import type { ChassisBodyStyle } from '../../core/types';

type SideProfile = Array<[z: number, y: number]>;

interface RoadBodyProfile {
  body: SideProfile;
  cabin: SideProfile;
  cabinWidth: number;
  hoodHeight: number;
  headlightHeight: number;
  taillightHeight: number;
}

export function getRoadBodyProfile(
  style: ChassisBodyStyle,
  axle: number,
  front: number,
  rear: number,
  bottom: number
): RoadBodyProfile | undefined {
  const lowerBody = (rearHeight: number, deck: SideProfile, noseHeight: number): SideProfile => [
    [rear, bottom + 0.12], [rear + 0.05, rearHeight], ...deck,
    [front - 0.11, noseHeight], [front, bottom + 0.19],
    [front - 0.08, bottom], [rear + 0.08, bottom],
  ];

  switch (style) {
    case 'sedan':
      return {
        body: lowerBody(0.82, [[-axle * 0.70, 0.89], [axle * 0.70, 0.87]], 0.77),
        cabin: [[-axle * 0.96, 0.86], [-axle * 0.55, 1.41], [axle * 0.28, 1.40], [axle * 0.78, 0.86]],
        cabinWidth: 0.85, hoodHeight: 0.88, headlightHeight: 0.66, taillightHeight: 0.72,
      };
    case 'pickup':
      return {
        body: lowerBody(0.83, [[-axle * 0.28, 0.83], [axle * 0.06, 1.04], [axle * 0.83, 1.09]], 1.04),
        cabin: [[-axle * 0.25, 1.02], [-axle * 0.20, 1.72], [axle * 0.38, 1.72], [axle * 0.76, 1.09]],
        cabinWidth: 0.88, hoodHeight: 1.11, headlightHeight: 0.88, taillightHeight: 0.77,
      };
    case 'minivan':
      return {
        body: lowerBody(1.14, [[-axle * 0.95, 1.15], [axle * 0.75, 1.15]], 0.88),
        cabin: [[rear + 0.12, 1.11], [rear + 0.27, 1.76], [axle * 0.42, 1.76], [axle * 1.08, 1.10]],
        cabinWidth: 0.92, hoodHeight: 1.12, headlightHeight: 0.77, taillightHeight: 0.94,
      };
    case 'microcar':
      return {
        body: lowerBody(0.82, [[-axle * 0.64, 0.89], [axle * 0.56, 0.84]], 0.62),
        cabin: [[rear + 0.10, 0.82], [-axle * 0.78, 1.38], [axle * 0.35, 1.36], [axle * 0.90, 0.81]],
        cabinWidth: 0.85, hoodHeight: 0.82, headlightHeight: 0.56, taillightHeight: 0.66,
      };
    case 'hatch':
      return {
        body: lowerBody(0.86, [[-axle * 0.62, 0.90], [axle * 0.57, 0.84]], 0.70),
        cabin: [[rear + 0.11, 0.86], [rear + 0.38, 1.36], [axle * 0.38, 1.34], [axle * 0.91, 0.82]],
        cabinWidth: 0.84, hoodHeight: 0.85, headlightHeight: 0.60, taillightHeight: 0.75,
      };
    case 'wagon':
      return {
        body: lowerBody(0.96, [[-axle * 0.83, 0.96], [axle * 0.75, 0.85]], 0.74),
        cabin: [[rear + 0.10, 0.94], [rear + 0.29, 1.44], [axle * 0.36, 1.44], [axle * 0.84, 0.84]],
        cabinWidth: 0.88, hoodHeight: 0.89, headlightHeight: 0.64, taillightHeight: 0.84,
      };
    case 'roadster':
      return {
        body: lowerBody(0.69, [[-axle * 0.79, 0.76], [-axle * 0.40, 0.69], [axle * 0.66, 0.72]], 0.55),
        cabin: [[axle * 0.17, 0.73], [axle * 0.32, 1.11], [axle * 0.36, 1.11], [axle * 0.50, 0.72]],
        cabinWidth: 0.80, hoodHeight: 0.73, headlightHeight: 0.49, taillightHeight: 0.56,
      };
    case 'muscle':
      return {
        body: lowerBody(0.87, [[-axle * 0.88, 0.92], [axle * 0.88, 0.92]], 0.84),
        cabin: [[-axle * 1.03, 0.90], [-axle * 0.62, 1.36], [axle * 0.01, 1.36], [axle * 0.50, 0.90]],
        cabinWidth: 0.81, hoodHeight: 0.93, headlightHeight: 0.74, taillightHeight: 0.76,
      };
    default:
      return undefined;
  }
}
