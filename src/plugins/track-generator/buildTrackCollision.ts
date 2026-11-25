import {
  normalizeTrackVersion,
  SURFACE_CODE,
  type ITrackCollisionHandle,
  type SurfaceType,
  type Vec3,
} from '../../contracts/simulation';
import {
  TRACK_KERB_WIDTH_M,
  TRACK_RUNOFF_WIDTH_M,
  TrackSpline,
  type ISplineSample,
} from '../../core/math/spline';
import type { ITrackSplineSchema } from '../../core/types';

export const TRACK_WALL_HEIGHT_M = 1.65;
export const TRACK_WALL_BELOW_M = 0.35;

export interface IBuiltTrackCollision {
  spline: TrackSpline;
  collisionHandle: ITrackCollisionHandle;
}

function evalSurfacePoint(sample: ISplineSample, latOffset: number, upOffset: number): Vec3 {
  return {
    x: sample.position.x + sample.right.x * latOffset + sample.normal.x * upOffset,
    y: sample.position.y + sample.right.y * latOffset + sample.normal.y * upOffset,
    z: sample.position.z + sample.right.z * latOffset + sample.normal.z * upOffset,
  };
}

function surfaceTypeToCode(surface: SurfaceType): number {
  return SURFACE_CODE[surface] ?? SURFACE_CODE.tarmac;
}

/**
 * Pure-math / typed-array track collision builder (ZERO Three.js imports).
 * Produces the canonical `ITrackCollisionHandle` (road trimesh, surface codes,
 * containment walls, standing start grid, ordered timing gates, and bounds)
 * from the exact same `TrackSpline` used by the visual builder and previews.
 */
