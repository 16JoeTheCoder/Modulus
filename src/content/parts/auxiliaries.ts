import type { IPartSchema } from '../../core/types';

export const STOCK_BRAKE_PAD = 'brk_pad_stock';
export const STOCK_OIL_COOLER = 'cool_oil_none';

export const AUXILIARY_PARTS: IPartSchema[] = [
  {
    id: STOCK_BRAKE_PAD, module: 'brakes', subCategory: 'pad', name: 'Factory pads', specKey: 'Factory',
    description: 'Predictable ordinary brake response for short runs.', price: 0, starterUnlocked: true, modifiers: {},
  },
  {
    id: 'brk_pad_street', module: 'brakes', subCategory: 'pad', name: 'Street Sport pads', specKey: 'Street Sport',
    description: 'Stronger initial bite for short stages. Heat builds quickly under repeated heavy stops.',
    price: 1100, starterUnlocked: false, modifiers: { brakeTorqueNm: 200, brakeFadeThresholdDeltaC: -35 },
  },
  {
    id: 'brk_pad_rally', module: 'brakes', subCategory: 'pad', name: 'Rally Progressive pads', specKey: 'Rally',
    description: 'Milder bite helps you avoid locking up on loose surfaces. Handles more heat than factory pads.',
    price: 2200, starterUnlocked: false, modifiers: { brakeTorqueNm: -130, brakeFadeThresholdDeltaC: 60 },
  },
  {
    id: 'brk_pad_endurance', module: 'brakes', subCategory: 'pad', name: 'Endurance Compound pads', specKey: 'Endurance',
    description: 'Resists fade under repeated braking. Needs a few stops to develop full bite.',
    price: 3400, starterUnlocked: false,
    modifiers: { brakeTorqueNm: 80, coldBiteFactor: 0.78, brakeFadeThresholdDeltaC: 125 },
  },
  {
    id: STOCK_OIL_COOLER, module: 'cooling', subCategory: 'oilCooler', name: 'No auxiliary cooler', specKey: 'None',
    description: 'The lightest option for a short, low-load run.', price: 0, starterUnlocked: true, modifiers: {},
  },
  {
    id: 'cool_oil_compact', module: 'cooling', subCategory: 'oilCooler', name: 'Compact oil cooler', specKey: 'Compact',
    description: 'Extra cooling for long drifts and short races. Adds 2 kg.',
    price: 1350, starterUnlocked: false, modifiers: { massKg: 2, coolingCapacityKw: 6 },
  },
  {
    id: 'cool_oil_rally', module: 'cooling', subCategory: 'oilCooler', name: 'Rally oil cooler', specKey: 'Rally',
    description: 'More heat rejection with a small mass and drag penalty.',
    price: 2600, starterUnlocked: false, modifiers: { massKg: 4, coolingCapacityKw: 12, dragCdDelta: 0.004 },
  },
  {
    id: 'cool_oil_endurance', module: 'cooling', subCategory: 'oilCooler', name: 'Endurance oil cooler', specKey: 'Endurance',
    description: 'Maximum cooling for sustained engine load. Adds 7 kg and more drag.',
    price: 4100, starterUnlocked: false, modifiers: { massKg: 7, coolingCapacityKw: 20, dragCdDelta: 0.009 },
  },
];
