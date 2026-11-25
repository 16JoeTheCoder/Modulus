import type {
  IEngineContext,
  IModulusPlugin,
  IVehicleRuntimeState,
} from '../../core/types';
import { readVehicleSnapshot } from '../../ui/engineBridge';
import { getPlayerSettings, type PlayerSettings } from '../../ui/settingsStore';

/**
 * Procedural Web Audio Cockpit Sound Synthesizer
 *
 * Synthesizes real-time driving cues with zero external audio assets:
 * - Engine fundamental + harmonic overtones scaled by RPM, cylinder layout & load
 * - Turbo spool whistle when forced induction is equipped
 * - Gear shift ignition cut & mechanical clunk cue
 * - Tire scrub & brake lockup filtered noise (rises BEFORE full slide)
 * - Kerb rumble & off-track gravel/grass hiss
 * - Wall/contact impact thud triggered once per impact sequence
 */
class AudioSynthController implements IModulusPlugin {
  public readonly id = 'audio-synth';
  public readonly version = '1.0.0';
  public readonly priority = 95;

  private ctx: IEngineContext | null = null;
  private audioCtx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private surfaceGain: GainNode | null = null;

  // Engine nodes
  private oscPrimary: OscillatorNode | null = null;
  private oscHarmonic: OscillatorNode | null = null;
  private oscSub: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private oscTurbo: OscillatorNode | null = null;
  private turboGain: GainNode | null = null;

  // Tire scrub + lockup + surface noise nodes
  private scrubFilter: BiquadFilterNode | null = null;
  private scrubGain: GainNode | null = null;
  private lockupFilter: BiquadFilterNode | null = null;
  private lockupGain: GainNode | null = null;
  private surfaceFilter: BiquadFilterNode | null = null;
  private surfaceNoiseGain: GainNode | null = null;

  // Kerb rumble oscillator
  private kerbOsc: OscillatorNode | null = null;
  private kerbGain: GainNode | null = null;

  // Runtime state tracking
  private settings: PlayerSettings = getPlayerSettings();
  private prevGear = 1;
  private prevShifting = false;
  private lastImpactSeq = -1;
  private prevTotalG = 0;
  private shiftDipUntilSec = 0;
  private unsubs: Array<() => void> = [];

  private boundUnlock: () => void;
  private boundSettings: () => void;
  private boundVisibility: () => void;

