import { useCallback, useEffect, useRef, useState } from 'react';
import { TRACKS_BY_ID } from '../content';
import type { ModulusEngine } from '../core/Engine';
import type { StorageSync } from '../core/StorageSync';
import type {
  IAuthUser,
  ICompiledVehicle,
  IGlobalBalanceConfig,
  ITrackSplineSchema,
  IVehicleBuildConfig,
} from '../core/types';
import type { SessionMode } from '../contracts/simulation';
import { DebriefModal, type IDebriefReport } from './debrief/DebriefModal';
import {
  normalizeLapFinishedEvent,
  setCameraPresetSafe,
  setSimulationPausedSafe,
  syncAssistsToEngine,
  syncKeyBindingsToEngine,
} from './engineBridge';
import { GarageHome } from './garage/GarageHome';
import { DriveHud } from './hud';
import { EngineeringLab } from './lab';
import { CircuitModal } from './lab/CircuitModal';
import { SettingsModal } from './settings/SettingsModal';
import {
  getPlayerSettings,
  getResumableSession,
  recordLocalLapAttempt,
  saveResumableSession,
  subscribePlayerSettings,
  updatePlayerSettings,
  type PlayerSettings,
  type ResumableSession,
} from './settingsStore';
import { TitleScreen } from './title/TitleScreen';

export interface IAppShellProps {
  engine: ModulusEngine;
  storage: StorageSync;
}

type AppScreen = 'title' | 'garage' | 'lab' | 'drive';

const PREFERRED_FIRST_SLICE_TRACK = 'track_switchyard_sprint';

