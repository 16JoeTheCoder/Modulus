/**
 * Pure Pacejka "Magic Formula" & Tire Contact Physics Helpers
 * Shared across 120Hz vehicle-solver AND /admin SVG curve previewer.
 */

export interface IPacejkaParams {
  B: number; // Stiffness factor
  C: number; // Shape factor
  D: number; // Peak value (mu * Fz)
  E: number; // Curvature factor
}

/**
 * Evaluates Pacejka Magic Formula: y(x) = D * sin(C * atan(B*x - E*(B*x - atan(B*x))))
 * @param slip dimensionless slip ratio kappa or slip angle tan(alpha) / radians
 */
export function evaluatePacejka(slip: number, params: IPacejkaParams): number {
  const bx = params.B * slip;
  return params.D * Math.sin(params.C * Math.atan(bx - params.E * (bx - Math.atan(bx))));
}

/**
 * Computes normalized friction coefficient mu(alphaDeg) for a given Pacejka parameter set
 * and live admin `pacejka_grip_mult`.
 */
export function evaluateSlipAngleGripCurve(
  slipAngleDeg: number,
  baseMu: number,
  pacejkaGripMult: number,
  B = 10.5,
  C = 1.38,
  E = -0.35
): number {
  const slipRad = (slipAngleDeg * Math.PI) / 180;
  return evaluatePacejka(slipRad, {
    B,
    C,
    D: baseMu * pacejkaGripMult,
    E,
  });
}

/**
 * Tire load sensitivity: actual friction coefficient drops slightly as vertical load Fz rises.
 */
export function computeLoadSensitiveMu(baseMu: number, normalLoadN: number, nominalLoadN = 3600): number {
  if (normalLoadN <= 1) return 0;
  const ratio = normalLoadN / nominalLoadN;
  const sensitivity = Math.max(0.74, 1.06 - 0.08 * ratio);
  return baseMu * sensitivity;
}

/**
 * Computes thermal grip multiplier [0.65 .. 1.04] from tire temperature vs compound window
 * and tire wear [0..1].
 */
export function computeThermalAndWearGripMultiplier(
  tireTempC: number,
  optimalWindowC: [number, number],
  tireWear: number
): number {
  const [minOpt, maxOpt] = optimalWindowC;
  let tempMult = 1.0;
  if (tireTempC < minOpt) {
    const deficit = minOpt - tireTempC;
    tempMult = Math.max(0.70, 1.0 - deficit * 0.0065);
  } else if (tireTempC > maxOpt) {
    const excess = tireTempC - maxOpt;
    tempMult = Math.max(0.62, 1.0 - excess * 0.0085);
  } else {
    tempMult = 1.02;
  }
  const wearMult = Math.max(0.55, 1.0 - Math.pow(Math.max(0, Math.min(1, tireWear)), 1.45) * 0.42);
  return tempMult * wearMult;
}

/**
 * Combined slip friction ellipse scaling so longitudinal + lateral forces never exceed mu * Fz.
 */
export function combineFrictionCircle(
  fxPure: number,
  fyPure: number,
  maxForceN: number
): { fx: number; fy: number } {
  const mag = Math.hypot(fxPure, fyPure);
  if (mag <= maxForceN || mag < 1e-5) {
    return { fx: fxPure, fy: fyPure };
  }
  const scale = maxForceN / mag;
  return { fx: fxPure * scale, fy: fyPure * scale };
}
