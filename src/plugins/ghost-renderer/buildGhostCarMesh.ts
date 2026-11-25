import * as THREE from 'three';
import type { ICompiledVehicle } from '../../core/types';
import type { IGhostPlaybackPose } from '../../replay';

export interface IGhostWheelVisual {
  suspensionGroup: THREE.Group;
  knuckleGroup: THREE.Group;
  spinGroup: THREE.Group;
  anchorLocalY: number;
  restLengthM: number;
  radiusM: number;
}

export interface IGhostCarRig {
  root: THREE.Group;
  bodyMaterial: THREE.MeshBasicMaterial;
  edgeMaterial: THREE.LineBasicMaterial;
  wheelMaterial: THREE.MeshBasicMaterial;
  taillightMaterial: THREE.MeshBasicMaterial;
  wheels: [IGhostWheelVisual, IGhostWheelVisual, IGhostWheelVisual, IGhostWheelVisual];
  applyPose: (pose: IGhostPlaybackPose, proximityOpacityScale: number) => void;
  dispose: () => void;
}

const BASE_BODY_OPACITY = 0.24;
const BASE_EDGE_OPACITY = 0.72;
const BASE_WHEEL_OPACITY = 0.36;
const BASE_TAIL_IDLE_OPACITY = 0.45;
const BASE_TAIL_BRAKE_OPACITY = 0.92;

function createGhostHullProfile(
  bodyStyle: ICompiledVehicle['bodyStyle'],
  wheelbaseM: number
): Array<[number, number]> {
  const halfWb = wheelbaseM * 0.5;
  const frontZ = halfWb + (bodyStyle === 'prototype' ? 0.92 : bodyStyle === 'wedge' ? 0.84 : 0.8);
  const rearZ = -(halfWb + (bodyStyle === 'prototype' ? 0.92 : bodyStyle === 'wedge' ? 0.82 : 0.78));

  if (bodyStyle === 'prototype') {
    return [
      [rearZ, 0.24],
      [rearZ + 0.12, 0.78],
      [-halfWb * 0.25, 0.96],
      [halfWb * 0.35, 0.92],
      [frontZ - 0.35, 0.56],
      [frontZ, 0.28],
      [frontZ - 0.08, 0.16],
      [rearZ + 0.08, 0.16],
    ];
  }
  if (bodyStyle === 'wedge') {
    return [
      [rearZ, 0.3],
      [rearZ + 0.14, 0.86],
      [-halfWb * 0.35, 1.1],
      [halfWb * 0.22, 1.06],
      [halfWb * 0.75, 0.68],
      [frontZ, 0.34],
      [frontZ - 0.06, 0.18],
      [rearZ + 0.06, 0.18],
    ];
  }
  return [
    [rearZ, 0.32],
    [rearZ + 0.16, 0.9],
    [-halfWb * 0.45, 1.24],
    [halfWb * 0.15, 1.22],
    [halfWb * 0.68, 0.78],
    [frontZ, 0.42],
    [frontZ - 0.08, 0.2],
    [rearZ + 0.08, 0.2],
  ];
}

/**
 * Builds a translucent holographic ghost vehicle silhouette with ZERO collision bodies
 * and zero shadow-casting overhead.
 */
