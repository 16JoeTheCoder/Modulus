import {
  normalizeTrackVersion,
  type ITrackSectorMeta,
  type ITrackZoneMeta,
} from '../../contracts/simulation';
import {
  isProgressInSpan,
  TRACK_KERB_WIDTH_M,
  TRACK_RUNOFF_WIDTH_M,
  TrackSpline,
} from '../../core/math/spline';
import type { ITrackSplineSchema } from '../../core/types';

export interface ITrackPreviewPoint2D {
  /** Normalized X in [0..1] preserving aspect ratio */
  x: number;
  /** Normalized Y in [0..1] preserving aspect ratio */
  y: number;
  t: number;
  distanceM: number;
  elevationM: number;
  sectorIndex: number;
  inPassingZone: boolean;
  inDriftZone: boolean;
}

export interface ITrackElevationPoint {
  distanceM: number;
  t: number;
  elevationAboveMinM: number;
  sectorIndex: number;
}

export interface ITrackPreviewData {
  trackId: string;
  trackVersion: string;
  geometryHash: string;
  name: string;
  totalLengthM: number;
  elevationMinM: number;
  elevationMaxM: number;
  elevationRangeM: number;
  widthMinM: number;
  widthMaxM: number;
  sectors: ITrackSectorMeta[];
  zones: ITrackZoneMeta[];
  outline: ITrackPreviewPoint2D[];
  elevationProfile: ITrackElevationPoint[];
  startPoint: ITrackPreviewPoint2D;
  startHeading2D: { x: number; y: number };
}

/**
 * Pure-math track preview generator (ZERO Three.js imports).
 * Driven by the exact same `TrackSpline` as render and collision meshes
 * for course selector cards, minimaps, debrief overlays, and Admin Track Kit previews.
 */
export function buildTrackPreviewData(
  schema: ITrackSplineSchema,
  previewPoints = 180
): ITrackPreviewData {
  const spline = new TrackSpline(schema);
  const count = Math.max(48, Math.min(480, previewPoints));
  const raw = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minW = Infinity;
  let maxW = -Infinity;

  for (let i = 0; i < count; i++) {
    const t = i / count;
    const s = spline.sampleAtProgress(t);
    raw.push(s);
    if (s.position.x < minX) minX = s.position.x;
    if (s.position.x > maxX) maxX = s.position.x;
    if (s.position.z < minZ) minZ = s.position.z;
    if (s.position.z > maxZ) maxZ = s.position.z;
    if (s.position.y < minY) minY = s.position.y;
    if (s.position.y > maxY) maxY = s.position.y;
    if (s.widthM < minW) minW = s.widthM;
    if (s.widthM > maxW) maxW = s.widthM;
  }

  const spanX = Math.max(1, maxX - minX);
  const spanZ = Math.max(1, maxZ - minZ);
  const maxSpan = Math.max(spanX, spanZ);
  const padX = (maxSpan - spanX) * 0.5;
  const padZ = (maxSpan - spanZ) * 0.5;

  const findSectorIndex = (t: number): number => {
    for (let i = 0; i < spline.sectors.length; i++) {
      const sec = spline.sectors[i];
      if (t >= sec.startT && (t < sec.endT || i === spline.sectors.length - 1)) {
        return i;
      }
    }
    return 0;
  };

  const outline: ITrackPreviewPoint2D[] = raw.map((s) => ({
    x: (s.position.x - minX + padX) / maxSpan,
    y: 1 - (s.position.z - minZ + padZ) / maxSpan,
    t: s.t,
    distanceM: s.distanceM,
    elevationM: s.position.y,
    sectorIndex: findSectorIndex(s.t),
    inPassingZone: s.inPassingZone,
    inDriftZone: s.inDriftZone,
  }));

  const elevationProfile: ITrackElevationPoint[] = outline.map((p) => ({
    distanceM: p.distanceM,
    t: p.t,
    elevationAboveMinM: p.elevationM - minY,
    sectorIndex: p.sectorIndex,
  }));

  const s0 = raw[0];
  const headingLen = Math.hypot(s0.tangent.x, s0.tangent.z) || 1;

  return {
    trackId: schema.id,
    trackVersion: normalizeTrackVersion(schema.trackVersion),
    geometryHash: spline.geometryHash,
    name: schema.name,
    totalLengthM: spline.totalLengthM,
    elevationMinM: minY,
    elevationMaxM: maxY,
    elevationRangeM: maxY - minY,
    widthMinM: minW,
    widthMaxM: maxW,
    sectors: spline.sectors,
    zones: spline.zones,
    outline,
    elevationProfile,
    startPoint: outline[0],
    startHeading2D: {
      x: s0.tangent.x / headingLen,
      y: -s0.tangent.z / headingLen,
    },
  };
}

export interface ITrackGeometryCheckResult {
  trackId: string;
  trackVersion: string;
  geometryHash: string;
  sampleCount: number;
  totalLengthM: number;
  minSampleStepM: number;
  maxSampleStepM: number;
  elevationRangeM: number;
  maxGradePct: number;
  minTurnRadiusM: number;
  selfCrossings: {
    centerline: number;
    roadLeft: number;
    roadRight: number;
    runoffLeft: number;
    runoffRight: number;
  };
  passingZonesClearOfKerbs: boolean;
  startGridSlotCount: number;
  timingGateCount: number;
  passed: boolean;
  issues: string[];
}