export function AppShell({ engine, storage }: IAppShellProps) {
  const [screen, setScreen] = useState<AppScreen>('title');
  const [settings, setSettings] = useState<PlayerSettings>(() => getPlayerSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [circuitModalOpen, setCircuitModalOpen] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>('practice');
  const [resumableSession, setResumableSession] = useState<ResumableSession | null>(() =>
    getResumableSession()
  );

  const [compiled, setCompiled] = useState<ICompiledVehicle>(() => engine.getCompiledVehicle());
  const [activeTrack, setActiveTrack] = useState<ITrackSplineSchema>(() =>
    engine.getActiveTrack()
  );
  const [balanceConfig, setBalanceConfig] = useState<IGlobalBalanceConfig>(() =>
    engine.getBalanceConfig()
  );
  const [credits, setCredits] = useState<number>(() => storage.getCredits());
  const [savedBuilds, setSavedBuilds] = useState<IVehicleBuildConfig[]>(
    () => storage.getGarageState().savedBuilds
  );
  const [user, setUser] = useState<IAuthUser | null>(() => storage.getUser());

  const [activeDebrief, setActiveDebrief] = useState<IDebriefReport | null>(null);
  const [lastDebrief, setLastDebrief] = useState<IDebriefReport | null>(null);
  const lapPeaksRef = useRef({ peakLockup: 0, peakScrub: 0 });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const sessionModeRef = useRef(sessionMode);
  sessionModeRef.current = sessionMode;

  // Show CG/Aero overlays only inside Engineering Lab (keep Title & Garage Bay clean)
  useEffect(() => {
    if (screen === 'title' || screen === 'garage') {
      engine.setLabOverlayOptions({
        cgSphere: false,
        aeroVectors: false,
        wireframe: false,
        highlightedModule: null,
      });
    } else if (screen === 'lab') {
      engine.setLabOverlayOptions({
        cgSphere: true,
        aeroVectors: true,
      });
    }
  }, [engine, screen]);

  // Prefer Switchyard Sprint on fresh launch once integrated into TRACKS_CATALOG
  useEffect(() => {
    if (
      !getResumableSession() &&
      TRACKS_BY_ID.has(PREFERRED_FIRST_SLICE_TRACK) &&
      engine.getActiveTrack().id !== PREFERRED_FIRST_SLICE_TRACK
    ) {
      engine.selectTrack(PREFERRED_FIRST_SLICE_TRACK);
    }
  }, [engine]);

  // Sync player settings -> engine (camera, assists, keybindings)
  useEffect(() => {
    syncAssistsToEngine(engine, {
      transmissionMode: settings.transmissionMode,
      assistPreset: settings.assistPreset,
    });
    syncKeyBindingsToEngine(engine, settings.keyBindings);
  }, [engine, settings.transmissionMode, settings.assistPreset, settings.keyBindings]);

  useEffect(() => {
    const unsubSettings = subscribePlayerSettings((next) => {
      setSettings(next);
    });

    const unsubs = [
      unsubSettings,
      engine.events.on('mode:changed', ({ mode }) => {
        if (mode === 'track') {
          setScreen('drive');
          setSimulationPausedSafe(engine, false);
        } else {
          setSimulationPausedSafe(engine, false);
          setActiveDebrief(null);
          setScreen((prev) => (prev === 'drive' ? 'garage' : prev));
        }
      }),
      engine.events.on('car:rebuilt', ({ compiled: c }) => {
        setCompiled(c);
        setSavedBuilds([...storage.getGarageState().savedBuilds]);
      }),
      engine.events.on('track:selected', ({ schema }) => setActiveTrack(schema)),
      engine.events.on('config:updated', ({ config }) => setBalanceConfig(config)),
      engine.events.on('economy:updated', ({ credits: cr }) => setCredits(cr)),
      engine.events.on('auth:changed', ({ user: u }) => {
        setUser(u);
        setSavedBuilds([...storage.getGarageState().savedBuilds]);
      }),
      engine.events.on('lap:finished', (rawPayload) => {
        const track = engine.getActiveTrack();
        const cfg = engine.getBalanceConfig();
        const currentBuild = engine.getCompiledVehicle().build;
        const normalized = normalizeLapFinishedEvent(
          { ...(rawPayload as unknown as Record<string, unknown>), sessionMode: sessionModeRef.current },
          track
        );

        const aiScale = normalized.isAiAssisted ? 0.35 : 1.0;
        const rewardCr = normalized.lapValid
          ? Math.max(
              250,
              Math.round(track.baseLapRewardCredits * cfg.economy_bias.payout_mult * aiScale)
            )
          : 0;

        const pbResult = recordLocalLapAttempt({
          id: `${Date.now()}_${normalized.lapNumber}`,
          timestamp: new Date().toISOString(),
          trackId: normalized.trackId,
          trackVersion: normalized.trackVersion,
          balanceVersionId: normalized.balanceVersionId,
          rulesetVersion: normalized.rulesetVersion,
          buildId: normalized.buildId,
          buildName: currentBuild.name,
          chassisId: normalized.chassisId,
          lapNumber: normalized.lapNumber,
          lapTimeMs: normalized.lapTimeMs,
          sectorTimesMs: normalized.sectorTimesMs,
          sectorNames: normalized.sectorNames,
          peakSpeedMs: normalized.peakSpeedMs,
          lapValid: normalized.lapValid,
          isAiAssisted: normalized.isAiAssisted,
        });

        const nextSession: ResumableSession = {
          trackId: track.id,
          buildId: currentBuild.id,
          buildName: currentBuild.name,
          trackName: track.name,
          lastPlayedAt: new Date().toISOString(),
          lastLapTimeMs: normalized.lapTimeMs,
        };
        saveResumableSession(nextSession);
        setResumableSession(nextSession);

        const report: IDebriefReport = {
          event: normalized,
          buildName: currentBuild.name,
          track,
          rewardCr,
          isNewBestLap: pbResult.isNewBestLap,
          bestLapTimeMs: pbResult.pbAfter.bestLapTimeMs,
          deltaToBestLapMs: pbResult.deltaToBestLapMs,
          deltaToPrevLapMs: pbResult.deltaToPrevLapMs,
          sectorDeltasMs: pbResult.sectorDeltasMs,
          peakLockup: lapPeaksRef.current.peakLockup,
          peakScrub: lapPeaksRef.current.peakScrub,
        };
        setLastDebrief(report);

        // Open readable Debrief automatically for human laps (keep AI laps rolling smoothly)
        if (settingsRef.current.autoDebriefOnLap && !normalized.isAiAssisted) {
          setActiveDebrief(report);
          setSimulationPausedSafe(engine, true);
        }
      }),
    ];

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [engine, storage]);

  const handleLaunchDrive = useCallback(
    (aiEnabled: boolean) => {
      const track = engine.getActiveTrack();
      const build = engine.getCompiledVehicle().build;
      const nextSession: ResumableSession = {
        trackId: track.id,
        buildId: build.id,
        buildName: build.name,
        trackName: track.name,
        lastPlayedAt: new Date().toISOString(),
        lastLapTimeMs: resumableSession?.lastLapTimeMs ?? null,
      };
      saveResumableSession(nextSession);
      setResumableSession(nextSession);

      setActiveDebrief(null);
      setCameraPresetSafe(engine, settingsRef.current.defaultCamera);
      engine.setAiEnabled(aiEnabled);
      engine.setVisualMode('track');
      setSimulationPausedSafe(engine, false);
      setScreen('drive');
    },
    [engine, resumableSession?.lastLapTimeMs]
  );

  const handleContinueDriving = useCallback(() => {
    if (resumableSession) {
      const saved = storage
        .getGarageState()
        .savedBuilds.find((b) => b.id === resumableSession.buildId);
      if (saved) engine.updateBuild(saved);
      if (TRACKS_BY_ID.has(resumableSession.trackId)) {
        engine.selectTrack(resumableSession.trackId);
      }
    }
    handleLaunchDrive(false);
  }, [engine, storage, resumableSession, handleLaunchDrive]);

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
    if (engine.getVisualMode() === 'track') {
      setSimulationPausedSafe(engine, true);
    }
  }, [engine]);

  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false);
    if (engine.getVisualMode() === 'track' && !activeDebrief) {
      setSimulationPausedSafe(engine, false);
    }
  }, [engine, activeDebrief]);

  const handleTelemetryPeaks = useCallback((peaks: { peakLockup: number; peakScrub: number }) => {
    lapPeaksRef.current = peaks;
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 h-[100dvh] w-screen overflow-hidden">
      {screen === 'title' && (
        <TitleScreen
          compiled={compiled}
          activeTrack={activeTrack}
          settings={settings}
          resumableSession={resumableSession}
          user={user}
          onEnterGarage={() => setScreen('garage')}
          onContinueDriving={handleContinueDriving}
          onOpenSettings={handleOpenSettings}
          onOpenAuth={() => engine.events.emit('auth:open-modal', undefined)}
        />
      )}

      {screen === 'garage' && (
        <GarageHome
          engine={engine}
          storage={storage}
          compiled={compiled}
          savedBuilds={savedBuilds}
          activeTrack={activeTrack}
          balanceConfig={balanceConfig}
          credits={credits}
          user={user}
          settings={settings}
          sessionMode={sessionMode}
          onChangeSessionMode={setSessionMode}
          onSelectBuild={(b) => engine.updateBuild(b)}
          onBuildsChanged={() => setSavedBuilds([...storage.getGarageState().savedBuilds])}
          onOpenLab={(mode) => {
            updatePlayerSettings({ labMode: mode });
            setScreen('lab');
          }}
          onOpenCircuitModal={() => setCircuitModalOpen(true)}
          onOpenSettings={handleOpenSettings}
          onOpenAuth={() => engine.events.emit('auth:open-modal', undefined)}
          onLaunchDrive={handleLaunchDrive}
        />
      )}

      <EngineeringLab
        engine={engine}
        storage={storage}
        visible={screen === 'lab'}
        settings={settings}
        onBackToGarage={() => setScreen('garage')}
        onOpenSettings={handleOpenSettings}
        onLaunchDrive={handleLaunchDrive}
      />

      <DriveHud
        engine={engine}
        storage={storage}
        settings={settings}
        debriefOpen={Boolean(activeDebrief)}
        onBackToGarage={() => {
          setActiveDebrief(null);
          setSimulationPausedSafe(engine, false);
          engine.setVisualMode('lab');
          setScreen('garage');
        }}
        onOpenLab={() => {
          setActiveDebrief(null);
          setSimulationPausedSafe(engine, false);
          engine.setVisualMode('lab');
          setScreen('lab');
        }}
        onOpenSettings={handleOpenSettings}
        onOpenLastDebrief={
          lastDebrief
            ? () => {
                setActiveDebrief(lastDebrief);
                setSimulationPausedSafe(engine, true);
              }
            : undefined
        }
        onTelemetryPeaks={handleTelemetryPeaks}
      />

      <DebriefModal
        report={activeDebrief}
        speedUnit={settings.speedUnit}
        onRetryLap={() => {
          setActiveDebrief(null);
          setSimulationPausedSafe(engine, false);
          engine.resetVehicleToStart();
        }}
        onContinueRolling={() => {
          setActiveDebrief(null);
          setSimulationPausedSafe(engine, false);
        }}
        onAdjustCar={() => {
          setActiveDebrief(null);
          setSimulationPausedSafe(engine, false);
          engine.setVisualMode('lab');
          setScreen('lab');
        }}
        onBackToGarage={() => {
          setActiveDebrief(null);
          setSimulationPausedSafe(engine, false);
          engine.setVisualMode('lab');
          setScreen('garage');
        }}
      />

      <CircuitModal
        open={circuitModalOpen}
        onClose={() => setCircuitModalOpen(false)}
        engine={engine}
        storage={storage}
        activeTrackId={activeTrack.id}
        balanceVersionId={balanceConfig.version_id}
        onSelectTrack={(id) => engine.selectTrack(id)}
        onLaunchDrive={handleLaunchDrive}
      />

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onClose={handleCloseSettings}
      />
    </div>
  );
}
