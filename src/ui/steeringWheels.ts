type Point = readonly [x: number, y: number];

interface WheelStyle {
  label: string;
  outline: readonly Point[];
  spokes: readonly Point[];
  closed: boolean;
}

const circle = Array.from({ length: 32 }, (_, i): Point => {
  const angle = i * Math.PI * 2 / 32;
  return [Math.cos(angle), Math.sin(angle)];
});

export const STEERING_WHEELS = {
  road: { label: 'Normal', outline: circle, spokes: [[-0.91, -0.18], [0.91, -0.18], [0, -0.92]], closed: true },
  formula: { label: 'F1', outline: [[-0.96, 0.53], [-1.05, 0.20], [-1.04, -0.35], [-0.82, -0.66],
    [0.82, -0.66], [1.04, -0.35], [1.05, 0.20], [0.96, 0.53], [0.67, 0.60], [0.50, 0.33],
    [-0.50, 0.33], [-0.67, 0.60]], spokes: [[-0.93, -0.30], [0.93, -0.30]], closed: true },
  gt: { label: 'GT flat-bottom', outline: [[0.99, 0], [0.80, 0.62], [0.41, 0.90], [0, 1], [-0.41, 0.90],
    [-0.80, 0.62], [-0.99, 0], [-0.92, -0.43], [-0.57, -0.81], [0.57, -0.81], [0.92, -0.43]],
    spokes: [[-0.94, -0.22], [0.94, -0.22], [0, -0.79]], closed: true },
  rally: { label: 'Rally deep dish', outline: circle, spokes: [[-0.84, 0.46], [0.84, 0.46], [0, -0.92]], closed: true },
  yoke: { label: 'Yoke', outline: [[-0.83, 0.77], [-1.01, 0.48], [-1.02, -0.2], [-0.79, -0.63],
    [-0.46, -0.73], [0.46, -0.73], [0.79, -0.63], [1.02, -0.2], [1.01, 0.48], [0.83, 0.77]],
    spokes: [[-0.96, -0.16], [0.96, -0.16], [0, -0.72]], closed: false },
} satisfies Record<string, WheelStyle>;

export type SteeringWheelStyle = keyof typeof STEERING_WHEELS;
