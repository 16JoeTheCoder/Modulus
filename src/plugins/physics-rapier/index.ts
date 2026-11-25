import RAPIER from '@dimforge/rapier3d-compat';
import {
  surfaceCodeToType as contractSurfaceCodeToType,
  type DamageZoneId,
  type IVehicleImpactPulse,
} from '../../contracts/simulation';
import {
  DEFAULT_BALANCE_CONFIG,
  type ICompiledVehicle,
  type IEngineContext,
  type IGlobalBalanceConfig,
  type IInputState,
  type IModulusPlugin,
  type ITrackGeometryData,
  type IVehicleRuntimeState,
  type Quat,
  type SurfaceType,
  type Vec3,
} from '../../core/types';

let rapierInitPromise: Promise<void> | null = null;

function ensureRapierInitialized(): Promise<void> {
  if (!rapierInitPromise) {
    rapierInitPromise = RAPIER.init();
  }
  return rapierInitPromise;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function isFiniteVec3(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function computeBasisFromQuat(q: Quat): {
  left: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
} {
  const { x, y, z, w } = q;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;

  // Local +X = Left, Local +Y = Up, Local +Z = Forward (Right-Handed)
  const left: Vec3 = {
    x: 1 - 2 * (yy + zz),
    y: 2 * (xy + wz),
    z: 2 * (xz - wy),
  };
  const up: Vec3 = {
    x: 2 * (xy - wz),
    y: 1 - 2 * (xx + zz),
    z: 2 * (yz + wx),
  };
  const forward: Vec3 = {
    x: 2 * (xz + wy),
    y: 2 * (yz - wx),
    z: 1 - 2 * (xx + yy),
  };
  const right: Vec3 = {
    x: -left.x,
    y: -left.y,
    z: -left.z,
  };

  return { left, right, up, forward };
}

function localToWorld(state: IVehicleRuntimeState, local: Vec3): Vec3 {
  const lx = -state.rightWorld.x;
  const ly = -state.rightWorld.y;
  const lz = -state.rightWorld.z;
  return {
    x: state.position.x + lx * local.x + state.upWorld.x * local.y + state.forwardWorld.x * local.z,
    y: state.position.y + ly * local.x + state.upWorld.y * local.y + state.forwardWorld.y * local.z,
    z: state.position.z + lz * local.x + state.upWorld.z * local.y + state.forwardWorld.z * local.z,
  };
}

function surfaceCodeToType(code: number): SurfaceType {
  return contractSurfaceCodeToType(code);
}

function classifyImpactDamageZone(localDir: Vec3): { zone: DamageZoneId; zoneIndex: number; secondaryIndex?: number } {
  // localDir points along the sudden impulse (direction the chassis was shoved in car-local space: +X left, +Y up, +Z forward)
  // A front wall impact shoves the car backward (-Z). A left-wall hit shoves the car right (-X).
  const ax = Math.abs(localDir.x);
  const az = Math.abs(localDir.z);
  if (az >= ax * 1.15) {
    if (localDir.z <= 0) {
      // Front hit (also affects cooling on harder hits)
      return { zone: 'front', zoneIndex: 4, secondaryIndex: 8 };
    }
    return { zone: 'rear', zoneIndex: 5, secondaryIndex: 9 };
  }
  if (ax >= az * 1.15) {
    if (localDir.x < 0) {
      // Hit on Left side (shoved right = -X)
      return { zone: 'left_side', zoneIndex: 6 };
    }
    return { zone: 'right_side', zoneIndex: 7 };
  }
  // Corner hit: classify into wheel corners (0: FL, 1: FR, 2: RL, 3: RR)
  const isFront = localDir.z <= 0;
  const isLeft = localDir.x < 0;
  if (isFront && isLeft) return { zone: 'wheel_fl', zoneIndex: 0, secondaryIndex: 4 };
  if (isFront && !isLeft) return { zone: 'wheel_fr', zoneIndex: 1, secondaryIndex: 4 };
  if (!isFront && isLeft) return { zone: 'wheel_rl', zoneIndex: 2, secondaryIndex: 5 };
  return { zone: 'wheel_rr', zoneIndex: 3, secondaryIndex: 5 };
}

const FIXED_DEFAULT_DT = 1 / 120;
const NOMINAL_RIDE_REST_M = 0.295; // 0.22 + 75mm nominal ride height matching chassis.json y=0 ground frame
const DROOP_TRAVEL_M = 0.065;
const BUMP_TRAVEL_M = 0.085;

export class PhysicsRapierPlugin implements IModulusPlugin {
  public readonly id = 'physics-rapier';
  public readonly version = '1.0.0';
  public readonly priority = 75;

  private ctx: IEngineContext | null = null;
  private vehicle: ICompiledVehicle | null = null;
  private balanceConfig: IGlobalBalanceConfig = DEFAULT_BALANCE_CONFIG;

  private world: RAPIER.World | null = null;
  private chassisBody: RAPIER.RigidBody | null = null;
  private chassisCollider: RAPIER.Collider | null = null;
  private fallbackGroundCollider: RAPIER.Collider | null = null;
  private roadCollider: RAPIER.Collider | null = null;
  private wallCollider: RAPIER.Collider | null = null;

  private roadColliderHandle: number | null = null;
  private wallColliderHandle: number | null = null;
  private triangleSurfaces: Uint8Array | null = null;
  private roadTriangleCount = 0;

  private appliedMassKg = 0;
  private appliedInertiaBias = 1.0;
  private vehicleCompiledInertiaBias = 1.0;
  private prevLinvel: Vec3 = { x: 0, y: 0, z: 0 };
  private expectedDeltaV: Vec3 = { x: 0, y: 0, z: 0 };
  private impactSeq = 0;
  private impactCooldownS = 0;
  private prevWheelCompression: [number, number, number, number] = [0, 0, 0, 0];
  private prevWheelGrounded: [boolean, boolean, boolean, boolean] = [false, false, false, false];

  private unsubTrackBuilt: (() => void) | null = null;
  private unsubReset: (() => void) | null = null;

  public async init(ctx: IEngineContext): Promise<void> {
    this.ctx = ctx;
    this.vehicle = ctx.getCompiledVehicle();
    this.balanceConfig = ctx.getBalanceConfig();
    this.vehicleCompiledInertiaBias = this.balanceConfig.physics_bias.weight_inertia_mult;

    await ensureRapierInitialized();

    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = FIXED_DEFAULT_DT;
    this.world.numSolverIterations = 6;

    // Fallback flat ground at y = 0 until track-generator emits track:built
    this.createFallbackGround(0);

    // Create dynamic chassis rigid body + elevated upper-body collider
    this.createChassisBody(ctx.getRuntimeState(), this.vehicle);

    // If track geometry was already built before physics-rapier initialized, build trimesh now
    const existingTrack = ctx.getTrackGeometry();
    if (existingTrack) {
      this.rebuildTrackColliders(existingTrack);
    }

    this.unsubTrackBuilt = ctx.events.on('track:built', ({ geometry }) => {
      this.rebuildTrackColliders(geometry);
    });

    this.unsubReset = ctx.events.on('vehicle:reset', ({ position, rotation }) => {
      this.resetBody(position, rotation);
    });
  }

  private createFallbackGround(surfaceY: number): void {
    if (!this.world) return;
    if (this.fallbackGroundCollider) {
      this.world.removeCollider(this.fallbackGroundCollider, false);
      this.fallbackGroundCollider = null;
    }
    const halfThick = 0.5;
    const desc = RAPIER.ColliderDesc.cuboid(4000, halfThick, 4000)
      .setTranslation(0, surfaceY - halfThick, 0)
      .setFriction(0.35)
      .setRestitution(0.05);
    this.fallbackGroundCollider = this.world.createCollider(desc);
  }

  private createChassisBody(state: IVehicleRuntimeState, vehicle: ICompiledVehicle): void {
    if (!this.world) return;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(state.position.x, state.position.y, state.position.z)
      .setRotation(state.rotation)
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setLinearDamping(0.002)
      .setAngularDamping(0.16);

    this.chassisBody = this.world.createRigidBody(bodyDesc);

    const hull = vehicle.collisionHull;
    const colDesc = RAPIER.ColliderDesc.cuboid(hull.halfExtents.x, hull.halfExtents.y, hull.halfExtents.z)
      .setTranslation(hull.localOffset.x, hull.localOffset.y, hull.localOffset.z)
      .setDensity(0) // Explicit mass & inertia tensor controlled via setAdditionalMassProperties
      .setFriction(hull.friction)
      .setRestitution(hull.restitution);

    this.chassisCollider = this.world.createCollider(colDesc, this.chassisBody);
    this.applyMassAndColliderDimensions(vehicle, state.fuelLiters, this.balanceConfig.physics_bias.weight_inertia_mult);
  }

  private applyMassAndColliderDimensions(
    vehicle: ICompiledVehicle,
    fuelLiters: number,
    inertiaBias: number
  ): void {
    if (!this.chassisBody) return;

    const liveMassKg = Math.max(550, vehicle.dryMassKg + Math.max(0, fuelLiters) * 0.75);
    const compiledBias = Math.max(0.25, this.vehicleCompiledInertiaBias);
    const biasScale = inertiaBias / compiledBias;

    // Principal axes in MODULUS local frame: X = Left (Pitch), Y = Up (Yaw), Z = Forward (Roll)
    const pitchI = Math.max(250, vehicle.pitchInertiaKgM2 * biasScale);
    const yawI = Math.max(300, vehicle.yawInertiaKgM2 * biasScale);
    const rollI = Math.max(120, vehicle.rollInertiaKgM2 * biasScale);

    const cg = vehicle.cgPositionLocal;
    this.chassisBody.setAdditionalMassProperties(
      liveMassKg,
      { x: cg.x, y: cg.y, z: cg.z },
      { x: pitchI, y: yawI, z: rollI },
      { x: 0, y: 0, z: 0, w: 1 },
      true
    );

    if (this.chassisCollider) {
      this.chassisCollider.setHalfExtents({
        x: vehicle.collisionHull.halfExtents.x,
        y: vehicle.collisionHull.halfExtents.y,
        z: vehicle.collisionHull.halfExtents.z,
      });
    }

    this.appliedMassKg = liveMassKg;
    this.appliedInertiaBias = inertiaBias;
  }

  private rebuildTrackColliders(geometry: ITrackGeometryData): void {
    if (!this.world) return;

    if (this.roadCollider) {
      this.world.removeCollider(this.roadCollider, false);
      this.roadCollider = null;
      this.roadColliderHandle = null;
    }
    if (this.wallCollider) {
      this.world.removeCollider(this.wallCollider, false);
      this.wallCollider = null;
      this.wallColliderHandle = null;
    }

    this.triangleSurfaces = geometry.triangleSurfaces ?? null;
    this.roadTriangleCount = Math.floor(geometry.roadIndices.length / 3);

    if (geometry.roadVertices.length >= 9 && geometry.roadIndices.length >= 3) {
      const roadDesc = RAPIER.ColliderDesc.trimesh(geometry.roadVertices, geometry.roadIndices)
        .setFriction(0.22)
        .setRestitution(0.05);
      this.roadCollider = this.world.createCollider(roadDesc);
      this.roadColliderHandle = this.roadCollider.handle;

      // Move fallback ground far below track as a deep safety catch-net
      this.createFallbackGround(-45);
    }

    if (
      geometry.wallVertices &&
      geometry.wallIndices &&
      geometry.wallVertices.length >= 9 &&
      geometry.wallIndices.length >= 3
    ) {
      const wallDesc = RAPIER.ColliderDesc.trimesh(geometry.wallVertices, geometry.wallIndices)
        .setFriction(0.14)
        .setRestitution(0.22);
      this.wallCollider = this.world.createCollider(wallDesc);
      this.wallColliderHandle = this.wallCollider.handle;
    }

    this.world.updateSceneQueries();
  }

  private resetBody(position: Vec3, rotation: Quat): void {
    if (!this.world || !this.chassisBody) return;

    this.chassisBody.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    this.chassisBody.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }, true);
    this.chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.chassisBody.resetForces(true);
    this.chassisBody.resetTorques(true);

    this.prevLinvel = { x: 0, y: 0, z: 0 };
    this.expectedDeltaV = { x: 0, y: 0, z: 0 };
    this.impactCooldownS = 0;
    this.prevWheelCompression = [0, 0, 0, 0];
    this.prevWheelGrounded = [false, false, false, false];

    this.world.propagateModifiedBodyPositionsToColliders();
    this.world.updateSceneQueries();

    const state = this.ctx?.getRuntimeState();
    const vehicle = this.vehicle ?? this.ctx?.getCompiledVehicle();
    if (state && vehicle) {
      this.applyMassAndColliderDimensions(vehicle, state.fuelLiters, this.balanceConfig.physics_bias.weight_inertia_mult);
      this.syncChassisTransformToState(state, FIXED_DEFAULT_DT, true);
      this.castWheelRays(state, vehicle, FIXED_DEFAULT_DT, true);
    }
  }

  public onBalanceConfigUpdated(config: IGlobalBalanceConfig): void {
    const prevBias = this.balanceConfig.physics_bias.weight_inertia_mult;
    this.balanceConfig = config;
    const nextBias = config.physics_bias.weight_inertia_mult;

    if (Math.abs(nextBias - prevBias) > 1e-5 && this.vehicle && this.ctx) {
      this.applyMassAndColliderDimensions(this.vehicle, this.ctx.getRuntimeState().fuelLiters, nextBias);
    }
  }

  public onBuildCompiled(vehicle: ICompiledVehicle): void {
    this.vehicle = vehicle;
    this.vehicleCompiledInertiaBias = this.balanceConfig.physics_bias.weight_inertia_mult;
    const fuelL = this.ctx?.getRuntimeState().fuelLiters ?? vehicle.build.fuelAndCooling.fuelLoadL;
    this.applyMassAndColliderDimensions(vehicle, fuelL, this.balanceConfig.physics_bias.weight_inertia_mult);
  }

  public onPhysicsStep(dt: number, state: IVehicleRuntimeState, _input: IInputState): void {
    const world = this.world;
    const body = this.chassisBody;
    const vehicle = this.vehicle ?? this.ctx?.getCompiledVehicle();
    if (!world || !body || !vehicle) return;

    // 1. Preserve previous transforms for render alpha interpolation
    state.prevPosition.x = state.position.x;
    state.prevPosition.y = state.position.y;
    state.prevPosition.z = state.position.z;
    state.prevRotation.x = state.rotation.x;
    state.prevRotation.y = state.rotation.y;
    state.prevRotation.z = state.rotation.z;
    state.prevRotation.w = state.rotation.w;

    for (let i = 0; i < 4; i++) {
      const w = state.wheels[i];
      w.prevWorldPosition.x = w.worldPosition.x;
      w.prevWorldPosition.y = w.worldPosition.y;
      w.prevWorldPosition.z = w.worldPosition.z;
    }

    // 2. Periodically update live body mass as fuel burns off
    const liveMassKg = Math.max(550, vehicle.dryMassKg + Math.max(0, state.fuelLiters) * 0.75);
    if (
      Math.abs(liveMassKg - this.appliedMassKg) > 0.35 ||
      Math.abs(this.balanceConfig.physics_bias.weight_inertia_mult - this.appliedInertiaBias) > 1e-4
    ) {
      this.applyMassAndColliderDimensions(
        vehicle,
        state.fuelLiters,
        this.balanceConfig.physics_bias.weight_inertia_mult
      );
    }

    // 3. Apply accumulated forces, torques, and point forces to Rapier RigidBody
    //    and track total non-contact force to distinguish genuine wall/car impact impulses.
    body.resetForces(true);
    body.resetTorques(true);

    let sumFx = 0;
    let sumFy = -9.81 * liveMassKg;
    let sumFz = 0;

    const fAcc = state.forceAccumulatorWorld;
    if (isFiniteVec3(fAcc) && (fAcc.x !== 0 || fAcc.y !== 0 || fAcc.z !== 0)) {
      body.addForce({ x: fAcc.x, y: fAcc.y, z: fAcc.z }, true);
      sumFx += fAcc.x;
      sumFy += fAcc.y;
      sumFz += fAcc.z;
    }

    const tAcc = state.torqueAccumulatorWorld;
    if (isFiniteVec3(tAcc) && (tAcc.x !== 0 || tAcc.y !== 0 || tAcc.z !== 0)) {
      body.addTorque({ x: tAcc.x, y: tAcc.y, z: tAcc.z }, true);
    }

    const pointForces = state.pointForces;
    for (let i = 0; i < pointForces.length; i++) {
      const pf = pointForces[i];
      if (isFiniteVec3(pf.forceWorld) && isFiniteVec3(pf.pointWorld)) {
        body.addForceAtPoint(
          { x: pf.forceWorld.x, y: pf.forceWorld.y, z: pf.forceWorld.z },
          { x: pf.pointWorld.x, y: pf.pointWorld.y, z: pf.pointWorld.z },
          true
        );
        sumFx += pf.forceWorld.x;
        sumFy += pf.forceWorld.y;
        sumFz += pf.forceWorld.z;
      }
    }

    const invMass = 1 / Math.max(550, liveMassKg);
    this.expectedDeltaV.x = sumFx * invMass * dt;
    this.expectedDeltaV.y = sumFy * invMass * dt;
    this.expectedDeltaV.z = sumFz * invMass * dt;

    // Clear accumulators for the next tick
    fAcc.x = 0;
    fAcc.y = 0;
    fAcc.z = 0;
    tAcc.x = 0;
    tAcc.y = 0;
    tAcc.z = 0;
    pointForces.length = 0;

    // 4. Advance Rapier3D physics simulation step
    world.timestep = dt;
    world.step();

    // 5. Read back rigid-body kinematics, local basis, speeds & smoothed G-forces
    this.syncChassisTransformToState(state, dt, false);

    // 6. Cast 4 downward wheel rays (filtering out chassis body & guardrail walls)
    this.castWheelRays(state, vehicle, dt, false);
  }

  private syncChassisTransformToState(
    state: IVehicleRuntimeState,
    dt: number,
    isReset: boolean
  ): void {
    const body = this.chassisBody;
    if (!body) return;

    const pos = body.translation();
    const rot = body.rotation();
    let linvel = body.linvel();
    let angvel = body.angvel();

    // Numerical stability clamp against freak high-energy collision impulses
    const speedSq = linvel.x * linvel.x + linvel.y * linvel.y + linvel.z * linvel.z;
    if (speedSq > 165 * 165) {
      const scale = 165 / Math.sqrt(speedSq);
      linvel = { x: linvel.x * scale, y: linvel.y * scale, z: linvel.z * scale };
      body.setLinvel(linvel, true);
    }
    const angSq = angvel.x * angvel.x + angvel.y * angvel.y + angvel.z * angvel.z;
    if (angSq > 18 * 18) {
      const scale = 18 / Math.sqrt(angSq);
      angvel = { x: angvel.x * scale, y: angvel.y * scale, z: angvel.z * scale };
      body.setAngvel(angvel, true);
    }

    state.position.x = pos.x;
    state.position.y = pos.y;
    state.position.z = pos.z;

    state.rotation.x = rot.x;
    state.rotation.y = rot.y;
    state.rotation.z = rot.z;
    state.rotation.w = rot.w;

    state.linearVelocityWorld.x = linvel.x;
    state.linearVelocityWorld.y = linvel.y;
    state.linearVelocityWorld.z = linvel.z;

    state.angularVelocityWorld.x = angvel.x;
    state.angularVelocityWorld.y = angvel.y;
    state.angularVelocityWorld.z = angvel.z;

    const basis = computeBasisFromQuat(state.rotation);
    state.forwardWorld.x = basis.forward.x;
    state.forwardWorld.y = basis.forward.y;
    state.forwardWorld.z = basis.forward.z;
    state.upWorld.x = basis.up.x;
    state.upWorld.y = basis.up.y;
    state.upWorld.z = basis.up.z;
    state.rightWorld.x = basis.right.x;
    state.rightWorld.y = basis.right.y;
    state.rightWorld.z = basis.right.z;

    // Local velocity: x = lateral (+right), y = vertical (+up), z = longitudinal (+forward)
    state.localVelocity.x = dot(state.linearVelocityWorld, state.rightWorld);
    state.localVelocity.y = dot(state.linearVelocityWorld, state.upWorld);
    state.localVelocity.z = dot(state.linearVelocityWorld, state.forwardWorld);

    state.speedMs = Math.hypot(linvel.x, linvel.y, linvel.z);
    state.forwardSpeedMs = state.localVelocity.z;
    state.speedKph = state.speedMs * 3.6;
    state.yawRateRadS = dot(state.angularVelocityWorld, state.upWorld);
    state.bodySlipAngleRad =
      Math.abs(state.localVelocity.z) > 1.0
        ? Math.atan2(state.localVelocity.x, Math.abs(state.localVelocity.z))
        : 0;

    if (isReset) {
      state.longitudinalG = 0;
      state.lateralG = 0;
      this.prevLinvel.x = linvel.x;
      this.prevLinvel.y = linvel.y;
      this.prevLinvel.z = linvel.z;
      return;
    }

    // Impact pulse detection & car-local 10-zone progressive damage
    if (this.impactCooldownS > 0) {
      this.impactCooldownS = Math.max(0, this.impactCooldownS - dt);
    }
    const unexpectedDv: Vec3 = {
      x: linvel.x - this.prevLinvel.x - this.expectedDeltaV.x,
      y: linvel.y - this.prevLinvel.y - this.expectedDeltaV.y,
      z: linvel.z - this.prevLinvel.z - this.expectedDeltaV.z,
    };
    const horizImpactDv = Math.hypot(unexpectedDv.x, unexpectedDv.z);
    if (horizImpactDv > 1.35 && this.impactCooldownS <= 0) {
      const intensity01 = clamp((horizImpactDv - 1.35) / 14.0, 0.08, 1.0);
      const invDv = 1 / Math.max(1e-4, Math.hypot(unexpectedDv.x, unexpectedDv.y, unexpectedDv.z));
      const worldDir: Vec3 = {
        x: unexpectedDv.x * invDv,
        y: unexpectedDv.y * invDv,
        z: unexpectedDv.z * invDv,
      };
      // Car-local direction: +X left (-rightWorld), +Y up, +Z forward
      const localDirection: Vec3 = {
        x: -dot(worldDir, state.rightWorld),
        y: dot(worldDir, state.upWorld),
        z: dot(worldDir, state.forwardWorld),
      };
      const classified = classifyImpactDamageZone(localDirection);
      const damageAdd = intensity01 * 0.28 * this.balanceConfig.physics_bias.impact_damage_mult;
      state.damageZones[classified.zoneIndex] = clamp(
        state.damageZones[classified.zoneIndex] + damageAdd,
        0,
        1
      );
      if (classified.secondaryIndex !== undefined && intensity01 > 0.35) {
        state.damageZones[classified.secondaryIndex] = clamp(
          state.damageZones[classified.secondaryIndex] + damageAdd * 0.45,
          0,
          1
        );
      }
      this.impactSeq++;
      this.impactCooldownS = 0.16;
      const pulse: IVehicleImpactPulse = {
        seq: this.impactSeq,
        tick: state.simTick,
        intensity01,
        impulseNs: Math.round(horizImpactDv * Math.max(550, this.appliedMassKg)),
        localDirection,
        zone: classified.zone,
      };
      state.lastImpact = pulse;
      this.ctx?.events.emit('vehicle:impact', pulse);
    }

    const invDt = dt > 1e-6 ? 1 / dt : 120;
    const accelWorld: Vec3 = {
      x: (linvel.x - this.prevLinvel.x) * invDt,
      y: (linvel.y - this.prevLinvel.y) * invDt,
      z: (linvel.z - this.prevLinvel.z) * invDt,
    };

    const rawLongG = clamp(dot(accelWorld, state.forwardWorld) / 9.81, -4.5, 4.5);
    const rawLatG = clamp(dot(accelWorld, state.rightWorld) / 9.81, -4.5, 4.5);
    const gSmooth = 1 - Math.exp(-dt * 14);

    state.longitudinalG += (rawLongG - state.longitudinalG) * gSmooth;
    state.lateralG += (rawLatG - state.lateralG) * gSmooth;

    this.prevLinvel.x = linvel.x;
    this.prevLinvel.y = linvel.y;
    this.prevLinvel.z = linvel.z;
  }

  private castWheelRays(
    state: IVehicleRuntimeState,
    vehicle: ICompiledVehicle,
    dt: number,
    isReset: boolean
  ): void {
    const world = this.world;
    const body = this.chassisBody;
    if (!world || !body) return;

    const rayDir: Vec3 = {
      x: -state.upWorld.x,
      y: -state.upWorld.y,
      z: -state.upWorld.z,
    };
    const worldCom = localToWorld(state, vehicle.cgPositionLocal);
    const invDt = dt > 1e-6 ? 1 / dt : 120;

    const wallHandle = this.wallColliderHandle;
    const filterPredicate =
      wallHandle !== null
        ? (col: RAPIER.Collider) => col.handle !== wallHandle
        : undefined;

    for (let i = 0; i < 4; i++) {
      const w = state.wheels[i];
      const isFront = i < 2;
      const wheelRadius = isFront ? vehicle.wheelRadiusFrontM : vehicle.wheelRadiusRearM;
      const lStatic = vehicle.suspensionRestLengthM[i];
      const lMax = lStatic + DROOP_TRAVEL_M;
      const lMin = Math.max(0.11, lStatic - BUMP_TRAVEL_M);
      const maxRayDist = lMax + wheelRadius;

      // Strut top mount chosen so at static equilibrium (L = lStatic), wheel hub sits at y = wheelRadius
      // and chassis local origin rests at y = (rideHeightMm - 75) / 1000 matching chassis.json.
      const anchor = vehicle.wheelPositionsLocal[i];
      const rayOrigin = localToWorld(state, {
        x: anchor.x,
        y: wheelRadius + NOMINAL_RIDE_REST_M,
        z: anchor.z,
      });

      const ray = new RAPIER.Ray(rayOrigin, rayDir);
      const hit = world.castRayAndGetNormal(
        ray,
        maxRayDist,
        true,
        undefined,
        undefined,
        undefined,
        body,
        filterPredicate
      );

      let validHit = false;
      let hitNormal: Vec3 = { ...state.upWorld };
      let hitDist = maxRayDist;

      if (hit !== null && hit.timeOfImpact >= 0 && hit.timeOfImpact <= maxRayDist) {
        const nLen = Math.hypot(hit.normal.x, hit.normal.y, hit.normal.z);
        if (nLen > 1e-4) {
          let nx = hit.normal.x / nLen;
          let ny = hit.normal.y / nLen;
          let nz = hit.normal.z / nLen;
          let align = nx * state.upWorld.x + ny * state.upWorld.y + nz * state.upWorld.z;
          // Flip back-face trimesh normals cleanly if triangle winding points down
          if (align < 0) {
            nx = -nx;
            ny = -ny;
            nz = -nz;
            align = -align;
          }
          if (align >= 0.35) {
            validHit = true;
            hitDist = hit.timeOfImpact;
            hitNormal = { x: nx, y: ny, z: nz };
          }
        }
      }

      if (validHit && hit !== null) {
        const rawSuspLen = hitDist - wheelRadius;
        const bottomedOut = rawSuspLen <= lMin + 0.01;
        const suspLen = clamp(rawSuspLen, lMin, lMax);
        const compressionM = clamp(lMax - suspLen, 0, lMax - lMin);

        let compVel = 0;
        if (!isReset && this.prevWheelGrounded[i]) {
          const rawVel = (compressionM - this.prevWheelCompression[i]) * invDt;
          compVel = clamp(w.compressionVelocityMs * 0.35 + rawVel * 0.65, -4.5, 4.5);
        } else if (!isReset) {
          // First frame landing: estimate vertical closure rate from chassis point velocity (prevents spike)
          const rAnchor: Vec3 = {
            x: rayOrigin.x - worldCom.x,
            y: rayOrigin.y - worldCom.y,
            z: rayOrigin.z - worldCom.z,
          };
          const rotV = cross(state.angularVelocityWorld, rAnchor);
          const pointVel: Vec3 = {
            x: state.linearVelocityWorld.x + rotV.x,
            y: state.linearVelocityWorld.y + rotV.y,
            z: state.linearVelocityWorld.z + rotV.z,
          };
          compVel = clamp(-dot(pointVel, hitNormal), -4.5, 4.5);
        }

        w.grounded = true;
        w.bottomedOut = bottomedOut;
        w.suspensionLengthM = suspLen;
        w.compressionM = compressionM;
        w.compressionVelocityMs = compVel;

        w.contactPointWorld.x = rayOrigin.x + rayDir.x * hitDist;
        w.contactPointWorld.y = rayOrigin.y + rayDir.y * hitDist;
        w.contactPointWorld.z = rayOrigin.z + rayDir.z * hitDist;

        w.contactNormalWorld.x = hitNormal.x;
        w.contactNormalWorld.y = hitNormal.y;
        w.contactNormalWorld.z = hitNormal.z;

        // Wheel hub center in world space (= contactPoint + upWorld * wheelRadius when not clamped)
        w.worldPosition.x = rayOrigin.x + rayDir.x * suspLen;
        w.worldPosition.y = rayOrigin.y + rayDir.y * suspLen;
        w.worldPosition.z = rayOrigin.z + rayDir.z * suspLen;

        // Tag surface type from track trimesh triangleSurfaces (0=tarmac, 1=kerb, 2=grass)
        if (
          this.roadColliderHandle !== null &&
          hit.collider.handle === this.roadColliderHandle &&
          this.triangleSurfaces !== null &&
          hit.featureId !== undefined
        ) {
          let triIdx = hit.featureId;
          if (triIdx >= this.roadTriangleCount && this.roadTriangleCount > 0) {
            triIdx = triIdx % this.roadTriangleCount;
          }
          const surfaceCode = this.triangleSurfaces[triIdx] ?? 0;
          w.surface = surfaceCodeToType(surfaceCode);
        } else {
          w.surface = 'tarmac';
        }

        this.prevWheelCompression[i] = compressionM;
        this.prevWheelGrounded[i] = true;
      } else {
        // Airborne wheel at full droop
        w.grounded = false;
        w.bottomedOut = false;
        w.surface = 'tarmac';
        w.suspensionLengthM = lMax;
        w.compressionM = 0;
        w.compressionVelocityMs = 0;

        w.contactNormalWorld.x = state.upWorld.x;
        w.contactNormalWorld.y = state.upWorld.y;
        w.contactNormalWorld.z = state.upWorld.z;

        w.contactPointWorld.x = rayOrigin.x + rayDir.x * maxRayDist;
        w.contactPointWorld.y = rayOrigin.y + rayDir.y * maxRayDist;
        w.contactPointWorld.z = rayOrigin.z + rayDir.z * maxRayDist;

        w.worldPosition.x = rayOrigin.x + rayDir.x * lMax;
        w.worldPosition.y = rayOrigin.y + rayDir.y * lMax;
        w.worldPosition.z = rayOrigin.z + rayDir.z * lMax;

        this.prevWheelCompression[i] = 0;
        this.prevWheelGrounded[i] = false;
      }

      if (isReset) {
        w.prevWorldPosition.x = w.worldPosition.x;
        w.prevWorldPosition.y = w.worldPosition.y;
        w.prevWorldPosition.z = w.worldPosition.z;
      }
    }
  }

  public dispose(): void {
    this.unsubTrackBuilt?.();
    this.unsubTrackBuilt = null;
    this.unsubReset?.();
    this.unsubReset = null;

    this.roadCollider = null;
    this.wallCollider = null;
    this.fallbackGroundCollider = null;
    this.chassisCollider = null;
    this.chassisBody = null;
    this.triangleSurfaces = null;

    if (this.world) {
      this.world.free();
      this.world = null;
    }
  }
}

export const physicsRapierPlugin: IModulusPlugin = new PhysicsRapierPlugin();
