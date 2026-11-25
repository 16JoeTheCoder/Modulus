import {
  normalizeTrackVersion,
  type ITrackGridSlot,
  type ITrackSectorMeta,
  type ITrackTimingGate,
  type ITrackZoneMeta,
  type Quat,
  type SurfaceType,
  type Vec3,
} from '../../contracts/simulation';
import type { ITrackControlPoint, ITrackSplineSchema } from '../types';

export interface ISplineSample {
  t: number; // Normalized spline parameter [0..1)
  distanceM: number;
  position: Vec3;
  tangent: Vec3; // Unit forward along track (+s)
  normal: Vec3; // Banked surface normal (+up)
  right: Vec3; // Banked road right vector
  bankRad: number;
  widthM: number;
  curvature: number; // 1/R in m^-1 (unsigned magnitude)
  signedCurvature: number;
  kerbLeft: boolean;
  kerbRight: boolean;
  surface: SurfaceType;
  inPassingZone: boolean;
  inDriftZone: boolean;
}

export const TRACK_KERB_WIDTH_M = 1.05;
export const TRACK_RUNOFF_WIDTH_M = 5.4;

const DEFAULT_MIN_SAMPLES = 480;
const DEFAULT_MAX_SAMPLES = 4096;
const TARGET_SAMPLE_SPACING_M = 2.0;

/**
 * Checks if a normalized spline parameter `t` in [0..1) lies inside [startT, endT].
 * Supports wrap-around across t = 0 when `startT > endT` (e.g. Switchyard Main Straight ~0.94 -> 0.08).
 */
export function isProgressInSpan(t: number, startT: number, endT: number): boolean {
  const w = ((t % 1) + 1) % 1;
  const s = ((startT % 1) + 1) % 1;
  const e = endT >= 1 ? 1 : ((endT % 1) + 1) % 1;
  if (endT >= 1 && s <= 1e-6) return true;
  if (s <= e) {
    return w >= s && w <= e;
  }
  return w >= s || w <= e;
}

/**
 * Computes a deterministic recommended sample count based on approximate 3D route length
 * so short courses (~1.2-2 km) sample at ~2 m spacing and long endurance routes stay fine.
 */
export function computeRecommendedSampleCount(schema: ITrackSplineSchema): number {
  const pts = schema.controlPoints;
  if (pts.length < 3) return DEFAULT_MIN_SAMPLES;
  let polyLen = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    polyLen += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  // Catmull-Rom curve is slightly longer than control polygon
  const estLen = polyLen * 1.04;
  const raw = Math.ceil(estLen / TARGET_SAMPLE_SPACING_M);
  // Align to multiple of 4 for clean decimation/post cadence
  const aligned = Math.ceil(raw / 4) * 4;
  return Math.max(DEFAULT_MIN_SAMPLES, Math.min(DEFAULT_MAX_SAMPLES, aligned));
}

/**
 * Resolves normalized sector metadata from v2 `schema.sectors` or legacy `sectorFractions`.
 */
export function resolveTrackSectors(schema: ITrackSplineSchema): ITrackSectorMeta[] {
  if (schema.sectors && schema.sectors.length >= 2) {
    return schema.sectors.map((s, idx) => ({
      index: idx,
      name: s.name || `Sector ${idx + 1}`,
      startT: s.startT,
      endT: s.endT,
      surface: s.surface ?? 'tarmac',
    }));
  }
  const [s1, s2] = schema.sectorFractions;
  return [
    { index: 0, name: 'Sector 1', startT: 0, endT: s1, surface: 'tarmac' },
    { index: 1, name: 'Sector 2', startT: s1, endT: s2, surface: 'tarmac' },
    { index: 2, name: 'Sector 3', startT: s2, endT: 1, surface: 'tarmac' },
  ];
}

/**
 * Resolves unified zone list (passing, drift, surface) from v2 optional schema extensions.
 */
