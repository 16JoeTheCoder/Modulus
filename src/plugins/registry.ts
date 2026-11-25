import type { IModulusPlugin } from '../core/types';
import { trackGeneratorPlugin } from './track-generator';
import { inputKeyboardPlugin } from './input-keyboard';
import { inputTouchPlugin } from './input-touch';
import { aiTestDriverPlugin } from './ai-test-driver';
import { powertrainPlugin } from './powertrain';
import { aerodynamicsPlugin } from './aerodynamics';
import { vehicleSolverPlugin } from './vehicle-solver';
import { thermalsPlugin } from './thermals';
import { physicsRapierPlugin } from './physics-rapier';
import { carAssemblerPlugin } from './car-assembler';
import { ghostRendererPlugin } from './ghost-renderer';
import { fxRendererPlugin } from './fx-renderer';
import { audioSynthPlugin } from './audio-synth';

/**
 * Single Plug-and-Play Manifest Toggling Active MODULUS Systems
 * Adding or removing any gameplay subsystem requires ZERO edits to /src/core.
 */
export const ACTIVE_PLUGINS: IModulusPlugin[] = [
  trackGeneratorPlugin, // 10: Builds 3D spline road mesh & emits track:built
  inputKeyboardPlugin,  // 30: Speed-sensitive WASD + counter-steer assist
  inputTouchPlugin,     // 31: Mobile touch controls (pointer: coarse)
  aiTestDriverPlugin,   // 35: Physical Pure Pursuit + spline curvature braking AI
  powertrainPlugin,     // 40: RPM, torque curve, turbo spool, gearbox, LSD
  aerodynamicsPlugin,   // 50: Splitter, ride-height diffuser stall, wing AoA
  vehicleSolverPlugin,  // 60: Raycast suspension, weight transfer, Pacejka tires, brakes
  thermalsPlugin,       // 70: Engine, tire & brake heat/cooling/wear/fade
  physicsRapierPlugin,  // 75: Rapier3D WASM rigid-body step + 4-corner raycasts
  carAssemblerPlugin,   // 80: Procedural low-poly car + Cockpit interior + Dark Lab overlays
  ghostRendererPlugin,  // 85: Time Trial PB ghost recorder & translucent zero-collision ghost replay
  fxRendererPlugin,     // 90: Dual lighting swap, skidmarks, tire smoke, cockpit/chase camera rig
  audioSynthPlugin,     // 95: Procedural Web Audio engine, shift, tire scrub, kerb & impact cues
];
