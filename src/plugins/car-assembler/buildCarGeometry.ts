import * as THREE from 'three';
import { CHASSIS_BY_ID } from '../../content';
import type { ICompiledVehicle, PartModuleCategory } from '../../core/types';
import { getCockpitAnchors } from '../../ui/engineBridge';
import { buildCockpit } from './buildCockpit';
import { getRoadBodyProfile } from './roadBodyProfiles';

export interface IWheelVisualRig {
  /** Root anchored to carRoot; moves vertically with suspension */
  suspensionGroup: THREE.Group;
  /** Steers (+Y) and cambers (±Z); holds non-spinning caliper */
  knuckleGroup: THREE.Group;
  /** Spins (+X forward roll); holds tire, rim, spokes, and brake rotor */
  spinGroup: THREE.Group;
  /** Brake rotor material whose emissive scales with brakeTempC > 380°C */
  rotorMaterial: THREE.MeshStandardMaterial;
  /** Nominal wheel radius in meters */
  radiusM: number;
  /** True for FL (0) and RL (2) */
  isLeft: boolean;
}

export interface IAssembledCarRig {
  root: THREE.Group;
  /** Sprung chassis body group (shifts with rideHeight in Lab mode) */
  bodyGroup: THREE.Group;
  /** Exterior canopy glass mesh (hidden in cockpit POV for unobstructed sightlines) */
  cabinMesh: THREE.Mesh;
  /** Exterior roof cap mesh (hidden in cockpit POV to avoid low overhang clipping) */
  roofMesh: THREE.Mesh | null;
  /** Interior bucket seat mesh (hidden in cockpit POV to avoid camera clip) */
  seatMesh: THREE.Mesh;
  exteriorGroup: THREE.Group;
  cockpitRig: ReturnType<typeof buildCockpit>;
  /** All primary exterior body shell meshes for X-Ray Wireframe toggle */
  bodyShellMaterials: THREE.MeshStandardMaterial[];
  /** Crisp cyan holographic edge lines shown when X-Ray Wireframe is active */
  xrayLinesGroup: THREE.Group;
  /** Taillight emissive material brightened under braking */
  taillightMaterial: THREE.MeshStandardMaterial;
  /** Exhaust tip world-local anchor points (for backfire FX reference) */
  exhaustTipsLocal: THREE.Vector3[];
  /** 4 articulated wheels: 0=FL, 1=FR, 2=RL, 3=RR */
  wheels: [IWheelVisualRig, IWheelVisualRig, IWheelVisualRig, IWheelVisualRig];
  /** Meshes grouped by the 8 PartModuleCategory tags for Lab highlight pulse */
  moduleMaterials: Record<PartModuleCategory, THREE.MeshStandardMaterial[]>;
  /** Cleanup all GPU resources */
  dispose: () => void;
}

function createExtrudedProfile(
  pointsXZ: Array<[number, number]>,
  width: number,
  bevelSize = 0.045
): THREE.BufferGeometry {
  // Shape is drawn in 2D (x = vehicle Z forward, y = vehicle Y up)
  // Extrusion goes along +Z in shape space; we rotateY(-PI/2) so shape X -> +Z (forward), shape Y -> +Y (up), extrusion -> X (left/right)
  const shape = new THREE.Shape();
  shape.moveTo(pointsXZ[0][0], pointsXZ[0][1]);
  for (let i = 1; i < pointsXZ.length; i++) {
    shape.lineTo(pointsXZ[i][0], pointsXZ[i][1]);
  }
  shape.closePath();

  const extrudeDepth = Math.max(0.2, width - bevelSize * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: extrudeDepth,
    bevelEnabled: true,
    bevelSegments: 1,
    steps: 1,
    bevelSize,
    bevelThickness: bevelSize,
  });

  // Center extrusion along Z, then rotate so shape-X aligns to +Z (vehicle forward)
  geo.translate(0, 0, -extrudeDepth * 0.5);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

const COMPOUND_STRIPE_HEX: Record<string, string> = {
  Street: '#475569',
  'Semi-Slick': '#CBD5E1',
  'Hard Slick': '#F8FAFC',
  'Med Slick': '#FACC15',
  'Soft Slick': '#EF4444',
  Wet: '#38BDF8',
};

const RIM_COLOR_HEX: Record<string, { color: string; metalness: number; roughness: number }> = {
  Steel: { color: '#334155', metalness: 0.55, roughness: 0.55 },
  'Cast Alloy': { color: '#CBD5E1', metalness: 0.78, roughness: 0.28 },
  'Forged Alloy': { color: '#E2E8F0', metalness: 0.88, roughness: 0.2 },
  Magnesium: { color: '#D4A359', metalness: 0.82, roughness: 0.26 },
  Carbon: { color: '#1E242E', metalness: 0.45, roughness: 0.32 },
};

const EXHAUST_COLOR_HEX: Record<string, string> = {
  Steel: '#64748B',
  Stainless: '#CBD5E1',
  Titanium: '#60A5FA',
  Inconel: '#F59E0B',
};

