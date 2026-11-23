import * as THREE from 'three';
import { DeterministicPrng } from '../../core/math/prng';
import { TrackSpline, type ISplineSample } from '../../core/math/spline';
import type { ITrackGeometryData, ITrackSplineSchema, Vec3 } from '../../core/types';

export interface IBuiltTrackBundle {
  group: THREE.Group;
  geometryData: ITrackGeometryData;
  dispose: () => void;
}

const SAMPLE_COUNT = 480;
const KERB_WIDTH_M = 1.05;
const RUNOFF_WIDTH_M = 5.4;
const WHITE_LINE_WIDTH_M = 0.24;
const WALL_HEIGHT_M = 1.65;
const WALL_BELOW_M = 0.35;

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
 * Builds collision trimesh (road + kerbs + runoff, plus inner containment walls)
 * and Art-of-Rally sunlit faceted visual geometry for any ITrackSplineSchema.
 */
export function buildTrackBundle(schema: ITrackSplineSchema): IBuiltTrackBundle {
  const spline = new TrackSpline(schema, SAMPLE_COUNT);
  const samples = spline.samples;
  const n = samples.length;
  const prng = new DeterministicPrng(schema.id);

  const root = new THREE.Group();
  root.name = `track_${schema.id}`;

  const disposables: Array<{ dispose: () => void }> = [];
  const trackDisposable = <T extends { dispose: () => void }>(res: T): T => {
    disposables.push(res);
    return res;
  };

  // Smooth signed curvature for racing line rubber wear shading
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
  // 1. PHYSICS COLLISION TRIMESH (Shared indexed vertices, watertight loop)
  // =========================================================================
  const COLL_COLS = 9;
  const roadVertices = new Float32Array(n * COLL_COLS * 3);
  const roadIndices = new Uint32Array(n * (COLL_COLS - 1) * 6);
  const triangleSurfaces = new Uint8Array(n * (COLL_COLS - 1) * 2);

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const halfW = s.widthM * 0.5;
    const outerLat = halfW + KERB_WIDTH_M + RUNOFF_WIDTH_M;
    const kerbLat = halfW + KERB_WIDTH_M;

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
    }
  }

  let idxCursor = 0;
  let triCursor = 0;
  for (let i = 0; i < n; i++) {
    const iNext = (i + 1) % n;
    const s = samples[i];
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

      // Surface ID: 0 = tarmac, 1 = kerb, 2 = grass
      let surf = 0;
      if (c === 0 || c === 7) surf = 2;
      else if (c === 1) surf = s.kerbLeft ? 1 : 2;
      else if (c === 6) surf = s.kerbRight ? 1 : 2;
      else surf = 0;

      triangleSurfaces[triCursor++] = surf;
      triangleSurfaces[triCursor++] = surf;
    }
  }

  // =========================================================================
  // 2. PHYSICS CONTAINMENT WALLS (Left + Right guardrails at outer runoff)
  // =========================================================================
  // 2 sides * n samples * 2 verts (bottom, top)
  const wallVertices = new Float32Array(n * 4 * 3);
  const wallIndices = new Uint32Array(n * 2 * 6);

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const outerLat = s.widthM * 0.5 + KERB_WIDTH_M + RUNOFF_WIDTH_M;
    const pLB = evalSurfacePoint(s, -outerLat, -WALL_BELOW_M);
    const pLT = evalSurfacePoint(s, -outerLat, WALL_HEIGHT_M);
    const pRB = evalSurfacePoint(s, outerLat, -WALL_BELOW_M);
    const pRT = evalSurfacePoint(s, outerLat, WALL_HEIGHT_M);

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

    // Left wall inward normal (+right): (lb0, lb1, lt0), (lb1, lt1, lt0)
    wallIndices[wIdx++] = lb0;
    wallIndices[wIdx++] = lb1;
    wallIndices[wIdx++] = lt0;
    wallIndices[wIdx++] = lb1;
    wallIndices[wIdx++] = lt1;
    wallIndices[wIdx++] = lt0;

    // Right wall inward normal (-right): (rb0, rt0, rb1), (rb1, rt0, rt1)
    wallIndices[wIdx++] = rb0;
    wallIndices[wIdx++] = rt0;
    wallIndices[wIdx++] = rb1;
    wallIndices[wIdx++] = rb1;
    wallIndices[wIdx++] = rt0;
    wallIndices[wIdx++] = rt1;
  }

  // =========================================================================
  // 3. VISUAL ROAD + KERBS + RUNOFF RIBBON (Art of Rally Vertex-Colored)
  // =========================================================================
  const roadPos: number[] = [];
  const roadCol: number[] = [];

  const groundBase = new THREE.Color(schema.groundColorHex);
  const asphaltBase = new THREE.Color('#2E3440');
  const asphaltGroove = new THREE.Color('#1F242D');
  const asphaltLight = new THREE.Color('#39404E');
  const whitePaint = new THREE.Color('#F1F5F9');
  const kerbRed = new THREE.Color('#DC2626');
  const kerbWhite = new THREE.Color('#F8FAFC');
  const concreteEdge = new THREE.Color('#94A3B8');
  const checkerDark = new THREE.Color('#111827');
  const tmpColor = new THREE.Color();
  const tmpColor2 = new THREE.Color();

  const buildStrips = (s: ISplineSample, segIndex: number): StripDef[] => {
    const hw = s.widthM * 0.5;
    const outerLat = hw + KERB_WIDTH_M + RUNOFF_WIDTH_M;
    const kerbLat = hw + KERB_WIDTH_M;
    const innerLine = hw - WHITE_LINE_WIDTH_M;
    const kerbWaveL = s.kerbLeft ? (segIndex % 2 === 0 ? 0.065 : 0.04) : -0.015;
    const kerbWaveR = s.kerbRight ? (segIndex % 2 === 0 ? 0.065 : 0.04) : -0.015;

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

    // Racing line shifts toward inside apex
    const grooveLat = Math.max(-0.78, Math.min(0.78, smoothedCurv[i] * 135)) * hw;
    const noise = (prng.next() - 0.5) * 0.028;

    for (let k = 0; k < strips0.length; k++) {
      const a0 = strips0[k];
      const a1 = strips1[k];
      const p00 = evalSurfacePoint(s0, a0.latA, a0.yA);
      const p01 = evalSurfacePoint(s0, a0.latB, a0.yB);
      const p10 = evalSurfacePoint(s1, a1.latA, a1.yA);
      const p11 = evalSurfacePoint(s1, a1.latB, a1.yB);

      if (a0.kind === 'tarmac') {
        // Start/finish checkered line right at i === 0 and i === 1
        if (i === 0 || i === 1) {
          const lane = a0.tarmacLane ?? 0;
          const isWhite = (lane + i) % 2 === 0;
          tmpColor.copy(isWhite ? whitePaint : checkerDark);
          pushQuadNonIndexed(roadPos, roadCol, p00, p01, p10, p11, tmpColor);
        } else {
          // Subtle racing-line rubber groove + warm sunlit tarmac facet variation
          const dA = Math.abs(a0.latA - grooveLat) / hw;
          const dB = Math.abs(a0.latB - grooveLat) / hw;
          const wearA = Math.exp(-dA * dA * 3.8);
          const wearB = Math.exp(-dB * dB * 3.8);

          tmpColor.copy(asphaltBase).lerp(asphaltGroove, wearA * 0.72);
          tmpColor.offsetHSL(0, 0, noise);

          tmpColor2.copy(asphaltBase).lerp(asphaltGroove, wearB * 0.72);
          tmpColor2.offsetHSL(0, 0, noise * 0.7);

          // Faint start grid box markings slightly ahead of finish line
          if (i >= 4 && i <= 7 && (a0.tarmacLane === 1 || a0.tarmacLane === 2) && i % 2 === 0) {
            tmpColor.lerp(asphaltLight, 0.35);
          }

          pushQuadDoubleColor(roadPos, roadCol, p00, p01, p10, p11, tmpColor, tmpColor2);
        }
      } else if (a0.kind === 'lineL' || a0.kind === 'lineR') {
        pushQuadNonIndexed(roadPos, roadCol, p00, p01, p10, p11, whitePaint);
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
        // Grass / sandy runoff shoulder with sunlit tonal variation
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
  // 4. LOW-POLY SAFETY BARRIERS (Armco Guardrail Ribbon + Accent Strips)
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
    const outer0 = s0.widthM * 0.5 + KERB_WIDTH_M + RUNOFF_WIDTH_M;
    const outer1 = s1.widthM * 0.5 + KERB_WIDTH_M + RUNOFF_WIDTH_M;

    const highCurve = s0.curvature > 0.011;
    const stripeCol = highCurve
      ? Math.floor(i / 2) % 2 === 0
        ? railAccentRed
        : railAccentWhite
      : i % 6 === 0
      ? railShadow
      : railSteel;

    // Build both Left (-1) and Right (+1) 3D boxed guardrail strips
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
        // Inner face (+right)
        pushQuadNonIndexed(barrierPos, barrierCol, i0t, i0b, i1t, i1b, stripeCol);
        // Top cap (+normal)
        pushQuadNonIndexed(barrierPos, barrierCol, o0t, i0t, o1t, i1t, railSteel);
        // Outer face (-right)
        pushQuadNonIndexed(barrierPos, barrierCol, o0b, o0t, o1b, o1t, railShadow);
      } else {
        // Inner face (-right)
        pushQuadNonIndexed(barrierPos, barrierCol, i0b, i0t, i1b, i1t, stripeCol);
        // Top cap (+normal)
        pushQuadNonIndexed(barrierPos, barrierCol, i0t, o0t, i1t, o1t, railSteel);
        // Outer face (+right)
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

  // Instanced guardrail steel support posts every 4 samples
  const postStep = 4;
  const postCount = Math.floor(n / postStep) * 2;
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
  for (let i = 0; i < n; i += postStep) {
    const s = samples[i];
    const outerLat = s.widthM * 0.5 + KERB_WIDTH_M + RUNOFF_WIDTH_M + railThick * 0.6;
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
  postInstanced.instanceMatrix.needsUpdate = true;
  root.add(postInstanced);

  // =========================================================================
  // 5. SCULPTED LOW-POLY TERRAIN APRON + SURROUNDING VALLEY & HILLS
  // =========================================================================
  // Compute bounding box of track samples
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity;
  for (let i = 0; i < n; i++) {
    const p = samples[i].position;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
    if (p.y < minY) minY = p.y;
  }

  const centerX = (minX + maxX) * 0.5;
  const centerZ = (minZ + maxZ) * 0.5;
  const span = Math.max(maxX - minX, maxZ - minZ) + 520;
  const gridSegs = 64;
  const terrainGeo = trackDisposable(new THREE.PlaneGeometry(span, span, gridSegs, gridSegs));
  terrainGeo.rotateX(-Math.PI / 2);

  // Decimated spline lookup for fast clearance clamping
  const decimated: ISplineSample[] = [];
  for (let i = 0; i < n; i += 4) {
    decimated.push(samples[i]);
  }

  const tPos = terrainGeo.attributes.position as THREE.BufferAttribute;
  const tColors = new Float32Array(tPos.count * 3);
  const hillHighCol = new THREE.Color(schema.groundColorHex).lerp(new THREE.Color('#94A3B8'), 0.42);
  const valleyLowCol = new THREE.Color(schema.groundColorHex).lerp(new THREE.Color('#3F5935'), 0.25);
  const warmSunTint = new THREE.Color(schema.groundColorHex).lerp(new THREE.Color('#D9B978'), 0.24);
  const isMountain = schema.id.includes('mountain');
  const isDesert = schema.id.includes('oval');
  const hillAmp = isMountain ? 34 : isDesert ? 16 : 22;

  for (let v = 0; v < tPos.count; v++) {
    const wx = tPos.getX(v) + centerX;
    const wz = tPos.getZ(v) + centerZ;

    // Nearest spline sample in XZ
    let nearestDistSq = Infinity;
    let nearestSample = decimated[0];
    for (let j = 0; j < decimated.length; j++) {
      const sp = decimated[j];
      const dx = wx - sp.position.x;
      const dz = wz - sp.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < nearestDistSq) {
        nearestDistSq = d2;
        nearestSample = sp;
      }
    }

    const nearestDist = Math.sqrt(nearestDistSq);
    const roadClearance = nearestSample.widthM * 0.5 + KERB_WIDTH_M + RUNOFF_WIDTH_M + 4.5;

    // Multi-frequency deterministic rolling hills (pure trig, zero GC)
    const hillWave =
      Math.sin(wx * 0.011 + 0.7) * Math.cos(wz * 0.013 - 0.4) * 0.55 +
      Math.sin((wx + wz) * 0.021 + 1.9) * 0.3 +
      Math.cos((wx - wz) * 0.037) * 0.15;
    const outerRim = Math.max(0, (nearestDist - 120) / 170);
    const rawHillY =
      minY - 2.4 + (hillWave * 0.5 + 0.5) * hillAmp + outerRim * outerRim * (isMountain ? 48 : 26);

    // Smooth blend from road embankment height to distant rolling hills
    const blend = Math.max(0, Math.min(1, (nearestDist - roadClearance) / 48));
    const smoothBlend = blend * blend * (3 - 2 * blend);
    const roadBedY = nearestSample.position.y - 0.55;
    const finalY = roadBedY * (1 - smoothBlend) + rawHillY * smoothBlend;

    // Strictly guarantee terrain never pokes through road/runoff
    const clampedY =
      nearestDist < roadClearance + 3 ? Math.min(finalY, nearestSample.position.y - 0.45) : finalY;

    tPos.setXYZ(v, wx, clampedY, wz);

    // Vertex color based on height & slope warmth
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

  // Seamless embankment skirt connecting outer runoff down into terrain
  const skirtPos: number[] = [];
  const skirtCol: number[] = [];
  const skirtColOuter = new THREE.Color(schema.groundColorHex).multiplyScalar(0.88);
  for (let i = 0; i < n; i++) {
    const iNext = (i + 1) % n;
    const s0 = samples[i];
    const s1 = samples[iNext];
    const outer0 = s0.widthM * 0.5 + KERB_WIDTH_M + RUNOFF_WIDTH_M;
    const outer1 = s1.widthM * 0.5 + KERB_WIDTH_M + RUNOFF_WIDTH_M;

    for (const side of [-1, 1] as const) {
      const a0 = evalSurfacePoint(s0, side * outer0, -0.08);
      const b0 = evalSurfacePoint(s0, side * (outer0 + 14), -4.2);
      const a1 = evalSurfacePoint(s1, side * outer1, -0.08);
      const b1 = evalSurfacePoint(s1, side * (outer1 + 14), -4.2);

      if (side === -1) {
        pushQuadDoubleColor(skirtPos, skirtCol, b0, a0, b1, a1, skirtColOuter, groundBase);
      } else {
        pushQuadDoubleColor(skirtPos, skirtCol, a0, b0, a1, b1, groundBase, skirtColOuter);
      }
    }
  }
  const skirtGeo = trackDisposable(new THREE.BufferGeometry());
  skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(skirtPos, 3));
  skirtGeo.setAttribute('color', new THREE.Float32BufferAttribute(skirtCol, 3));
  skirtGeo.computeVertexNormals();
  const skirtMesh = new THREE.Mesh(skirtGeo, terrainMat);
  skirtMesh.receiveShadow = true;
  root.add(skirtMesh);

  // =========================================================================
  // 6. START/FINISH GANTRY ARCH + SECTOR TIMING ARCHES
  // =========================================================================
  const buildGantry = (
    sample: ISplineSample,
    isStartFinish: boolean,
    accentHex: string
  ): THREE.Group => {
    const g = new THREE.Group();
    const spanW = sample.widthM + KERB_WIDTH_M * 2 + 2.4;
    const height = isStartFinish ? 6.8 : 5.6;

    // Orient group to track frame: +X = left (-right), +Y = normal, +Z = tangent
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

    const beamGeo = trackDisposable(new THREE.BoxGeometry(spanW + 1.0, isStartFinish ? 1.35 : 0.75, 0.9));
    const beam = new THREE.Mesh(beamGeo, frameMat);
    beam.position.set(0, height - 0.3, 0);
    beam.castShadow = true;
    g.add(beam);

    // Accent neon telemetry bar under beam
    const stripGeo = trackDisposable(new THREE.BoxGeometry(spanW - 0.8, 0.14, 0.96));
    const strip = new THREE.Mesh(stripGeo, accentMat);
    strip.position.set(0, height - (isStartFinish ? 0.95 : 0.68), 0);
    g.add(strip);

    if (isStartFinish) {
      // Crisp checkered banner facets along front & back of gantry beam
      const tiles = 16;
      const tileW = (spanW - 1.2) / tiles;
      const tileGeo = trackDisposable(new THREE.BoxGeometry(tileW * 0.96, 0.42, 0.96));
      const whiteMat = trackDisposable(
        new THREE.MeshStandardMaterial({ color: '#F8FAFC', roughness: 0.5 })
      );
      const darkMat = trackDisposable(
        new THREE.MeshStandardMaterial({ color: '#0F172A', roughness: 0.5 })
      );
      for (let t = 0; t < tiles; t++) {
        const x = -((spanW - 1.2) * 0.5) + tileW * (t + 0.5);
        for (let row = 0; row < 2; row++) {
          const tile = new THREE.Mesh(tileGeo, (t + row) % 2 === 0 ? whiteMat : darkMat);
          tile.position.set(x, height - 0.1 + (row === 0 ? 0.22 : -0.22), 0);
          g.add(tile);
        }
      }

      // 5 Start Light Pods suspended below gantry
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
  // 7. GPU INSTANCED LOW-POLY PROPS (Trees, Boulders, Apex Bollards)
  // =========================================================================
  const isSafeFromRoad = (x: number, z: number, extraMargin: number): boolean => {
    for (let j = 0; j < decimated.length; j++) {
      const sp = decimated[j];
      const dx = x - sp.position.x;
      const dz = z - sp.position.z;
      const minClear = sp.widthM * 0.5 + KERB_WIDTH_M + RUNOFF_WIDTH_M + extraMargin;
      if (dx * dx + dz * dz < minClear * minClear) return false;
    }
    return true;
  };

  // Sample terrain elevation approximation for placed props
  const estimatePropY = (x: number, z: number): number => {
    let bestD2 = Infinity;
    let bestS = decimated[0];
    for (let j = 0; j < decimated.length; j++) {
      const sp = decimated[j];
      const dx = x - sp.position.x;
      const dz = z - sp.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestS = sp;
      }
    }
    const dist = Math.sqrt(bestD2);
    const roadClearance = bestS.widthM * 0.5 + KERB_WIDTH_M + RUNOFF_WIDTH_M + 4.5;
    const hillWave =
      Math.sin(x * 0.011 + 0.7) * Math.cos(z * 0.013 - 0.4) * 0.55 +
      Math.sin((x + z) * 0.021 + 1.9) * 0.3 +
      Math.cos((x - z) * 0.037) * 0.15;
    const outerRim = Math.max(0, (dist - 120) / 170);
    const rawHillY =
      minY - 2.4 + (hillWave * 0.5 + 0.5) * hillAmp + outerRim * outerRim * (isMountain ? 48 : 26);
    const blend = Math.max(0, Math.min(1, (dist - roadClearance) / 48));
    const smoothBlend = blend * blend * (3 - 2 * blend);
    return (bestS.position.y - 0.55) * (1 - smoothBlend) + rawHillY * smoothBlend;
  };

  // 7A. Low-Poly Trees (Instanced trunks + Instanced 2-tier faceted foliage)
  const targetTrees = Math.floor(240 * Math.max(0.1, schema.treeDensity));
  const treeMatrices: THREE.Matrix4[] = [];
  const foliageMatrices: THREE.Matrix4[] = [];
  const foliageColors: THREE.Color[] = [];

  const treePalette = isMountain
    ? ['#1E4D2B', '#2D6A4F', '#40916C', '#E07A5F', '#D97706'] // Alpine cedar + autumn accents
    : isDesert
    ? ['#6B705C', '#849B63', '#A3A87A']
    : ['#2B580C', '#3E7C17', '#5C9438', '#4F772D']; // Sunlit Tuscan cypress / pine

  for (let attempt = 0; attempt < targetTrees * 4 && treeMatrices.length < targetTrees; attempt++) {
    const s = samples[prng.int(0, n - 1)];
    const side = prng.next() > 0.5 ? 1 : -1;
    const lateralDist =
      s.widthM * 0.5 + KERB_WIDTH_M + RUNOFF_WIDTH_M + prng.range(5.5, 68.0);
    const px = s.position.x + s.right.x * side * lateralDist + prng.range(-4, 4);
    const pz = s.position.z + s.right.z * side * lateralDist + prng.range(-4, 4);
    if (!isSafeFromRoad(px, pz, 3.2)) continue;

    const py = estimatePropY(px, pz);
    const scale = prng.range(0.75, 1.85);
    const rotY = prng.range(0, Math.PI * 2);

    dummy.position.set(px, py + 1.1 * scale, pz);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    treeMatrices.push(dummy.matrix.clone());

    dummy.position.set(px, py + 3.4 * scale, pz);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(scale * (isDesert ? 0.8 : 1.0), scale * (isMountain ? 1.3 : 1.15), scale * (isDesert ? 0.8 : 1.0));
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
  const targetRocks = Math.floor(140 * Math.max(0.15, schema.rockDensity));
  const rockMatrices: THREE.Matrix4[] = [];
  const rockColors: THREE.Color[] = [];
  const baseRockHex = isDesert ? '#B08968' : isMountain ? '#64748B' : '#78716C';

  for (let attempt = 0; attempt < targetRocks * 4 && rockMatrices.length < targetRocks; attempt++) {
    const s = samples[prng.int(0, n - 1)];
    const side = prng.next() > 0.5 ? 1 : -1;
    const lateralDist =
      s.widthM * 0.5 + KERB_WIDTH_M + RUNOFF_WIDTH_M + prng.range(4.2, 56.0);
    const px = s.position.x + s.right.x * side * lateralDist + prng.range(-3, 3);
    const pz = s.position.z + s.right.z * side * lateralDist + prng.range(-3, 3);
    if (!isSafeFromRoad(px, pz, 2.6)) continue;

    const py = estimatePropY(px, pz);
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

  // 7C. Apex Bollards along tight kerbs (high-visibility orange-amber cylinders)
  const bollardMatrices: THREE.Matrix4[] = [];
  for (let i = 0; i < n; i += 6) {
    const s = samples[i];
    if (s.curvature < 0.008) continue;
    const hw = s.widthM * 0.5;
    if (s.kerbLeft && s.signedCurvature < 0) {
      const p = evalSurfacePoint(s, -(hw + KERB_WIDTH_M + 0.55), 0.38);
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bollardMatrices.push(dummy.matrix.clone());
    }
    if (s.kerbRight && s.signedCurvature > 0) {
      const p = evalSurfacePoint(s, hw + KERB_WIDTH_M + 0.55, 0.38);
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

  const spawn = spline.getSpawnTransform();
  const geometryData: ITrackGeometryData = {
    trackSchema: schema,
    spline,
    roadVertices,
    roadIndices,
    wallVertices,
    wallIndices,
    triangleSurfaces,
    spawnPosition: spawn.position,
    spawnRotation: spawn.rotation,
  };

  return {
    group: root,
    geometryData,
    dispose: () => {
      for (const item of disposables) {
        item.dispose();
      }
    },
  };
}
