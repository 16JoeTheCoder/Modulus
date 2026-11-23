import { computeThermalAndWearGripMultiplier } from '../../core/math/pacejka';
import {
  DEFAULT_BALANCE_CONFIG,
  type ICompiledVehicle,
  type IEngineContext,
  type IGlobalBalanceConfig,
  type IInputState,
  type IModulusPlugin,
  type IVehicleRuntimeState,
} from '../../core/types';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export class ThermalsPlugin implements IModulusPlugin {
  public readonly id = 'thermals';
  public readonly version = '1.0.0';
  public readonly priority = 70;

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

  public onPhysicsStep(dt: number, state: IVehicleRuntimeState, input: IInputState): void {
    const vehicle = this.vehicle ?? this.ctx?.getCompiledVehicle();
    if (!vehicle) return;

    const { build } = vehicle;
    const heatBias = this.balanceConfig.physics_bias.thermal_heat_soak_mult;
    const ambientC = state.ambientTempC;
    const trackC = state.trackTempC;
    const speedMs = state.speedMs;

    // ------------------------------------------------------------------
    // 1. Engine Thermal Balance (dT/dt = (P_heat * beta - P_cool) / C_th)
    // ------------------------------------------------------------------
    const layoutHeatMult = build.engine.layout === 'Rotary' ? 1.18 : 1.0;
    const overRevExcess = Math.max(0, state.engineRpm - vehicle.redlineRpm);
    const overRevMult = 1 + Math.pow(overRevExcess / 450, 1.5) * 0.55;

    let engineHeatW = 0;
    if (!state.engineBlown && state.fuelLiters > 0) {
      const idleFloorW = 3600;
      const combustionWasteW = state.enginePowerHp * 240 * vehicle.engineHeatMultiplier * layoutHeatMult;
      const boostHeatW = state.turboBoostBar * 6800 * (0.2 + 0.8 * clamp(input.throttle, 0, 1));
      engineHeatW = (idleFloorW + (combustionWasteW + boostHeatW) * overRevMult) * heatBias;
    }

    // Radiator heat rejection scaled by airflow speed and thermostat opening
    const airflowFactor = 0.28 + 0.72 * clamp(speedMs / 42, 0, 1.35);
    const thermostatOpen = clamp((state.engineTempC - 74) / 14, 0.08, 1.0);
    const engineDeltaT = Math.max(0, state.engineTempC - ambientC);
    const engineCoolW =
      vehicle.radiatorCoolingKw * 1000 * airflowFactor * thermostatOpen * (engineDeltaT / 75);

    const engineCap = Math.max(8000, vehicle.engineThermalCapacityJPerC);
    state.engineTempC = clamp(
      state.engineTempC + ((engineHeatW - engineCoolW) / engineCap) * dt,
      ambientC,
      165
    );

    // Engine limp mode with hysteresis & blown engine failure threshold
    if (!state.engineLimpMode && state.engineTempC >= vehicle.engineMaxSafeTempC) {
      state.engineLimpMode = true;
    } else if (state.engineLimpMode && state.engineTempC <= vehicle.engineMaxSafeTempC - 8) {
      state.engineLimpMode = false;
    }

    if (state.engineTempC >= vehicle.engineMaxSafeTempC + 24) {
      state.engineBlown = true;
      state.engineLimpMode = true;
    }

    // ------------------------------------------------------------------
    // 2. Per-Corner Brake Rotor & Tire Thermals + Wear / Fade
    // ------------------------------------------------------------------
    const rotorSizeScale = build.brakes.rotorDiameterMm / 320;
    const rotorBaseCap =
      build.brakes.rotorMaterial === 'Carbon-Ceramic'
        ? 1150
        : build.brakes.rotorMaterial === 'Slotted Steel'
          ? 1450
          : 1650;
    const rotorCapJPerC = rotorBaseCap * rotorSizeScale;

    const psiFlexFactor = clamp(1 + (28.5 - build.wheelsAndTires.coldPressurePsi) * 0.035, 0.72, 1.38);
    const [, maxOptTireC] = vehicle.tireOptimalTempWindowC;

    for (let i = 0; i < 4; i++) {
      const w = state.wheels[i];
      const isFront = i < 2;

      // --- 2a. Brake Rotor Heat & Cooling ---
      // Friction power only occurs while rotor is spinning against clamped pads
      const brakePowerW = Math.abs(w.brakeTorqueNm * w.angularVelocityRadS) * 0.85 * heatBias;
      const brakeDeltaT = Math.max(0, w.brakeTempC - ambientC);
      const brakeConvectiveW = (18 + speedMs * 2.4 * vehicle.brakeCoolingFactor) * brakeDeltaT;
      const brakeRadiativeW = 0.000018 * Math.pow(brakeDeltaT, 2.35);

      w.brakeTempC = clamp(
        w.brakeTempC + ((brakePowerW - brakeConvectiveW - brakeRadiativeW) / rotorCapJPerC) * dt,
        ambientC,
        1150
      );

      // Cold bite (Carbon-Ceramic glazed below 220C) + High-temp thermal fade above brakeMaxSafeTempC
      let coldMult = 1.0;
      if (w.brakeTempC < 220 && vehicle.brakeColdBiteFactor < 0.995) {
        const coldFrac = clamp((220 - w.brakeTempC) / 170, 0, 1);
        coldMult = 1.0 - (1.0 - vehicle.brakeColdBiteFactor) * coldFrac;
      }

      let fadeMult = 1.0;
      if (w.brakeTempC > vehicle.brakeMaxSafeTempC) {
        const excess = w.brakeTempC - vehicle.brakeMaxSafeTempC;
        fadeMult = Math.max(0.42, 1.0 - (excess / 260) * 0.58);
      }

      w.brakeFadeMultiplier = clamp(coldMult * fadeMult, 0.35, 1.02);

      // --- 2b. Tire Surface/Carcass Heat, Cooling & Wear ---
      const tireWidthMm = isFront
        ? build.wheelsAndTires.tireWidthFrontMm
        : build.wheelsAndTires.tireWidthRearMm;
      const tireCapJPerC = 2200 * (tireWidthMm / 235);

      let slipPowerW = 0;
      let flexPowerW = 0;
      if (w.grounded && w.normalLoadN > 10) {
        const vLongSlip = Math.abs(w.slipRatio) * Math.max(speedMs, 2.0);
        const vLatSlip = Math.abs(Math.sin(w.slipAngleRad)) * speedMs;
        slipPowerW =
          Math.abs(w.longitudinalForceN) * vLongSlip * 0.34 +
          Math.abs(w.lateralForceN) * vLatSlip * 0.42;
        flexPowerW = w.normalLoadN * speedMs * 0.0045 * psiFlexFactor;
      }

      // Radiant heat soak from glowing brake discs into the wheel/tire carcass
      const brakeSoakW = Math.max(0, w.brakeTempC - 280) * 2.1;
      const tireHeatW = (slipPowerW + flexPowerW + brakeSoakW) * heatBias;

      const tireAirCoolW = (16 + speedMs * 1.65) * (w.tireTempC - ambientC);
      const tireRoadCoolW = w.grounded
        ? (26 + speedMs * 0.85) * (w.tireTempC - trackC)
        : 0;

      w.tireTempC = clamp(
        w.tireTempC + ((tireHeatW - tireAirCoolW - tireRoadCoolW) / tireCapJPerC) * dt,
        ambientC,
        160
      );

      // Progressive tire wear [0..1]
      if (w.grounded && w.normalLoadN > 10) {
        const overheatWearMult = w.tireTempC > maxOptTireC ? 1 + (w.tireTempC - maxOptTireC) * 0.06 : 1.0;
        const slipWear = (slipPowerW / 55000) * 0.0022 * vehicle.tireWearRateMultiplier * overheatWearMult * heatBias;
        const rollingWear = (w.normalLoadN / 4000) * speedMs * 0.0000042 * vehicle.tireWearRateMultiplier;
        w.tireWear = clamp(w.tireWear + (slipWear + rollingWear) * dt, 0, 1);
      }

      // Thermal + wear grip multiplier shared with /src/core/math/pacejka.ts
      w.thermalGripMultiplier = computeThermalAndWearGripMultiplier(
        w.tireTempC,
        vehicle.tireOptimalTempWindowC,
        w.tireWear
      );
    }
  }
}

export const thermalsPlugin: IModulusPlugin = new ThermalsPlugin();