  constructor() {
    this.boundUnlock = () => this.ensureAudioUnlocked();
    this.boundSettings = () => {
      this.settings = getPlayerSettings();
      this.applyVolumes();
    };
    this.boundVisibility = () => {
      if (typeof document !== 'undefined' && document.hidden && this.masterGain && this.audioCtx) {
        this.masterGain.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.03);
      }
    };
  }

  public init(ctx: IEngineContext): void {
    this.ctx = ctx;
    this.settings = getPlayerSettings();

    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', this.boundUnlock, { passive: true });
      window.addEventListener('keydown', this.boundUnlock, { passive: true });
      window.addEventListener('modulus:settings-changed', this.boundSettings);
      document.addEventListener('visibilitychange', this.boundVisibility);
    }

    this.unsubs.push(
      ctx.events.on('mode:changed', ({ mode }) => {
        if (mode === 'track') {
          this.ensureAudioUnlocked();
        } else if (this.masterGain && this.audioCtx) {
          this.masterGain.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.06);
        }
      }),
      ctx.events.on('vehicle:reset', () => {
        this.prevGear = 1;
        this.prevShifting = false;
        this.prevTotalG = 0;
      })
    );
  }

  private ensureAudioUnlocked(): void {
    if (typeof window === 'undefined') return;
    const AudioCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;

    try {
      if (!this.audioCtx) {
        const ac = new AudioCtor();
        this.audioCtx = ac;
        this.buildAudioGraph(ac);
      }
      if (this.audioCtx.state === 'suspended') {
        void this.audioCtx.resume().catch(() => undefined);
      }
    } catch {
      // Headless or restricted audio environment — fail silently
    }
  }

  private buildAudioGraph(ac: AudioContext): void {
    const master = ac.createGain();
    master.gain.value = 0;
    master.connect(ac.destination);
    this.masterGain = master;

    // 1. Engine chain: 3 oscillators -> resonant low-pass filter -> engineGain -> master
    const engGain = ac.createGain();
    engGain.gain.value = 0.25;
    engGain.connect(master);
    this.engineGain = engGain;

    const engFilter = ac.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 320;
    engFilter.Q.value = 2.4;
    engFilter.connect(engGain);
    this.engineFilter = engFilter;

    const pGain = ac.createGain();
    pGain.gain.value = 0.55;
    pGain.connect(engFilter);
    const oscPrimary = ac.createOscillator();
    oscPrimary.type = 'sawtooth';
    oscPrimary.frequency.value = 55;
    oscPrimary.connect(pGain);
    oscPrimary.start();
    this.oscPrimary = oscPrimary;

    const hGain = ac.createGain();
    hGain.gain.value = 0.28;
    hGain.connect(engFilter);
    const oscHarmonic = ac.createOscillator();
    oscHarmonic.type = 'triangle';
    oscHarmonic.frequency.value = 110;
    oscHarmonic.connect(hGain);
    oscHarmonic.start();
    this.oscHarmonic = oscHarmonic;

    const sGain = ac.createGain();
    sGain.gain.value = 0.35;
    sGain.connect(engFilter);
    const oscSub = ac.createOscillator();
    oscSub.type = 'sine';
    oscSub.frequency.value = 27.5;
    oscSub.connect(sGain);
    oscSub.start();
    this.oscSub = oscSub;

    // Turbo spool whine
    const turboGain = ac.createGain();
    turboGain.gain.value = 0;
    turboGain.connect(engGain);
    const oscTurbo = ac.createOscillator();
    oscTurbo.type = 'sine';
    oscTurbo.frequency.value = 1600;
    oscTurbo.connect(turboGain);
    oscTurbo.start();
    this.oscTurbo = oscTurbo;
    this.turboGain = turboGain;

    // 2. Shared white-noise buffer for tire scrub, brake lockup chirp & off-track gravel hiss
    const surfGain = ac.createGain();
    surfGain.gain.value = 0.28;
    surfGain.connect(master);
    this.surfaceGain = surfGain;

    const bufferLen = ac.sampleRate * 2;
    const noiseBuf = ac.createBuffer(1, bufferLen, ac.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufferLen; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseSrc = ac.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    noiseSrc.loop = true;

    // Tire scrub band-pass (700–1450 Hz)
    const scrubFilter = ac.createBiquadFilter();
    scrubFilter.type = 'bandpass';
    scrubFilter.frequency.value = 880;
    scrubFilter.Q.value = 3.2;
    const scrubGain = ac.createGain();
    scrubGain.gain.value = 0;
    noiseSrc.connect(scrubFilter);
    scrubFilter.connect(scrubGain);
    scrubGain.connect(surfGain);
    this.scrubFilter = scrubFilter;
    this.scrubGain = scrubGain;

    // Brake lockup higher squeal/chirp band (1650–2400 Hz)
    const lockupFilter = ac.createBiquadFilter();
    lockupFilter.type = 'bandpass';
    lockupFilter.frequency.value = 1850;
    lockupFilter.Q.value = 6.5;
    const lockupGain = ac.createGain();
    lockupGain.gain.value = 0;
    noiseSrc.connect(lockupFilter);
    lockupFilter.connect(lockupGain);
    lockupGain.connect(surfGain);
    this.lockupFilter = lockupFilter;
    this.lockupGain = lockupGain;

    // Off-track grass/gravel rumble band (240–520 Hz)
    const surfaceFilter = ac.createBiquadFilter();
    surfaceFilter.type = 'bandpass';
    surfaceFilter.frequency.value = 360;
    surfaceFilter.Q.value = 1.1;
    const surfaceNoiseGain = ac.createGain();
    surfaceNoiseGain.gain.value = 0;
    noiseSrc.connect(surfaceFilter);
    surfaceFilter.connect(surfaceNoiseGain);
    surfaceNoiseGain.connect(surfGain);
    this.surfaceFilter = surfaceFilter;
    this.surfaceNoiseGain = surfaceNoiseGain;

    noiseSrc.start();

    // 3. Kerb tactile rumble oscillator
    const kerbGain = ac.createGain();
    kerbGain.gain.value = 0;
    kerbGain.connect(surfGain);
    const kerbOsc = ac.createOscillator();
    kerbOsc.type = 'triangle';
    kerbOsc.frequency.value = 42;
    kerbOsc.connect(kerbGain);
    kerbOsc.start();
    this.kerbOsc = kerbOsc;
    this.kerbGain = kerbGain;

    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.audioCtx || !this.engineGain || !this.surfaceGain) return;
    const now = this.audioCtx.currentTime;
    this.engineGain.gain.setTargetAtTime(0.24 * this.settings.engineVolume, now, 0.04);
    this.surfaceGain.gain.setTargetAtTime(0.26 * this.settings.tireSurfaceVolume, now, 0.04);
  }

  private triggerShiftClunk(isUpshift: boolean): void {
    if (!this.audioCtx || !this.masterGain || this.settings.muted) return;
    const ac = this.audioCtx;
    const now = ac.currentTime;
    this.shiftDipUntilSec = now + 0.085;

    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isUpshift ? 135 : 170, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.075);
    g.gain.setValueAtTime(0.18 * this.settings.engineVolume, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.085);
  }

  private triggerImpactThud(intensity01: number): void {
    if (!this.audioCtx || !this.masterGain || this.settings.muted) return;
    const ac = this.audioCtx;
    const now = ac.currentTime;
    const clamped = Math.max(0.1, Math.min(1, intensity01));

    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(115 + clamped * 45, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.16);
    g.gain.setValueAtTime(0.42 * clamped * this.settings.tireSurfaceVolume, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  public onRender(_alpha: number, _state: IVehicleRuntimeState): void {
    if (!this.ctx || !this.audioCtx || !this.masterGain) return;
    if (this.audioCtx.state !== 'running') return;

    const now = this.audioCtx.currentTime;
    const inTrack = this.ctx.getVisualMode() === 'track';
    const isHidden = typeof document !== 'undefined' && document.hidden;
    const isPaused = Boolean(
      (this.ctx as unknown as { isSimulationPaused?: () => boolean }).isSimulationPaused?.()
    );

    if (!inTrack || this.settings.muted || isHidden || isPaused) {
      this.masterGain.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    const snap = readVehicleSnapshot(this.ctx);
    const compiled = this.ctx.getCompiledVehicle();

    const targetMaster = Math.max(0, Math.min(1, this.settings.masterVolume));
    const shiftCutScale = now < this.shiftDipUntilSec ? 0.42 : 1.0;
    this.masterGain.gain.setTargetAtTime(targetMaster * shiftCutScale, now, 0.025);

    // Cylinder-aware firing fundamental
    const layout = compiled.build.engine.layout;
    const firingMult =
      layout === 'V8'
        ? 4.0
        : layout === 'V6' || layout === 'I6'
        ? 3.0
        : layout === 'Rotary'
        ? 3.5
        : layout === 'Flat-4'
        ? 1.92
        : 2.0;

    const rpm = Math.max(650, snap.engineRpm);
    const baseFreq = Math.max(30, (rpm / 60) * firingMult * 0.5);
    const harmonicMult = layout === 'Flat-4' ? 1.5 : 2.0;

    this.oscPrimary?.frequency.setTargetAtTime(baseFreq, now, 0.022);
    this.oscHarmonic?.frequency.setTargetAtTime(baseFreq * harmonicMult, now, 0.022);
    this.oscSub?.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.028);

    // Filter opens with throttle / engine load & RPM
    const rpmNorm = Math.max(0, Math.min(1, (rpm - snap.idleRpm) / Math.max(1000, snap.redlineRpm - snap.idleRpm)));
    const cutoffHz = 180 + snap.engineLoad * 1250 + rpmNorm * 950;
    this.engineFilter?.frequency.setTargetAtTime(cutoffHz, now, 0.03);

    // Turbo spool cue
    if (this.oscTurbo && this.turboGain) {
      const boostNorm =
        snap.maxBoostBar > 0 ? Math.max(0, Math.min(1, snap.turboBoostBar / snap.maxBoostBar)) : 0;
      this.oscTurbo.frequency.setTargetAtTime(1400 + boostNorm * 2400, now, 0.04);
      this.turboGain.gain.setTargetAtTime(boostNorm * 0.08, now, 0.05);
    }

    // Shift detection cue
    const shifted =
      (snap.isShifting && !this.prevShifting) ||
      (snap.gear !== this.prevGear && snap.gear !== 0 && this.prevGear !== 0);
    if (shifted) {
      this.triggerShiftClunk(snap.gear >= this.prevGear);
    }
    this.prevGear = snap.gear;
    this.prevShifting = snap.isShifting;

    // Tire scrub, brake lockup, kerb & off-track surface cues
    let maxScrub = 0;
    let maxLockup = 0;
    let kerbWheels = 0;
    let offTrackWheels = 0;

    for (let i = 0; i < 4; i++) {
      const w = snap.wheels[i];
      if (!w.grounded) continue;
      if (w.scrubIntensity > maxScrub) maxScrub = w.scrubIntensity;
      if (w.lockupIntensity > maxLockup) maxLockup = w.lockupIntensity;
      if (w.surface === 'kerb') kerbWheels++;
      if (w.surface === 'grass' || w.surface === 'gravel' || w.surface === 'dirt') offTrackWheels++;
    }

    const speedFactor = Math.max(0, Math.min(1, snap.speedMs / 18));
    // Early tire scrub cue (audible from 0.16 scrub onward so driver feels grip approaching limit)
    const scrubLevel = maxScrub > 0.16 ? Math.min(1, (maxScrub - 0.16) / 0.72) * speedFactor : 0;
    this.scrubGain?.gain.setTargetAtTime(scrubLevel * 0.52, now, 0.035);
    this.scrubFilter?.frequency.setTargetAtTime(720 + scrubLevel * 620, now, 0.04);

    // Brake lockup chirp
    const lockupLevel = maxLockup > 0.18 ? Math.min(1, (maxLockup - 0.18) / 0.65) * speedFactor : 0;
    this.lockupGain?.gain.setTargetAtTime(lockupLevel * 0.36, now, 0.025);
    this.lockupFilter?.frequency.setTargetAtTime(1650 + lockupLevel * 580, now, 0.03);

    // Off-track grass/gravel hiss
    const offTrackLevel = offTrackWheels > 0 ? Math.min(1, (offTrackWheels / 4) * speedFactor * 1.15) : 0;
    this.surfaceNoiseGain?.gain.setTargetAtTime(offTrackLevel * 0.45, now, 0.05);
    this.surfaceFilter?.frequency.setTargetAtTime(280 + speedFactor * 260, now, 0.05);

    // Kerb tactile rumble
    const kerbLevel = kerbWheels > 0 && snap.speedMs > 2 ? Math.min(1, (kerbWheels / 2) * speedFactor) : 0;
    this.kerbGain?.gain.setTargetAtTime(kerbLevel * 0.34, now, 0.02);
    this.kerbOsc?.frequency.setTargetAtTime(24 + Math.min(72, snap.speedMs * 2.6), now, 0.025);

    // Impact pulse cue (contract `lastImpact` or fallback sudden G spike)
    if (snap.lastImpact && snap.lastImpact.seq !== this.lastImpactSeq) {
      this.lastImpactSeq = snap.lastImpact.seq;
      this.triggerImpactThud(snap.lastImpact.intensity01);
    } else {
      const totalG = Math.hypot(snap.longitudinalG, snap.lateralG);
      if (totalG - this.prevTotalG > 3.6 && snap.speedMs > 3) {
        this.triggerImpactThud(Math.min(1, (totalG - 3.0) / 5.0));
      }
      this.prevTotalG = totalG;
    }
  }

  public dispose(): void {
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];

    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this.boundUnlock);
      window.removeEventListener('keydown', this.boundUnlock);
      window.removeEventListener('modulus:settings-changed', this.boundSettings);
      document.removeEventListener('visibilitychange', this.boundVisibility);
    }

    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => undefined);
      this.audioCtx = null;
    }
    this.masterGain = null;
    this.ctx = null;
  }
}

export const audioSynthPlugin: IModulusPlugin = new AudioSynthController();