export function buildTrackCollision(
  schema: ITrackSplineSchema,
  sampleCount?: number
): IBuiltTrackCollision {
  const spline = new TrackSpline(schema, sampleCount);
  const samples = spline.samples;
  const n = samples.length;
  const trackVersion = normalizeTrackVersion(schema.trackVersion);

  // =========================================================================
  // 1. PHYSICS COLLISION TRIMESH (Shared indexed vertices, watertight loop)
  // =========================================================================
  const COLL_COLS = 9;
  const roadVertices = new Float32Array(n * COLL_COLS * 3);
  const roadIndices = new Uint32Array(n * (COLL_COLS - 1) * 6);
  const triangleSurfaces = new Uint8Array(n * (COLL_COLS - 1) * 2);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const halfW = s.widthM * 0.5;
    const outerLat = halfW + TRACK_KERB_WIDTH_M + TRACK_RUNOFF_WIDTH_M;
    const kerbLat = halfW + TRACK_KERB_WIDTH_M;

    const colLats = [
      -outerLat,
      -kerbLat,
      -halfW,
      -halfW * 0.5,
      0,
      halfW * 0.5,
      halfW,
      kerbLat,
      outerLat,
    ];
    const colUps = [
      -0.08,
      s.kerbLeft ? 0.025 : -0.02,
      s.kerbLeft ? 0.04 : 0.0,
      0.015,
      0.02,
      0.015,
      s.kerbRight ? 0.04 : 0.0,
      s.kerbRight ? 0.025 : -0.02,
      -0.08,
    ];

    for (let c = 0; c < COLL_COLS; c++) {
      const p = evalSurfacePoint(s, colLats[c], colUps[c]);
      const vIdx = (i * COLL_COLS + c) * 3;
      roadVertices[vIdx] = p.x;
      roadVertices[vIdx + 1] = p.y;
      roadVertices[vIdx + 2] = p.z;

      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
  }

  let idxCursor = 0;
  let triCursor = 0;
  for (let i = 0; i < n; i++) {
    const iNext = (i + 1) % n;
    const s = samples[i];
    const roadSurfCode = surfaceTypeToCode(s.surface);
    for (let c = 0; c < COLL_COLS - 1; c++) {
      const v00 = i * COLL_COLS + c;
      const v01 = i * COLL_COLS + (c + 1);
      const v10 = iNext * COLL_COLS + c;
      const v11 = iNext * COLL_COLS + (c + 1);

      roadIndices[idxCursor++] = v00;
      roadIndices[idxCursor++] = v01;
      roadIndices[idxCursor++] = v10;

      roadIndices[idxCursor++] = v01;
      roadIndices[idxCursor++] = v11;
      roadIndices[idxCursor++] = v10;

      let surf: number = roadSurfCode;
      if (c === 0 || c === 7) surf = SURFACE_CODE.grass;
      else if (c === 1) surf = s.kerbLeft ? SURFACE_CODE.kerb : SURFACE_CODE.grass;
      else if (c === 6) surf = s.kerbRight ? SURFACE_CODE.kerb : SURFACE_CODE.grass;

      triangleSurfaces[triCursor++] = surf;
      triangleSurfaces[triCursor++] = surf;
    }
  }

  // =========================================================================
  // 2. PHYSICS CONTAINMENT WALLS (Left + Right guardrails at outer runoff)
  // =========================================================================
  const wallVertices = new Float32Array(n * 4 * 3);
  const wallIndices = new Uint32Array(n * 2 * 6);

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const outerLat = s.widthM * 0.5 + TRACK_KERB_WIDTH_M + TRACK_RUNOFF_WIDTH_M;
    const pLB = evalSurfacePoint(s, -outerLat, -TRACK_WALL_BELOW_M);
    const pLT = evalSurfacePoint(s, -outerLat, TRACK_WALL_HEIGHT_M);
    const pRB = evalSurfacePoint(s, outerLat, -TRACK_WALL_BELOW_M);
    const pRT = evalSurfacePoint(s, outerLat, TRACK_WALL_HEIGHT_M);

    const base = i * 4 * 3;
    wallVertices[base] = pLB.x;
    wallVertices[base + 1] = pLB.y;
    wallVertices[base + 2] = pLB.z;

    wallVertices[base + 3] = pLT.x;
    wallVertices[base + 4] = pLT.y;
    wallVertices[base + 5] = pLT.z;

    wallVertices[base + 6] = pRB.x;
    wallVertices[base + 7] = pRB.y;
    wallVertices[base + 8] = pRB.z;

    wallVertices[base + 9] = pRT.x;
    wallVertices[base + 10] = pRT.y;
    wallVertices[base + 11] = pRT.z;
  }

  let wIdx = 0;
  for (let i = 0; i < n; i++) {
    const iNext = (i + 1) % n;
    const lb0 = i * 4;
    const lt0 = i * 4 + 1;
    const rb0 = i * 4 + 2;
    const rt0 = i * 4 + 3;

    const lb1 = iNext * 4;
    const lt1 = iNext * 4 + 1;
    const rb1 = iNext * 4 + 2;
    const rt1 = iNext * 4 + 3;

    // Left wall inward normal (+right)
    wallIndices[wIdx++] = lb0;
    wallIndices[wIdx++] = lb1;
    wallIndices[wIdx++] = lt0;
    wallIndices[wIdx++] = lb1;
    wallIndices[wIdx++] = lt1;
    wallIndices[wIdx++] = lt0;

    // Right wall inward normal (-right)
    wallIndices[wIdx++] = rb0;
    wallIndices[wIdx++] = rt0;
    wallIndices[wIdx++] = rb1;
    wallIndices[wIdx++] = rb1;
    wallIndices[wIdx++] = rt0;
    wallIndices[wIdx++] = rt1;
  }

  const startGrid = spline.getStartGridSlots(4);
  const timingGates = spline.buildTimingGates();

  const collisionHandle: ITrackCollisionHandle = {
    handleId: `${schema.id}:${trackVersion}:${spline.geometryHash}`,
    trackId: schema.id,
    trackVersion,
    geometryHash: spline.geometryHash,
    totalLengthM: spline.totalLengthM,
    roadVertices,
    roadIndices,
    wallVertices,
    wallIndices,
    triangleSurfaces,
    startGrid,
    timingGates,
    sectors: spline.sectors,
    zones: spline.zones,
    bounds: {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    },
  };

  return { spline, collisionHandle };
}
