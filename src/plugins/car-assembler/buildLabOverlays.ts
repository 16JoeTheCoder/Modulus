import * as THREE from 'three';
import type { ICompiledVehicle, ILabOverlayOptions, PartModuleCategory } from '../../core/types';

export interface ILabOverlaysRig {
  group: THREE.Group;
  applyOptions(opts: ILabOverlayOptions): void;
  updateAnimation(timeSec: number, highlightedModule: PartModuleCategory | null): void;
  dispose(): void;
}

function createVectorArrow(
  colorHex: string,
  shaftLength: number,
  disposables: Array<{ dispose: () => void }>
): { group: THREE.Group; pulseRing: THREE.Mesh; shaftLen: number } {
  const group = new THREE.Group();
  const len = Math.max(0.32, Math.min(2.2, shaftLength));

  const mat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.9,
  });
  const glowMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.28,
  });
  disposables.push(mat, glowMat);

  // Built pointing along +Y from 0 to len, then oriented by caller
  const shaftGeo = new THREE.CylinderGeometry(0.024, 0.024, len, 8);
  const headGeo = new THREE.ConeGeometry(0.095, 0.24, 10);
  const ringGeo = new THREE.TorusGeometry(0.085, 0.014, 6, 16);
  ringGeo.rotateX(Math.PI / 2);
  disposables.push(shaftGeo, headGeo, ringGeo);

  const shaft = new THREE.Mesh(shaftGeo, mat);
  shaft.position.y = len * 0.5;
  group.add(shaft);

  const head = new THREE.Mesh(headGeo, mat);
  head.position.y = len + 0.11;
  group.add(head);

  const pulseRing = new THREE.Mesh(ringGeo, glowMat);
  pulseRing.position.y = len * 0.5;
  group.add(pulseRing);

  return { group, pulseRing, shaftLen: len };
}

/**
 * Builds the Dark Engineering Lab 3D Overlays:
 * 1. Glowing CG Sphere + vertical plumb line + floor projection cross at cgPositionLocal
 * 2. Live Aero Vector Arrows (#00F0FF front/rear downforce + #FF3B30 rearward drag)
 * 3. Subsystem Highlight Hardpoint Beacon ring for all 8 PartModuleCategory targets
 */
