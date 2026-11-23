import {
  DEFAULT_BALANCE_CONFIG,
  type ICompiledVehicle,
  type IEngineContext,
  type IGlobalBalanceConfig,
  type IInputState,
  type IModulusPlugin,
  type IVehicleRuntimeState,
  type Vec3,
} from '../../core/types';

const AIR_DENSITY_KG_M3 = 1.225;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function localToWorld(state: IVehicleRuntimeState, local: Vec3): Vec3 {
  // MODULUS Local Basis: +X = Left (-rightWorld), +Y = Up (upWorld), +Z = Forward (forwardWorld)
  const lx = -state.rightWorld.x;
  const ly = -state.rightWorld.y;
  const lz = -state.rightWorld.z;
  return {
    x: state.position.x + lx * local.x + state.upWorld.x * local.y + state.forwardWorld.x * local.z,
    y: state.position.y + ly * local.x + state.upWorld.y * local.y + state.forwardWorld.y * local.z,
    z: state.position.z + lz * local.x + state.upWorld.z * local.y + state.forwardWorld.z * local.z,
  };
}

export class AerodynamicsPlugin implements IModulusPlugin {
  public readonly id = 'aerodynamics';
  public readonly version = '1.0.0';
  public readonly priority = 50;

  private ctx: IEngineContext | null = null;
  private vehicle: ICompiledVehicle | null = null;
  private balanceConfig: IGlobalBalanceConfig = DEFAULT_BALANCE_CONFIG;

  public init(ctx: IEngineContext): void {
    this.ctx = ctx;
    this.vehicle = ctx.getCompiledVehicle();
    this.balanceConfig = ctx.getBalanceConfig();
  }

  public onBalanceConfigUpdated(config: IGlobalBalanceConfig): void {
    this.balanceConfig = config;
  }

  public onBuildCompiled(vehicle: ICompiledVehicle): void {
    this.vehicle = vehicle;
  }

