/**
 * Browser-side helper scripts injected into the Modulus page via CDP Runtime.evaluate.
 * Discovers the live ModulusEngine (via window.__modulusEngine / window.__modulus if exposed,
 * or read-only React fiber inspection on #root as a fallback) and records rAF telemetry,
 * spline-progress probe crossings, corner window metrics, lap/sector events, and HUD DOM reads.
 */

export const INSTALL_INPAGE_HARNESS_SCRIPT = `(() => {
  if (window.__modulusPlaytest) return { alreadyInstalled: true };

  function findEngine() {
    if (window.__modulusEngine) return window.__modulusEngine;
    if (window.__modulus && window.__modulus.engine) return window.__modulus.engine;

    const root = document.getElementById('root');
    if (!root) return null;
    const queue = [root];
    const seen = new Set();
    let scanned = 0;

    // Locate React fiber on DOM tree and walk fiber graph for props.engine
    let rootFiber = null;
    while (queue.length && !rootFiber && scanned < 200) {
      const node = queue.shift();
      scanned++;
      for (const k of Object.keys(node)) {
        if (k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$')) {
          rootFiber = node[k];
          break;
        }
      }
      if (!rootFiber && node.children) {
        for (const ch of node.children) queue.push(ch);
      }
    }
    if (!rootFiber) return null;

    const fQueue = [rootFiber];
    let fScanned = 0;
    while (fQueue.length && fScanned < 800) {
      const f = fQueue.shift();
      if (!f || seen.has(f)) continue;
      seen.add(f);
      fScanned++;
      const props = f.memoizedProps || f.pendingProps;
      if (props && props.engine && typeof props.engine.getRuntimeState === 'function') {
        return props.engine;
      }
      if (f.child) fQueue.push(f.child);
      if (f.sibling) fQueue.push(f.sibling);
      if (f.return) fQueue.push(f.return);
    }
    return null;
  }

  function readHudDom() {
    const txt = document.body.innerText || '';
    const lines = txt.split('\\n').map((s) => s.trim()).filter(Boolean);
    const speedUnitIdx = lines.findIndex((l) => l === 'KM/H' || l === 'MPH');
    const speedUnit = speedUnitIdx >= 0 ? lines[speedUnitIdx] : null;
    const speedDisplayed = speedUnitIdx > 0 ? Number(lines[speedUnitIdx - 1]) : null;
    const gear = speedUnitIdx >= 0 ? lines[speedUnitIdx + 1] ?? null : null;
    const rpmText = speedUnitIdx >= 0 ? lines[speedUnitIdx + 2] ?? null : null;
    const lapLine = lines.find((l) => /^LAP \\d+/.test(l)) || null;
    const timeLine = lines.find((l) => /^\\d+:\\d{2}\\.\\d{3}$/.test(l)) || null;
    const bestLine = lines.find((l) => l.startsWith('BEST:')) || null;
    const inv = lines.includes('INV');
    const toastLines = lines.filter((l) => /LAP \\d+ COMPLETE/i.test(l));
    const s1Idx = lines.indexOf('S1');
    const s2Idx = lines.indexOf('S2');
    const s3Idx = lines.indexOf('S3');
    const aiBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      /ai driver/i.test(b.innerText)
    );
    const camBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      /^(cockpit|chase|hood|orbit)$/i.test(b.innerText.trim())
    );
    return {
      inTrackMode: speedUnitIdx >= 0,
      speedUnit,
      speedDisplayed: Number.isFinite(speedDisplayed) ? speedDisplayed : null,
      gear,
      rpmText,
      lapLine,
      timeLine,
      bestLine,
      sectors: [
        s1Idx >= 0 ? lines[s1Idx + 1] ?? null : null,
        s2Idx >= 0 ? lines[s2Idx + 1] ?? null : null,
        s3Idx >= 0 ? lines[s3Idx + 1] ?? null : null,
      ],
      inv,
      toastLines,
      aiButtonText: aiBtn ? aiBtn.innerText.trim() : null,
      cameraButtonText: camBtn ? camBtn.innerText.trim() : null,
    };
  }

  function normProgress(p) {
    if (typeof p !== 'number' || !Number.isFinite(p)) return 0;
    return ((p % 1) + 1) % 1;
  }

  function crossedForward(prevP, currP, targetP) {
    const a = normProgress(prevP);
    const b = normProgress(currP);
    const t = normProgress(targetP);
    if (a === b) return false;
    const delta = (b - a + 1) % 1;
    if (delta > 0.25) return false; // ignore resets / wrap jumps backwards
    if (a < b) return t > a && t <= b;
    // wrap-around across 1.0 -> 0.0
    return t > a || t <= b;
  }

  function inWindow(p, startP, endP) {
    const x = normProgress(p);
    const a = normProgress(startP);
    const b = normProgress(endP);
    if (a <= b) return x >= a && x <= b;
    return x >= a || x <= b;
  }

  const state = {
    running: false,
    rafId: 0,
    startedAtMs: 0,
    traceIntervalMs: 100,
    lastTraceMs: -1e9,
    prevProgress: null,
    prevPos: null,
    probes: [],
    probeHits: [],
    cornerWindows: [],
    cornerAccumulators: new Map(),
    trace: [],
    events: {
      sectors: [],
      laps: [],
    },
    unsubs: [],
  };

  function captureSample(engine, nowMs) {
    const rt = engine && typeof engine.getRuntimeState === 'function' ? engine.getRuntimeState() : null;
    const inp = engine && typeof engine.getInputState === 'function' ? engine.getInputState() : null;
    if (!rt) {
      return {
        tMs: Math.round(nowMs - state.startedAtMs),
        source: 'hud',
        hud: readHudDom(),
      };
    }
    return {
      tMs: Math.round(nowMs - state.startedAtMs),
      source: 'engine',
      lap: rt.currentLap,
      sector: rt.currentSector,
      lapTimeMs: Math.round(rt.currentLapTimeMs || 0),
      lapValid: Boolean(rt.lapValid),
      splineProgress: Number((rt.splineProgress ?? 0).toFixed(5)),
      speedKph: Number((rt.speedKph ?? 0).toFixed(2)),
      speedMs: Number((rt.speedMs ?? 0).toFixed(3)),
      gear: rt.gear,
      rpm: Math.round(rt.engineRpm ?? 0),
      lateralG: Number((rt.lateralG ?? 0).toFixed(3)),
      longitudinalG: Number((rt.longitudinalG ?? 0).toFixed(3)),
      yawRateRadS: Number((rt.yawRateRadS ?? 0).toFixed(4)),
      throttle: inp ? Number((inp.throttle ?? 0).toFixed(3)) : null,
      brake: inp ? Number((inp.brake ?? 0).toFixed(3)) : null,
      steer: inp ? Number((inp.steer ?? 0).toFixed(3)) : null,
      handbrake: inp ? Number((inp.handbrake ?? 0).toFixed(3)) : null,
      pos: rt.position
        ? {
            x: Number(rt.position.x.toFixed(2)),
            y: Number(rt.position.y.toFixed(2)),
            z: Number(rt.position.z.toFixed(2)),
          }
        : null,
    };
  }

  function stepCornerWindows(sample, prevPos) {
    const p = sample.splineProgress;
    let distStep = 0;
    if (prevPos && sample.pos) {
      distStep = Math.hypot(
        sample.pos.x - prevPos.x,
        sample.pos.y - prevPos.y,
        sample.pos.z - prevPos.z
      );
      if (distStep > 20) distStep = 0; // ignore teleport/reset
    }

    for (const cw of state.cornerWindows) {
      const key = cw.name + '#lap' + sample.lap;
      const inside = inWindow(p, cw.entryProgress, cw.exitProgress);
      let acc = state.cornerAccumulators.get(key);
      if (inside) {
        if (!acc) {
          acc = {
            name: cw.name,
            lap: sample.lap,
            entryProgress: cw.entryProgress,
            exitProgress: cw.exitProgress,
            entryTimeMs: sample.tMs,
            entrySpeedKph: sample.speedKph,
            minSpeedKph: sample.speedKph,
            minSpeedProgress: p,
            exitSpeedKph: sample.speedKph,
            exitTimeMs: sample.tMs,
            maxBrake: 0,
            brakingDistanceM: 0,
            peakLateralG: 0,
            peakYawRateRadS: 0,
            steerInputStartMs: null,
            steerResponseTimeMs: null,
            lapValidThroughout: sample.lapValid,
            samplesCount: 0,
          };
          state.cornerAccumulators.set(key, acc);
        }
        acc.samplesCount++;
        acc.exitSpeedKph = sample.speedKph;
        acc.exitTimeMs = sample.tMs;
        if (sample.speedKph < acc.minSpeedKph) {
          acc.minSpeedKph = sample.speedKph;
          acc.minSpeedProgress = p;
        }
        if ((sample.brake ?? 0) > acc.maxBrake) acc.maxBrake = sample.brake;
        if ((sample.brake ?? 0) > 0.1) acc.brakingDistanceM += distStep;
        if (Math.abs(sample.lateralG) > acc.peakLateralG) {
          acc.peakLateralG = Math.abs(sample.lateralG);
        }
        if (Math.abs(sample.yawRateRadS) > acc.peakYawRateRadS) {
          acc.peakYawRateRadS = Math.abs(sample.yawRateRadS);
        }
        if (acc.steerInputStartMs === null && Math.abs(sample.steer ?? 0) >= 0.15) {
          acc.steerInputStartMs = sample.tMs;
        }
        if (
          acc.steerInputStartMs !== null &&
          acc.steerResponseTimeMs === null &&
          (Math.abs(sample.yawRateRadS) >= 0.15 || Math.abs(sample.lateralG) >= 0.25)
        ) {
          acc.steerResponseTimeMs = Math.max(0, sample.tMs - acc.steerInputStartMs);
        }
        if (!sample.lapValid) acc.lapValidThroughout = false;
      }
    }
  }

  function startRecording(opts = {}) {
    stopRecording();
    const engine = findEngine();
    state.running = true;
    state.startedAtMs = performance.now();
    state.traceIntervalMs = opts.traceIntervalMs ?? 100;
    state.lastTraceMs = -1e9;
    state.prevProgress = null;
    state.prevPos = null;
    state.probes = Array.isArray(opts.probes) ? opts.probes.map(Number).filter(Number.isFinite) : [];
    state.probeHits = [];
    state.cornerWindows = Array.isArray(opts.cornerWindows) ? opts.cornerWindows : [];
    state.cornerAccumulators = new Map();
    state.trace = [];
    state.events = { sectors: [], laps: [] };

    if (engine && engine.events && typeof engine.events.on === 'function') {
      state.unsubs.push(
        engine.events.on('sector:split', (payload) => {
          state.events.sectors.push({
            tMs: Math.round(performance.now() - state.startedAtMs),
            ...payload,
          });
        })
      );
      state.unsubs.push(
        engine.events.on('lap:finished', (payload) => {
          state.events.laps.push({
            tMs: Math.round(performance.now() - state.startedAtMs),
            ...payload,
          });
        })
      );
    }

    const tick = (now) => {
      if (!state.running) return;
      state.rafId = requestAnimationFrame(tick);
      const sample = captureSample(engine, now);
      if (sample.source === 'engine') {
        if (state.prevProgress !== null) {
          for (const targetP of state.probes) {
            if (crossedForward(state.prevProgress, sample.splineProgress, targetP)) {
              state.probeHits.push({
                probe: targetP,
                ...sample,
              });
            }
          }
        }
        if (state.cornerWindows.length > 0) {
          stepCornerWindows(sample, state.prevPos);
        }
        state.prevProgress = sample.splineProgress;
        state.prevPos = sample.pos;
      }

      if (now - state.lastTraceMs >= state.traceIntervalMs) {
        state.lastTraceMs = now;
        state.trace.push(sample);
      }
    };
    state.rafId = requestAnimationFrame(tick);
    return {
      engineFound: Boolean(engine),
      activeTrackId: engine?.getActiveTrack?.()?.id ?? null,
      activeTrackName: engine?.getActiveTrack?.()?.name ?? null,
    };
  }

  function stopRecording() {
    state.running = false;
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
    for (const fn of state.unsubs) {
      try { fn(); } catch {}
    }
    state.unsubs = [];
  }

  function getReport() {
    const engine = findEngine();
    const cornerSummaries = Array.from(state.cornerAccumulators.values()).map((c) => ({
      ...c,
      brakingDistanceM: Number(c.brakingDistanceM.toFixed(2)),
      peakLateralG: Number(c.peakLateralG.toFixed(3)),
      peakYawRateRadS: Number(c.peakYawRateRadS.toFixed(4)),
    }));
    const rt = engine?.getRuntimeState?.();
    return {
      engineFound: Boolean(engine),
      activeTrack: engine?.getActiveTrack?.()
        ? { id: engine.getActiveTrack().id, name: engine.getActiveTrack().name }
        : null,
      hud: readHudDom(),
      finalRuntime: rt
        ? {
            lap: rt.currentLap,
            sector: rt.currentSector,
            lapTimeMs: Math.round(rt.currentLapTimeMs || 0),
            bestLapTimeMs: rt.bestLapTimeMs ?? null,
            lastLapTimeMs: rt.lastLapTimeMs ?? null,
            sectorTimesMs: rt.sectorTimesMs ?? [],
            lapValid: Boolean(rt.lapValid),
            splineProgress: Number((rt.splineProgress ?? 0).toFixed(5)),
            speedKph: Number((rt.speedKph ?? 0).toFixed(2)),
            gear: rt.gear,
            rpm: Math.round(rt.engineRpm ?? 0),
          }
        : null,
      events: state.events,
      probeHits: state.probeHits,
      cornerSummaries,
      traceCount: state.trace.length,
      trace: state.trace,
    };
  }

  window.__modulusPlaytest = {
    findEngine,
    readHudDom,
    startRecording,
    stopRecording,
    getReport,
  };
  return { installed: true, engineFound: Boolean(findEngine()) };
})()`;