export function buildAssembledCar(compiled: ICompiledVehicle): IAssembledCarRig {
  const { build, bodyStyle, wheelbaseM, trackWidthM, hardpoints } = compiled;
  const halfWb = wheelbaseM * 0.5;
  const halfTrack = trackWidthM * 0.5;
  const bodyWidth = trackWidthM * 0.98;
  const roadGeometry = CHASSIS_BY_ID.get(build.chassisId)?.roadGeometry;
  const frontOverhang = roadGeometry?.frontOverhangM ?? (bodyStyle === 'prototype' ? 0.94 : bodyStyle === 'wedge' ? 0.86 : 0.82);
  const rearOverhang = roadGeometry?.rearOverhangM ?? (bodyStyle === 'prototype' ? 0.94 : bodyStyle === 'wedge' ? 0.84 : 0.80);
  const frontZ = halfWb + frontOverhang;
  const rearZ = -(halfWb + rearOverhang);
  const roadBody = roadGeometry && getRoadBodyProfile(bodyStyle, halfWb, frontZ, rearZ, roadGeometry.collisionBottomM);

  const root = new THREE.Group();
  root.name = 'modulus_vehicle_root';

  const bodyGroup = new THREE.Group();
  bodyGroup.name = 'vehicle_sprung_body';
  root.add(bodyGroup);

  const xrayLinesGroup = new THREE.Group();
  xrayLinesGroup.name = 'vehicle_xray_wireframe';
  xrayLinesGroup.visible = false;
  bodyGroup.add(xrayLinesGroup);

  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(res: T): T => {
    disposables.push(res);
    return res;
  };

  const moduleMaterials: Record<PartModuleCategory, THREE.MeshStandardMaterial[]> = {
    chassis: [],
    engine: [],
    drivetrain: [],
    suspension: [],
    tires: [],
    brakes: [],
    aero: [],
    cooling: [],
  };

  const registerMat = (
    cat: PartModuleCategory,
    params: THREE.MeshStandardMaterialParameters
  ): THREE.MeshStandardMaterial => {
    const mat = track(new THREE.MeshStandardMaterial(params));
    mat.userData.baseEmissiveHex = mat.emissive.getHex();
    mat.userData.baseEmissiveIntensity = mat.emissiveIntensity;
    moduleMaterials[cat].push(mat);
    return mat;
  };

  const isDryCarbonBody = build.aero.bodyPanelMaterial === 'Dry Carbon Fiber';
  const primaryPaintMat = registerMat('chassis', {
    color: isDryCarbonBody
      ? new THREE.Color(build.paintHex).lerp(new THREE.Color('#181C24'), 0.48)
      : build.paintHex,
    roughness: isDryCarbonBody ? 0.34 : 0.28,
    metalness: isDryCarbonBody ? 0.42 : 0.55,
    flatShading: true,
  });

  const accentMat = registerMat('chassis', {
    color: build.accentHex,
    roughness: 0.32,
    metalness: 0.45,
    flatShading: true,
  });

  const darkTrimMat = registerMat('chassis', {
    color: '#141820',
    roughness: 0.65,
    metalness: 0.25,
    flatShading: true,
  });

  const carbonAeroMat = registerMat('aero', {
    color: '#191E28',
    roughness: 0.38,
    metalness: 0.38,
    flatShading: true,
  });

  const aeroAccentMat = registerMat('aero', {
    color: build.accentHex,
    roughness: 0.35,
    metalness: 0.45,
    flatShading: true,
  });

  const glassMat = track(
    new THREE.MeshStandardMaterial({
      color: '#0C1422',
      roughness: 0.08,
      metalness: 0.9,
      transparent: true,
      opacity: 0.54,
      flatShading: true,
    })
  );

  const xrayLineMat = track(
    new THREE.LineBasicMaterial({
      color: '#00F0FF',
      transparent: true,
      opacity: 0.78,
    })
  );

  const bodyShellMaterials: THREE.MeshStandardMaterial[] = [primaryPaintMat, accentMat];

  const addShellMesh = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    bodyGroup.add(mesh);

    const edges = track(new THREE.EdgesGeometry(geo, 16));
    const line = new THREE.LineSegments(edges, xrayLineMat);
    line.position.copy(mesh.position);
    line.rotation.copy(mesh.rotation);
    line.scale.copy(mesh.scale);
    xrayLinesGroup.add(line);
    return mesh;
  };

  // =========================================================================
  // 1. SCULPTED LOW-POLY BODY SILHOUETTE (Coupe / Wedge / Prototype / Hatch)
  // =========================================================================
  let lowerProfile: Array<[number, number]>;
  let cabinProfile: Array<[number, number]>;
  let cabinWidthRatio = 0.72;

  if (roadBody) {
    lowerProfile = roadBody.body;
    cabinProfile = roadBody.cabin;
    cabinWidthRatio = roadBody.cabinWidth;
  } else if (bodyStyle === 'prototype') {
    // Low Le Mans ground-effect LMP prototype
    lowerProfile = [
      [rearZ, 0.22],
      [rearZ + 0.14, 0.72],
      [-halfWb * 0.4, 0.74],
      [halfWb * 0.55, 0.68],
      [frontZ - 0.35, 0.52],
      [frontZ, 0.22],
      [frontZ - 0.08, 0.12],
      [rearZ + 0.06, 0.12],
    ];
    cabinProfile = [
      [-halfWb * 0.85, 0.68],
      [-halfWb * 0.25, 1.06],
      [halfWb * 0.35, 1.04],
      [halfWb * 0.82, 0.64],
    ];
    cabinWidthRatio = 0.54;
  } else if (bodyStyle === 'wedge') {
    // Razor-sharp mid-engine wedge supercar (Stratos / Countach heritage)
    lowerProfile = [
      [rearZ, 0.24],
      [rearZ + 0.06, 0.78],
      [-halfWb * 0.35, 0.80],
      [halfWb * 0.45, 0.68],
      [frontZ - 0.28, 0.50],
      [frontZ, 0.26],
      [frontZ - 0.10, 0.14],
      [rearZ + 0.08, 0.14],
    ];
    cabinProfile = [
      [-halfWb * 0.65, 0.76],
      [-halfWb * 0.18, 1.12],
      [halfWb * 0.22, 1.11],
      [halfWb * 0.84, 0.64],
    ];
    cabinWidthRatio = 0.68;
  } else if (bodyStyle === 'hatch') {
    // Aggressive Group-B widebody hot hatch
    lowerProfile = [
      [rearZ, 0.24],
      [rearZ + 0.05, 0.82],
      [halfWb * 0.5, 0.80],
      [frontZ - 0.18, 0.68],
      [frontZ, 0.32],
      [frontZ - 0.08, 0.16],
      [rearZ + 0.08, 0.16],
    ];
    cabinProfile = [
      [rearZ + 0.12, 0.78],
      [rearZ + 0.38, 1.28],
      [halfWb * 0.38, 1.26],
      [halfWb * 0.86, 0.78],
    ];
    cabinWidthRatio = 0.78;
  } else {
    // Balanced Front-Engine Rear-Drive GT Coupe (Apex GT-86R)
    lowerProfile = [
      [rearZ, 0.24],
      [rearZ + 0.05, 0.78],
      [-halfWb * 0.45, 0.82],
      [halfWb * 0.38, 0.78],
      [frontZ - 0.22, 0.62],
      [frontZ, 0.30],
      [frontZ - 0.08, 0.15],
      [rearZ + 0.08, 0.15],
    ];
    cabinProfile = [
      [-halfWb * 0.88, 0.78],
      [-halfWb * 0.36, 1.20],
      [halfWb * 0.18, 1.20],
      [halfWb * 0.68, 0.76],
    ];
    cabinWidthRatio = 0.72;
  }

  // Main lower fuselage
  const mainBodyGeo = track(createExtrudedProfile(lowerProfile, bodyWidth * 0.92, 0.05));
  addShellMesh(mainBodyGeo, primaryPaintMat, 'chassis_main_body');

  // Sculpted widebody fender haunches (front + rear wheel arch blisters)
  const fenderGeoF = track(new THREE.BoxGeometry(bodyWidth * 1.04, 0.36, 0.88));
  const fenderF = addShellMesh(fenderGeoF, primaryPaintMat, 'fender_front');
  fenderF.position.set(0, roadBody ? hardpoints.wheelFL.y + 0.06 : 0.44, halfWb);

  const fenderGeoR = track(new THREE.BoxGeometry(bodyWidth * 1.07, 0.40, 0.96));
  const fenderR = addShellMesh(fenderGeoR, primaryPaintMat, 'fender_rear');
  fenderR.position.set(0, roadBody ? hardpoints.wheelRL.y + 0.09 : 0.47, -halfWb);

  // Accent racing center stripe along hood & roof deck
  const stripeLen = frontZ - rearZ - 0.25;
  const hoodStripeGeo = track(new THREE.BoxGeometry(bodyWidth * 0.14, 0.025, stripeLen * (roadBody ? 0.14 : 0.42)));
  const hoodStripe = addShellMesh(hoodStripeGeo, accentMat, 'livery_hood_stripe');
  hoodStripe.position.set(0, roadBody?.hoodHeight ?? (bodyStyle === 'prototype' ? 0.66 : 0.72), frontZ * (roadBody ? 0.65 : 0.45));
  hoodStripe.rotation.x = roadBody ? 0.035 : bodyStyle === 'wedge' ? 0.18 : 0.11;

  // Greenhouse cockpit glass canopy
  const cabinGeo = track(createExtrudedProfile(cabinProfile, bodyWidth * cabinWidthRatio, 0.035));
  const cabinMesh = new THREE.Mesh(cabinGeo, glassMat);
  cabinMesh.name = 'cockpit_canopy';
  bodyGroup.add(cabinMesh);

  // Roof cap panel in primary paint
  const roofW = bodyWidth * cabinWidthRatio * 0.84;
  const roofL = roadBody ? cabinProfile[2][0] - cabinProfile[1][0] : bodyStyle === 'prototype' ? halfWb * 0.62 : halfWb * 0.68;
  const roofY = roadBody ? cabinProfile[2][1] : bodyStyle === 'prototype' ? 1.06 : bodyStyle === 'wedge' ? 1.12 : 1.20;
  const roofZ = roadBody ? (cabinProfile[2][0] + cabinProfile[1][0]) / 2 : bodyStyle === 'prototype' ? 0.04 : -halfWb * 0.08;
  let roofMesh: THREE.Mesh | null = null;
  if (bodyStyle !== 'roadster') {
    const roofGeo = track(new THREE.BoxGeometry(roofW, 0.045, roofL));
    roofMesh = addShellMesh(roofGeo, primaryPaintMat, 'chassis_roof_cap');
    roofMesh.position.set(0, roofY, roofZ);
  }

  if (bodyStyle === 'pickup') {
    const bedFrontZ = -halfWb * 0.27;
    const bedRearZ = rearZ + 0.08;
    const bedLength = bedFrontZ - bedRearZ;
    const bedCenterZ = (bedFrontZ + bedRearZ) / 2;
    const liner = new THREE.Mesh(track(new THREE.BoxGeometry(bodyWidth * 0.83, 0.045, bedLength)), darkTrimMat);
    liner.position.set(0, 0.88, bedCenterZ);
    bodyGroup.add(liner);
    const railGeo = track(new THREE.BoxGeometry(0.09, 0.21, bedLength));
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(railGeo, primaryPaintMat);
      rail.position.set(side * bodyWidth * 0.43, 0.95, bedCenterZ);
      rail.castShadow = true;
      bodyGroup.add(rail);
    }
    const tailgate = new THREE.Mesh(track(new THREE.BoxGeometry(bodyWidth * 0.91, 0.21, 0.085)), primaryPaintMat);
    tailgate.position.set(0, 0.95, bedRearZ);
    bodyGroup.add(tailgate);
  }

  // LMP Prototype dorsal shark-fin stabilizer
  if (bodyStyle === 'prototype') {
    const finGeo = track(new THREE.BoxGeometry(0.045, 0.34, halfWb * 0.9));
    const fin = addShellMesh(finGeo, accentMat, 'prototype_shark_fin');
    fin.position.set(0, 0.92, -halfWb * 0.62);
  }

  // Underbody flat floor pan
  const floorGeo = track(new THREE.BoxGeometry(bodyWidth * 0.86, 0.06, frontZ - rearZ - 0.2));
  const floorMesh = new THREE.Mesh(floorGeo, darkTrimMat);
  floorMesh.position.set(0, roadGeometry?.collisionBottomM ?? 0.13, (frontZ + rearZ) * 0.5);
  bodyGroup.add(floorMesh);

  // =========================================================================
  // 2. VISIBLE COCKPIT INTERIOR + ROLL CAGE (Half-Cage / Full FIA Welded)
  // =========================================================================
  const anchors = getCockpitAnchors(compiled);
  const wheelAnchor = anchors.steeringWheelLocal;
  const driverX = wheelAnchor.x;

  const seatGeo = track(new THREE.BoxGeometry(0.44, 0.52, 0.42));
  const seatMesh = new THREE.Mesh(seatGeo, darkTrimMat);
  seatMesh.position.set(driverX, roadBody ? anchors.cockpitEyeLocal.y - 0.50 : 0.56, anchors.cockpitEyeLocal.z - 0.08);
  seatMesh.rotation.x = -0.18;
  bodyGroup.add(seatMesh);

  const cockpitRig = buildCockpit(compiled, track);
  cockpitRig.group.visible = false;
  bodyGroup.add(cockpitRig.group);

  if (build.chassis.rollCage !== 'None') {
    const cageMat = registerMat('chassis', {
      color: build.chassis.rollCage === 'Full FIA Welded' ? '#F59E0B' : '#94A3B8',
      roughness: 0.35,
      metalness: 0.72,
    });
    const cageW = bodyWidth * cabinWidthRatio * 0.82;
    const cageH = roofY - 0.38;
    const hoopZ = -halfWb * 0.34;
    const tubeR = 0.026;

    const addBar = (p1: THREE.Vector3, p2: THREE.Vector3) => {
      const dir = new THREE.Vector3().subVectors(p2, p1);
      const len = dir.length();
      const barGeo = track(new THREE.CylinderGeometry(tubeR, tubeR, len, 6));
      const bar = new THREE.Mesh(barGeo, cageMat);
      bar.position.copy(p1).add(p2).multiplyScalar(0.5);
      bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      bodyGroup.add(bar);
    };

    const bl = new THREE.Vector3(cageW * 0.5, 0.34, hoopZ);
    const br = new THREE.Vector3(-cageW * 0.5, 0.34, hoopZ);
    const tl = new THREE.Vector3(cageW * 0.44, 0.34 + cageH, hoopZ);
    const tr = new THREE.Vector3(-cageW * 0.44, 0.34 + cageH, hoopZ);
    // Main Roll Hoop + Diagonal Cross Brace
    addBar(bl, tl);
    addBar(br, tr);
    addBar(tl, tr);
    addBar(bl, tr);
    // Rear strut stays
    addBar(tl, new THREE.Vector3(cageW * 0.38, 0.42, hoopZ - 0.52));
    addBar(tr, new THREE.Vector3(-cageW * 0.38, 0.42, hoopZ - 0.52));

    if (build.chassis.rollCage === 'Full FIA Welded') {
      const fl = new THREE.Vector3(cageW * 0.42, 0.34 + cageH - 0.04, halfWb * 0.24);
      const fr = new THREE.Vector3(-cageW * 0.42, 0.34 + cageH - 0.04, halfWb * 0.24);
      const afl = new THREE.Vector3(cageW * 0.48, 0.38, halfWb * 0.58);
      const afr = new THREE.Vector3(-cageW * 0.48, 0.38, halfWb * 0.58);
      // Roof side bars, windshield header, A-pillars, door bars
      addBar(tl, fl);
      addBar(tr, fr);
      addBar(fl, fr);
      addBar(fl, afl);
      addBar(fr, afr);
      addBar(bl, afl);
      addBar(br, afr);
    }
  }

  // =========================================================================
  // 3. VISIBLE ENGINE BAY, FORCED INDUCTION, DRIVETRAIN & RADIATOR
  // =========================================================================
  const engineBlockMat = registerMat('engine', {
    color:
      build.engine.blockMaterial === 'Billet Magnesium'
        ? '#D4AF37'
        : build.engine.blockMaterial === 'Cast Iron'
        ? '#475569'
        : '#CBD5E1',
    roughness: 0.36,
    metalness: 0.78,
    flatShading: true,
  });
  const engineCoverMat = registerMat('engine', {
    color: build.engine.ecuTune === 'Qualifying Attack' ? '#EF4444' : '#00F0FF',
    roughness: 0.35,
    metalness: 0.4,
    flatShading: true,
  });

  const engGroup = new THREE.Group();
  engGroup.position.set(hardpoints.engineBay.x, hardpoints.engineBay.y, hardpoints.engineBay.z);
  const dispFactor = 0.78 + (build.engine.displacementL / 6.2) * 0.55;

  if (build.engine.layout === 'V8' || build.engine.layout === 'V6') {
    const bankGeo = track(new THREE.BoxGeometry(0.24, 0.26, 0.46 * dispFactor));
    const leftBank = new THREE.Mesh(bankGeo, engineBlockMat);
    leftBank.position.set(0.14, 0.06, 0);
    leftBank.rotation.z = -0.45;
    engGroup.add(leftBank);
    const rightBank = new THREE.Mesh(bankGeo, engineBlockMat);
    rightBank.position.set(-0.14, 0.06, 0);
    rightBank.rotation.z = 0.45;
    engGroup.add(rightBank);
  } else if (build.engine.layout === 'Flat-4') {
    const boxerGeo = track(new THREE.BoxGeometry(0.62, 0.20, 0.38 * dispFactor));
    engGroup.add(new THREE.Mesh(boxerGeo, engineBlockMat));
  } else if (build.engine.layout === 'Rotary') {
    const rotorGeo = track(new THREE.CylinderGeometry(0.16, 0.16, 0.32, 6));
    rotorGeo.rotateX(Math.PI / 2);
    engGroup.add(new THREE.Mesh(rotorGeo, engineBlockMat));
  } else {
    const inlineGeo = track(new THREE.BoxGeometry(0.28, 0.32, 0.48 * dispFactor));
    engGroup.add(new THREE.Mesh(inlineGeo, engineBlockMat));
  }

  // Valve cover / intake plenum accent
  const plenumGeo = track(new THREE.BoxGeometry(0.32, 0.08, 0.36 * dispFactor));
  const plenum = new THREE.Mesh(plenumGeo, engineCoverMat);
  plenum.position.set(0, 0.18, 0);
  engGroup.add(plenum);

  // Forced Induction visual (Turbo snails or Supercharger blower)
  if (build.engine.aspiration === 'Single Turbo' || build.engine.aspiration === 'Twin-Turbo') {
    const turboGeo = track(new THREE.TorusGeometry(0.075, 0.032, 6, 10));
    const turboMat = registerMat('engine', { color: '#F59E0B', roughness: 0.3, metalness: 0.85 });
    const t1 = new THREE.Mesh(turboGeo, turboMat);
    t1.position.set(0.22, 0.14, 0.14);
    engGroup.add(t1);
    if (build.engine.aspiration === 'Twin-Turbo') {
      const t2 = new THREE.Mesh(turboGeo, turboMat);
      t2.position.set(-0.22, 0.14, 0.14);
      engGroup.add(t2);
    }
  } else if (build.engine.aspiration === 'Supercharger') {
    const blowerGeo = track(new THREE.BoxGeometry(0.26, 0.14, 0.34));
    const blower = new THREE.Mesh(blowerGeo, engineBlockMat);
    blower.position.set(0, 0.25, 0);
    engGroup.add(blower);
  }
  bodyGroup.add(engGroup);

  // Gearbox + Driveshaft + Differential (drivetrain module)
  const drvMat = registerMat('drivetrain', {
    color: '#64748B',
    roughness: 0.42,
    metalness: 0.72,
    flatShading: true,
  });
  const gbxGeo = track(new THREE.BoxGeometry(0.28, 0.24, 0.44));
  const gbxMesh = new THREE.Mesh(gbxGeo, drvMat);
  gbxMesh.position.set(hardpoints.gearbox.x, hardpoints.gearbox.y, hardpoints.gearbox.z);
  bodyGroup.add(gbxMesh);

  const shaftGeo = track(new THREE.CylinderGeometry(0.032, 0.032, wheelbaseM * 0.72, 6));
  shaftGeo.rotateX(Math.PI / 2);
  const shaftMesh = new THREE.Mesh(shaftGeo, drvMat);
  shaftMesh.position.set(0, 0.26, 0);
  bodyGroup.add(shaftMesh);

  // Exhaust Pipes & Rear Tips (engine / exhaust material)
  const exhMat = registerMat('engine', {
    color: EXHAUST_COLOR_HEX[build.engine.exhaustMaterial] ?? '#CBD5E1',
    roughness: 0.26,
    metalness: 0.88,
  });
  const tipGeo = track(new THREE.CylinderGeometry(0.048, 0.052, 0.24, 8));
  tipGeo.rotateX(Math.PI / 2);
  const exhaustTipsLocal: THREE.Vector3[] = [];
  const tipOffsetsX = build.engine.layout === 'V8' ? [-0.42, -0.30, 0.30, 0.42] : [-0.34, 0.34];
  for (const tx of tipOffsetsX) {
    const tip = new THREE.Mesh(tipGeo, exhMat);
    tip.position.set(tx, 0.22, rearZ - 0.04);
    bodyGroup.add(tip);
    exhaustTipsLocal.push(new THREE.Vector3(tx, 0.22, rearZ - 0.16));
  }

  // Radiator Core & Front Intercooler + Fuel Cell (cooling module)
  const radScale =
    build.fuelAndCooling.radiatorSpec === 'Endurance Spec'
      ? 1.28
      : build.fuelAndCooling.radiatorSpec === 'Dual-Pass Aluminum'
      ? 1.12
      : build.fuelAndCooling.radiatorSpec === 'Compact'
      ? 0.76
      : 0.96;
  const radMat = registerMat('cooling', {
    color: '#93C5FD',
    roughness: 0.32,
    metalness: 0.78,
    flatShading: true,
  });
  const radGeo = track(new THREE.BoxGeometry(0.74 * radScale, 0.28 * radScale, 0.08));
  const radMesh = new THREE.Mesh(radGeo, radMat);
  radMesh.position.set(0, 0.34, frontZ - 0.14);
  radMesh.rotation.x = 0.22;
  bodyGroup.add(radMesh);

  // FIA Fuel Cell
  const fuelMat = registerMat('cooling', {
    color: '#DC2626',
    roughness: 0.55,
    metalness: 0.25,
    flatShading: true,
  });
  const fuelGeo = track(new THREE.BoxGeometry(0.56, 0.24, 0.42));
  const fuelMesh = new THREE.Mesh(fuelGeo, fuelMat);
  fuelMesh.position.set(hardpoints.fuelCell.x, hardpoints.fuelCell.y, hardpoints.fuelCell.z);
  bodyGroup.add(fuelMesh);

  // =========================================================================
  // 4. VISIBLE SUSPENSION WISHBONES & COILOVER SPRINGS
  // =========================================================================
  const susArmMat = registerMat('suspension', {
    color: '#94A3B8',
    roughness: 0.4,
    metalness: 0.75,
  });
  const springMat = registerMat('suspension', {
    color: '#F59E0B',
    roughness: 0.35,
    metalness: 0.5,
  });
  const armGeo = track(new THREE.BoxGeometry(0.38, 0.03, 0.14));
  const coilGeo = track(new THREE.CylinderGeometry(0.036, 0.036, 0.26, 6));
  for (let i = 0; i < 4; i++) {
    const wp = compiled.wheelPositionsLocal[i];
    const signX = wp.x >= 0 ? 1 : -1;
    const arm = new THREE.Mesh(armGeo, susArmMat);
    arm.position.set(signX * (halfTrack - 0.24), wp.y - 0.02, wp.z);
    bodyGroup.add(arm);

    const coil = new THREE.Mesh(coilGeo, springMat);
    coil.position.set(signX * (halfTrack - 0.22), wp.y + 0.14, wp.z);
    coil.rotation.z = signX * 0.22;
    bodyGroup.add(coil);
  }

  // =========================================================================
  // 5. AERODYNAMICS (Splitter, Side Skirts, Rear Diffuser, Dynamic Rear Wing)
  // =========================================================================
  // Front Splitter
  if (build.aero.frontSplitter !== 'None') {
    const splitDepth =
      build.aero.frontSplitter === 'GT Pro'
        ? 0.42
        : build.aero.frontSplitter === 'Track Blade'
        ? 0.30
        : 0.18;
    const splitWidth =
      build.aero.frontSplitter === 'GT Pro' ? bodyWidth * 1.10 : bodyWidth * 1.02;
    const splitGeo = track(new THREE.BoxGeometry(splitWidth, 0.04, splitDepth));
    const splitMesh = new THREE.Mesh(splitGeo, carbonAeroMat);
    splitMesh.position.set(0, 0.12, frontZ + splitDepth * 0.34);
    splitMesh.castShadow = true;
    bodyGroup.add(splitMesh);

    // Accent edge lip
    const lipGeo = track(new THREE.BoxGeometry(splitWidth + 0.01, 0.018, 0.04));
    const lip = new THREE.Mesh(lipGeo, aeroAccentMat);
    lip.position.set(0, 0.135, frontZ + splitDepth * 0.8);
    bodyGroup.add(lip);

    if (build.aero.frontSplitter === 'GT Pro') {
      // Support tie-rods + endplate dive canards
      const rodGeo = track(new THREE.CylinderGeometry(0.01, 0.01, 0.24, 5));
      for (const sx of [-0.42, 0.42]) {
        const rod = new THREE.Mesh(rodGeo, susArmMat);
        rod.position.set(sx, 0.22, frontZ + 0.16);
        rod.rotation.x = 0.25;
        bodyGroup.add(rod);
      }
      const canardGeo = track(new THREE.BoxGeometry(0.04, 0.14, 0.28));
      for (const sx of [-1, 1]) {
        const canard = new THREE.Mesh(canardGeo, carbonAeroMat);
        canard.position.set(sx * (splitWidth * 0.5), 0.18, frontZ + 0.10);
        bodyGroup.add(canard);
      }
    }
  }

  // Side Skirts (Aero Sills)
  const skirtLen = wheelbaseM - 0.72;
  const skirtGeo = track(new THREE.BoxGeometry(0.11, 0.06, skirtLen));
  for (const sx of [-1, 1]) {
    const skirt = new THREE.Mesh(skirtGeo, carbonAeroMat);
    skirt.position.set(sx * (bodyWidth * 0.51), 0.14, 0);
    bodyGroup.add(skirt);
  }

  // Rear Diffuser Strakes
  if (build.aero.rearDiffuser !== 'None') {
    const isDeep = build.aero.rearDiffuser === 'Deep Venturi';
    const finCount = isDeep ? 5 : 3;
    const finH = isDeep ? 0.18 : 0.11;
    const finLen = isDeep ? 0.46 : 0.30;
    const diffBackGeo = track(new THREE.BoxGeometry(bodyWidth * 0.74, 0.05, finLen));
    const diffBack = new THREE.Mesh(diffBackGeo, carbonAeroMat);
    diffBack.position.set(0, 0.15, rearZ - finLen * 0.15);
    diffBack.rotation.x = -0.22;
    bodyGroup.add(diffBack);

    const finGeo = track(new THREE.BoxGeometry(0.025, finH, finLen));
    const spanW = bodyWidth * 0.64;
    for (let f = 0; f < finCount; f++) {
      const fx = -spanW * 0.5 + (spanW * f) / (finCount - 1);
      const fin = new THREE.Mesh(finGeo, carbonAeroMat);
      fin.position.set(fx, 0.14, rearZ - finLen * 0.15);
      bodyGroup.add(fin);
    }
  }

  // Rear Wing (Ducktail / GT Wing / Swan-Neck Dual Element pitched by wingAngleDeg!)
  if (build.aero.rearWing !== 'None') {
    const wingPitchRad = (build.aero.wingAngleDeg * Math.PI) / 180;
    const wingZ = rearZ + 0.12;
    const deckY = bodyStyle === 'prototype' ? 0.72 : 0.78;

    if (build.aero.rearWing === 'Ducktail') {
      const duckGeo = track(new THREE.BoxGeometry(bodyWidth * 0.88, 0.12, 0.24));
      const duck = new THREE.Mesh(duckGeo, primaryPaintMat);
      duck.position.set(0, deckY + 0.06, wingZ - 0.04);
      duck.rotation.x = -0.35 - wingPitchRad * 0.5;
      duck.castShadow = true;
      bodyGroup.add(duck);
    } else {
      const isSwan = build.aero.rearWing === 'Swan-Neck Dual Element';
      const wingSpan = isSwan ? bodyWidth * 1.08 : bodyWidth * 0.98;
      const wingY = deckY + (isSwan ? 0.34 : 0.26);

      // Pylons
      const pylonH = wingY - deckY + (isSwan ? 0.08 : 0);
      const pylonGeo = track(new THREE.BoxGeometry(0.035, pylonH, 0.18));
      for (const px of [-0.36, 0.36]) {
        const pylon = new THREE.Mesh(pylonGeo, carbonAeroMat);
        pylon.position.set(px, deckY + pylonH * 0.5 - 0.02, wingZ + (isSwan ? 0.05 : 0));
        pylon.castShadow = true;
        bodyGroup.add(pylon);
      }

      // Main Airfoil Plane (rotates around X to pitch leading edge down / trailing edge up)
      // In local +Z forward: positive rotation.x tilts +Z DOWN and -Z UP -> increases Angle of Attack!
      const airfoilGroup = new THREE.Group();
      airfoilGroup.position.set(0, wingY, wingZ - 0.06);
      airfoilGroup.rotation.x = wingPitchRad;

      const mainPlaneGeo = track(new THREE.BoxGeometry(wingSpan, 0.038, 0.30));
      const mainPlane = new THREE.Mesh(mainPlaneGeo, carbonAeroMat);
      mainPlane.castShadow = true;
      airfoilGroup.add(mainPlane);

      if (isSwan) {
        const upperFlapGeo = track(new THREE.BoxGeometry(wingSpan * 0.98, 0.026, 0.14));
        const upperFlap = new THREE.Mesh(upperFlapGeo, aeroAccentMat);
        upperFlap.position.set(0, 0.065, -0.10);
        upperFlap.rotation.x = 0.24;
        airfoilGroup.add(upperFlap);
      }

      // Wing Endplates
      const endplateGeo = track(new THREE.BoxGeometry(0.032, isSwan ? 0.26 : 0.20, 0.42));
      for (const ex of [-1, 1]) {
        const ep = new THREE.Mesh(endplateGeo, aeroAccentMat);
        ep.position.set(ex * (wingSpan * 0.5), 0.02, -0.02);
        airfoilGroup.add(ep);
      }

      bodyGroup.add(airfoilGroup);
    }
  }

  // =========================================================================
  // 6. HEADLIGHTS & BRAKE-REACTIVE TAILLIGHTS
  // =========================================================================
  const headlightMat = track(
    new THREE.MeshStandardMaterial({
      color: '#E0F2FE',
      emissive: '#BAE6FD',
      emissiveIntensity: 1.8,
      roughness: 0.15,
    })
  );
  const hlGeo = track(new THREE.BoxGeometry(0.34, 0.085, 0.08));
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(hlGeo, headlightMat);
    hl.position.set(sx * (bodyWidth * 0.34), roadBody?.headlightHeight ?? (bodyStyle === 'prototype' ? 0.44 : 0.50), frontZ - 0.05);
    hl.rotation.y = sx * -0.18;
    bodyGroup.add(hl);
  }

  const taillightMaterial = track(
    new THREE.MeshStandardMaterial({
      color: '#EF4444',
      emissive: '#FF1E2D',
      emissiveIntensity: 0.85,
      roughness: 0.2,
    })
  );
  const tlGeo = track(new THREE.BoxGeometry(bodyWidth * 0.78, 0.085, 0.06));
  const tlBar = new THREE.Mesh(tlGeo, taillightMaterial);
  tlBar.position.set(0, roadBody?.taillightHeight ?? (bodyStyle === 'prototype' ? 0.54 : 0.62), rearZ + 0.02);
  bodyGroup.add(tlBar);

  // =========================================================================
  // 7. 4 ARTICULATED WHEEL, TIRE, CALIPER & GLOWING BRAKE ROTOR ASSEMBLIES
  // =========================================================================
  const tireMat = registerMat('tires', {
    color: '#171A21',
    roughness: 0.88,
    metalness: 0.04,
    flatShading: true,
  });
  const compoundStripeMat = registerMat('tires', {
    color: COMPOUND_STRIPE_HEX[build.wheelsAndTires.tireCompound] ?? '#CBD5E1',
    roughness: 0.45,
    metalness: 0.1,
  });
  const rimSpec = RIM_COLOR_HEX[build.wheelsAndTires.rimMaterial] ?? RIM_COLOR_HEX['Cast Alloy'];
  const rimMat = registerMat('tires', {
    color: rimSpec.color,
    roughness: rimSpec.roughness,
    metalness: rimSpec.metalness,
    flatShading: true,
  });

  const caliperColor =
    build.brakes.caliperPistons === '8-Pot Monoblock'
      ? '#F59E0B'
      : build.brakes.caliperPistons === '6-Pot'
      ? '#EF4444'
      : build.brakes.caliperPistons === '4-Pot'
      ? '#00F0FF'
      : '#64748B';
  const caliperMat = registerMat('brakes', {
    color: caliperColor,
    roughness: 0.3,
    metalness: 0.6,
    flatShading: true,
  });

  const rimRadiusM = (build.wheelsAndTires.rimDiameterIn * 0.0254) / 2;
  const rotorRadiusM = Math.min(rimRadiusM * 0.86, (build.brakes.rotorDiameterMm / 1000) * 0.5);
  const spokeCount =
    build.wheelsAndTires.rimMaterial === 'Carbon'
      ? 5
      : build.wheelsAndTires.rimMaterial === 'Forged Alloy'
      ? 7
      : 6;

  const wheelRigs: IWheelVisualRig[] = [];

  for (let i = 0; i < 4; i++) {
    const isFront = i < 2;
    const isLeft = i === 0 || i === 2;
    const radiusM = isFront ? compiled.wheelRadiusFrontM : compiled.wheelRadiusRearM;
    const widthM =
      (isFront ? build.wheelsAndTires.tireWidthFrontMm : build.wheelsAndTires.tireWidthRearMm) / 1000;
    const wp = compiled.wheelPositionsLocal[i];
    const outerSign = isLeft ? 1 : -1;

    const suspensionGroup = new THREE.Group();
    suspensionGroup.name = `wheel_suspension_${i}`;
    suspensionGroup.position.set(wp.x, radiusM, wp.z);
    root.add(suspensionGroup);

    const knuckleGroup = new THREE.Group();
    knuckleGroup.name = `wheel_knuckle_${i}`;
    suspensionGroup.add(knuckleGroup);

    const spinGroup = new THREE.Group();
    spinGroup.name = `wheel_spin_${i}`;
    knuckleGroup.add(spinGroup);

    // Tire cylinder (axis along X!)
    const tireGeo = track(new THREE.CylinderGeometry(radiusM, radiusM, widthM, 18));
    tireGeo.rotateZ(Math.PI / 2);
    const tireMesh = new THREE.Mesh(tireGeo, tireMat);
    tireMesh.castShadow = true;
    tireMesh.receiveShadow = true;
    spinGroup.add(tireMesh);

    // Sidewall compound identification ring on outer face
    const stripeGeo = track(new THREE.RingGeometry(rimRadiusM * 1.06, rimRadiusM * 1.15, 18));
    stripeGeo.rotateY(isLeft ? Math.PI / 2 : -Math.PI / 2);
    const stripeMesh = new THREE.Mesh(stripeGeo, compoundStripeMat);
    stripeMesh.position.x = outerSign * (widthM * 0.5 + 0.003);
    spinGroup.add(stripeMesh);

    // Rim barrel
    const barrelGeo = track(new THREE.CylinderGeometry(rimRadiusM, rimRadiusM, widthM * 0.92, 14));
    barrelGeo.rotateZ(Math.PI / 2);
    const barrelMesh = new THREE.Mesh(barrelGeo, rimMat);
    spinGroup.add(barrelMesh);

    // Multi-spoke face
    const spokeGeo = track(new THREE.BoxGeometry(0.032, rimRadiusM * 1.82, 0.036));
    for (let s = 0; s < spokeCount; s++) {
      const spoke = new THREE.Mesh(spokeGeo, rimMat);
      spoke.position.x = outerSign * (widthM * 0.44);
      spoke.rotation.x = (s / spokeCount) * Math.PI;
      spinGroup.add(spoke);
    }

    // Center lock nut
    const nutGeo = track(new THREE.CylinderGeometry(0.042, 0.048, 0.04, 6));
    nutGeo.rotateZ(Math.PI / 2);
    const nut = new THREE.Mesh(nutGeo, accentMat);
    nut.position.x = outerSign * (widthM * 0.47);
    spinGroup.add(nut);

    // Spinning Brake Rotor Disc with independent per-wheel thermal emissive material
    const rotorMaterial = registerMat('brakes', {
      color: build.brakes.rotorMaterial === 'Carbon-Ceramic' ? '#334155' : '#94A3B8',
      emissive: '#FF3B00',
      emissiveIntensity: 0,
      roughness: 0.32,
      metalness: 0.78,
    });
    const rotorGeo = track(new THREE.CylinderGeometry(rotorRadiusM, rotorRadiusM, 0.032, 16));
    rotorGeo.rotateZ(Math.PI / 2);
    const rotorMesh = new THREE.Mesh(rotorGeo, rotorMaterial);
    rotorMesh.position.x = outerSign * (widthM * 0.16);
    spinGroup.add(rotorMesh);

    // Non-spinning Brake Caliper mounted to knuckleGroup
    const calScale =
      build.brakes.caliperPistons === '8-Pot Monoblock'
        ? 1.25
        : build.brakes.caliperPistons === '6-Pot'
        ? 1.1
        : 0.92;
    const calGeo = track(new THREE.BoxGeometry(0.075, 0.15 * calScale, 0.11 * calScale));
    const calMesh = new THREE.Mesh(calGeo, caliperMat);
    calMesh.position.set(outerSign * (widthM * 0.18), 0.03, isFront ? -rotorRadiusM * 0.72 : rotorRadiusM * 0.72);
    knuckleGroup.add(calMesh);

    wheelRigs.push({
      suspensionGroup,
      knuckleGroup,
      spinGroup,
      rotorMaterial,
      radiusM,
      isLeft,
    });
  }

  const exteriorGroup = new THREE.Group();
  exteriorGroup.name = 'vehicle_exterior';
  for (const child of [...bodyGroup.children]) {
    if (child !== cockpitRig.group && child !== xrayLinesGroup) exteriorGroup.add(child);
  }
  bodyGroup.add(exteriorGroup);

  return {
    root,
    bodyGroup,
    cabinMesh,
    roofMesh,
    seatMesh,
    exteriorGroup,
    cockpitRig,
    bodyShellMaterials,
    xrayLinesGroup,
    taillightMaterial,
    exhaustTipsLocal,
    wheels: wheelRigs as [IWheelVisualRig, IWheelVisualRig, IWheelVisualRig, IWheelVisualRig],
    moduleMaterials,
    dispose: () => {
      for (const d of disposables) {
        d.dispose();
      }
    },
  };
}
