import * as THREE from 'three';
import type {
  ITrackCollisionHandle,
  ITrackRenderHandle,
} from '../../contracts/simulation';
import { DeterministicPrng } from '../../core/math/prng';
import {
  TRACK_KERB_WIDTH_M,
  TRACK_RUNOFF_WIDTH_M,
  type ISplineSample,
} from '../../core/math/spline';
import type { ITrackGeometryData, ITrackSplineSchema, Vec3 } from '../../core/types';
import { buildTrackCollision } from './buildTrackCollision';
import {
  extractCrestAndDownhillBrakingZones,
  extractSurfaceTransitions,
} from './trackPreview';

export interface ITrackGeometryDataV2 extends ITrackGeometryData {
  collisionHandle: ITrackCollisionHandle;
  renderHandle: ITrackRenderHandle;
}

export interface IBuiltTrackBundle {
  group: THREE.Group;
  geometryData: ITrackGeometryDataV2;
  collisionHandle: ITrackCollisionHandle;
  renderHandle: ITrackRenderHandle;
  dispose: () => void;
}

const WHITE_LINE_WIDTH_M = 0.24;

interface StripDef {
  latA: number;
  latB: number;
  yA: number;
  yB: number;
  kind: 'grassL' | 'kerbL' | 'lineL' | 'tarmac' | 'lineR' | 'kerbR' | 'grassR';
  tarmacLane?: number;
}

function evalSurfacePoint(sample: ISplineSample, latOffset: number, upOffset: number): Vec3 {
  return {
    x: sample.position.x + sample.right.x * latOffset + sample.normal.x * upOffset,
    y: sample.position.y + sample.right.y * latOffset + sample.normal.y * upOffset,
    z: sample.position.z + sample.right.z * latOffset + sample.normal.z * upOffset,
  };
}

function pushQuadNonIndexed(
  positions: number[],
  colors: number[],
  p00: Vec3,
  p01: Vec3,
  p10: Vec3,
  p11: Vec3,
  c: THREE.Color
): void {
  // Winding: (p00, p01, p10) and (p01, p11, p10) -> outward normal = +right x +tangent = +normal (UP)
  positions.push(
    p00.x, p00.y, p00.z,
    p01.x, p01.y, p01.z,
    p10.x, p10.y, p10.z,
    p01.x, p01.y, p01.z,
    p11.x, p11.y, p11.z,
    p10.x, p10.y, p10.z
  );
  for (let k = 0; k < 6; k++) {
    colors.push(c.r, c.g, c.b);
  }
}

function pushQuadDoubleColor(
  positions: number[],
  colors: number[],
  p00: Vec3,
  p01: Vec3,
  p10: Vec3,
  p11: Vec3,
  c0: THREE.Color,
  c1: THREE.Color
): void {
  // c0 for left edge (p00, p10), c1 for right edge (p01, p11)
  positions.push(
    p00.x, p00.y, p00.z,
    p01.x, p01.y, p01.z,
    p10.x, p10.y, p10.z,
    p01.x, p01.y, p01.z,
    p11.x, p11.y, p11.z,
    p10.x, p10.y, p10.z
  );
  colors.push(
    c0.r, c0.g, c0.b,
    c1.r, c1.g, c1.b,
    c0.r, c0.g, c0.b,
    c1.r, c1.g, c1.b,
    c1.r, c1.g, c1.b,
    c0.r, c0.g, c0.b
  );
}

/**
 * Spatial hash over all spline samples in XZ for fast exact terrain-clearance & prop setback queries.
 */
class SplineSpatialIndex {
  private readonly cellSize: number;
  private readonly buckets = new Map<string, ISplineSample[]>();
  private readonly allSamples: ISplineSample[];

  constructor(samples: ISplineSample[], cellSize = 24) {
    this.cellSize = cellSize;
    this.allSamples = samples;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const cx = Math.floor(s.position.x / cellSize);
      const cz = Math.floor(s.position.z / cellSize);
      const key = `${cx},${cz}`;
      let list = this.buckets.get(key);
      if (!list) {
        list = [];
        this.buckets.set(key, list);
      }
      list.push(s);
    }
  }

  public queryClearance(
    wx: number,
    wz: number,
    corridorExtraM: number
  ): {
    nearestSample: ISplineSample;
    nearestDist: number;
    inCorridor: boolean;
    minCorridorRoadY: number;
  } {
    const cx = Math.floor(wx / this.cellSize);
    const cz = Math.floor(wz / this.cellSize);
    const searchRadiusCells = Math.max(2, Math.ceil((28 + corridorExtraM) / this.cellSize));

    let nearestDistSq = Infinity;
    let nearestSample: ISplineSample | null = null;
    let inCorridor = false;
    let minCorridorRoadY = Infinity;

    for (let dz = -searchRadiusCells; dz <= searchRadiusCells; dz++) {
      for (let dx = -searchRadiusCells; dx <= searchRadiusCells; dx++) {
        const list = this.buckets.get(`${cx + dx},${cz + dz}`);
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const sp = list[i];
          const ddx = wx - sp.position.x;
          const ddz = wz - sp.position.z;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < nearestDistSq) {
            nearestDistSq = d2;
            nearestSample = sp;
          }
          const outerLat = sp.widthM * 0.5 + TRACK_KERB_WIDTH_M + TRACK_RUNOFF_WIDTH_M;
          const cRad = outerLat + corridorExtraM;
          if (d2 <= cRad * cRad) {
            inCorridor = true;
            // Account for worst-case banking dip at the outer edge
            const edgeDip = Math.abs(Math.sin(sp.bankRad)) * outerLat;
            const lowY = sp.position.y - edgeDip;
            if (lowY < minCorridorRoadY) {
              minCorridorRoadY = lowY;
            }
          }
        }
      }
    }

    // Fallback scan for distant outer-rim terrain vertices outside local search window
    if (!nearestSample) {
      const step = Math.max(1, Math.floor(this.allSamples.length / 180));
      for (let i = 0; i < this.allSamples.length; i += step) {
        const sp = this.allSamples[i];
        const ddx = wx - sp.position.x;
        const ddz = wz - sp.position.z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 < nearestDistSq) {
          nearestDistSq = d2;
          nearestSample = sp;
        }
      }
    }

    const best = nearestSample ?? this.allSamples[0];
    return {
      nearestSample: best,
      nearestDist: Math.sqrt(nearestDistSq),
      inCorridor,
      minCorridorRoadY: inCorridor ? minCorridorRoadY : best.position.y,
    };
  }
}

/**
 * Builds canonical collision handle (via pure-math `buildTrackCollision`) and
 * Art-of-Rally sunlit faceted visual geometry + terrain clearance corridor for any `ITrackSplineSchema`.
 */
