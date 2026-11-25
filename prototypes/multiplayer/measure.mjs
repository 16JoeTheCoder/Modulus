import { createRequire } from 'node:module';
import { mkdtemp, readFile, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import esbuild from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { createContactSimulation, SIM_HZ, SNAPSHOT_HZ } from './simulation.mjs';

const require = createRequire(import.meta.url);
const rapierRoot = dirname(require.resolve('@dimforge/rapier3d-compat'));
const here = dirname(fileURLToPath(import.meta.url));
const accelerator = { throttle: 1, brake: 0, steer: 0 };
const inputMessage = JSON.stringify({ type: 'input', ...accelerator });
const stepCount = SIM_HZ / SNAPSHOT_HZ;

function percentile(samples, ratio) {
  const sorted = [...samples].sort((a, b) => a - b);
  return Number(sorted[Math.ceil(sorted.length * ratio) - 1].toFixed(3));
}

async function measureNode(driverCount) {
  const samples = [];
  const simulation = await createContactSimulation();
  try {
    for (let i = 0; i < driverCount; i++) {
      simulation.addDriver(String(i));
      simulation.setInput(String(i), accelerator);
    }
    for (let frame = 0; frame < 960; frame++) {
      const start = performance.now();
      for (let i = 0; i < stepCount; i++) simulation.step();
      JSON.stringify(simulation.snapshot());
      if (frame >= 60) samples.push(performance.now() - start);
    }
    return { drivers: driverCount, batchSteps: stepCount, medianMs: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95) };
  } finally {
    simulation.dispose();
  }
}

async function bundleWorker(tempDir) {
  // The compatibility package embeds the exact sibling .wasm bytes for browser
  // consumers. workerd needs a compiled WASM module import for the same bytes.
  const result = await esbuild.build({
    entryPoints: [join(here, 'room.mjs')],
    bundle: true,
    external: ['cloudflare:workers', './rapier.wasm'],
    format: 'esm',
    loader: { '.html': 'text' },
    outfile: join(tempDir, 'room.mjs'),
    write: false,
    plugins: [{
      name: 'workerd-rapier-wasm',
      setup(build) {
        build.onResolve({ filter: /^@dimforge\/rapier3d-compat$/ }, () => ({
          path: join(rapierRoot, 'rapier.es.js'),
          namespace: 'workerd-rapier',
        }));
        build.onLoad({ filter: /.*/, namespace: 'workerd-rapier' }, async ({ path }) => {
          const siblingWasm = await readFile(join(rapierRoot, 'rapier_wasm3d_bg.wasm'));
          const source = await readFile(path, 'utf8');
          const embedded = /\w+\.toByteArray\("([A-Za-z0-9+/]{500000,}={0,2})"\)\.buffer/;
          const match = embedded.exec(source);
          assert(match && siblingWasm.equals(Buffer.from(match[1], 'base64')), 'Rapier WASM loader changed');
          return {
            contents: 'import rapierWasm from "./rapier.wasm";\n' + source.replace(embedded, 'rapierWasm'),
            loader: 'js',
          };
        });
      },
    }],
  });
  return [
    { type: 'ESModule', path: join(tempDir, 'room.mjs'), contents: result.outputFiles[0].text },
    { type: 'CompiledWasm', path: join(tempDir, 'rapier.wasm'), contents: await readFile(join(rapierRoot, 'rapier_wasm3d_bg.wasm')) },
  ];
}

async function startWorker(tempDir) {
  return new Miniflare(convertV4MiniflareOptions({
    host: '127.0.0.1',
    modules: await bundleWorker(tempDir),
    modulesRoot: tempDir,
    compatibilityDate: '2026-01-01',
    durableObjects: { CONTACT_ROOMS: { className: 'ContactRoom', useSQLite: true } },
  }));
}