export function buildLabOverlays(compiled: ICompiledVehicle): ILabOverlaysRig {
  const group = new THREE.Group();
  group.name = 'lab_telemetry_overlays';

  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(res: T): T => {
    disposables.push(res);
    return res;
  };

  // =========================================================================
  // 1. GLOWING CENTER OF GRAVITY (CG) SPHERE + GROUND PROJECTION CROSS
  // =========================================================================
  const cgGroup = new THREE.Group();
  cgGroup.name = 'overlay_cg_sphere';
  const cg = compiled.cgPositionLocal;

  const cgCoreMat = track(
    new THREE.MeshBasicMaterial({
      color: '#F59E0B',
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    })
  );
  const cgHaloMat = track(
    new THREE.MeshBasicMaterial({
      color: '#FBBF24',
      depthTest: false,
      transparent: true,
      opacity: 0.28,
    })
  );

  const cgCore = new THREE.Mesh(track(new THREE.SphereGeometry(0.085, 16, 12)), cgCoreMat);
  cgCore.position.set(cg.x, cg.y, cg.z);
  cgCore.renderOrder = 20;
  cgGroup.add(cgCore);

  const cgHalo = new THREE.Mesh(track(new THREE.SphereGeometry(0.165, 16, 12)), cgHaloMat);
  cgHalo.position.set(cg.x, cg.y, cg.z);
  cgHalo.renderOrder = 19;
  cgGroup.add(cgHalo);

  // Vertical plumb line down to studio floor (y = 0.008)
  const plumbGeo = track(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(cg.x, cg.y, cg.z),
      new THREE.Vector3(cg.x, 0.01, cg.z),
    ])
  );
  const plumbMat = track(
    new THREE.LineBasicMaterial({
      color: '#F59E0B',
      transparent: true,
      opacity: 0.8,
      depthTest: false,
    })
  );
  const plumbLine = new THREE.Line(plumbGeo, plumbMat);
  plumbLine.renderOrder = 18;
  cgGroup.add(plumbLine);

  // Ground projection cross + ring at (cg.x, 0.012, cg.z)
  const floorCrossGroup = new THREE.Group();
  floorCrossGroup.position.set(cg.x, 0.014, cg.z);

  const cgRingGeo = track(new THREE.RingGeometry(0.16, 0.20, 24));
  cgRingGeo.rotateX(-Math.PI / 2);
  const cgFloorMat = track(
    new THREE.MeshBasicMaterial({
      color: '#F59E0B',
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
    })
  );
  floorCrossGroup.add(new THREE.Mesh(cgRingGeo, cgFloorMat));

  const crossBarGeo = track(new THREE.PlaneGeometry(0.56, 0.025));
  crossBarGeo.rotateX(-Math.PI / 2);
  floorCrossGroup.add(new THREE.Mesh(crossBarGeo, cgFloorMat));

  const crossBar2 = new THREE.Mesh(crossBarGeo, cgFloorMat);
  crossBar2.rotation.y = Math.PI / 2;
  floorCrossGroup.add(crossBar2);
  cgGroup.add(floorCrossGroup);

  group.add(cgGroup);

  // =========================================================================
  // 2. LIVE AERO VECTOR ARROWS (Cyan Downforce F/R + Red Drag)
  // =========================================================================
  const aeroGroup = new THREE.Group();
  aeroGroup.name = 'overlay_aero_vectors';

  const halfWb = compiled.wheelbaseM * 0.5;
  const frontArrowLen = 0.32 + compiled.liftCoefficientFrontCl * 0.95;
  const rearArrowLen = 0.32 + compiled.liftCoefficientRearCl * 0.95;
  const dragArrowLen = 0.45 + compiled.dragCoefficientCd * 2.1;

  // Front downforce arrow pointing DOWN (-Y) above front axle/splitter
  const frontDownforce = createVectorArrow('#00F0FF', frontArrowLen, disposables);
  frontDownforce.group.rotation.x = Math.PI; // +Y -> -Y (downward)
  frontDownforce.group.position.set(0, 0.92 + frontArrowLen, halfWb + 0.35);
  aeroGroup.add(frontDownforce.group);

  // Rear downforce arrow pointing DOWN (-Y) above rear wing/diffuser
  const rearDownforce = createVectorArrow('#00F0FF', rearArrowLen, disposables);
  rearDownforce.group.rotation.x = Math.PI;
  rearDownforce.group.position.set(0, 1.24 + rearArrowLen, -(halfWb + 0.45));
  aeroGroup.add(rearDownforce.group);

  // Rearward drag arrow pointing BACKWARD (-Z) behind car tail
  const dragArrow = createVectorArrow('#FF3B30', dragArrowLen, disposables);
  dragArrow.group.rotation.x = -Math.PI / 2; // +Y -> -Z (rearward)
  dragArrow.group.position.set(0, 0.72, -(halfWb + 0.96));
  aeroGroup.add(dragArrow.group);

  group.add(aeroGroup);

  // =========================================================================
  // 3. SUBSYSTEM HARDPOINT HIGHLIGHT BEACON RING
  // =========================================================================
  const beaconMat = track(
    new THREE.MeshBasicMaterial({
      color: '#00F0FF',
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthTest: false,
    })
  );
  const beaconRing = new THREE.Mesh(track(new THREE.RingGeometry(0.24, 0.31, 24)), beaconMat);
  beaconRing.rotation.x = -Math.PI / 2;
  beaconRing.renderOrder = 25;
  beaconRing.visible = false;
  group.add(beaconRing);

  const hp = compiled.hardpoints;
  const moduleAnchorPos: Record<PartModuleCategory, THREE.Vector3> = {
    chassis: new THREE.Vector3(0, 0.03, 0),
    engine: new THREE.Vector3(hp.engineBay.x, hp.engineBay.y + 0.12, hp.engineBay.z),
    drivetrain: new THREE.Vector3(hp.gearbox.x, hp.gearbox.y + 0.08, hp.gearbox.z),
    suspension: new THREE.Vector3(hp.wheelFL.x * 0.72, hp.wheelFL.y + 0.08, hp.wheelFL.z),
    tires: new THREE.Vector3(hp.wheelFL.x, 0.03, hp.wheelFL.z),
    brakes: new THREE.Vector3(hp.wheelFL.x * 0.92, hp.wheelFL.y, hp.wheelFL.z),
    aero: new THREE.Vector3(hp.rearWing.x, hp.rearWing.y + 0.1, hp.rearWing.z),
    cooling: new THREE.Vector3(hp.radiator.x, hp.radiator.y, hp.radiator.z),
  };

  return {
    group,
    applyOptions(opts: ILabOverlayOptions) {
      cgGroup.visible = opts.cgSphere;
      aeroGroup.visible = opts.aeroVectors;
    },
    updateAnimation(timeSec: number, highlightedModule: PartModuleCategory | null) {
      // Gentle pulsing CG halo
      const cgScale = 1.0 + Math.sin(timeSec * 3.6) * 0.14;
      cgHalo.scale.setScalar(cgScale);

      // Flow pulse rings sliding down/back along aero vectors
      const flowT = (timeSec * 1.15) % 1;
      frontDownforce.pulseRing.position.y = flowT * frontDownforce.shaftLen;
      rearDownforce.pulseRing.position.y = flowT * rearDownforce.shaftLen;
      dragArrow.pulseRing.position.y = flowT * dragArrow.shaftLen;

      // Hardpoint highlight beacon
      if (highlightedModule) {
        beaconRing.visible = true;
        beaconRing.position.copy(moduleAnchorPos[highlightedModule]);
        const s = 1.0 + Math.sin(timeSec * 6.5) * 0.18;
        beaconRing.scale.setScalar(s);
        beaconMat.opacity = 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(timeSec * 6.5));
      } else {
        beaconRing.visible = false;
      }
    },
    dispose() {
      for (const d of disposables) {
        d.dispose();
      }
    },
  };
}