  public onPhysicsStep(_dt: number, state: IVehicleRuntimeState, _input: IInputState): void {
    const vehicle = this.vehicle ?? this.ctx?.getCompiledVehicle();
    if (!vehicle) return;

    const { build } = vehicle;
    const speedMs = state.speedMs;

    if (speedMs < 0.25) {
      state.downforceFrontN = 0;
      state.downforceRearN = 0;
      state.downforceTotalN = 0;
      state.dragForceN = 0;
      state.diffuserStalled = false;
      return;
    }

    const downforceBias = this.balanceConfig.physics_bias.aero_downforce_mult;
    const dragBias = this.balanceConfig.physics_bias.aero_drag_mult;

    // Forward airflow component drives wing/splitter/diffuser downforce; yaw slip reduces aero efficiency slightly
    const forwardAirSpeed = Math.max(0, state.localVelocity.z);
    const yawSlipFrac = clamp(Math.abs(state.localVelocity.x) / Math.max(5, speedMs), 0, 1);
    const yawAeroEfficiency = 1 - yawSlipFrac * 0.45;
    const qDown = 0.5 * AIR_DENSITY_KG_M3 * forwardAirSpeed * forwardAirSpeed * vehicle.frontalAreaM2 * yawAeroEfficiency;

    // Ground-effect rear diffuser stall based on live rear suspension ride height
    const rl = state.wheels[2];
    const rr = state.wheels[3];
    const hasDiffuser = build.aero.rearDiffuser !== 'None';

    let diffuserEfficiency = 1.0;
    let diffuserStalled = false;

    if (hasDiffuser) {
      const [minOptMm, maxOptMm] = vehicle.diffuserOptimalRideHeightMm;
      const rearGrounded = rl.grounded || rr.grounded;

      if (!rearGrounded) {
        diffuserEfficiency = 0.15;
        diffuserStalled = forwardAirSpeed > 10;
      } else {
        // suspensionLengthM = 0.22 + dynamicRideHeightM when grounded
        const avgRearSuspM =
          rl.grounded && rr.grounded
            ? 0.5 * (rl.suspensionLengthM + rr.suspensionLengthM)
            : rl.grounded
              ? rl.suspensionLengthM
              : rr.suspensionLengthM;
        const dynamicRearRideHeightMm = Math.max(0, (avgRearSuspM - 0.22) * 1000);
        const bottomed = rl.bottomedOut || rr.bottomedOut;

        if (bottomed || dynamicRearRideHeightMm < minOptMm) {
          // Choked underbody flow / bottoming out stalls Venturi suction rapidly
          const deficitMm = Math.max(0, minOptMm - dynamicRearRideHeightMm) + (bottomed ? 14 : 0);
          diffuserEfficiency = clamp(1.0 - (deficitMm / 24) * 0.85, 0.15, 1.0);
          diffuserStalled = forwardAirSpeed > 10 && diffuserEfficiency < 0.72;
        } else if (dynamicRearRideHeightMm > maxOptMm) {
          // Ride height too high loses ground-effect seal smoothly
          const excessMm = dynamicRearRideHeightMm - maxOptMm;
          diffuserEfficiency = clamp(1.0 - (excessMm / 48) * 0.78, 0.22, 1.0);
          diffuserStalled = forwardAirSpeed > 10 && diffuserEfficiency < 0.72;
        }
      }
    }

    // Separate diffuser Cl contribution from rear wing Cl so stalling the diffuser leaves the wing working
    const nominalDiffuserCl =
      build.aero.rearDiffuser === 'Deep Venturi'
        ? 0.72
        : build.aero.rearDiffuser === 'Shallow Strakes'
          ? 0.34
          : 0.04;
    const diffuserCl = Math.min(vehicle.liftCoefficientRearCl, nominalDiffuserCl);
    const wingCl = Math.max(0, vehicle.liftCoefficientRearCl - diffuserCl);
    const effectiveRearCl = wingCl + diffuserCl * diffuserEfficiency;

    const downforceFrontN = qDown * vehicle.liftCoefficientFrontCl * downforceBias;
    const downforceRearN = qDown * effectiveRearCl * downforceBias;
    const downforceTotalN = downforceFrontN + downforceRearN;

    // Aerodynamic drag opposing 3D velocity vector (slightly higher Cd when sliding sideways)
    const effectiveCd = vehicle.dragCoefficientCd * (1 + yawSlipFrac * 0.35);
    const qDrag = 0.5 * AIR_DENSITY_KG_M3 * speedMs * speedMs * vehicle.frontalAreaM2;
    const dragForceN = qDrag * effectiveCd * dragBias;

    state.downforceFrontN = downforceFrontN;
    state.downforceRearN = downforceRearN;
    state.downforceTotalN = downforceTotalN;
    state.dragForceN = dragForceN;
    state.diffuserStalled = diffuserStalled;

    // Apply front & rear downforce along -upWorld at front/rear aero centers of pressure
    const halfWb = vehicle.wheelbaseM * 0.5;
    if (downforceFrontN > 0.5) {
      const frontPoint = localToWorld(state, {
        x: 0,
        y: vehicle.cgHeightM,
        z: halfWb * 0.96,
      });
      state.pointForces.push({
        forceWorld: {
          x: -state.upWorld.x * downforceFrontN,
          y: -state.upWorld.y * downforceFrontN,
          z: -state.upWorld.z * downforceFrontN,
        },
        pointWorld: frontPoint,
      });
    }

    if (downforceRearN > 0.5) {
      const rearPoint = localToWorld(state, {
        x: 0,
        y: vehicle.cgHeightM,
        z: -halfWb * 0.96,
      });
      state.pointForces.push({
        forceWorld: {
          x: -state.upWorld.x * downforceRearN,
          y: -state.upWorld.y * downforceRearN,
          z: -state.upWorld.z * downforceRearN,
        },
        pointWorld: rearPoint,
      });
    }

    // Apply aerodynamic drag at Center of Mass opposing world linear velocity
    if (dragForceN > 0.5) {
      const invSpeed = 1 / speedMs;
      state.forceAccumulatorWorld.x -= state.linearVelocityWorld.x * invSpeed * dragForceN;
      state.forceAccumulatorWorld.y -= state.linearVelocityWorld.y * invSpeed * dragForceN;
      state.forceAccumulatorWorld.z -= state.linearVelocityWorld.z * invSpeed * dragForceN;
    }
  }
}

export const aerodynamicsPlugin: IModulusPlugin = new AerodynamicsPlugin();