async function measureRoom(tempDir) {
  const miniflare = await startWorker(tempDir);
  const peers = [];
  let inputs;
  try {
    const endpoint = new URL('/rooms/first-contact', await miniflare.ready);
    const headers = { Upgrade: 'websocket' };
    const origin = performance.now();
    const frames = [];
    const observers = [];
    for (let i = 0; i < 4; i++) {
      const res = await miniflare.dispatchFetch(endpoint, { headers });
      assert.equal(res.status, 101);
      const peer = res.webSocket;
      peers.push(peer);
      const observer = { id: null, lastFrame: null, frames: new Map() };
      observers.push(observer);
      peer.addEventListener('message', ({ data }) => {
        const message = JSON.parse(data);
        if (message.type === 'welcome') observer.id = message.id;
        if (message.type === 'snapshot') {
          observer.lastFrame = message;
          observer.frames.set(message.tick, message);
          if (i === 0 && message.drivers.length === 4) frames.push({ ...message, receivedMs: performance.now() - origin });
        }
      });
      peer.accept();
    }
    const overflow = await miniflare.dispatchFetch(endpoint, { headers });
    assert.equal(overflow.status, 409);
    inputs = setInterval(() => {
      for (const peer of peers) peer.send(inputMessage);
    }, 1000 / SNAPSHOT_HZ);
    peers.forEach(peer => peer.send(inputMessage));
    const until = performance.now() + 7_000;
    while (performance.now() < until && frames.length < 80) {
      await new Promise(done => setTimeout(done, 50));
    }
    clearInterval(inputs);
    inputs = undefined;
    assert(frames.length >= 45, 'Room did not deliver enough live snapshots');
    const firstId = observers[0].id;
    const secondId = observers[1].id;
    assert(firstId && secondId && firstId !== secondId);
    const sharedTick = observers[1].lastFrame.tick;
    assert(Math.abs(observers[0].lastFrame.tick - sharedTick) <= SIM_HZ / SNAPSHOT_HZ);
    const firstCar = frames.map(frame => frame.drivers.find(driver => driver.id === firstId));
    const contactIndex = firstCar.findIndex((frame, index) => (
      index > 0 && firstCar[index - 1].speed > 4 && frame.speed < 2 && frame.z > -3 && frame.z < 0
    ));
    assert(contactIndex > 0, 'Opponent contact did not slow the first car on the practice pad');
    const contact = frames[contactIndex];
    assert(contact.drivers.some(driver => driver.id === secondId && driver.z > 0 && driver.z < 3));
    for (const observer of observers) {
      assert.deepEqual(observer.frames.get(contact.tick)?.drivers, contact.drivers);
    }
    const intervals = frames.slice(1).map((frame, i) => frame.receivedMs - frames[i].receivedMs);
    peers.pop().close(1000, 'Test complete');
    const disconnectDeadline = performance.now() + 2_000;
    while (observers[0].lastFrame.drivers.length !== 3 && performance.now() < disconnectDeadline) {
      await new Promise(done => setTimeout(done, 50));
    }
    assert.equal(observers[0].lastFrame.drivers.length, 3);
    return {
      drivers: 4,
      snapshots: frames.length,
      medianSnapshotIntervalMs: percentile(intervals, 0.5),
      p95SnapshotIntervalMs: percentile(intervals, 0.95),
      simulatedSeconds: Number(((frames.at(-1).tick - frames[0].tick) / SIM_HZ).toFixed(3)),
      elapsedSeconds: Number(((frames.at(-1).receivedMs - frames[0].receivedMs) / 1_000).toFixed(3)),
      firstCarContactSpeedMs: [
        Number(firstCar[contactIndex - 1].speed.toFixed(2)),
        Number(firstCar[contactIndex].speed.toFixed(2)),
      ],
      sharedCollisionState: true,
      fifthDriverRejected: true,
      disconnectReplicated: true,
    };
  } finally {
    clearInterval(inputs);
    for (const peer of peers) peer.close(1000, 'Test complete');
    await miniflare.dispose();
  }
}

const tempDir = resolve(await mkdtemp(join(tmpdir(), 'modulus-contact-probe-')));
try {
  if (process.argv.includes('--serve')) {
    const local = await startWorker(tempDir);
    try {
      console.log(new URL('?room=first-contact', await local.ready).href);
      await new Promise(done => {
        process.once('SIGINT', done);
        process.once('SIGTERM', done);
      });
    } finally {
      await local.dispose();
    }
  } else {
    const node = [await measureNode(2), await measureNode(4)];
    const workerd = await measureRoom(tempDir);
    console.log(JSON.stringify({ node, workerd }, null, 2));
  }
} finally {
  await rmdir(tempDir);
}