export function buildGhostCarMesh(compiled: ICompiledVehicle): IGhostCarRig {
  const disposables: Array<{ dispose: () => void }> = [];
  const trackRes = <T extends { dispose: () => void }>(r: T): T => {
    disposables.push(r);
    return r;
  };

  const root = new THREE.Group();
  root.name = 'modulus_ghost_vehicle_root';
  root.visible = false;

  const bodyWidth = compiled.trackWidthM * 0.94;
  const profile = createGhostHullProfile(compiled.bodyStyle, compiled.wheelbaseM);

  const shape = new THREE.Shape();
  shape.moveTo(profile[0][0], profile[0][1]);
  for (let i = 1; i < profile.length; i++) {
    shape.lineTo(profile[i][0], profile[i][1]);
  }
  shape.closePath();

  const bevel = 0.04;
  const extrudeDepth = Math.max(0.25, bodyWidth - bevel * 2);
  const hullGeo = trackRes(
    new THREE.ExtrudeGeometry(shape, {
      depth: extrudeDepth,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: bevel,
      bevelThickness: bevel,
    })
  );
  hullGeo.translate(0, 0, -extrudeDepth * 0.5);
  hullGeo.rotateY(-Math.PI / 2);
  hullGeo.computeVertexNormals();

  const bodyMaterial = trackRes(
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#22D3EE'),
      transparent: true,
      opacity: BASE_BODY_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );

  const hullMesh = new THREE.Mesh(hullGeo, bodyMaterial);
  hullMesh.castShadow = false;
  hullMesh.receiveShadow = false;
  hullMesh.renderOrder = 10;
  root.add(hullMesh);

  const edgesGeo = trackRes(new THREE.EdgesGeometry(hullGeo, 24));
  const edgeMaterial = trackRes(
    new THREE.LineBasicMaterial({
      color: new THREE.Color('#67E8F9'),
      transparent: true,
      opacity: BASE_EDGE_OPACITY,
      depthWrite: false,
    })
  );
  const edgeLines = new THREE.LineSegments(edgesGeo, edgeMaterial);
  edgeLines.renderOrder = 11;
  root.add(edgeLines);

  // Subtle rear taillight bar so braking points of the PB ghost are readable on track
  const rearZ = -(compiled.wheelbaseM * 0.5 + 0.78);
  const tailGeo = trackRes(new THREE.BoxGeometry(bodyWidth * 0.82, 0.1, 0.06));
  const taillightMaterial = trackRes(
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#FB7185'),
      transparent: true,
      opacity: BASE_TAIL_IDLE_OPACITY,
      depthWrite: false,
    })
  );
  const tailBar = new THREE.Mesh(tailGeo, taillightMaterial);
  tailBar.position.set(0, 0.68, rearZ);
  tailBar.renderOrder = 12;
  root.add(tailBar);

  // 4 articulated translucent wheels (0: FL, 1: FR, 2: RL, 3: RR)
  const wheelMaterial = trackRes(
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#38BDF8'),
      transparent: true,
      opacity: BASE_WHEEL_OPACITY,
      depthWrite: false,
      wireframe: false,
    })
  );

  const wheels: IGhostWheelVisual[] = [];
  for (let i = 0; i < 4; i++) {
    const isFront = i < 2;
    const radiusM = isFront ? compiled.wheelRadiusFrontM : compiled.wheelRadiusRearM;
    const widthM = isFront
      ? compiled.build.wheelsAndTires.tireWidthFrontMm / 1000
      : compiled.build.wheelsAndTires.tireWidthRearMm / 1000;
    const anchor = compiled.wheelPositionsLocal[i];
    const restLen = compiled.suspensionRestLengthM[i];

    const suspensionGroup = new THREE.Group();
    suspensionGroup.position.set(anchor.x, radiusM, anchor.z);

    const knuckleGroup = new THREE.Group();
    const spinGroup = new THREE.Group();

    const wheelGeo = trackRes(new THREE.CylinderGeometry(radiusM, radiusM, widthM, 14));
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMesh = new THREE.Mesh(wheelGeo, wheelMaterial);
    wheelMesh.castShadow = false;
    wheelMesh.receiveShadow = false;
    wheelMesh.renderOrder = 10;
    spinGroup.add(wheelMesh);

    knuckleGroup.add(spinGroup);
    suspensionGroup.add(knuckleGroup);
    root.add(suspensionGroup);

    wheels.push({
      suspensionGroup,
      knuckleGroup,
      spinGroup,
      anchorLocalY: radiusM,
      restLengthM: restLen,
      radiusM,
    });
  }

  const typedWheels = wheels as [
    IGhostWheelVisual,
    IGhostWheelVisual,
    IGhostWheelVisual,
    IGhostWheelVisual,
  ];

  const applyPose = (pose: IGhostPlaybackPose, proximityOpacityScale: number) => {
    root.position.set(pose.position.x, pose.position.y, pose.position.z);
    root.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);

    const scale = Math.max(0.12, Math.min(1, proximityOpacityScale));
    bodyMaterial.opacity = BASE_BODY_OPACITY * scale;
    edgeMaterial.opacity = BASE_EDGE_OPACITY * scale;
    wheelMaterial.opacity = BASE_WHEEL_OPACITY * scale;
    taillightMaterial.opacity =
      (pose.brakeLightOn ? BASE_TAIL_BRAKE_OPACITY : BASE_TAIL_IDLE_OPACITY) * scale;

    for (let i = 0; i < 4; i++) {
      const w = typedWheels[i];
      const comp = pose.wheelCompressionM[i] ?? 0;
      w.suspensionGroup.position.y = w.anchorLocalY + Math.max(-0.08, Math.min(0.12, comp - 0.04));
      if (i < 2) {
        w.knuckleGroup.rotation.y = pose.frontWheelAngleRad;
      }
      w.spinGroup.rotation.x = pose.wheelRotationRad[i] ?? 0;
    }
  };

  const dispose = () => {
    for (const item of disposables) {
      item.dispose();
    }
  };

  return {
    root,
    bodyMaterial,
    edgeMaterial,
    wheelMaterial,
    taillightMaterial,
    wheels: typedWheels,
    applyPose,
    dispose,
  };
}