function segIntersect2D(
  a: { x: number; z: number },
  b: { x: number; z: number },
  c: { x: number; z: number },
  d: { x: number; z: number }
): boolean {
  const ccw = (
    p1: { x: number; z: number },
    p2: { x: number; z: number },
    p3: { x: number; z: number }
  ) => (p3.z - p1.z) * (p2.x - p1.x) > (p2.z - p1.z) * (p3.x - p1.x);
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

/**
 * Pure-math geometry validator for tracks & Admin Track Kit draft imports.
 */
export function validateTrackGeometry(schema: ITrackSplineSchema): ITrackGeometryCheckResult {
  const spline = new TrackSpline(schema);
  const samples = spline.samples;
  const n = samples.length;
  const issues: string[] = [];

  if (!schema.closed) {
    issues.push('Route is not marked closed');
  }

  let minStep = Infinity;
  let maxStep = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxGrade = 0;
  let maxCurv = 0;
  let passingZonesClearOfKerbs = true;

  for (let i = 0; i < n; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % n];
    const ds = Math.hypot(
      b.position.x - a.position.x,
      b.position.y - a.position.y,
      b.position.z - a.position.z
    );
    const dHoriz = Math.hypot(b.position.x - a.position.x, b.position.z - a.position.z);
    if (ds < minStep) minStep = ds;
    if (ds > maxStep) maxStep = ds;
    if (dHoriz > 1e-4) {
      const g = Math.abs(b.position.y - a.position.y) / dHoriz;
      if (g > maxGrade) maxGrade = g;
    }
    if (a.position.y < minY) minY = a.position.y;
    if (a.position.y > maxY) maxY = a.position.y;
    if (a.curvature > maxCurv) maxCurv = a.curvature;
    if (a.inPassingZone && (a.kerbLeft || a.kerbRight)) {
      passingZonesClearOfKerbs = false;
    }
    if (
      !Number.isFinite(a.position.x) ||
      !Number.isFinite(a.position.y) ||
      !Number.isFinite(a.position.z)
    ) {
      issues.push(`Non-finite sample position at index ${i}`);
    }
  }

  const checkCrossings = (latFn: (s: (typeof samples)[number]) => number): number => {
    const pts = samples.map((s) => {
      const lat = latFn(s);
      return { x: s.position.x + s.right.x * lat, z: s.position.z + s.right.z * lat };
    });
    let hits = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (segIntersect2D(a, b, pts[j], pts[(j + 1) % n])) hits++;
      }
    }
    return hits;
  };

  const selfCrossings = {
    centerline: checkCrossings(() => 0),
    roadLeft: checkCrossings((s) => -s.widthM * 0.5),
    roadRight: checkCrossings((s) => s.widthM * 0.5),
    runoffLeft: checkCrossings((s) => -(s.widthM * 0.5 + TRACK_KERB_WIDTH_M + TRACK_RUNOFF_WIDTH_M)),
    runoffRight: checkCrossings((s) => s.widthM * 0.5 + TRACK_KERB_WIDTH_M + TRACK_RUNOFF_WIDTH_M),
  };

  if (selfCrossings.centerline > 0) issues.push(`Centerline self-crossings: ${selfCrossings.centerline}`);
  if (selfCrossings.roadLeft > 0 || selfCrossings.roadRight > 0) {
    issues.push(`Road edge self-crossings: L=${selfCrossings.roadLeft}, R=${selfCrossings.roadRight}`);
  }
  if (selfCrossings.runoffLeft > 0 || selfCrossings.runoffRight > 0) {
    issues.push(
      `Runoff boundary self-crossings: L=${selfCrossings.runoffLeft}, R=${selfCrossings.runoffRight}`
    );
  }
  if (!passingZonesClearOfKerbs) {
    issues.push('Passing zone contains kerbs');
  }

  const startGrid = spline.getStartGridSlots(4);
  const timingGates = spline.buildTimingGates();
  if (timingGates.length < 3) {
    issues.push(`Expected at least 3 timing gates, got ${timingGates.length}`);
  }

  // Verify zone spans are valid
  for (const z of spline.zones) {
    if (!Number.isFinite(z.startT) || !Number.isFinite(z.endT)) {
      issues.push(`Invalid zone ${z.id} bounds`);
    } else if (!isProgressInSpan(z.startT, z.startT, z.endT)) {
      issues.push(`Zone ${z.id} span failed self-containment check`);
    }
  }

  return {
    trackId: schema.id,
    trackVersion: normalizeTrackVersion(schema.trackVersion),
    geometryHash: spline.geometryHash,
    sampleCount: n,
    totalLengthM: spline.totalLengthM,
    minSampleStepM: minStep,
    maxSampleStepM: maxStep,
    elevationRangeM: maxY - minY,
    maxGradePct: maxGrade * 100,
    minTurnRadiusM: maxCurv > 1e-6 ? 1 / maxCurv : Infinity,
    selfCrossings,
    passingZonesClearOfKerbs,
    startGridSlotCount: startGrid.length,
    timingGateCount: timingGates.length,
    passed: issues.length === 0,
    issues,
  };
}
