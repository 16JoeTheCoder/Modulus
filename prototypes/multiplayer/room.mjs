import { DurableObject } from 'cloudflare:workers';
import { createContactSimulation, MAX_DRIVERS, NEUTRAL, SIM_HZ, SNAPSHOT_HZ } from './simulation.mjs';
import testDrivePage from './test-drive.html';

const ROOM_MS = 5 * 60 * 1000;
const IDLE_MS = 30_000;
const INPUT_INTERVAL_MS = 35;
const STALE_INPUT_MS = 1_000;
const STEPS_PER_SNAPSHOT = SIM_HZ / SNAPSHOT_HZ;

function parseInput(message) {
  if (typeof message !== 'string' || message.length > 128) return null;
  let input;
  try {
    input = JSON.parse(message);
  } catch {
    return null;
  }
  if (!input || input.type !== 'input') return null;
  const { throttle, brake, steer } = input;
  if (![throttle, brake, steer].every(Number.isFinite)) return null;
  if (throttle < 0 || throttle > 1 || brake < 0 || brake > 1 || steer < -1 || steer > 1) return null;
  return { throttle, brake, steer };
}

export class ContactRoom extends DurableObject {
  simulation;
  initialization;
  drivers = new Map();
  timer;
  startedAt = 0;
  lastActivity = 0;
  previousTickAt = 0;
  accumulatedSteps = 0;

  constructor(ctx, env) {
    super(ctx, env);
    // Matches are ephemeral. A restarted isolate has no authoritative race state.
    for (const socket of ctx.getWebSockets()) socket.close(1012, 'Room restarted');
  }

  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 });
    }
    if (this.drivers.size >= MAX_DRIVERS) return new Response('Room full', { status: 409 });
    this.initialization ??= createContactSimulation().catch((error) => {
      this.initialization = undefined;
      throw error;
    });
    this.simulation ??= await this.initialization;
    // The WASM initialization can yield while another join request is in flight.
    if (this.drivers.size >= MAX_DRIVERS) return new Response('Room full', { status: 409 });
    const id = crypto.randomUUID();
    if (!this.simulation.addDriver(id)) return new Response('Room full', { status: 409 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const now = Date.now();
    this.drivers.set(server, { id, lastInput: now - INPUT_INTERVAL_MS });
    this.lastActivity = now;
    if (!this.timer) {
      this.startedAt = now;
      this.previousTickAt = now;
      this.accumulatedSteps = 0;
      this.timer = setInterval(() => this.advance(), 1000 / SNAPSHOT_HZ);
    }
    server.send(JSON.stringify({ type: 'welcome', id }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket, message) {
    const driver = this.drivers.get(socket);
    const now = Date.now();
    if (!driver || now - driver.lastInput < INPUT_INTERVAL_MS) return;
    const input = parseInput(message);
    if (!input) return;
    driver.lastInput = now;
    this.lastActivity = now;
    this.simulation.setInput(driver.id, input);
  }

  webSocketClose(socket) {
    this.removeDriver(socket);
  }

  webSocketError(socket) {
    this.removeDriver(socket);
  }

  removeDriver(socket) {
    const driver = this.drivers.get(socket);
    if (!driver) return;
    this.simulation.removeDriver(driver.id);
    this.drivers.delete(socket);
    if (!this.drivers.size) this.stop();
  }

  advance() {
    const now = Date.now();
    if (now - this.startedAt >= ROOM_MS || now - this.lastActivity >= IDLE_MS) {
      for (const socket of this.drivers.keys()) socket.close(1000, 'Room expired');
      this.stop();
      return;
    }
    for (const driver of this.drivers.values()) {
      if (now - driver.lastInput > STALE_INPUT_MS) this.simulation.setInput(driver.id, NEUTRAL);
    }
    this.accumulatedSteps += Math.min(
      2 * STEPS_PER_SNAPSHOT,
      (now - this.previousTickAt) * SIM_HZ / 1000
    );
    this.previousTickAt = now;
    const steps = Math.floor(this.accumulatedSteps);
    this.accumulatedSteps -= steps;
    for (let i = 0; i < steps; i++) this.simulation.step();
    const snapshot = JSON.stringify(this.simulation.snapshot());
    for (const socket of this.drivers.keys()) {
      try {
        socket.send(snapshot);
      } catch {
        this.removeDriver(socket);
      }
    }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.drivers.clear();
    this.simulation?.dispose();
    this.simulation = undefined;
    this.initialization = undefined;
  }
}

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method === 'GET' && pathname === '/') {
      return new Response(testDrivePage, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    const match = /^\/rooms\/([a-z0-9-]{1,32})$/.exec(pathname);
    if (!match) return new Response('Room not found', { status: 404 });
    return env.CONTACT_ROOMS.get(env.CONTACT_ROOMS.idFromName(match[1])).fetch(request);
  },
};
