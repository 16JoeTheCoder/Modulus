import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModulusEngine } from '../../core/Engine';
import type { ITrackGeometryData, ITrackSplineSchema } from '../../core/types';
import {
  FIXED_SIM_DT,
  type ITrackCollisionHandle,
  type IVehicleStateSnapshot,
  type SessionMode,
} from '../../contracts/simulation';
import { isProgressInSpan } from '../../core/math/spline';
import {
  getTrackVersion,
  readVehicleSnapshot,
  subscribeFixedStepSafe,
} from '../engineBridge';
import {
  driftPenaltyLabel,
  getTrackDriftBest,
  makeDriftPartitionKey,
  recordLocalDriftRun,
  type DriftEvent,
  type DriftFeedBadge,
  type DriftGrade,
  type IDriftLiveState,
  type IDriftRunSummary,
} from './driftSessionStore';
import type { IDriftDebriefReport } from './DriftDebriefModal';

const MIN_SPEED_MS = 6.0;
const MIN_ANGLE_RAD = 0.14; // ~8 deg
const SPINOUT_ANGLE_RAD = 1.28; // ~73 deg
const TRANSITION_GRACE_S = 1.45;
const BASE_POINTS_PER_SEC = 180;
const MAX_MULTIPLIER = 4.0;

function scoreToGrade(score: number, cleanRun: boolean): DriftGrade {
  if (score >= 22000 && cleanRun) return 'S';
  if (score >= 15000) return 'A';
  if (score >= 9000) return 'B';
  if (score >= 4000) return 'C';
  return 'D';
}

function createEmptyLiveState(runNumber = 1): IDriftLiveState {
  return {
    vehicleId: 'v0',
    runNumber,
    inDriftZone: false,
    activeZoneId: null,
    isDrifting: false,
    driftDirection: 0,
    driftAngleDeg: 0,
    lineBonusMult: 1.0,
    activeComboPoints: 0,
    comboMultiplier: 1.0,
    chainCount: 0,
    bankedScore: 0,
    projectedTotalScore: 0,
    activeDriftDurationS: 0,
    transitionGraceRemainingS: 0,
    cleanRun: true,
  };
}

interface InternalRunAcc {
  runNumber: number;
  inDriftZone: boolean;
  activeZoneId: string | null;
  activeZoneName: string | null;
  isDrifting: boolean;
  driftDirection: -1 | 0 | 1;
  driftAngleDeg: number;
  lineBonusMult: number;
  activeComboPoints: number;
  comboMultiplier: number;
  chainCount: number;
  bankedScore: number;
  bestComboScore: number;
  maxChainCount: number;
  maxMultiplier: number;
  maxDriftAngleDeg: number;
  angleDegAccum: number;
  driftingSteps: number;
  zoneSteps: number;
  activeDriftDurationS: number;
  totalDriftDurationS: number;
  transitionGraceRemainingS: number;
  offTrackSteps: number;
  offTrackPenaltyApplied: boolean;
  lastImpactSeqSeen: number;
  cleanRun: boolean;
  penaltiesCount: number;
}

function createFreshAcc(runNumber: number, lastImpactSeqSeen = -1): InternalRunAcc {
  return {
    runNumber,
    inDriftZone: false,
    activeZoneId: null,
    activeZoneName: null,
    isDrifting: false,
    driftDirection: 0,
    driftAngleDeg: 0,
    lineBonusMult: 1.0,
    activeComboPoints: 0,
    comboMultiplier: 1.0,
    chainCount: 0,
    bankedScore: 0,
    bestComboScore: 0,
    maxChainCount: 0,
    maxMultiplier: 1.0,
    maxDriftAngleDeg: 0,
    angleDegAccum: 0,
    driftingSteps: 0,
    zoneSteps: 0,
    activeDriftDurationS: 0,
    totalDriftDurationS: 0,
    transitionGraceRemainingS: 0,
    offTrackSteps: 0,
    offTrackPenaltyApplied: false,
    lastImpactSeqSeen,
    cleanRun: true,
    penaltiesCount: 0,
  };
}

