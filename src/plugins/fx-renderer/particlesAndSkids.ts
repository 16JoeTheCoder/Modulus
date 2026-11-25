import * as THREE from 'three';
import type { ICompiledVehicle, IInputState, IVehicleRuntimeState } from '../../core/types';

export interface ISurfaceFxRig {
  group: THREE.Group;
  update(
    dt: number,
    state: IVehicleRuntimeState,
    input: IInputState,
    compiled: ICompiledVehicle,
    carPos: THREE.Vector3,
    carQuat: THREE.Quaternion
  ): void;
  clear(): void;
  dispose(scene: THREE.Scene): void;
}

const MAX_SKID_QUADS = 1200;
const MAX_SMOKE_PUFFS = 96;

interface ISmokePuff {
  active: boolean;
  age: number;
  maxAge: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  baseScale: number;
  rotY: number;
}

/**
 * Ring-buffered Asphalt Skidmark Ribbons, Instanced Low-Poly Tire Smoke Puffs,
 * and Exhaust Shift-Cut Backfire Flashes.
 */
export function buildSurfaceFxRig(scene: THREE.Scene): ISurfaceFxRig {
  const group = new THREE.Group();
  group.name = 'fx_surface_particles';

  // =========================================================================
  // 1. PERSISTENT RING-BUFFERED SKIDMARK RIBBONS (1 Draw Call, Zero GC)
  // =========================================================================
  const skidPositions = new Float32Array(MAX_SKID_QUADS * 6 * 3);
  const skidColors = new Float32Array(MAX_SKID_QUADS * 6 * 3);
  const skidGeo = new THREE.BufferGeometry();
  const skidPosAttr = new THREE.BufferAttribute(skidPositions, 3);
  const skidColAttr = new THREE.BufferAttribute(skidColors, 3);
  skidPosAttr.setUsage(THREE.DynamicDrawUsage);
  skidColAttr.setUsage(THREE.DynamicDrawUsage);
  skidGeo.setAttribute('position', skidPosAttr);
  skidGeo.setAttribute('color', skidColAttr);

  const skidMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const skidMesh = new THREE.Mesh(skidGeo, skidMat);
  skidMesh.frustumCulled = false;
  skidMesh.renderOrder = 4;
  group.add(skidMesh);

  let skidCursor = 0;
  const prevWheelContact: Array<THREE.Vector3 | null> = [null, null, null, null];
  const prevWheelRight: Array<THREE.Vector3> = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];

  // =========================================================================
  // 2. INSTANCED LOW-POLY TIRE SMOKE PUFFS
  // =========================================================================
  const smokeGeo = new THREE.IcosahedronGeometry(0.32, 0);
  const smokeMat = new THREE.MeshStandardMaterial({
    color: '#E2E8F0',
    roughness: 0.95,
    metalness: 0.0,
    transparent: true,
    opacity: 0.44,
    flatShading: true,
    depthWrite: false,
  });
  const smokeMesh = new THREE.InstancedMesh(smokeGeo, smokeMat, MAX_SMOKE_PUFFS);
  smokeMesh.frustumCulled = false;
  smokeMesh.renderOrder = 6;
  group.add(smokeMesh);

  const puffs: ISmokePuff[] = [];
  const dummy = new THREE.Object3D();
  for (let i = 0; i < MAX_SMOKE_PUFFS; i++) {
    puffs.push({
      active: false,
      age: 0,
      maxAge: 0.85,
      pos: new THREE.Vector3(0, -500, 0),
      vel: new THREE.Vector3(),
      baseScale: 0.4,
      rotY: 0,
    });
    dummy.position.set(0, -500, 0);
    dummy.scale.setScalar(0.001);
    dummy.updateMatrix();
    smokeMesh.setMatrixAt(i, dummy.matrix);
  }
  smokeMesh.instanceMatrix.needsUpdate = true;
  let smokeCursor = 0;
  let smokeEmitAccum = 0;
  let lastImpactSeq = -1;
  const tireSmoke = new THREE.Color('#ffffff');
  const crashSmoke = new THREE.Color('#878a93');
  const impactOrigin = new THREE.Vector3();

  const emitSmoke = (color: THREE.Color) => {
    const index = smokeCursor;
    smokeCursor = (smokeCursor + 1) % MAX_SMOKE_PUFFS;
    const puff = puffs[index];
    puff.active = true;
    puff.age = 0;
    puff.rotY = Math.random() * Math.PI * 2;
    smokeMesh.setColorAt(index, color);
    if (smokeMesh.instanceColor) smokeMesh.instanceColor.needsUpdate = true;
    return puff;
  };

  // =========================================================================
  // 3. EXHAUST SHIFT-CUT BACKFIRE FLASHES
  // =========================================================================
  const flameGroup = new THREE.Group();
  flameGroup.visible = false;
  const flameGeo = new THREE.ConeGeometry(0.09, 0.56, 6);
  flameGeo.rotateX(-Math.PI / 2); // Point backward along -Z
  const outerFlameMat = new THREE.MeshBasicMaterial({
    color: '#F59E0B',
    transparent: true,
    opacity: 0.92,
  });
  const innerFlameMat = new THREE.MeshBasicMaterial({
    color: '#38BDF8',
    transparent: true,
    opacity: 0.95,
  });

  const leftFlame = new THREE.Mesh(flameGeo, outerFlameMat);
  leftFlame.position.set(0.34, 0.22, -2.25);
  flameGroup.add(leftFlame);

  const rightFlame = new THREE.Mesh(flameGeo, outerFlameMat);
  rightFlame.position.set(-0.34, 0.22, -2.25);
  flameGroup.add(rightFlame);

  const leftCore = new THREE.Mesh(flameGeo, innerFlameMat);
  leftCore.scale.set(0.55, 0.55, 0.65);
  leftCore.position.set(0.34, 0.22, -2.16);
  flameGroup.add(leftCore);

  const rightCore = new THREE.Mesh(flameGeo, innerFlameMat);
  rightCore.scale.set(0.55, 0.55, 0.65);
  rightCore.position.set(-0.34, 0.22, -2.16);
  flameGroup.add(rightCore);

  const backfireLight = new THREE.PointLight('#F59E0B', 10, 6.5, 2.0);
  backfireLight.position.set(0, 0.26, -2.4);
  flameGroup.add(backfireLight);
  group.add(flameGroup);

  let backfireTimerS = 0;
  let prevWasShifting = false;
  let prevThrottle = 0;

  // Scratch vectors (zero per-frame GC)
  const currContact = new THREE.Vector3();
  const segDir = new THREE.Vector3();
  const sideDir = new THREE.Vector3();
  const normalVec = new THREE.Vector3();
  const p0L = new THREE.Vector3();
  const p0R = new THREE.Vector3();
  const p1L = new THREE.Vector3();
  const p1R = new THREE.Vector3();
  const skidTint = new THREE.Color();

  scene.add(group);

  const clear = () => {
    skidPositions.fill(0);
    skidPosAttr.needsUpdate = true;
    skidCursor = 0;
    for (let i = 0; i < 4; i++) {
      prevWheelContact[i] = null;
    }
    for (let i = 0; i < MAX_SMOKE_PUFFS; i++) {
      puffs[i].active = false;
      dummy.position.set(0, -500, 0);
      dummy.scale.setScalar(0.001);
      dummy.updateMatrix();
      smokeMesh.setMatrixAt(i, dummy.matrix);
    }
    smokeMesh.instanceMatrix.needsUpdate = true;
    backfireTimerS = 0;
    flameGroup.visible = false;
  };

  return {
    group,
    clear,
    update(dt, state, input, compiled, carPos, carQuat) {
      let skidDirty = false;
      smokeEmitAccum += dt;

      const impact = state.lastImpact;
      if (impact && impact.seq !== lastImpactSeq) {
        lastImpactSeq = impact.seq;
        if (impact.intensity01 >= 0.14) {
          const hull = compiled.collisionHull;
          const wheelIndex = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].indexOf(impact.zone);
          if (wheelIndex >= 0) {
            const wheel = compiled.wheelPositionsLocal[wheelIndex];
            impactOrigin.set(wheel.x, wheel.y + 0.22, wheel.z);
          } else {
            const left = impact.zone === 'left_side';
            const right = impact.zone === 'right_side';
            const rear = impact.zone === 'rear' || impact.zone === 'driveline';
            impactOrigin.set(
              (Number(left) - Number(right)) * hull.halfExtents.x,
              hull.localOffset.y + 0.26,
              hull.localOffset.z + (left || right ? 0 : (rear ? -1 : 1) * hull.halfExtents.z * 0.88)
            );
          }
          impactOrigin.applyQuaternion(carQuat).add(carPos);
          const count = Math.round(6 + 14 * impact.intensity01);
          for (let i = 0; i < count; i++) {
            const puff = emitSmoke(crashSmoke);
            puff.pos.copy(impactOrigin);
            puff.pos.x += (Math.random() - 0.5) * 0.55;
            puff.pos.y += Math.random() * 0.30;
            puff.pos.z += (Math.random() - 0.5) * 0.55;
            puff.vel.set((Math.random() - 0.5) * 3, 1.2 + Math.random() * 1.65, (Math.random() - 0.5) * 3);
            puff.maxAge = 0.65 + Math.random() * 0.9;
            puff.baseScale = 0.62 + impact.intensity01 * 0.48 + Math.random() * 0.3;
          }
        }
      }

      // 1. Update Skidmarks & Emit Tire Smoke per wheel
      for (let i = 0; i < 4; i++) {
        const w = state.wheels[i];
        const slipMag = Math.max(
          Math.abs(w.slipRatio),
          Math.abs(w.slipAngleRad) * 1.2,
          i >= 2 ? input.handbrake * 0.65 : 0
        );
        const shouldMark = w.grounded && state.speedMs > 1.8 && slipMag > 0.17;

        if (!shouldMark) {
          prevWheelContact[i] = null;
          continue;
        }

        normalVec.set(w.contactNormalWorld.x, w.contactNormalWorld.y, w.contactNormalWorld.z);
        if (normalVec.lengthSq() < 0.1) normalVec.set(0, 1, 0);
        else normalVec.normalize();

        currContact
          .set(w.contactPointWorld.x, w.contactPointWorld.y, w.contactPointWorld.z)
          .addScaledVector(normalVec, 0.026);

        const tireHalfW =
          ((i < 2
            ? compiled.build.wheelsAndTires.tireWidthFrontMm
            : compiled.build.wheelsAndTires.tireWidthRearMm) /
            1000) *
          0.46;

        const prev = prevWheelContact[i];
        if (!prev) {
          prevWheelContact[i] = currContact.clone();
          prevWheelRight[i].set(state.rightWorld.x, state.rightWorld.y, state.rightWorld.z);
        } else {
          segDir.subVectors(currContact, prev);
          const segLen = segDir.length();
          if (segLen > 4.5) {
            // Discontinuity (teleport/reset)
            prev.copy(currContact);
          } else if (segLen > 0.18) {
            segDir.divideScalar(segLen);
            sideDir.crossVectors(segDir, normalVec).normalize();

            p0L.copy(prev).addScaledVector(prevWheelRight[i], -tireHalfW);
            p0R.copy(prev).addScaledVector(prevWheelRight[i], tireHalfW);
            p1L.copy(currContact).addScaledVector(sideDir, -tireHalfW);
            p1R.copy(currContact).addScaledVector(sideDir, tireHalfW);

            const base = skidCursor * 18;
            skidPositions[base] = p0L.x;
            skidPositions[base + 1] = p0L.y;
            skidPositions[base + 2] = p0L.z;
            skidPositions[base + 3] = p0R.x;
            skidPositions[base + 4] = p0R.y;
            skidPositions[base + 5] = p0R.z;
            skidPositions[base + 6] = p1L.x;
            skidPositions[base + 7] = p1L.y;
            skidPositions[base + 8] = p1L.z;

            skidPositions[base + 9] = p0R.x;
            skidPositions[base + 10] = p0R.y;
            skidPositions[base + 11] = p0R.z;
            skidPositions[base + 12] = p1R.x;
            skidPositions[base + 13] = p1R.y;
            skidPositions[base + 14] = p1R.z;
            skidPositions[base + 15] = p1L.x;
            skidPositions[base + 16] = p1L.y;
            skidPositions[base + 17] = p1L.z;

            if (w.surface === 'grass') {
              skidTint.set('#3F2E1E');
            } else {
              const intensity = Math.min(1, (slipMag - 0.15) * 2.2);
              const shade = 0.08 + (1 - intensity) * 0.14;
              skidTint.setRGB(shade, shade, shade * 1.05);
            }
            for (let k = 0; k < 6; k++) {
              skidColors[base + k * 3] = skidTint.r;
              skidColors[base + k * 3 + 1] = skidTint.g;
              skidColors[base + k * 3 + 2] = skidTint.b;
            }

            skidCursor = (skidCursor + 1) % MAX_SKID_QUADS;
            skidDirty = true;

            prev.copy(currContact);
            prevWheelRight[i].copy(sideDir);
          }
        }

        // Emit low-poly tire smoke puff on strong slip
        if (slipMag > 0.24 && smokeEmitAccum >= 0.028) {
          const p = emitSmoke(tireSmoke);
          p.maxAge = 0.65 + Math.random() * 0.45;
          p.pos.copy(currContact).addScaledVector(normalVec, 0.14);
          p.vel.set(
            (Math.random() - 0.5) * 1.4,
            0.85 + Math.random() * 0.9,
            (Math.random() - 0.5) * 1.4
          );
          p.baseScale = 0.42 + Math.min(0.65, slipMag * 0.45);
        }
      }

      if (smokeEmitAccum >= 0.028) {
        smokeEmitAccum = 0;
      }

      if (skidDirty) {
        skidPosAttr.needsUpdate = true;
        skidColAttr.needsUpdate = true;
      }

      // 2. Step Smoke Puffs
      let smokeDirty = false;
      for (let i = 0; i < MAX_SMOKE_PUFFS; i++) {
        const p = puffs[i];
        if (!p.active) continue;
        smokeDirty = true;
        p.age += dt;
        if (p.age >= p.maxAge) {
          p.active = false;
          dummy.position.set(0, -500, 0);
          dummy.scale.setScalar(0.001);
          dummy.updateMatrix();
          smokeMesh.setMatrixAt(i, dummy.matrix);
          continue;
        }
        p.pos.addScaledVector(p.vel, dt);
        p.vel.multiplyScalar(Math.max(0, 1 - dt * 1.8));
        const lifeT = p.age / p.maxAge;
        const scale = p.baseScale * (0.65 + lifeT * 2.1) * (1 - lifeT * 0.55);
        dummy.position.copy(p.pos);
        dummy.rotation.set(lifeT * 1.4, p.rotY + lifeT * 2.0, 0);
        dummy.scale.setScalar(Math.max(0.01, scale));
        dummy.updateMatrix();
        smokeMesh.setMatrixAt(i, dummy.matrix);
      }
      if (smokeDirty) {
        smokeMesh.instanceMatrix.needsUpdate = true;
      }

      // 3. Exhaust Shift-Cut / Overrun Backfire Flashes
      const shiftStart = state.isShifting && !prevWasShifting && state.engineRpm > 4600;
      const throttleLiftPop =
        prevThrottle > 0.75 &&
        input.throttle < 0.12 &&
        state.engineRpm > compiled.redlineRpm * 0.72 &&
        compiled.build.engine.ecuTune !== 'Eco / Endurance';
      prevWasShifting = state.isShifting;
      prevThrottle = input.throttle;

      if (shiftStart || throttleLiftPop) {
        backfireTimerS = 0.13;
      }

      if (backfireTimerS > 0) {
        backfireTimerS = Math.max(0, backfireTimerS - dt);
        flameGroup.visible = true;
        flameGroup.position.copy(carPos);
        flameGroup.quaternion.copy(carQuat);

        const rearZ = -(compiled.wheelbaseM * 0.5 + 0.92);
        const flicker = 0.75 + Math.random() * 0.65;
        const fade = backfireTimerS / 0.13;
        leftFlame.position.z = rearZ - 0.25 * flicker;
        rightFlame.position.z = rearZ - 0.25 * flicker;
        leftCore.position.z = rearZ - 0.16 * flicker;
        rightCore.position.z = rearZ - 0.16 * flicker;
        leftFlame.scale.set(fade, fade, flicker * (0.6 + fade * 0.7));
        rightFlame.scale.set(fade, fade, flicker * (0.6 + fade * 0.7));
        backfireLight.intensity = 12 * fade * flicker;
      } else {
        flameGroup.visible = false;
      }
    },
    dispose(targetScene) {
      targetScene.remove(group);
      skidGeo.dispose();
      skidMat.dispose();
      smokeGeo.dispose();
      smokeMat.dispose();
      flameGeo.dispose();
      outerFlameMat.dispose();
      innerFlameMat.dispose();
    },
  };
}
