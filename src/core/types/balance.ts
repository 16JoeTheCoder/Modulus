import { z } from 'zod';

export const BrandingConfigSchema = z.object({
  site_name: z.string().min(1).max(60),
  domain: z.string().min(1).max(120),
  tagline: z.string().min(1).max(140),
  meta_description: z.string().min(10).max(320),
});

export const PhysicsBiasSchema = z.object({
  pacejka_grip_mult: z.number().min(0.5).max(2.0),
  aero_drag_mult: z.number().min(0.5).max(2.0),
  aero_downforce_mult: z.number().min(0.5).max(2.0),
  thermal_heat_soak_mult: z.number().min(0.5).max(2.0),
  weight_inertia_mult: z.number().min(0.5).max(2.0),
  turbo_lag_mult: z.number().min(0.5).max(2.0),
  driving_pace: z.number().min(0.6).max(1).default(1),
  steering_response: z.number().min(0.85).max(1.4).default(1.25),
  drift_forgiveness: z.number().min(0).max(1).default(0.65),
  traction_assist: z.number().min(0).max(1).default(0.55),
  impact_damage_mult: z.number().min(0.5).max(2).default(1.45),
});

export const EconomyBiasSchema = z.object({
  payout_mult: z.number().min(0.1).max(10.0),
  part_price_mult: z.number().min(0.1).max(10.0),
  wear_cost_mult: z.number().min(0.0).max(5.0),
  starting_credits: z.number().int().min(0).max(10_000_000),
  max_pwr_ratio_cap: z.number().min(0.0).max(5.0),
});

export const GlobalBalanceConfigSchema = z.object({
  version_id: z.string().min(1).max(40),
  updated_at: z.string(),
  branding: BrandingConfigSchema,
  physics_bias: PhysicsBiasSchema,
  economy_bias: EconomyBiasSchema,
});

export type IBrandingConfig = z.infer<typeof BrandingConfigSchema>;
export type IPhysicsBias = z.infer<typeof PhysicsBiasSchema>;
export type IEconomyBias = z.infer<typeof EconomyBiasSchema>;
export type IGlobalBalanceConfig = z.infer<typeof GlobalBalanceConfigSchema>;

export const DEFAULT_BALANCE_CONFIG: IGlobalBalanceConfig = {
  version_id: 'v1.0.0',
  updated_at: '2026-11-23T00:00:00Z',
  branding: {
    site_name: 'Modulus',
    domain: 'modulus.josefyang.com',
    tagline: 'Build the machine. Master the physics.',
    meta_description:
      'A modular low-poly engineering racing simulator. Mix parts, balance mechanical trade-offs, and test your builds on a 120Hz physics engine.',
  },
  physics_bias: {
    pacejka_grip_mult: 1.0,
    aero_drag_mult: 1.0,
    aero_downforce_mult: 1.0,
    thermal_heat_soak_mult: 1.0,
    weight_inertia_mult: 1.0,
    turbo_lag_mult: 1.0,
    driving_pace: 1,
    steering_response: 1.25,
    drift_forgiveness: 0.65,
    traction_assist: 0.55,
    impact_damage_mult: 1.45,
  },
  economy_bias: {
    payout_mult: 1.0,
    part_price_mult: 1.0,
    wear_cost_mult: 1.0,
    starting_credits: 25000,
    max_pwr_ratio_cap: 0.0,
  },
};

// The first garage release stored 0.78 in its stock KV and browser config.
export function migrateStockDrivingPace(config: IGlobalBalanceConfig): IGlobalBalanceConfig {
  if (config.version_id !== 'v1.0.0' || config.physics_bias.driving_pace !== 0.78) return config;
  return { ...config, physics_bias: { ...config.physics_bias, driving_pace: 1 } };
}

export function didPhysicsBiasChange(a: IPhysicsBias, b: IPhysicsBias): boolean {
  return (Object.keys(DEFAULT_BALANCE_CONFIG.physics_bias) as (keyof IPhysicsBias)[]).some(
    (key) => Math.abs(a[key] - b[key]) > 1e-6
  );
}
