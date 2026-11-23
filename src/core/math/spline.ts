import type { ITrackControlPoint, ITrackSplineSchema, Quat, Vec3 } from '../types';

export interface ISplineSample {
  t: number; // Normalized [0..1)
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

function catmullRomDerivativeScalar(p0: number, p1: number, p2: number, p3: number, u: number): number {
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
 * Converts basis vectors (right, up, forward) where local vehicle forward = +Z, up = +Y, left = +X (or Three.js right-handed: X = left, Y = up, Z = forward -> X = up x forward; or X = right, Y = up, -Z = forward).
 * MODULUS Standard Right-Handed Basis:
 * Local +X = Left (`up x forward`), Local +Y = Up, Local +Z = Forward!
 * Check: X cross Y = (up x forward) x up = forward = +Z! Determinant = +1 (Pure Right-Handed!).
 */
export function basisToQuaternion(left: Vec3, up: Vec3, forward: Vec3): Quat {
  const m00 = left.x, m01 = up.x, m02 = forward.x;
  const m10 = left.y, m11 = up.y, m12 = forward.y;
  const m20 = left.z, m21 = up.z, m22 = forward.z;
  const trace = m00 + m11 + m22;
  let x = 0, y = 0, z = 0, w = 1;

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
 * Banked 3D Closed Catmull-Rom Track Spline
 * Used identically by track-generator, physics-rapier, Engine lap timing, and ai-test-driver.
 */
export class TrackSpline {
  public readonly schema: ITrackSplineSchema;
  public readonly samples: ISplineSample[];
  public readonly totalLengthM: number;

  constructor(schema: ITrackSplineSchema, sampleCount = 480) {
    this.schema = schema;
    const pts = schema.controlPoints;
    const n = pts.length;
    const rawSamples: Omit<ISplineSample, 'curvature' | 'signedCurvature'>[] = [];
    let cumulativeDist = 0;
    let prevPos: Vec3 | null = null;

    for (let i = 0; i < sampleCount; i++) {
      const t = i / sampleCount;
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
      });
    }

    const first = rawSamples[0].position;
    const last = rawSamples[rawSamples.length - 1].position;
    this.totalLengthM =
      cumulativeDist + Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z);

    this.samples = rawSamples.map((s, idx) => {
      const prev = rawSamples[(idx - 1 + sampleCount) % sampleCount];
      const next = rawSamples[(idx + 1) % sampleCount];
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
      return {
        ...s,
        curvature,
        signedCurvature: curvature * turnSign,
      };
    });
  }

  public sampleAtProgress(t: number): ISplineSample {
    const wrapped = ((t % 1) + 1) % 1;
    const floatIdx = wrapped * this.samples.length;
    const i0 = Math.floor(floatIdx) % this.samples.length;
    const i1 = (i0 + 1) % this.samples.length;
    const frac = floatIdx - Math.floor(floatIdx);
    const a = this.samples[i0];
    const b = this.samples[i1];

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
      distanceM: wrapped * this.totalLengthM,
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
    };
  }

  public findClosestSample(point: Vec3, hintProgress?: number): {
    sample: ISplineSample;
    lateralOffsetM: number;
    distanceSq: number;
  } {
    const n = this.samples.length;
    let bestIdx = 0;
    let bestDistSq = Infinity;

    if (hintProgress !== undefined) {
      const center = Math.floor((((hintProgress % 1) + 1) % 1) * n);
      const windowRadius = 32;
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

  public getSpawnTransform(): { position: Vec3; rotation: Quat } {
    const start = this.sampleAtProgress(0.005);
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