function getDriftZonesForTrack(
  track: ITrackSplineSchema,
  geom: ITrackGeometryData | null
): Array<{ id: string; name: string; startT: number; endT: number }> {
  const extGeom = geom as (ITrackGeometryData & { collisionHandle?: ITrackCollisionHandle }) | null;
  const colZones = extGeom?.collisionHandle?.zones?.filter((z) => z.kind === 'drift') ?? [];
  if (colZones.length > 0) return colZones;
  const schemaZones = track.driftZones ?? [];
  if (schemaZones.length > 0) return schemaZones;
  return [];
}

/**
 * React hook driving the Drift HUD & Drift Debrief from `DriftScorer`-compatible events.
 * - Subscribes to native EventBus `drift:*` events when emitted by engine/courses scorer.
 * - Runs an exact `DriftScorer`-compatible client stepper while in `sessionMode === 'drift'`
 *   so Drift HUD & Drift Debrief work live on both Dockyard Drift Park and Switchyard Sprint.
 * - Keeps all drift scores strictly isolated from Time Trial lap records (`eligibleForLapRecords: false`).
 */
export function useDriftSession(
  engine: ModulusEngine,
  sessionMode: SessionMode,
  isDriving: boolean,
  onRunDebrief: (report: IDriftDebriefReport) => void
): {
  liveState: IDriftLiveState;
  activeZoneName: string | null;
  bestDriftScore: number | null;
  feedBadges: DriftFeedBadge[];
  finishCurrentRun: () => void;
  resetDriftRun: () => void;
} {
  const active = isDriving && sessionMode === 'drift';
  const [liveState, setLiveState] = useState<IDriftLiveState>(() => createEmptyLiveState(1));
  const [activeZoneName, setActiveZoneName] = useState<string | null>(null);
  const [feedBadges, setFeedBadges] = useState<DriftFeedBadge[]>([]);
  const [bestDriftScore, setBestDriftScore] = useState<number | null>(null);

  const accRef = useRef<InternalRunAcc>(createFreshAcc(1));
  const badgeSeqRef = useRef(1);
  const externalEventsSeenRef = useRef(false);
  const onRunDebriefRef = useRef(onRunDebrief);
  onRunDebriefRef.current = onRunDebrief;

  const pushBadge = useCallback(
    (kind: DriftFeedBadge['kind'], label: string, detail?: string) => {
      const id = badgeSeqRef.current++;
      const createdAtMs = Date.now();
      setFeedBadges((prev) => [{ id, kind, label, detail, createdAtMs }, ...prev].slice(0, 3));
      setTimeout(() => {
        setFeedBadges((prev) => prev.filter((b) => b.id !== id));
      }, 2800);
    },
    []
  );

  const handleDriftEvent = useCallback(
    (ev: DriftEvent) => {
      if (ev.type === 'drift:zone_entered') {
        setActiveZoneName(ev.zoneName);
        pushBadge('zone', 'DRIFT ZONE', ev.zoneName);
      } else if (ev.type === 'drift:transition') {
        pushBadge(
          'transition',
          `CHAIN ×${ev.chainCount}`,
          `×${ev.comboMultiplier.toFixed(1)}`
        );
      } else if (ev.type === 'drift:banked') {
        pushBadge(
          'banked',
          `+${ev.bankedDelta.toLocaleString()} BANKED`,
          ev.multiplier > 1.01 ? `×${ev.multiplier.toFixed(1)}` : undefined
        );
      } else if (ev.type === 'drift:penalty') {
        pushBadge(
          'penalty',
          driftPenaltyLabel(ev.reason),
          ev.pointsLost > 0 ? `-${ev.pointsLost.toLocaleString()}` : undefined
        );
      } else if (ev.type === 'drift:run_finished') {
        const track = engine.getActiveTrack();
        const cfg = engine.getBalanceConfig();
        const buildName = engine.getCompiledVehicle().build.name;
        const pb = recordLocalDriftRun(ev.summary, cfg.version_id, buildName);
        setBestDriftScore(pb.bestScore);
        onRunDebriefRef.current({
          summary: ev.summary,
          track,
          buildName,
          isNewBestScore: pb.isNewBestScore,
          bestScore: pb.bestScore,
          deltaToBestScore: pb.deltaToBestScore,
          deltaToPrevScore: pb.deltaToPrevScore,
        });
      }
    },
    [engine, pushBadge]
  );

  // Refresh stored Drift Best whenever track changes
  useEffect(() => {
    const refreshBest = () => {
      const track = engine.getActiveTrack();
      const cfg = engine.getBalanceConfig();
      const key = makeDriftPartitionKey(track.id, getTrackVersion(track), cfg.version_id);
      const best = getTrackDriftBest(key);
      setBestDriftScore(best ? best.bestScore : null);
    };
    refreshBest();
    const unsubTrack = engine.events.on('track:selected', refreshBest);
    return () => unsubTrack();
  }, [engine, active]);

  const toLive = (v: InternalRunAcc): IDriftLiveState => ({
    vehicleId: 'v0',
    runNumber: v.runNumber,
    inDriftZone: v.inDriftZone,
    activeZoneId: v.activeZoneId,
    isDrifting: v.isDrifting,
    driftDirection: v.driftDirection,
    driftAngleDeg: v.driftAngleDeg,
    lineBonusMult: v.lineBonusMult,
    activeComboPoints: v.activeComboPoints,
    comboMultiplier: v.comboMultiplier,
    chainCount: v.chainCount,
    bankedScore: v.bankedScore,
    projectedTotalScore: v.bankedScore + v.activeComboPoints * v.comboMultiplier,
    activeDriftDurationS: v.activeDriftDurationS,
    transitionGraceRemainingS: v.transitionGraceRemainingS,
    cleanRun: v.cleanRun,
  });

  const bankActiveCombo = useCallback(
    (v: InternalRunAcc, tick: number) => {
      if (v.activeComboPoints <= 0) return;
      const rawPoints = Math.round(v.activeComboPoints);
      const bankedDelta = Math.round(v.activeComboPoints * v.comboMultiplier);
      v.bankedScore += bankedDelta;
      if (bankedDelta > v.bestComboScore) v.bestComboScore = bankedDelta;
      const durationS = Number(v.activeDriftDurationS.toFixed(2));
      const mult = Number(v.comboMultiplier.toFixed(2));
      const chain = v.chainCount;

      v.activeComboPoints = 0;
      v.comboMultiplier = 1.0;
      v.chainCount = 0;
      v.activeDriftDurationS = 0;
      v.transitionGraceRemainingS = 0;
      v.isDrifting = false;
      v.driftDirection = 0;

      handleDriftEvent({
        type: 'drift:banked',
        vehicleId: 'v0',
        tick,
        runNumber: v.runNumber,
        rawPoints,
        multiplier: mult,
        bankedDelta,
        totalScore: Math.round(v.bankedScore),
        chainCount: chain,
        durationS,
      });
    },
    [handleDriftEvent]
  );

  const finishCurrentRun = useCallback(() => {
    const v = accRef.current;
    const snap = readVehicleSnapshot(engine);
    if (v.activeComboPoints > 0) {
      bankActiveCombo(v, snap.tick);
    }

    const track = engine.getActiveTrack();
    const geom = engine.getTrackGeometry();
    const extGeom = geom as (ITrackGeometryData & { collisionHandle?: ITrackCollisionHandle }) | null;
    const avgAngle = v.driftingSteps > 0 ? v.angleDegAccum / v.driftingSteps : 0;
    const coverage = v.zoneSteps > 0 ? Math.min(100, (v.driftingSteps / v.zoneSteps) * 100) : 0;
    const totalScore = Math.round(v.bankedScore);

    const summary: IDriftRunSummary = {
      runNumber: v.runNumber,
      trackId: track.id,
      trackVersion: getTrackVersion(track),
      geometryHash: extGeom?.collisionHandle?.geometryHash ?? 'local',
      vehicleId: snap.vehicleId,
      totalScore,
      bestComboScore: Math.round(v.bestComboScore),
      maxChainCount: v.maxChainCount,
      maxMultiplier: Number(v.maxMultiplier.toFixed(2)),
      maxDriftAngleDeg: Number(v.maxDriftAngleDeg.toFixed(1)),
      avgDriftAngleDeg: Number(avgAngle.toFixed(1)),
      totalDriftDurationS: Number(v.totalDriftDurationS.toFixed(2)),
      zoneCoveragePct: Number(coverage.toFixed(1)),
      cleanRun: v.cleanRun,
      penaltiesCount: v.penaltiesCount,
      grade: scoreToGrade(totalScore, v.cleanRun),
      eligibleForLapRecords: false,
    };

    const nextAcc = createFreshAcc(v.runNumber + 1, v.lastImpactSeqSeen);
    accRef.current = nextAcc;
    setLiveState(toLive(nextAcc));
    setActiveZoneName(null);

    handleDriftEvent({ type: 'drift:run_finished', summary });
  }, [engine, bankActiveCombo, handleDriftEvent]);

  const resetDriftRun = useCallback(() => {
    const v = accRef.current;
    if (v.activeComboPoints > 0) {
      handleDriftEvent({
        type: 'drift:penalty',
        vehicleId: 'v0',
        tick: 0,
        runNumber: v.runNumber,
        reason: 'reset',
        pointsLost: Math.round(v.activeComboPoints * v.comboMultiplier),
        multiplierReset: true,
      });
    }
    const fresh = createFreshAcc(v.runNumber, v.lastImpactSeqSeen);
    accRef.current = fresh;
    setLiveState(toLive(fresh));
    setActiveZoneName(null);
  }, [handleDriftEvent]);

  // Listen to native EventBus drift:* events if emitted by Engine/Scorer
  useEffect(() => {
    if (!active) return;
    const bus = engine.events as unknown as {
      on: (ev: string, fn: (payload: unknown) => void) => () => void;
    };
    const names = [
      'drift:zone_entered',
      'drift:transition',
      'drift:banked',
      'drift:penalty',
      'drift:run_finished',
    ] as const;

    const unsubs = names.map((evName) =>
      bus.on(evName, (payload) => {
        if (payload && typeof payload === 'object') {
          externalEventsSeenRef.current = true;
          handleDriftEvent({ type: evName, ...(payload as Record<string, unknown>) } as DriftEvent);
        }
      })
    );

    const unsubReset = engine.events.on('vehicle:reset', () => {
      if (!externalEventsSeenRef.current) {
        resetDriftRun();
      }
    });

    // Crossing Start/Finish in Drift mode finishes the current judged run cleanly
    const unsubLap = engine.events.on('lap:finished', () => {
      if (!externalEventsSeenRef.current) {
        finishCurrentRun();
      }
    });

    return () => {
      unsubs.forEach((fn) => fn());
      unsubReset();
      unsubLap();
    };
  }, [engine, active, handleDriftEvent, resetDriftRun, finishCurrentRun]);

  // Step DriftScorer-compatible logic during Drift sessions
  useEffect(() => {
    if (!active) {
      accRef.current = createFreshAcc(1);
      setLiveState(createEmptyLiveState(1));
      setActiveZoneName(null);
      return;
    }

    externalEventsSeenRef.current = false;

    const stepSnapshot = (snap: IVehicleStateSnapshot, dt: number) => {
      if (externalEventsSeenRef.current) return;
      const v = accRef.current;
      const track = engine.getActiveTrack();
      const geom = engine.getTrackGeometry();
      const zones = getDriftZonesForTrack(track, geom);

      let matchedZoneId: string | null = null;
      let matchedZoneName = track.name;
      if (zones.length === 0) {
        matchedZoneId = 'full_course';
        matchedZoneName = track.name;
      } else {
        for (const z of zones) {
          if (isProgressInSpan(snap.splineProgress, z.startT, z.endT)) {
            matchedZoneId = z.id;
            matchedZoneName = z.name;
            break;
          }
        }
      }

      const inZone = matchedZoneId !== null;
      if (inZone && (!v.inDriftZone || v.activeZoneId !== matchedZoneId)) {
        v.activeZoneName = matchedZoneName;
        handleDriftEvent({
          type: 'drift:zone_entered',
          vehicleId: snap.vehicleId,
          tick: snap.tick,
          runNumber: v.runNumber,
          zoneId: matchedZoneId!,
          zoneName: matchedZoneName,
        });
      } else if (!inZone && v.inDriftZone && v.activeComboPoints > 0) {
        bankActiveCombo(v, snap.tick);
      }

      v.inDriftZone = inZone;
      v.activeZoneId = matchedZoneId;
      if (inZone) v.zoneSteps += 1;

      // Wall impact / brush check via monotonic lastImpact.seq
      if (snap.lastImpact && snap.lastImpact.seq > v.lastImpactSeqSeen) {
        v.lastImpactSeqSeen = snap.lastImpact.seq;
        const intensity = snap.lastImpact.intensity01;
        if (intensity >= 0.35) {
          const lost = Math.round(v.activeComboPoints * v.comboMultiplier);
          v.activeComboPoints = 0;
          v.comboMultiplier = 1.0;
          v.chainCount = 0;
          v.activeDriftDurationS = 0;
          v.transitionGraceRemainingS = 0;
          v.isDrifting = false;
          v.driftDirection = 0;
          v.cleanRun = false;
          v.penaltiesCount += 1;
          handleDriftEvent({
            type: 'drift:penalty',
            vehicleId: snap.vehicleId,
            tick: snap.tick,
            runNumber: v.runNumber,
            reason: 'wall_impact',
            pointsLost: lost,
            multiplierReset: true,
          });
        } else if (intensity >= 0.12 && v.activeComboPoints > 0) {
          const rawPenalty = v.activeComboPoints * 0.25;
          v.activeComboPoints = Math.max(0, v.activeComboPoints - rawPenalty);
          v.penaltiesCount += 1;
          handleDriftEvent({
            type: 'drift:penalty',
            vehicleId: snap.vehicleId,
            tick: snap.tick,
            runNumber: v.runNumber,
            reason: 'wall_brush',
            pointsLost: Math.round(rawPenalty * v.comboMultiplier),
            multiplierReset: false,
          });
        }
      }

      // Off-track & outer-arc line bonus calculation
      let lineBonus = 1.0;
      if (geom && inZone) {
        const closest = geom.spline.findClosestSample(snap.position, snap.splineProgress);
        const halfW = closest.sample.widthM * 0.5;
        const absLat = Math.abs(closest.lateralOffsetM);
        if (absLat > halfW + 1.5) {
          v.offTrackSteps += 1;
          if (v.offTrackSteps >= 24 && v.activeComboPoints > 0 && !v.offTrackPenaltyApplied) {
            v.offTrackPenaltyApplied = true;
            const lost = Math.round(v.activeComboPoints * v.comboMultiplier);
            v.activeComboPoints = 0;
            v.comboMultiplier = 1.0;
            v.chainCount = 0;
            v.activeDriftDurationS = 0;
            v.transitionGraceRemainingS = 0;
            v.isDrifting = false;
            v.cleanRun = false;
            v.penaltiesCount += 1;
            handleDriftEvent({
              type: 'drift:penalty',
              vehicleId: snap.vehicleId,
              tick: snap.tick,
              runNumber: v.runNumber,
              reason: 'off_track',
              pointsLost: lost,
              multiplierReset: true,
            });
          }
        } else {
          v.offTrackSteps = 0;
          v.offTrackPenaltyApplied = false;
          const latFrac = Math.min(1, absLat / Math.max(2, halfW));
          lineBonus = 1.0 + latFrac * 0.35;
        }
      }
      v.lineBonusMult = lineBonus;

      // Active drift evaluation
      const absSlip = Math.abs(snap.bodySlipAngleRad);
      const angleDeg = (absSlip * 180) / Math.PI;
      v.driftAngleDeg = angleDeg;

      const groundedCount = snap.wheels.reduce((acc, w) => acc + (w.grounded ? 1 : 0), 0);
      const isSpinout =
        (absSlip > SPINOUT_ANGLE_RAD && snap.speedMs > 2.5) ||
        (snap.forwardSpeedMs < -1.5 && v.activeComboPoints > 0);

      if (isSpinout) {
        if (v.activeComboPoints > 0) {
          const lost = Math.round(v.activeComboPoints * v.comboMultiplier);
          v.activeComboPoints = 0;
          v.comboMultiplier = 1.0;
          v.chainCount = 0;
          v.activeDriftDurationS = 0;
          v.transitionGraceRemainingS = 0;
          v.isDrifting = false;
          v.driftDirection = 0;
          v.cleanRun = false;
          v.penaltiesCount += 1;
          handleDriftEvent({
            type: 'drift:penalty',
            vehicleId: snap.vehicleId,
            tick: snap.tick,
            runNumber: v.runNumber,
            reason: 'spinout',
            pointsLost: lost,
            multiplierReset: true,
          });
        }
        return;
      }

      const qualifiesDrift =
        inZone &&
        groundedCount >= 2 &&
        snap.forwardSpeedMs >= MIN_SPEED_MS &&
        absSlip >= MIN_ANGLE_RAD;

      if (qualifiesDrift) {
        const dir: -1 | 1 = snap.bodySlipAngleRad >= 0 ? 1 : -1;
        if (v.activeComboPoints > 0 && v.driftDirection !== 0 && v.driftDirection !== dir) {
          v.chainCount += 1;
          v.comboMultiplier = Math.min(MAX_MULTIPLIER, 1.0 + v.chainCount * 0.5);
          if (v.chainCount > v.maxChainCount) v.maxChainCount = v.chainCount;
          if (v.comboMultiplier > v.maxMultiplier) v.maxMultiplier = v.comboMultiplier;
          handleDriftEvent({
            type: 'drift:transition',
            vehicleId: snap.vehicleId,
            tick: snap.tick,
            runNumber: v.runNumber,
            chainCount: v.chainCount,
            comboMultiplier: v.comboMultiplier,
            direction: dir,
            activeComboPoints: Math.round(v.activeComboPoints),
          });
        } else if (v.chainCount === 0) {
          v.chainCount = 1;
          if (v.maxChainCount < 1) v.maxChainCount = 1;
        }

        v.isDrifting = true;
        v.driftDirection = dir;
        v.transitionGraceRemainingS = TRANSITION_GRACE_S;
        v.activeDriftDurationS += dt;
        v.totalDriftDurationS += dt;
        v.driftingSteps += 1;
        v.angleDegAccum += angleDeg;
        if (angleDeg > v.maxDriftAngleDeg) v.maxDriftAngleDeg = angleDeg;

        const angleFactor = Math.min(2.0, absSlip / 0.45);
        const speedFactor = Math.min(2.2, snap.forwardSpeedMs / 18.0);
        v.activeComboPoints += BASE_POINTS_PER_SEC * angleFactor * speedFactor * lineBonus * dt;
      } else {
        v.isDrifting = false;
        if (v.activeComboPoints > 0) {
          v.transitionGraceRemainingS = Math.max(0, v.transitionGraceRemainingS - dt);
          if (v.transitionGraceRemainingS <= 0) {
            bankActiveCombo(v, snap.tick);
          }
        }
      }
    };

    // Prefer fixed-step subscription when physics hook is live; fall back to rAF stepping
    const unsubFixed = subscribeFixedStepSafe(engine, (_tick, _input, snap) => {
      stepSnapshot(snap, FIXED_SIM_DT);
    });

    let rafId = 0;
    let lastUiEmit = 0;
    let lastStepMs = performance.now();

    const loop = (now: number) => {
      rafId = requestAnimationFrame(loop);
      if (!unsubFixed) {
        const dt = Math.min(0.05, Math.max(0.001, (now - lastStepMs) / 1000));
        lastStepMs = now;
        const paused = Boolean(
          (engine as unknown as { isSimulationPaused?: () => boolean }).isSimulationPaused?.()
        );
        if (!paused) {
          stepSnapshot(readVehicleSnapshot(engine), dt);
        }
      }
      if (now - lastUiEmit >= 50) {
        lastUiEmit = now;
        setLiveState(toLive(accRef.current));
      }
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId);
      unsubFixed?.();
    };
  }, [engine, active, handleDriftEvent, bankActiveCombo]);

  return {
    liveState,
    activeZoneName,
    bestDriftScore,
    feedBadges,
    finishCurrentRun,
    resetDriftRun,
  };
}
