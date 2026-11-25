import Rapier from '@dimforge/rapier3d-compat';

export const SIM_HZ = 120;
export const SNAPSHOT_HZ = 15;
export const MAX_DRIVERS = 4;
export const NEUTRAL = Object.freeze({ throttle: 0, brake: 0, steer: 0 });

let initialization;

// A shared-world contact probe. Tire forces and track rules stay in the game
// until the production simulation can run independently of its renderer.
export async function createContactSimulation() {
  await (initialization ??= Rapier.init());
  const world = new Rapier.World({ x: 0, y: 0, z: 0 });
  world.timestep = 1 / SIM_HZ;
  const drivers = new Map();
  let tick = 0;

  for (const x of [-8, 8]) {
    world.createCollider(
      Rapier.ColliderDesc.cuboid(0.25, 1, 32).setTranslation(x, 0, 0)
    );
  }
  for (const z of [-32, 32]) {
    world.createCollider(
      Rapier.ColliderDesc.cuboid(8, 1, 0.25).setTranslation(0, 0, z)
    );
  }

  return {
    addDriver(id) {
      if (drivers.size >= MAX_DRIVERS || drivers.has(id)) return false;
      let slot = 0;
      while ([...drivers.values()].some((driver) => driver.slot === slot)) slot++;
      const opposing = slot % 2 === 1;
      const body = world.createRigidBody(
        Rapier.RigidBodyDesc.dynamic()
          .setTranslation(slot < 2 ? 0 : 4, 0, opposing ? 11 : -11)
          .setRotation({ x: 0, y: opposing ? 1 : 0, z: 0, w: opposing ? 0 : 1 })
          .enabledTranslations(true, false, true)
          .enabledRotations(false, true, false)
          .setCanSleep(false)
          .setCcdEnabled(true)
      );
      world.createCollider(
        Rapier.ColliderDesc.cuboid(0.83, 0.6, 2)
          .setMass(1180)
          .setFriction(0.4)
          .setRestitution(0.12),
        body
      );
      drivers.set(id, { body, slot, input: NEUTRAL });
      return true;
    },
    removeDriver(id) {
      const driver = drivers.get(id);
      if (!driver) return;
      world.removeRigidBody(driver.body);
      drivers.delete(id);
    },
    setInput(id, input) {
      const driver = drivers.get(id);
      if (driver) driver.input = input;
    },
    step() {
      for (const { body, input } of drivers.values()) {
        const rotation = body.rotation();
        const yaw = 2 * Math.atan2(rotation.y, rotation.w);
        const fx = Math.sin(yaw);
        const fz = Math.cos(yaw);
        const velocity = body.linvel();
        const along = velocity.x * fx + velocity.z * fz;
        const lateral = velocity.x * fz - velocity.z * fx;
        const brake = Math.min(Math.abs(along) * SIM_HZ, input.brake * 7);
        const acceleration = input.throttle * 3.2 - 0.085 * along - Math.sign(along) * brake;
        const sideways = -lateral * 5;
        const impulse = body.mass() / SIM_HZ;
        body.applyImpulse({
          x: (fx * acceleration + fz * sideways) * impulse,
          y: 0,
          z: (fz * acceleration - fx * sideways) * impulse,
        }, true);
        body.setAngvel({
          x: 0,
          y: input.steer * Math.min(1.4, Math.abs(along) * 0.14),
          z: 0,
        }, true);
      }
      world.step();
      tick++;
    },
    snapshot() {
      return {
        type: 'snapshot',
        tick,
        drivers: [...drivers].map(([id, { body }]) => {
          const { x, z } = body.translation();
          const rotation = body.rotation();
          const velocity = body.linvel();
          return { id, x, z, yaw: 2 * Math.atan2(rotation.y, rotation.w), speed: Math.hypot(velocity.x, velocity.z) };
        }),
      };
    },
    dispose() {
      world.free();
    },
  };
}
