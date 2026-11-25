#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { launchChromeSession, sleep } from './cdp.mjs';
import { INSTALL_INPAGE_HARNESS_SCRIPT } from './inpage.mjs';

function parseArgs(argv) {
  const opts = {
    url: 'http://localhost:5173',
    track: null,
    scenario: null,
    ai: false,
    duration: null,
    probes: null,
    out: null,
    headed: false,
    width: 1280,
    height: 800,
    stopOnLap: null,
    camera: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') opts.url = argv[++i];
    else if (a === '--track') opts.track = argv[++i];
    else if (a === '--scenario') opts.scenario = argv[++i];
    else if (a === '--ai') opts.ai = true;
    else if (a === '--duration') opts.duration = Number(argv[++i]);
    else if (a === '--probes') {
      opts.probes = argv[++i]
        .split(',')
        .map((s) => Number(s.trim()))
        .filter(Number.isFinite);
    } else if (a === '--out') opts.out = argv[++i];
    else if (a === '--headed') opts.headed = true;
    else if (a === '--width') opts.width = Number(argv[++i]);
    else if (a === '--height') opts.height = Number(argv[++i]);
    else if (a === '--stop-on-lap') opts.stopOnLap = Number(argv[++i]);
    else if (a === '--camera') opts.camera = argv[++i];
    else if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    }
  }
  return opts;
}

function printUsage() {
  console.log(`Modulus Headless-Chrome/CDP Playtest Harness

Usage:
  node scripts/playtest/run.mjs [options]

Options:
  --url <url>             Local dev server URL (default: http://localhost:5173)
  --track <trackId>       Track ID to select before driving (e.g. track_gp_circuit, track_switchyard_sprint)
  --scenario <file.json>  JSON scenario defining scripted keyboard inputs, probes, cornerWindows, etc.
  --ai                    Enable AI Driver and run until lap completion (or --duration)
  --duration <sec>        Max drive duration in seconds
  --probes <p1,p2,...>    Comma-separated spline progress probe points in [0,1)
  --camera <preset>       Camera preset to set after entering drive (cockpit|chase|hood|orbit)
  --stop-on-lap <n>       Stop recording once n laps finish (e.g. 1)
  --out <dir>             Output directory (default: playtest-results/runs/<timestamp>-<track>)
  --headed                Show Chrome window instead of --headless=new
  --width <px>            Viewport width (default: 1280)
  --height <px>           Viewport height (default: 800)
`);
}