export function buildTrackBundle(schema: ITrackSplineSchema): IBuiltTrackBundle {
  const { spline, collisionHandle } = buildTrackCollision(schema);
  const samples = spline.samples;
  const n = samples.length;
  const prng = new DeterministicPrng(schema.id);
  const spatialIndex = new SplineSpatialIndex(samples, 24);

  const root = new THREE.Group();
  root.name = `track_${schema.id}`;

  const disposables: Array<{ dispose: () => void }> = [];
  const trackDisposable = <T extends { dispose: () => void }>(res: T): T => {
    disposables.push(res);
    return res;
  };

  // Smooth signed curvature for racing-line rubber groove shading
  const smoothedCurv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const radius = 5;
    for (let k = -radius; k <= radius; k++) {
      sum += samples[(i + k + n) % n].signedCurvature;
    }
    smoothedCurv[i] = sum / (radius * 2 + 1);
  }

  // =========================================================================
  // 1. VISUAL ROAD + KERBS + RUNOFF RIBBON (Art of Rally Vertex-Colored)
  // =========================================================================
  const roadPos: number[] = [];
  const roadCol: number[] = [];

  const groundBase = new THREE.Color(schema.groundColorHex);
  const asphaltBase = new THREE.Color('#2E3440');
  const asphaltGroove = new THREE.Color('#1F242D');
  const gravelBase = new THREE.Color('#9A866E');
  const gravelGroove = new THREE.Color('#7D6B55');
  const whitePaint = new THREE.Color('#F1F5F9');
  const kerbRed = new THREE.Color('#DC2626');
  const kerbWhite = new THREE.Color('#F8FAFC');
  const concreteEdge = new THREE.Color('#94A3B8');
  const checkerDark = new THREE.Color('#111827');
  const sector1Amber = new THREE.Color('#F59E0B');
  const sector2Cyan = new THREE.Color('#00F0FF');
  const tmpColor = new THREE.Color();
  const tmpColor2 = new THREE.Color();

  const sectorGateIndices = new Map<number, THREE.Color>();
  if (schema.sectorFractions[0] > 0 && schema.sectorFractions[0] < 1) {
    sectorGateIndices.set(spline.indexAtProgress(schema.sectorFractions[0]), sector1Amber);
  }
  if (schema.sectorFractions[1] > 0 && schema.sectorFractions[1] < 1) {
    sectorGateIndices.set(spline.indexAtProgress(schema.sectorFractions[1]), sector2Cyan);
  }

  const buildStrips = (s: ISplineSample, segIndex: number): StripDef[] => {
    const hw = s.widthM * 0.5;
    const outerLat = hw + TRACK_KERB_WIDTH_M + TRACK_RUNOFF_WIDTH_M;
    const kerbLat = hw + TRACK_KERB_WIDTH_M;
    const innerLine = hw - WHITE_LINE_WIDTH_M;
    const kerbWaveL = s.kerbLeft ? (segIndex % 2 === 0 ? 0.06 : 0.038) : -0.015;
    const kerbWaveR = s.kerbRight ? (segIndex % 2 === 0 ? 0.06 : 0.038) : -0.015;

    return [
      { latA: -outerLat, latB: -kerbLat, yA: -0.08, yB: -0.015, kind: 'grassL' },
      { latA: -kerbLat, latB: -hw, yA: s.kerbLeft ? 0.025 : -0.015, yB: kerbWaveL, kind: 'kerbL' },
      { latA: -hw, latB: -innerLine, yA: 0.008, yB: 0.01, kind: 'lineL' },
      { latA: -innerLine, latB: -hw * 0.5, yA: 0.01, yB: 0.016, kind: 'tarmac', tarmacLane: 0 },
      { latA: -hw * 0.5, latB: 0, yA: 0.016, yB: 0.022, kind: 'tarmac', tarmacLane: 1 },
      { latA: 0, latB: hw * 0.5, yA: 0.022, yB: 0.016, kind: 'tarmac', tarmacLane: 2 },
      { latA: hw * 0.5, latB: innerLine, yA: 0.016, yB: 0.01, kind: 'tarmac', tarmacLane: 3 },
      { latA: innerLine, latB: hw, yA: 0.01, yB: 0.008, kind: 'lineR' },
      { latA: hw, latB: kerbLat, yA: kerbWaveR, yB: s.kerbRight ? 0.025 : -0.015, kind: 'kerbR' },
      { latA: kerbLat, latB: outerLat, yA: -0.015, yB: -0.08, kind: 'grassR' },
    ];
  };

  for (let i = 0; i < n; i++) {
    const iNext = (i + 1) % n;
    const s0 = samples[i];
    const s1 = samples[iNext];
    const strips0 = buildStrips(s0, i);
    const strips1 = buildStrips(s1, iNext);
    const hw = s0.widthM * 0.5;

    const grooveLat = Math.max(-0.78, Math.min(0.78, smoothedCurv[i] * 135)) * hw;
    const noise = (prng.next() - 0.5) * 0.026;
    const isGravel = s0.surface === 'gravel' || s0.surface === 'dirt';
    const baseRoadColor = isGravel ? gravelBase : asphaltBase;
    const grooveRoadColor = isGravel ? gravelGroove : asphaltGroove;
    const sectorStripeColor = sectorGateIndices.get(i);

    for (let k = 0; k < strips0.length; k++) {
      const a0 = strips0[k];
      const a1 = strips1[k];
      const p00 = evalSurfacePoint(s0, a0.latA, a0.yA);
      const p01 = evalSurfacePoint(s0, a0.latB, a0.yB);
      const p10 = evalSurfacePoint(s1, a1.latA, a1.yA);
      const p11 = evalSurfacePoint(s1, a1.latB, a1.yB);

      if (a0.kind === 'tarmac') {
        // Start/finish checkered line right at i === 0 and i === n - 1 (centered on t = 0)
        if (i === 0 || i === n - 1) {
          const lane = a0.tarmacLane ?? 0;
          const row = i === 0 ? 0 : 1;
          const isWhite = (lane + row) % 2 === 0;
          tmpColor.copy(isWhite ? whitePaint : checkerDark);
          pushQuadNonIndexed(roadPos, roadCol, p00, p01, p10, p11, tmpColor);
        } else if (s0.surface !== s1.surface) {
          // Crisp readable surface transition apron strip (e.g. tarmac <-> gravel)
          tmpColor.copy(asphaltBase).lerp(gravelBase, 0.5).lerp(sector1Amber, 0.25);
          pushQuadNonIndexed(roadPos, roadCol, p00, p01, p10, p11, tmpColor);
        } else if (sectorStripeColor) {
          // Crisp painted sector timing line matching sector gantry accent
          tmpColor.copy(baseRoadColor).lerp(sectorStripeColor, 0.58);
          pushQuadNonIndexed(roadPos, roadCol, p00, p01, p10, p11, tmpColor);
        } else {
          const dA = Math.abs(a0.latA - grooveLat) / hw;
          const dB = Math.abs(a0.latB - grooveLat) / hw;
          const wearA = Math.exp(-dA * dA * 3.8);
          const wearB = Math.exp(-dB * dB * 3.8);

          tmpColor.copy(baseRoadColor).lerp(grooveRoadColor, wearA * 0.72);
          tmpColor.offsetHSL(0, 0, noise);

          tmpColor2.copy(baseRoadColor).lerp(grooveRoadColor, wearB * 0.72);
          tmpColor2.offsetHSL(0, 0, noise * 0.7);

          pushQuadDoubleColor(roadPos, roadCol, p00, p01, p10, p11, tmpColor, tmpColor2);
        }
      } else if (a0.kind === 'lineL' || a0.kind === 'lineR') {
        if (isGravel) {
          tmpColor.copy(gravelBase).lerp(groundBase, 0.35);
          pushQuadNonIndexed(roadPos, roadCol, p00, p01, p10, p11, tmpColor);
        } else {
          pushQuadNonIndexed(roadPos, roadCol, p00, p01, p10, p11, whitePaint);
        }
      } else if (a0.kind === 'kerbL') {
        if (s0.kerbLeft) {
          tmpColor.copy(i % 2 === 0 ? kerbRed : kerbWhite);
        } else {
          tmpColor.copy(concreteEdge).lerp(groundBase, 0.55);
          tmpColor.offsetHSL(0, 0, noise * 0.8);
        }
        pushQuadNonIndexed(roadPos, roadCol, p00, p01, p10, p11, tmpColor);
      } else if (a0.kind === 'kerbR') {
        if (s0.kerbRight) {
          tmpColor.copy(i % 2 === 0 ? kerbRed : kerbWhite);
        } else {
          tmpColor.copy(concreteEdge).lerp(groundBase, 0.55);
          tmpColor.offsetHSL(0, 0, noise * 0.8);
        }
        pushQuadNonIndexed(roadPos, roadCol, p00, p01, p10, p11, tmpColor);
      } else {
        tmpColor.copy(groundBase);
        tmpColor.offsetHSL((prng.next() - 0.5) * 0.02, (prng.next() - 0.5) * 0.04, noise * 1.4);
        tmpColor2.copy(groundBase);
        tmpColor2.offsetHSL(0, -0.02, -0.03 + noise);
        if (a0.kind === 'grassL') {
          pushQuadDoubleColor(roadPos, roadCol, p00, p01, p10, p11, tmpColor2, tmpColor);
        } else {
          pushQuadDoubleColor(roadPos, roadCol, p00, p01, p10, p11, tmpColor, tmpColor2);
        }
      }
    }
  }

  const roadGeo = trackDisposable(new THREE.BufferGeometry());
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPos, 3));
  roadGeo.setAttribute('color', new THREE.Float32BufferAttribute(roadCol, 3));
  roadGeo.computeVertexNormals();

  const roadMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.86,
      metalness: 0.04,
      flatShading: true,
    })
  );
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.receiveShadow = true;
  roadMesh.castShadow = false;
  roadMesh.name = 'track_road_surface';
  root.add(roadMesh);

  // =========================================================================
  // 2. PAINTED STANDING START GRID BOXES (Aligned 1:1 with startGrid[0..3])
  // =========================================================================
  const gridPaintMat = trackDisposable(
    new THREE.MeshBasicMaterial({
      color: '#F1F5F9',
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  );
  const gridFrontBarGeo = trackDisposable(new THREE.PlaneGeometry(2.4, 0.22));
  gridFrontBarGeo.rotateX(-Math.PI / 2);
  const gridSideBarGeo = trackDisposable(new THREE.PlaneGeometry(0.16, 1.35));
  gridSideBarGeo.rotateX(-Math.PI / 2);

  for (const slot of collisionHandle.startGrid) {
    const s = spline.sampleAtProgress(slot.splineProgress);
    const boxGroup = new THREE.Group();
    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(-s.right.x, -s.right.y, -s.right.z),
      new THREE.Vector3(s.normal.x, s.normal.y, s.normal.z),
      new THREE.Vector3(s.tangent.x, s.tangent.y, s.tangent.z)
    );
    const baseP = evalSurfacePoint(s, slot.lateralOffsetM, 0.032);
    boxGroup.position.set(baseP.x, baseP.y, baseP.z);
    boxGroup.quaternion.setFromRotationMatrix(basis);

    const frontBar = new THREE.Mesh(gridFrontBarGeo, gridPaintMat);
    frontBar.position.set(0, 0, 2.15);
    boxGroup.add(frontBar);

    const leftBar = new THREE.Mesh(gridSideBarGeo, gridPaintMat);
    leftBar.position.set(1.12, 0, 1.48);
    boxGroup.add(leftBar);

    const rightBar = new THREE.Mesh(gridSideBarGeo, gridPaintMat);
    rightBar.position.set(-1.12, 0, 1.48);
    boxGroup.add(rightBar);

    root.add(boxGroup);
  }

  // =========================================================================
  // 3. LOW-POLY SAFETY BARRIERS (Armco Guardrail Ribbon + Support Posts)
  // =========================================================================
  const barrierPos: number[] = [];
  const barrierCol: number[] = [];
  const railSteel = new THREE.Color('#CBD5E1');
  const railShadow = new THREE.Color('#64748B');
  const railAccentRed = new THREE.Color('#E11D48');
  const railAccentWhite = new THREE.Color('#F8FAFC');
  const railTopH = 0.92;
  const railBotH = 0.24;
  const railThick = 0.28;

  for (let i = 0; i < n; i++) {
    const iNext = (i + 1) % n;
    const s0 = samples[i];
    const s1 = samples[iNext];
    const outer0 = s0.widthM * 0.5 + TRACK_KERB_WIDTH_M + TRACK_RUNOFF_WIDTH_M;
    const outer1 = s1.widthM * 0.5 + TRACK_KERB_WIDTH_M + TRACK_RUNOFF_WIDTH_M;

    const highCurve = s0.curvature > 0.011;
    const stripeCol = highCurve
      ? Math.floor(i / 2) % 2 === 0
        ? railAccentRed
        : railAccentWhite
      : i % 6 === 0
      ? railShadow
      : railSteel;

    for (const side of [-1, 1] as const) {
      const innerLat0 = side * outer0;
      const outerLat0 = side * (outer0 + railThick);
      const innerLat1 = side * outer1;
      const outerLat1 = side * (outer1 + railThick);

      const i0b = evalSurfacePoint(s0, innerLat0, railBotH);
      const i0t = evalSurfacePoint(s0, innerLat0, railTopH);
      const o0t = evalSurfacePoint(s0, outerLat0, railTopH);
      const o0b = evalSurfacePoint(s0, outerLat0, railBotH);

      const i1b = evalSurfacePoint(s1, innerLat1, railBotH);
      const i1t = evalSurfacePoint(s1, innerLat1, railTopH);
      const o1t = evalSurfacePoint(s1, outerLat1, railTopH);
      const o1b = evalSurfacePoint(s1, outerLat1, railBotH);

      if (side === -1) {
        pushQuadNonIndexed(barrierPos, barrierCol, i0t, i0b, i1t, i1b, stripeCol);
        pushQuadNonIndexed(barrierPos, barrierCol, o0t, i0t, o1t, i1t, railSteel);
        pushQuadNonIndexed(barrierPos, barrierCol, o0b, o0t, o1b, o1t, railShadow);
      } else {
        pushQuadNonIndexed(barrierPos, barrierCol, i0b, i0t, i1b, i1t, stripeCol);
        pushQuadNonIndexed(barrierPos, barrierCol, i0t, o0t, i1t, o1t, railSteel);
        pushQuadNonIndexed(barrierPos, barrierCol, o0t, o0b, o1t, o1b, railShadow);
      }
    }
  }

  const barrierGeo = trackDisposable(new THREE.BufferGeometry());
  barrierGeo.setAttribute('position', new THREE.Float32BufferAttribute(barrierPos, 3));
  barrierGeo.setAttribute('color', new THREE.Float32BufferAttribute(barrierCol, 3));
  barrierGeo.computeVertexNormals();

  const barrierMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.62,
      metalness: 0.25,
      flatShading: true,
    })
  );
  const barrierMesh = new THREE.Mesh(barrierGeo, barrierMat);
  barrierMesh.castShadow = true;
  barrierMesh.receiveShadow = true;
  barrierMesh.name = 'track_barriers';
  root.add(barrierMesh);

  // Instanced guardrail steel support posts spaced cleanly every ~10 m along arc-length
  const postIndices: number[] = [];
  let nextPostDistM = 0;
  const postIntervalM = 10.0;
  for (let i = 0; i < n; i++) {
    if (samples[i].distanceM >= nextPostDistM) {
      postIndices.push(i);
      nextPostDistM = samples[i].distanceM + postIntervalM;
    }
  }
  const postCount = postIndices.length * 2;
  const postGeo = trackDisposable(new THREE.BoxGeometry(0.12, 0.95, 0.12));
  const postMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: '#475569',
      roughness: 0.7,
      metalness: 0.4,
      flatShading: true,
    })
  );
  const postInstanced = new THREE.InstancedMesh(postGeo, postMat, postCount);
  postInstanced.castShadow = true;
  const dummy = new THREE.Object3D();
  let pCursor = 0;
  for (let k = 0; k < postIndices.length; k++) {
    const s = samples[postIndices[k]];
    const outerLat = s.widthM * 0.5 + TRACK_KERB_WIDTH_M + TRACK_RUNOFF_WIDTH_M + railThick * 0.6;
    for (const side of [-1, 1] as const) {
      if (pCursor >= postCount) break;
      const p = evalSurfacePoint(s, side * outerLat, 0.36);
      dummy.position.set(p.x, p.y, p.z);
      dummy.lookAt(p.x + s.tangent.x, p.y + s.tangent.y, p.z + s.tangent.z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      postInstanced.setMatrixAt(pCursor++, dummy.matrix);
    }
  }
  postInstanced.count = pCursor;
  postInstanced.instanceMatrix.needsUpdate = true;
  root.add(postInstanced);

  // =========================================================================
  // 4. SCULPTED TERRAIN APRON WITH STRICT ROAD + RUNOFF CLEARANCE CORRIDOR
  // =========================================================================
  const { min: bMin, max: bMax } = collisionHandle.bounds;
  const centerX = (bMin.x + bMax.x) * 0.5;
  const centerZ = (bMin.z + bMax.z) * 0.5;
  const minY = bMin.y;
  const span = Math.max(bMax.x - bMin.x, bMax.z - bMin.z) + 520;
  const gridSegs = span > 2800 ? 192 : span > 1400 ? 144 : 96;
  const cellSize = span / gridSegs;
  // Guarantee every vertex of any terrain cell touching road or outer runoff is strictly depressed
  const corridorExtraM = cellSize * 1.35 + 3.0;

  const terrainGeo = trackDisposable(new THREE.PlaneGeometry(span, span, gridSegs, gridSegs));
  terrainGeo.rotateX(-Math.PI / 2);

  const tPos = terrainGeo.attributes.position as THREE.BufferAttribute;
  const tColors = new Float32Array(tPos.count * 3);
  const hillHighCol = new THREE.Color(schema.groundColorHex).lerp(new THREE.Color('#94A3B8'), 0.42);
  const valleyLowCol = new THREE.Color(schema.groundColorHex).lerp(new THREE.Color('#3F5935'), 0.25);
  const warmSunTint = new THREE.Color(schema.groundColorHex).lerp(new THREE.Color('#D9B978'), 0.24);
  const isMountain = schema.id.includes('mountain');
  const isDesert = schema.id.includes('oval');
  const hillAmp = isMountain ? 34 : isDesert ? 16 : 20;

  const evalTerrainHeight = (wx: number, wz: number): { y: number; hillWave: number } => {
    const q = spatialIndex.queryClearance(wx, wz, corridorExtraM);
    const nearestSample = q.nearestSample;
    const nearestDist = q.nearestDist;
    const outerLat = nearestSample.widthM * 0.5 + TRACK_KERB_WIDTH_M + TRACK_RUNOFF_WIDTH_M;
    const corridorRadius = outerLat + corridorExtraM;

    const hillWave =
      Math.sin(wx * 0.011 + 0.7) * Math.cos(wz * 0.013 - 0.4) * 0.55 +
      Math.sin((wx + wz) * 0.021 + 1.9) * 0.3 +
      Math.cos((wx - wz) * 0.037) * 0.15;

    if (q.inCorridor) {
      return { y: q.minCorridorRoadY - 0.55, hillWave };
    }

    const outerRim = Math.max(0, (nearestDist - 125) / 170);
    const rawHillY =
      minY - 2.4 + (hillWave * 0.5 + 0.5) * hillAmp + outerRim * outerRim * (isMountain ? 48 : 26);

    const blend = Math.max(0, Math.min(1, (nearestDist - corridorRadius) / 56));
    const smoothBlend = blend * blend * (3 - 2 * blend);
    const roadBedY = nearestSample.position.y - 0.55;
    const finalY = roadBedY * (1 - smoothBlend) + rawHillY * smoothBlend;
    return { y: finalY, hillWave };
  };

  for (let v = 0; v < tPos.count; v++) {
    const wx = tPos.getX(v) + centerX;
    const wz = tPos.getZ(v) + centerZ;
    const { y: clampedY, hillWave } = evalTerrainHeight(wx, wz);

    tPos.setXYZ(v, wx, clampedY, wz);

    const hNorm = Math.max(0, Math.min(1, (clampedY - (minY - 2)) / (hillAmp + 18)));
    if (hNorm > 0.62) {
      tmpColor.copy(groundBase).lerp(hillHighCol, (hNorm - 0.62) / 0.38);
    } else if (hNorm < 0.25) {
      tmpColor.copy(valleyLowCol).lerp(groundBase, hNorm / 0.25);
    } else {
      tmpColor.copy(groundBase).lerp(warmSunTint, Math.abs(hillWave) * 0.38);
    }
    tmpColor.offsetHSL(0, 0, (prng.next() - 0.5) * 0.035);
    tColors[v * 3] = tmpColor.r;
    tColors[v * 3 + 1] = tmpColor.g;
    tColors[v * 3 + 2] = tmpColor.b;
  }

  terrainGeo.setAttribute('color', new THREE.BufferAttribute(tColors, 3));
  terrainGeo.computeVertexNormals();

  const terrainMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.0,
      flatShading: true,
    })
  );
  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  terrainMesh.receiveShadow = true;
  terrainMesh.name = 'track_terrain_apron';
  root.add(terrainMesh);

  // Dynamic 2-tier corridor embankment skirt:
  // Tier 1 drops cleanly below the outer runoff lip into a 6 m shoulder berm.
  // Tier 2 spans dynamically out to bridge wide endurance terrain corridors (clamped below any nearby road leg at tight hairpins).
  const skirtPos: number[] = [];
  const skirtCol: number[] = [];
  const skirtColMid = new THREE.Color(schema.groundColorHex).multiplyScalar(0.93);
  const skirtColOuter = new THREE.Color(schema.groundColorHex).multiplyScalar(0.84);
  const dynamicSkirtReachM = Math.min(48, Math.max(14, corridorExtraM + cellSize * 0.55));
  const shoulderOffsetM = 5.5;

  const evalSkirtOuterPoint = (s: ISplineSample, side: -1 | 1, reachM: number): Vec3 => {
    const outerLat = s.widthM * 0.5 + TRACK_KERB_WIDTH_M + TRACK_RUNOFF_WIDTH_M;
    const raw = evalSurfacePoint(s, side * (outerLat + reachM), 0);
    const terrY = evalTerrainHeight(raw.x, raw.z).y;
    const clearance = spatialIndex.queryClearance(raw.x, raw.z, 3.0);
    // Ground cleanly into the terrain apron below, while strictly staying below any nearby road leg
    const safeRoadCeiling = clearance.inCorridor
      ? clearance.minCorridorRoadY - 0.62
      : s.position.y - 0.55;
    const groundedY = Math.min(terrY - 0.35, safeRoadCeiling, s.position.y - 1.2);
    return { x: raw.x, y: groundedY, z: raw.z };
  };

  const evalSkirtMidPoint = (s: ISplineSample, side: -1 | 1): Vec3 => {
    const outerLat = s.widthM * 0.5 + TRACK_KERB_WIDTH_M + TRACK_RUNOFF_WIDTH_M;
    const raw = evalSurfacePoint(s, side * (outerLat + shoulderOffsetM), 0);
    const terrY = evalTerrainHeight(raw.x, raw.z).y;
    const clearance = spatialIndex.queryClearance(raw.x, raw.z, 2.0);
    const safeRoadCeiling = clearance.inCorridor
      ? clearance.minCorridorRoadY - 0.52
      : s.position.y - 0.52;
    const midY = Math.min(s.position.y - 0.58, terrY - 0.12, safeRoadCeiling);
    return { x: raw.x, y: midY, z: raw.z };
  };

  // Precompute left/right mid & outer skirt rings so adjacent segments share exact stitched edges
  const leftMidRing: Vec3[] = new Array(n);
  const leftOuterRing: Vec3[] = new Array(n);
  const rightMidRing: Vec3[] = new Array(n);
  const rightOuterRing: Vec3[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    leftMidRing[i] = evalSkirtMidPoint(s, -1);
    leftOuterRing[i] = evalSkirtOuterPoint(s, -1, dynamicSkirtReachM);
    rightMidRing[i] = evalSkirtMidPoint(s, 1);
    rightOuterRing[i] = evalSkirtOuterPoint(s, 1, dynamicSkirtReachM);
  }

  for (let i = 0; i < n; i++) {
    const iNext = (i + 1) % n;
    const s0 = samples[i];
    const s1 = samples[iNext];
    const outer0 = s0.widthM * 0.5 + TRACK_KERB_WIDTH_M + TRACK_RUNOFF_WIDTH_M;
    const outer1 = s1.widthM * 0.5 + TRACK_KERB_WIDTH_M + TRACK_RUNOFF_WIDTH_M;

    const aL0 = evalSurfacePoint(s0, -outer0, -0.08);
    const aL1 = evalSurfacePoint(s1, -outer1, -0.08);
    pushQuadDoubleColor(skirtPos, skirtCol, leftMidRing[i], aL0, leftMidRing[iNext], aL1, skirtColMid, groundBase);
    pushQuadDoubleColor(
      skirtPos,
      skirtCol,
      leftOuterRing[i],
      leftMidRing[i],
      leftOuterRing[iNext],
      leftMidRing[iNext],
      skirtColOuter,
      skirtColMid
    );

    const aR0 = evalSurfacePoint(s0, outer0, -0.08);
    const aR1 = evalSurfacePoint(s1, outer1, -0.08);
    pushQuadDoubleColor(skirtPos, skirtCol, aR0, rightMidRing[i], aR1, rightMidRing[iNext], groundBase, skirtColMid);
    pushQuadDoubleColor(
      skirtPos,
      skirtCol,
      rightMidRing[i],
      rightOuterRing[i],
      rightMidRing[iNext],
      rightOuterRing[iNext],
      skirtColMid,
      skirtColOuter
    );
  }
  const skirtGeo = trackDisposable(new THREE.BufferGeometry());
  skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(skirtPos, 3));
  skirtGeo.setAttribute('color', new THREE.Float32BufferAttribute(skirtCol, 3));
  skirtGeo.computeVertexNormals();
  const skirtMesh = new THREE.Mesh(skirtGeo, terrainMat);
  skirtMesh.receiveShadow = true;
  skirtMesh.name = 'track_corridor_skirt';
  root.add(skirtMesh);

  // =========================================================================
  // 5. START/FINISH & SECTOR TIMING GANTRIES (Pillars strictly OUTSIDE barriers)
  // =========================================================================
  const buildGantry = (
    sample: ISplineSample,
    isStartFinish: boolean,
    accentHex: string
  ): THREE.Group => {
    const g = new THREE.Group();
    const outerLat = sample.widthM * 0.5 + TRACK_KERB_WIDTH_M + TRACK_RUNOFF_WIDTH_M;
    // Place pillars cleanly outside the containment wall so runoff & passing zones are 100% unobstructed
    const spanW = (outerLat + railThick + 0.65) * 2;
    const height = isStartFinish ? 7.2 : 6.0;

    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(-sample.right.x, -sample.right.y, -sample.right.z),
      new THREE.Vector3(sample.normal.x, sample.normal.y, sample.normal.z),
      new THREE.Vector3(sample.tangent.x, sample.tangent.y, sample.tangent.z)
    );
    g.position.set(sample.position.x, sample.position.y, sample.position.z);
    g.quaternion.setFromRotationMatrix(basis);

    const frameMat = trackDisposable(
      new THREE.MeshStandardMaterial({
        color: '#1E293B',
        roughness: 0.45,
        metalness: 0.65,
        flatShading: true,
      })
    );
    const accentMat = trackDisposable(
      new THREE.MeshStandardMaterial({
        color: accentHex,
        emissive: accentHex,
        emissiveIntensity: 0.55,
        roughness: 0.35,
        metalness: 0.2,
      })
    );

    const pillarGeo = trackDisposable(new THREE.BoxGeometry(0.65, height, 0.75));
    const leftPillar = new THREE.Mesh(pillarGeo, frameMat);
    leftPillar.position.set(spanW * 0.5, height * 0.5, 0);
    leftPillar.castShadow = true;
    g.add(leftPillar);

    const rightPillar = new THREE.Mesh(pillarGeo, frameMat);
    rightPillar.position.set(-spanW * 0.5, height * 0.5, 0);
    rightPillar.castShadow = true;
    g.add(rightPillar);

    const beamGeo = trackDisposable(
      new THREE.BoxGeometry(spanW + 1.0, isStartFinish ? 1.35 : 0.75, 0.9)
    );
    const beam = new THREE.Mesh(beamGeo, frameMat);
    beam.position.set(0, height - 0.3, 0);
    beam.castShadow = true;
    g.add(beam);

    const stripGeo = trackDisposable(new THREE.BoxGeometry(spanW - 0.8, 0.14, 0.96));
    const strip = new THREE.Mesh(stripGeo, accentMat);
    strip.position.set(0, height - (isStartFinish ? 0.95 : 0.68), 0);
    g.add(strip);

    if (isStartFinish) {
      const tiles = 16;
      const bannerW = Math.min(spanW - 2.0, sample.widthM + 4.0);
      const tileW = bannerW / tiles;
      const tileGeo = trackDisposable(new THREE.BoxGeometry(tileW * 0.96, 0.42, 0.96));
      const whiteMat = trackDisposable(
        new THREE.MeshStandardMaterial({ color: '#F8FAFC', roughness: 0.5 })
      );
      const darkMat = trackDisposable(
        new THREE.MeshStandardMaterial({ color: '#0F172A', roughness: 0.5 })
      );
      for (let t = 0; t < tiles; t++) {
        const x = -(bannerW * 0.5) + tileW * (t + 0.5);
        for (let row = 0; row < 2; row++) {
          const tile = new THREE.Mesh(tileGeo, (t + row) % 2 === 0 ? whiteMat : darkMat);
          tile.position.set(x, height - 0.1 + (row === 0 ? 0.22 : -0.22), 0);
          g.add(tile);
        }
      }

      const podGeo = trackDisposable(new THREE.BoxGeometry(0.45, 0.72, 0.3));
      const lampGeo = trackDisposable(new THREE.SphereGeometry(0.11, 8, 6));
      const greenLampMat = trackDisposable(
        new THREE.MeshStandardMaterial({
          color: '#10B981',
          emissive: '#10B981',
          emissiveIntensity: 1.6,
        })
      );
      for (let p = -2; p <= 2; p++) {
        const pod = new THREE.Mesh(podGeo, frameMat);
        pod.position.set(p * 1.15, height - 1.45, 0);
        g.add(pod);
        const lamp = new THREE.Mesh(lampGeo, greenLampMat);
        lamp.position.set(p * 1.15, height - 1.52, -0.18);
        g.add(lamp);
      }
    }

    return g;
  };

  root.add(buildGantry(spline.sampleAtProgress(0.0), true, '#00F0FF'));
  root.add(buildGantry(spline.sampleAtProgress(schema.sectorFractions[0]), false, '#F59E0B'));
  root.add(buildGantry(spline.sampleAtProgress(schema.sectorFractions[1]), false, '#00F0FF'));

  // =========================================================================
  // 6. BRAKE DISTANCE, CREST WARNING & SURFACE TRANSITION BOARDS (Outside barriers)
  // =========================================================================
  const brakeBoardPositions: Array<{
    sample: ISplineSample;
    side: -1 | 1;
    kind: '100' | '50' | 'crest' | 'surface';
  }> = [];
  let lastBrakeCornerDist = -200;
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    if (s.curvature < 0.022) continue;
    // Check that we're entering a corner from a straighter approach
    const prevS = spline.sampleAtProgress(spline.progressAtDistance(s.distanceM - 45));
    if (prevS.curvature > 0.013) continue;
    if (s.distanceM - lastBrakeCornerDist < 180) continue;
    lastBrakeCornerDist = s.distanceM;

    // Place marker boards on the OUTSIDE of the upcoming turn, strictly outside the barrier
    const outsideSide: -1 | 1 = s.signedCurvature >= 0 ? -1 : 1;
    for (const distM of [100, 50] as const) {
      const markerSample = spline.sampleAtProgress(spline.progressAtDistance(s.distanceM - distM));
      brakeBoardPositions.push({
        sample: markerSample,
        side: outsideSide,
        kind: distM === 100 ? '100' : '50',
      });
    }
  }

  // Add blind-crest & steep downhill braking boards (e.g. Teras Switchback)
  const hazards = extractCrestAndDownhillBrakingZones(spline);
  for (const h of hazards) {
    if (h.kind === 'blind_crest') {
      // Crest warning boards on both sides 45 m before the crest
      const crestApproach = spline.sampleAtProgress(spline.progressAtDistance(h.distanceM - 45));
      brakeBoardPositions.push({ sample: crestApproach, side: -1, kind: 'crest' });
      brakeBoardPositions.push({ sample: crestApproach, side: 1, kind: 'crest' });
    } else {
      // Downhill braking 100/50 boards on the outside of the turn
      for (const distM of [85, 45] as const) {
        const ms = spline.sampleAtProgress(spline.progressAtDistance(h.distanceM - distM));
        brakeBoardPositions.push({
          sample: ms,
          side: h.outsideSide,
          kind: distM === 85 ? '100' : '50',
        });
      }
    }
  }

  // Add readable surface-transition boards 30 m ahead of tarmac <-> gravel boundaries
  const surfaceTransitions = extractSurfaceTransitions(spline);
  for (const st of surfaceTransitions) {
    const approach = spline.sampleAtProgress(spline.progressAtDistance(st.distanceM - 30));
    brakeBoardPositions.push({ sample: approach, side: -1, kind: 'surface' });
    brakeBoardPositions.push({ sample: approach, side: 1, kind: 'surface' });
  }

  if (brakeBoardPositions.length > 0) {
    const boardGeo = trackDisposable(new THREE.BoxGeometry(1.15, 0.72, 0.1));
    const boardPostGeo = trackDisposable(new THREE.BoxGeometry(0.1, 1.4, 0.1));
    const boardPostMat = trackDisposable(
      new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.7 })
    );
    const board100Mat = trackDisposable(
      new THREE.MeshStandardMaterial({ color: '#F8FAFC', roughness: 0.45 })
    );
    const board50Mat = trackDisposable(
      new THREE.MeshStandardMaterial({ color: '#F59E0B', roughness: 0.45 })
    );
    const boardCrestMat = trackDisposable(
      new THREE.MeshStandardMaterial({
        color: '#EF4444',
        emissive: '#EF4444',
        emissiveIntensity: 0.15,
        roughness: 0.45,
      })
    );
    const boardSurfaceMat = trackDisposable(
      new THREE.MeshStandardMaterial({ color: '#D97706', roughness: 0.55 })
    );
    const stripeMat = trackDisposable(
      new THREE.MeshStandardMaterial({ color: '#0F172A', roughness: 0.5 })
    );
    const stripeGeo = trackDisposable(new THREE.BoxGeometry(0.95, 0.14, 0.12));

    for (const m of brakeBoardPositions) {
      const s = m.sample;
      const outerLat = s.widthM * 0.5 + TRACK_KERB_WIDTH_M + TRACK_RUNOFF_WIDTH_M + railThick + 1.1;
      const p = evalSurfacePoint(s, m.side * outerLat, 0);
      const boardGroup = new THREE.Group();
      const basis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(-s.right.x, -s.right.y, -s.right.z),
        new THREE.Vector3(s.normal.x, s.normal.y, s.normal.z),
        new THREE.Vector3(s.tangent.x, s.tangent.y, s.tangent.z)
      );
      boardGroup.position.set(p.x, p.y, p.z);
      boardGroup.quaternion.setFromRotationMatrix(basis);

      const post = new THREE.Mesh(boardPostGeo, boardPostMat);
      post.position.set(0, 0.7, 0);
      boardGroup.add(post);

      const mat =
        m.kind === '100'
          ? board100Mat
          : m.kind === '50'
          ? board50Mat
          : m.kind === 'crest'
          ? boardCrestMat
          : boardSurfaceMat;
      const board = new THREE.Mesh(boardGeo, mat);
      board.position.set(0, 1.45, 0);
      board.castShadow = true;
      boardGroup.add(board);

      const stripes = m.kind === '100' || m.kind === 'crest' ? 2 : 1;
      for (let st = 0; st < stripes; st++) {
        const bar = new THREE.Mesh(stripeGeo, stripeMat);
        bar.position.set(0, 1.45 + (stripes === 2 ? (st === 0 ? 0.14 : -0.14) : 0), 0);
        boardGroup.add(bar);
      }

      root.add(boardGroup);
    }
  }

  // =========================================================================
  // 7. GPU INSTANCED LOW-POLY PROPS (Trees, Boulders, Apex Bollards)
  // =========================================================================
  const isSafeFromRoad = (x: number, z: number, extraMargin: number): boolean => {
    const q = spatialIndex.queryClearance(x, z, extraMargin);
    const minClear =
      q.nearestSample.widthM * 0.5 +
      TRACK_KERB_WIDTH_M +
      TRACK_RUNOFF_WIDTH_M +
      extraMargin +
      (q.nearestSample.inPassingZone ? 4.0 : 0);
    return q.nearestDist >= minClear;
  };

  // 7A. Low-Poly Trees
  const targetTrees =
    schema.treeDensity <= 0 ? 0 : Math.floor(240 * Math.max(0.05, schema.treeDensity));
  const treeMatrices: THREE.Matrix4[] = [];
  const foliageMatrices: THREE.Matrix4[] = [];
  const foliageColors: THREE.Color[] = [];

  const treePalette = isMountain
    ? ['#1E4D2B', '#2D6A4F', '#40916C', '#E07A5F', '#D97706']
    : isDesert
    ? ['#6B705C', '#849B63', '#A3A87A']
    : ['#2B580C', '#3E7C17', '#5C9438', '#4F772D'];

  for (let attempt = 0; attempt < targetTrees * 4 && treeMatrices.length < targetTrees; attempt++) {
    const s = samples[prng.int(0, n - 1)];
    const side = prng.next() > 0.5 ? 1 : -1;
    const lateralDist =
      s.widthM * 0.5 + TRACK_KERB_WIDTH_M + TRACK_RUNOFF_WIDTH_M + prng.range(7.0, 68.0);
    const px = s.position.x + s.right.x * side * lateralDist + prng.range(-4, 4);
    const pz = s.position.z + s.right.z * side * lateralDist + prng.range(-4, 4);
    if (!isSafeFromRoad(px, pz, 4.5)) continue;

    const py = evalTerrainHeight(px, pz).y;
    const scale = prng.range(0.75, 1.85);
    const rotY = prng.range(0, Math.PI * 2);

    dummy.position.set(px, py + 1.1 * scale, pz);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    treeMatrices.push(dummy.matrix.clone());

    dummy.position.set(px, py + 3.4 * scale, pz);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(
      scale * (isDesert ? 0.8 : 1.0),
      scale * (isMountain ? 1.3 : 1.15),
      scale * (isDesert ? 0.8 : 1.0)
    );
    dummy.updateMatrix();
    foliageMatrices.push(dummy.matrix.clone());

    const baseTreeHex = treePalette[prng.int(0, treePalette.length - 1)];
    const tc = new THREE.Color(baseTreeHex);
    tc.offsetHSL((prng.next() - 0.5) * 0.03, 0, (prng.next() - 0.5) * 0.08);
    foliageColors.push(tc);
  }

  if (treeMatrices.length > 0) {
    const trunkGeo = trackDisposable(new THREE.CylinderGeometry(0.22, 0.34, 2.4, 5));
    const trunkMat = trackDisposable(
      new THREE.MeshStandardMaterial({ color: '#5C4033', roughness: 0.92, flatShading: true })
    );
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, treeMatrices.length);
    trunkMesh.castShadow = true;
    trunkMesh.receiveShadow = true;

    const crownGeo = trackDisposable(new THREE.ConeGeometry(1.75, 4.6, 6));
    const crownMat = trackDisposable(
      new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.82, flatShading: true })
    );
    const crownMesh = new THREE.InstancedMesh(crownGeo, crownMat, foliageMatrices.length);
    crownMesh.castShadow = true;
    crownMesh.receiveShadow = true;

    for (let i = 0; i < treeMatrices.length; i++) {
      trunkMesh.setMatrixAt(i, treeMatrices[i]);
      crownMesh.setMatrixAt(i, foliageMatrices[i]);
      crownMesh.setColorAt(i, foliageColors[i]);
    }
    trunkMesh.instanceMatrix.needsUpdate = true;
    crownMesh.instanceMatrix.needsUpdate = true;
    if (crownMesh.instanceColor) crownMesh.instanceColor.needsUpdate = true;
    root.add(trunkMesh);
    root.add(crownMesh);
  }

  // 7B. Low-Poly Boulders / Rocks
  const targetRocks =
    schema.rockDensity <= 0 ? 0 : Math.floor(140 * Math.max(0.05, schema.rockDensity));
  const rockMatrices: THREE.Matrix4[] = [];
  const rockColors: THREE.Color[] = [];
  const baseRockHex = isDesert ? '#B08968' : isMountain ? '#64748B' : '#78716C';

  for (let attempt = 0; attempt < targetRocks * 4 && rockMatrices.length < targetRocks; attempt++) {
    const s = samples[prng.int(0, n - 1)];
    const side = prng.next() > 0.5 ? 1 : -1;
    const lateralDist =
      s.widthM * 0.5 + TRACK_KERB_WIDTH_M + TRACK_RUNOFF_WIDTH_M + prng.range(5.5, 56.0);
    const px = s.position.x + s.right.x * side * lateralDist + prng.range(-3, 3);
    const pz = s.position.z + s.right.z * side * lateralDist + prng.range(-3, 3);
    if (!isSafeFromRoad(px, pz, 3.6)) continue;

    const py = evalTerrainHeight(px, pz).y;
    const sx = prng.range(0.8, 3.4);
    const sy = prng.range(0.6, 2.4);
    const sz = prng.range(0.8, 3.2);

    dummy.position.set(px, py + sy * 0.35, pz);
    dummy.rotation.set(prng.range(0, Math.PI), prng.range(0, Math.PI), prng.range(0, Math.PI));
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    rockMatrices.push(dummy.matrix.clone());

    const rc = new THREE.Color(baseRockHex);
    rc.offsetHSL(0, (prng.next() - 0.5) * 0.05, (prng.next() - 0.5) * 0.14);
    rockColors.push(rc);
  }

  if (rockMatrices.length > 0) {
    const rockGeo = trackDisposable(new THREE.DodecahedronGeometry(1.0, 0));
    const rockMat = trackDisposable(
      new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.9, flatShading: true })
    );
    const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, rockMatrices.length);
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    for (let i = 0; i < rockMatrices.length; i++) {
      rockMesh.setMatrixAt(i, rockMatrices[i]);
      rockMesh.setColorAt(i, rockColors[i]);
    }
    rockMesh.instanceMatrix.needsUpdate = true;
    if (rockMesh.instanceColor) rockMesh.instanceColor.needsUpdate = true;
    root.add(rockMesh);
  }

  // 7C. Apex Bollards along tight kerbs — strictly EXCLUDED from passing zones & drift zones
  const bollardMatrices: THREE.Matrix4[] = [];
  const bollardStep = Math.max(4, Math.round(n / 90));
  for (let i = 0; i < n; i += bollardStep) {
    const s = samples[i];
    if (s.inPassingZone || s.inDriftZone) continue;
    if (s.curvature < 0.012) continue;
    const hw = s.widthM * 0.5;
    if (s.kerbLeft && s.signedCurvature < 0) {
      const p = evalSurfacePoint(s, -(hw + TRACK_KERB_WIDTH_M + 0.6), 0.38);
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bollardMatrices.push(dummy.matrix.clone());
    }
    if (s.kerbRight && s.signedCurvature > 0) {
      const p = evalSurfacePoint(s, hw + TRACK_KERB_WIDTH_M + 0.6, 0.38);
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bollardMatrices.push(dummy.matrix.clone());
    }
  }

  if (bollardMatrices.length > 0) {
    const bollardGeo = trackDisposable(new THREE.CylinderGeometry(0.11, 0.14, 0.8, 6));
    const bollardMat = trackDisposable(
      new THREE.MeshStandardMaterial({
        color: '#FF5722',
        emissive: '#FF5722',
        emissiveIntensity: 0.18,
        roughness: 0.45,
        flatShading: true,
      })
    );
    const bollardMesh = new THREE.InstancedMesh(bollardGeo, bollardMat, bollardMatrices.length);
    bollardMesh.castShadow = true;
    for (let i = 0; i < bollardMatrices.length; i++) {
      bollardMesh.setMatrixAt(i, bollardMatrices[i]);
    }
    bollardMesh.instanceMatrix.needsUpdate = true;
    root.add(bollardMesh);
  }

  const dispose = () => {
    for (const item of disposables) {
      item.dispose();
    }
  };

  const renderHandle: ITrackRenderHandle = {
    handleId: collisionHandle.handleId,
    trackId: collisionHandle.trackId,
    trackVersion: collisionHandle.trackVersion,
    geometryHash: collisionHandle.geometryHash,
    sceneObject: root,
    dispose,
  };

  // Keep legacy Engine.ts spawnPosition just ahead of t=0 so legacy splineProgress=0.005
  // timing doesn't wrap to t=0.998 and misfire S1; new Engine.ts uses collisionHandle.startGrid[0]
  // (-2.5 m nose-at-S/F) together with LapSectorTimer.
  const legacySpawn = spline.getLegacySpawnTransform();
  const geometryData: ITrackGeometryDataV2 = {
    trackSchema: schema,
    spline,
    roadVertices: collisionHandle.roadVertices,
    roadIndices: collisionHandle.roadIndices,
    wallVertices: collisionHandle.wallVertices,
    wallIndices: collisionHandle.wallIndices,
    triangleSurfaces: collisionHandle.triangleSurfaces,
    spawnPosition: legacySpawn.position,
    spawnRotation: legacySpawn.rotation,
    collisionHandle,
    renderHandle,
  };

  return {
    group: root,
    geometryData,
    collisionHandle,
    renderHandle,
    dispose,
  };
}