export function resolveTrackZones(schema: ITrackSplineSchema): ITrackZoneMeta[] {
  const zones: ITrackZoneMeta[] = [];
  if (schema.passingZones) {
    for (const pz of schema.passingZones) {
      zones.push({
        id: pz.id,
        name: pz.name,
        kind: 'passing',
        startT: pz.startT,
        endT: pz.endT,
      });
    }
  }
  if (schema.driftZones) {
    for (const dz of schema.driftZones) {
      zones.push({
        id: dz.id,
        name: dz.name,
        kind: 'drift',
        startT: dz.startT,
        endT: dz.endT,
      });
    }
  }
  if (schema.surfaceZones) {
    schema.surfaceZones.forEach((sz, idx) => {
      zones.push({
        id: `surface_${idx}`,
        name: `${sz.surface} zone`,
        kind: 'surface',
        startT: sz.startT,
        endT: sz.endT,
        surface: sz.surface,
      });
    });
  }
  return zones;
}

/**
 * Deterministic 32-bit FNV-1a geometry hash over canonical track geometry + version + sampleCount.
 * Used to pair render & collision handles 1:1 and partition replays/leaderboards.
 */
export function computeTrackGeometryHash(
  schema: ITrackSplineSchema,
  sampleCount: number
): string {
  const trackVersion = normalizeTrackVersion(schema.trackVersion);
  const payload = JSON.stringify({
    id: schema.id,
    v: trackVersion,
    closed: schema.closed,
    w: schema.defaultWidthM,
    sf: schema.sectorFractions,
    n: sampleCount,
    pts: schema.controlPoints.map((p) => [
      p.x,
      p.y,
      p.z,
      p.bankDeg,
      p.widthM ?? null,
      Boolean(p.kerbLeft),
      Boolean(p.kerbRight),
    ]),
    surf: schema.surfaceZones ?? null,
  });

  let h = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `trk_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

function catmullRomScalar(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
  );
}

function catmullRomDerivativeScalar(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  u: number
): number {
  const u2 = u * u;
  return (
    0.5 *
    ((-p0 + p2) +
      2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * u +
      3 * (-p0 + 3 * p1 - 3 * p2 + p3) * u2)
  );
}

function normalizeVec3(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function rotateAroundAxis(v: Vec3, axis: Vec3, angleRad: number): Vec3 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const dot = v.x * axis.x + v.y * axis.y + v.z * axis.z;
  const cross = crossVec3(axis, v);
  return {
    x: v.x * c + cross.x * s + axis.x * dot * (1 - c),
    y: v.y * c + cross.y * s + axis.y * dot * (1 - c),
    z: v.z * c + cross.z * s + axis.z * dot * (1 - c),
  };
}

/**
 * Converts basis vectors (left, up, forward) into a unit quaternion.
 * MODULUS Standard Right-Handed Basis:
 * Local +X = Left (`up x forward`), Local +Y = Up, Local +Z = Forward.
 */
export function basisToQuaternion(left: Vec3, up: Vec3, forward: Vec3): Quat {
  const m00 = left.x,
    m01 = up.x,
    m02 = forward.x;
  const m10 = left.y,
    m11 = up.y,
    m12 = forward.y;
  const m20 = left.z,
    m21 = up.z,
    m22 = forward.z;
  const trace = m00 + m11 + m22;
  let x = 0,
    y = 0,
    z = 0,
    w = 1;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  const len = Math.hypot(x, y, z, w) || 1;
  return { x: x / len, y: y / len, z: z / len, w: w / len };
}

/**
 * Banked 3D Closed Catmull-Rom Track Spline.
 * Single canonical geometry source shared identically by track-generator (render + collision),
 * physics-rapier, LapSectorTimer, previews, and ai-test-driver.
 */
export class TrackSpline {
  public readonly schema: ITrackSplineSchema;
  public readonly sampleCount: number;
  public readonly samples: ISplineSample[];
  public readonly totalLengthM: number;
  public readonly sectors: ITrackSectorMeta[];
  public readonly zones: ITrackZoneMeta[];
  public readonly geometryHash: string;

  constructor(schema: ITrackSplineSchema, sampleCount?: number) {
    this.schema = schema;
    const count =
      sampleCount && sampleCount >= 64
        ? sampleCount
        : computeRecommendedSampleCount(schema);
    this.sampleCount = count;
    this.sectors = resolveTrackSectors(schema);
    this.zones = resolveTrackZones(schema);
    this.geometryHash = computeTrackGeometryHash(schema, count);

    const pts = schema.controlPoints;
    const n = pts.length;
    const hasExplicitKerbs = pts.some((p) => Boolean(p.kerbLeft || p.kerbRight));

    const passingZones = this.zones.filter((z) => z.kind === 'passing');
    const driftZones = this.zones.filter((z) => z.kind === 'drift');
    const surfaceZones = this.zones.filter((z) => z.kind === 'surface' && z.surface);

    const resolveSurfaceAt = (t: number): SurfaceType => {
      for (let i = 0; i < surfaceZones.length; i++) {
        const sz = surfaceZones[i];
        if (sz.surface && isProgressInSpan(t, sz.startT, sz.endT)) {
          return sz.surface;
        }
      }
      for (let i = 0; i < this.sectors.length; i++) {
        const sec = this.sectors[i];
        if (t >= sec.startT && (t < sec.endT || (i === this.sectors.length - 1 && t <= 1))) {
          return sec.surface;
        }
      }
      return 'tarmac';
    };

    const rawSamples: Omit<ISplineSample, 'curvature' | 'signedCurvature'>[] = [];
    let cumulativeDist = 0;
    let prevPos: Vec3 | null = null;

    for (let i = 0; i < count; i++) {
      const t = i / count;
      const segFloat = t * n;
      const segIdx = Math.floor(segFloat) % n;
      const u = segFloat - Math.floor(segFloat);

      const p0: ITrackControlPoint = pts[(segIdx - 1 + n) % n];
      const p1: ITrackControlPoint = pts[segIdx];
      const p2: ITrackControlPoint = pts[(segIdx + 1) % n];
      const p3: ITrackControlPoint = pts[(segIdx + 2) % n];

      const position: Vec3 = {
        x: catmullRomScalar(p0.x, p1.x, p2.x, p3.x, u),
        y: catmullRomScalar(p0.y, p1.y, p2.y, p3.y, u),
        z: catmullRomScalar(p0.z, p1.z, p2.z, p3.z, u),
      };

      const deriv: Vec3 = {
        x: catmullRomDerivativeScalar(p0.x, p1.x, p2.x, p3.x, u),
        y: catmullRomDerivativeScalar(p0.y, p1.y, p2.y, p3.y, u),
        z: catmullRomDerivativeScalar(p0.z, p1.z, p2.z, p3.z, u),
      };

      const tangent = normalizeVec3(deriv);
      const worldUp: Vec3 = { x: 0, y: 1, z: 0 };
      const flatRight = normalizeVec3(crossVec3(tangent, worldUp));
      const unbankedUp = normalizeVec3(crossVec3(flatRight, tangent));

      const bankDeg = catmullRomScalar(p0.bankDeg, p1.bankDeg, p2.bankDeg, p3.bankDeg, u);
      const bankRad = (bankDeg * Math.PI) / 180;

      const right = normalizeVec3(rotateAroundAxis(flatRight, tangent, bankRad));
      const normal = normalizeVec3(rotateAroundAxis(unbankedUp, tangent, bankRad));

      const w0 = p0.widthM ?? schema.defaultWidthM;
      const w1 = p1.widthM ?? schema.defaultWidthM;
      const w2 = p2.widthM ?? schema.defaultWidthM;
      const w3 = p3.widthM ?? schema.defaultWidthM;
      const widthM = Math.max(6, catmullRomScalar(w0, w1, w2, w3, u));

      if (prevPos) {
        cumulativeDist += Math.hypot(
          position.x - prevPos.x,
          position.y - prevPos.y,
          position.z - prevPos.z
        );
      }
      prevPos = position;

      const nearestCtrl = u < 0.5 ? p1 : p2;
      const inPassingZone = passingZones.some((z) => isProgressInSpan(t, z.startT, z.endT));
      const inDriftZone = driftZones.some((z) => isProgressInSpan(t, z.startT, z.endT));

      rawSamples.push({
        t,
        distanceM: cumulativeDist,
        position,
        tangent,
        normal,
        right,
        bankRad,
        widthM,
        kerbLeft: Boolean(nearestCtrl.kerbLeft),
        kerbRight: Boolean(nearestCtrl.kerbRight),
        surface: resolveSurfaceAt(t),
        inPassingZone,
        inDriftZone,
      });
    }

    const first = rawSamples[0].position;
    const last = rawSamples[rawSamples.length - 1].position;
    this.totalLengthM =
      cumulativeDist + Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z);

    this.samples = rawSamples.map((s, idx) => {
      const prev = rawSamples[(idx - 1 + count) % count];
      const next = rawSamples[(idx + 1) % count];
      const ds =
        Math.hypot(
          next.position.x - prev.position.x,
          next.position.y - prev.position.y,
          next.position.z - prev.position.z
        ) || 1;
      const dtX = next.tangent.x - prev.tangent.x;
      const dtY = next.tangent.y - prev.tangent.y;
      const dtZ = next.tangent.z - prev.tangent.z;
      const curvature = Math.hypot(dtX, dtY, dtZ) / ds;
      const turnSign = dtX * s.right.x + dtY * s.right.y + dtZ * s.right.z >= 0 ? 1 : -1;
      const signedCurvature = curvature * turnSign;

      // Auto-derive subtle apex kerbs on tight tarmac bends when route JSON omits kerb flags,
      // while keeping passing zones and straights completely clear.
      let kerbLeft = s.kerbLeft;
      let kerbRight = s.kerbRight;
      if (!hasExplicitKerbs && !s.inPassingZone && s.surface === 'tarmac' && curvature >= 0.015) {
        // turnSign < 0 => left bend (inside apex on left); turnSign > 0 => right bend (inside apex on right)
        if (signedCurvature < 0) kerbLeft = true;
        else kerbRight = true;
      }

      return {
        ...s,
        kerbLeft,
        kerbRight,
        curvature,
        signedCurvature,
      };
    });
  }

  public sampleAtProgress(t: number): ISplineSample {
    const wrapped = ((t % 1) + 1) % 1;
    const count = this.samples.length;
    const floatIdx = wrapped * count;
    const i0 = Math.floor(floatIdx) % count;
    const i1 = (i0 + 1) % count;
    const frac = floatIdx - Math.floor(floatIdx);
    const a = this.samples[i0];
    const b = this.samples[i1];

    const distB = i1 === 0 ? this.totalLengthM : b.distanceM;

    const position: Vec3 = {
      x: a.position.x + (b.position.x - a.position.x) * frac,
      y: a.position.y + (b.position.y - a.position.y) * frac,
      z: a.position.z + (b.position.z - a.position.z) * frac,
    };
    const tangent = normalizeVec3({
      x: a.tangent.x + (b.tangent.x - a.tangent.x) * frac,
      y: a.tangent.y + (b.tangent.y - a.tangent.y) * frac,
      z: a.tangent.z + (b.tangent.z - a.tangent.z) * frac,
    });
    const normal = normalizeVec3({
      x: a.normal.x + (b.normal.x - a.normal.x) * frac,
      y: a.normal.y + (b.normal.y - a.normal.y) * frac,
      z: a.normal.z + (b.normal.z - a.normal.z) * frac,
    });
    const right = normalizeVec3({
      x: a.right.x + (b.right.x - a.right.x) * frac,
      y: a.right.y + (b.right.y - a.right.y) * frac,
      z: a.right.z + (b.right.z - a.right.z) * frac,
    });

    return {
      t: wrapped,
      distanceM: a.distanceM + (distB - a.distanceM) * frac,
      position,
      tangent,
      normal,
      right,
      bankRad: a.bankRad + (b.bankRad - a.bankRad) * frac,
      widthM: a.widthM + (b.widthM - a.widthM) * frac,
      curvature: a.curvature + (b.curvature - a.curvature) * frac,
      signedCurvature: a.signedCurvature + (b.signedCurvature - a.signedCurvature) * frac,
      kerbLeft: a.kerbLeft,
      kerbRight: a.kerbRight,
      surface: a.surface,
      inPassingZone: a.inPassingZone,
      inDriftZone: a.inDriftZone,
    };
  }

  /**
   * Maps an arc-length distance in meters (wrapped to [0, totalLengthM)) to exact spline parameter `t`.
   */
  public progressAtDistance(distanceM: number): number {
    const len = this.totalLengthM;
    if (len <= 1e-6) return 0;
    const d = ((distanceM % len) + len) % len;
    const count = this.samples.length;

    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (this.samples[mid].distanceM <= d) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }

    const d0 = this.samples[lo].distanceM;
    const d1 = lo === count - 1 ? len : this.samples[lo + 1].distanceM;
    const span = Math.max(1e-6, d1 - d0);
    const frac = Math.max(0, Math.min(1, (d - d0) / span));
    return ((lo + frac) / count) % 1;
  }

  public findClosestSample(
    point: Vec3,
    hintProgress?: number
  ): {
    sample: ISplineSample;
    lateralOffsetM: number;
    distanceSq: number;
  } {
    const n = this.samples.length;
    let bestIdx = 0;
    let bestDistSq = Infinity;

    if (hintProgress !== undefined) {
      const center = Math.floor((((hintProgress % 1) + 1) % 1) * n);
      const windowRadius = Math.max(32, Math.ceil(n * 0.08));
      for (let offset = -windowRadius; offset <= windowRadius; offset++) {
        const idx = (center + offset + n) % n;
        const s = this.samples[idx];
        const dx = point.x - s.position.x;
        const dy = point.y - s.position.y;
        const dz = point.z - s.position.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestIdx = idx;
        }
      }
    }

    if (bestDistSq > 900) {
      bestDistSq = Infinity;
      for (let i = 0; i < n; i++) {
        const s = this.samples[i];
        const dx = point.x - s.position.x;
        const dy = point.y - s.position.y;
        const dz = point.z - s.position.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestIdx = i;
        }
      }
    }

    const best = this.samples[bestIdx];
    const relX = point.x - best.position.x;
    const relY = point.y - best.position.y;
    const relZ = point.z - best.position.z;
    const lateralOffsetM = relX * best.right.x + relY * best.right.y + relZ * best.right.z;

    return { sample: best, lateralOffsetM, distanceSq: bestDistSq };
  }

  /**
   * Builds 4 standing start grid slots behind the Start/Finish line (t = 0).
   * Slot 0 sits centered at -2.5 m (nose right at the S/F line per contract),
   * while slots 1..3 stagger cleanly behind with safe lateral clearance for AI / Friend Race.
   */
  public getStartGridSlots(count = 4): ITrackGridSlot[] {
    const slots: ITrackGridSlot[] = [];
    const slotBackOffsetsM = [2.5, 10.0, 17.5, 25.0];
    const slotLateralFracs = [0.0, 0.22, -0.22, 0.22];

    for (let i = 0; i < count; i++) {
      const backM = slotBackOffsetsM[i] ?? 2.5 + i * 7.5;
      const latFrac = slotLateralFracs[i] ?? (i % 2 === 1 ? 0.22 : -0.22);
      const t = this.progressAtDistance(this.totalLengthM - backM);
      const s = this.sampleAtProgress(t);
      const maxSafeLat = Math.max(0, s.widthM * 0.5 - 2.1);
      const lateralOffsetM = Math.max(-maxSafeLat, Math.min(maxSafeLat, s.widthM * latFrac));
      const left: Vec3 = { x: -s.right.x, y: -s.right.y, z: -s.right.z };
      const rotation = basisToQuaternion(left, s.normal, s.tangent);

      slots.push({
        slotIndex: i,
        position: {
          x: s.position.x + s.right.x * lateralOffsetM + s.normal.x * 0.65,
          y: s.position.y + s.right.y * lateralOffsetM + s.normal.y * 0.65,
          z: s.position.z + s.right.z * lateralOffsetM + s.normal.z * 0.65,
        },
        rotation,
        splineProgress: t,
        lateralOffsetM,
      });
    }
    return slots;
  }

  /**
   * Builds ordered timing & anti-cut checkpoint gates along [0..1):
   * Gate 0 = Start/Finish (completes final sector), followed by interleaved
   * anti-cut mid-sector checkpoints and sector split gates in strictly ascending `t`.
   */
  public buildTimingGates(): ITrackTimingGate[] {
    const sectors = this.sectors;
    const rawGates: Array<{
      kind: 'start_finish' | 'sector' | 'checkpoint';
      sectorIndex?: number;
      sectorName?: string;
      t: number;
    }> = [];

    const finalSector = sectors[sectors.length - 1];
    rawGates.push({
      kind: 'start_finish',
      sectorIndex: finalSector.index,
      sectorName: finalSector.name,
      t: 0,
    });

    for (let i = 0; i < sectors.length; i++) {
      const sec = sectors[i];
      const startT = sec.startT;
      const endT = i === sectors.length - 1 ? 1.0 : sec.endT;
      const midT = (startT + endT) * 0.5;
      if (midT > 0.02 && midT < 0.98) {
        rawGates.push({
          kind: 'checkpoint',
          t: midT,
        });
      }
      if (i < sectors.length - 1) {
        rawGates.push({
          kind: 'sector',
          sectorIndex: sec.index,
          sectorName: sec.name,
          t: endT,
        });
      }
    }

    rawGates.sort((a, b) => a.t - b.t);

    return rawGates.map((g, gateIndex) => {
      const s = this.sampleAtProgress(g.t);
      const halfWidthM = s.widthM * 0.5 + TRACK_KERB_WIDTH_M + TRACK_RUNOFF_WIDTH_M;
      return {
        gateIndex,
        kind: g.kind,
        sectorIndex: g.sectorIndex,
        sectorName: g.sectorName,
        t: g.t,
        center: { ...s.position },
        tangent: { ...s.tangent },
        right: { ...s.right },
        normal: { ...s.normal },
        halfWidthM,
      };
    });
  }

  public getSpawnTransform(): { position: Vec3; rotation: Quat; splineProgress: number } {
    const slot0 = this.getStartGridSlots(1)[0];
    return {
      position: slot0.position,
      rotation: slot0.rotation,
      splineProgress: slot0.splineProgress,
    };
  }

  /**
   * Legacy spawn transform just ahead of t=0 for backwards compatibility with pre-LapSectorTimer Engine.ts
   * (avoids t=0.005 -> t=0.998 wrap misfiring Sector 1). New Engine.ts uses `collisionHandle.startGrid[0]`.
   */
  public getLegacySpawnTransform(): { position: Vec3; rotation: Quat } {
    const start = this.sampleAtProgress(0.001);
    const left: Vec3 = { x: -start.right.x, y: -start.right.y, z: -start.right.z };
    const rotation = basisToQuaternion(left, start.normal, start.tangent);
    return {
      position: {
        x: start.position.x + start.normal.x * 0.65,
        y: start.position.y + start.normal.y * 0.65,
        z: start.position.z + start.normal.z * 0.65,
      },
      rotation,
    };
  }
}