function timestampSlug() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}`;
}

async function runScriptedInputs(cdp, actions, outDir, screenshots) {
  const heldKeys = new Set();
  try {
    for (let idx = 0; idx < actions.length; idx++) {
      const act = actions[idx];
      if (act.type === 'keyDown') {
        await cdp.keyDown(act.key);
        heldKeys.add(act.key);
      } else if (act.type === 'keyUp') {
        await cdp.keyUp(act.key);
        heldKeys.delete(act.key);
      } else if (act.type === 'press') {
        await cdp.pressKey(act.key, act.holdMs ?? 100);
      } else if (act.type === 'hold') {
        const keys = Array.isArray(act.keys) ? act.keys : [act.key];
        for (const k of keys) {
          await cdp.keyDown(k);
          heldKeys.add(k);
        }
        await sleep(act.ms ?? 1000);
        for (const k of keys) {
          await cdp.keyUp(k);
          heldKeys.delete(k);
        }
      } else if (act.type === 'wait') {
        await sleep(act.ms ?? 500);
      } else if (act.type === 'screenshot') {
        const name = act.name || `step-${String(idx).padStart(2, '0')}.png`;
        const file = name.endsWith('.png') ? name : `${name}.png`;
        screenshots[name] = await cdp.screenshot(path.join(outDir, file));
      } else if (act.type === 'clickText') {
        const pattern = JSON.stringify(act.pattern);
        await cdp.eval(`(() => {
          const re = new RegExp(${pattern}, 'i');
          const btn = Array.from(document.querySelectorAll('button')).find(b => re.test(b.innerText));
          if (btn) { btn.click(); return true; }
          return false;
        })()`);
      } else if (act.type === 'setAi') {
        const enabled = Boolean(act.enabled);
        await cdp.eval(`(() => {
          const eng = window.__modulusPlaytest?.findEngine();
          if (eng && typeof eng.setAiEnabled === 'function') {
            eng.setAiEnabled(${enabled});
            return true;
          }
          const btn = Array.from(document.querySelectorAll('button')).find(b => /ai driver/i.test(b.innerText));
          if (btn) {
            const isOn = /on/i.test(btn.innerText);
            if (isOn !== ${enabled}) btn.click();
            return true;
          }
          return false;
        })()`);
      } else if (act.type === 'setCamera') {
        const preset = JSON.stringify(act.preset);
        await cdp.eval(`(() => {
          const eng = window.__modulusPlaytest?.findEngine();
          if (eng && typeof eng.setCameraPreset === 'function') {
            eng.setCameraPreset(${preset});
            return true;
          }
          return false;
        })()`);
      }
    }
  } finally {
    for (const k of heldKeys) {
      try {
        await cdp.keyUp(k);
      } catch {
        // ignore
      }
    }
  }
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  let scenario = {};
  if (cli.scenario) {
    scenario = JSON.parse(fs.readFileSync(cli.scenario, 'utf8'));
  }

  const trackId = cli.track ?? scenario.trackId ?? null;
  const aiMode = cli.ai || Boolean(scenario.ai);
  const probes = cli.probes ?? scenario.probes ?? [0.1, 0.25, 0.5, 0.75, 0.9];
  const cornerWindows = scenario.cornerWindows ?? [];
  const traceIntervalMs = scenario.traceIntervalMs ?? 100;
  const stopOnLap = cli.stopOnLap ?? scenario.stopOnLap ?? (aiMode ? 1 : null);
  const maxDurationSec = cli.duration ?? scenario.maxDurationSec ?? (aiMode ? 75 : 20);
  const cameraPreset = cli.camera ?? scenario.camera ?? null;
  const actions = Array.isArray(scenario.actions) ? scenario.actions : [];

  const slugTrack = (trackId || 'default').replace(/[^a-z0-9_-]/gi, '_');
  const outDir = path.resolve(
    cli.out || path.join('playtest-results', 'runs', `${timestampSlug()}-${slugTrack}`)
  );
  fs.mkdirSync(outDir, { recursive: true });

  const { cdp, logs, dispose } = await launchChromeSession({
    width: cli.width,
    height: cli.height,
    headed: cli.headed,
  });

  const screenshots = {};
  const result = {
    meta: {
      timestamp: new Date().toISOString(),
      url: cli.url,
      requestedTrackId: trackId,
      scenario: cli.scenario || null,
      aiMode,
      probes,
      cornerWindows,
      viewport: { width: cli.width, height: cli.height },
      outDir,
    },
    environment: null,
    boot: null,
    trackSelection: null,
    driveEntry: null,
    telemetry: null,
    screenshots,
    errors: logs,
  };

  try {
    // 1. Boot app
    await cdp.send('Page.navigate', { url: cli.url });
    await sleep(3500);

    // Wait for canvas & React mount
    await cdp.eval(`new Promise((resolve) => {
      const start = performance.now();
      function check() {
        if (document.querySelector('canvas') && document.querySelectorAll('button').length > 0) {
          resolve(true);
        } else if (performance.now() - start > 10000) {
          resolve(false);
        } else {
          setTimeout(check, 150);
        }
      }
      check();
    })`);
    await sleep(800);

    // Install in-page harness
    const installRes = await cdp.eval(INSTALL_INPAGE_HARNESS_SCRIPT);

    // Capture WebGL + FPS
    result.environment = await cdp.eval(`(async () => {
      let renderer = null, vendor = null, version = null;
      try {
        const tmp = document.createElement('canvas');
        const gl = tmp.getContext('webgl2') || tmp.getContext('webgl');
        if (gl) {
          version = gl.getParameter(gl.VERSION);
          const dbg = gl.getExtension('WEBGL_debug_renderer_info');
          if (dbg) {
            renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
            vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
          }
        }
      } catch (e) { renderer = 'error: ' + e.message; }
      const fps = await new Promise((resolve) => {
        let frames = 0;
        const t0 = performance.now();
        function tick(now) {
          frames++;
          if (now - t0 >= 800) resolve(Math.round((frames * 1000) / (now - t0)));
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
      return {
        userAgent: navigator.userAgent,
        webglVersion: version,
        webglVendor: vendor,
        webglRenderer: renderer,
        measuredFps: fps,
      };
    })()`);

    result.boot = {
      ...installRes,
      title: await cdp.eval('document.title'),
    };
    screenshots.boot = await cdp.screenshot(path.join(outDir, '01-boot.png'));

    // If a Title screen with "Enter Garage" / "Continue Driving" exists, pass through to Garage first
    const titlePass = await cdp.eval(`(() => {
      const enterBtn = Array.from(document.querySelectorAll('button')).find(b =>
        /enter garage/i.test(b.innerText)
      );
      if (enterBtn) { enterBtn.click(); return 'clicked_enter_garage'; }
      return 'no_title_screen';
    })()`);
    if (titlePass === 'clicked_enter_garage') {
      await sleep(1000);
      screenshots.garage = await cdp.screenshot(path.join(outDir, '01b-garage.png'));
    }

    // 2. Select requested trackId (via engine API so exact IDs always resolve cleanly)
    if (trackId) {
      result.trackSelection = await cdp.eval(`(() => {
        const eng = window.__modulusPlaytest?.findEngine();
        if (!eng || typeof eng.selectTrack !== 'function') {
          return { selected: false, reason: 'engine_not_found' };
        }
        eng.selectTrack(${JSON.stringify(trackId)});
        const active = eng.getActiveTrack?.();
        return {
          selected: active?.id === ${JSON.stringify(trackId)},
          activeTrackId: active?.id ?? null,
          activeTrackName: active?.name ?? null,
        };
      })()`);
      await sleep(800);
    } else {
      result.trackSelection = await cdp.eval(`(() => {
        const eng = window.__modulusPlaytest?.findEngine();
        const active = eng?.getActiveTrack?.();
        return { selected: true, activeTrackId: active?.id ?? null, activeTrackName: active?.name ?? null };
      })()`);
    }

    // 3. Enter Drive mode (click "Drive on Track" / "Drive" / "Start Drive" button, fallback to engine.setVisualMode('track'))
    result.driveEntry = await cdp.eval(`(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const driveBtn =
        btns.find(b => /drive on track|start drive|continue driving/i.test(b.innerText.trim())) ||
        btns.find(b => /^drive now$/i.test(b.innerText.trim()));
      if (driveBtn) {
        driveBtn.click();
        return { method: 'ui_click', buttonText: driveBtn.innerText.trim() };
      }
      const eng = window.__modulusPlaytest?.findEngine();
      if (eng && typeof eng.setVisualMode === 'function') {
        eng.setVisualMode('track');
        return { method: 'engine_api', buttonText: null };
      }
      return { method: 'failed', buttonText: null };
    })()`);
    await sleep(1500);

    // Optional camera preset
    if (cameraPreset) {
      await cdp.eval(`(() => {
        const eng = window.__modulusPlaytest?.findEngine();
        if (eng && typeof eng.setCameraPreset === 'function') {
          eng.setCameraPreset(${JSON.stringify(cameraPreset)});
        }
      })()`);
      await sleep(300);
    }

    // Reset car cleanly right before recording starts
    await cdp.eval(`(() => {
      const eng = window.__modulusPlaytest?.findEngine();
      if (eng && typeof eng.resetVehicleToStart === 'function') {
        eng.resetVehicleToStart();
      }
    })()`);
    await sleep(350);

    screenshots.driveStart = await cdp.screenshot(path.join(outDir, '02-drive-start.png'));

    // Start in-page high-frequency recorder
    await cdp.eval(
      `window.__modulusPlaytest.startRecording(${JSON.stringify({
        probes,
        cornerWindows,
        traceIntervalMs,
      })})`
    );

    // Enable AI if requested
    if (aiMode) {
      await cdp.eval(`(() => {
        const eng = window.__modulusPlaytest?.findEngine();
        if (eng && typeof eng.setAiEnabled === 'function') {
          eng.setAiEnabled(true);
        } else {
          const btn = Array.from(document.querySelectorAll('button')).find(b => /ai driver/i.test(b.innerText));
          if (btn && /off/i.test(btn.innerText)) btn.click();
        }
      })()`);
    }

    // 4. Execute scripted keyboard/input actions if provided
    if (actions.length > 0) {
      await runScriptedInputs(cdp, actions, outDir, screenshots);
    }

    // 5. If waiting for lap completion or duration loop
    if (aiMode || stopOnLap !== null || actions.length === 0) {
      const deadline = Date.now() + maxDurationSec * 1000;
      while (Date.now() < deadline) {
        await sleep(500);
        if (stopOnLap !== null) {
          const lapCount = await cdp.eval(
            `window.__modulusPlaytest.getReport().events.laps.length`
          );
          if (lapCount >= stopOnLap) {
            await sleep(400); // allow lap toast / debrief UI to render
            break;
          }
        }
      }
    }

    screenshots.driveEnd = await cdp.screenshot(path.join(outDir, '03-drive-end.png'));

    // Stop recorder and gather report
    await cdp.eval(`window.__modulusPlaytest.stopRecording()`);
    const report = await cdp.eval(`window.__modulusPlaytest.getReport()`);

    // Write full trace separately to keep summary.json concise and readable
    const tracePath = path.join(outDir, 'trace.json');
    fs.writeFileSync(tracePath, JSON.stringify(report.trace, null, 2));
    delete report.trace;
    report.traceFile = tracePath;

    result.telemetry = report;
  } finally {
    await dispose();
  }

  const summaryPath = path.join(outDir, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(result, null, 2));

  // Print concise machine + human readable summary to stdout
  const unexpectedHttp = result.errors.failedRequests.filter(
    (r) => !(r.status === 401 && r.url.includes('/api/garage'))
  );
  console.log(
    JSON.stringify(
      {
        summaryPath,
        track: result.telemetry?.activeTrack ?? result.trackSelection,
        fps: result.environment?.measuredFps,
        webglRenderer: result.environment?.webglRenderer,
        hud: result.telemetry?.hud,
        laps: result.telemetry?.events?.laps ?? [],
        sectors: result.telemetry?.events?.sectors ?? [],
        probeHits: result.telemetry?.probeHits ?? [],
        cornerSummaries: result.telemetry?.cornerSummaries ?? [],
        screenshots: result.screenshots,
        exceptionsCount: result.errors.exceptions.length,
        consoleErrorsCount: result.errors.consoleErrors.length,
        unexpectedHttpErrors: unexpectedHttp,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error('[playtest] FAILED:', err);
  process.exit(1);
});
