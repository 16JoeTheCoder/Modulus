import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function findChromeExecutable() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
      : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
        ];

  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error(
    'Could not locate Chrome executable. Set CHROME_PATH environment variable to your Chrome binary.'
  );
}

export function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 9222;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForDevTools(port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const targets = await res.json();
        const page = targets.find((t) => t.type === 'page');
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
    } catch {
      // retry until Chrome opens debugging port
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for Chrome DevTools on port ${port}`);
}

const KEY_DEFS = {
  KeyW: { key: 'w', code: 'KeyW', keyCode: 87 },
  KeyA: { key: 'a', code: 'KeyA', keyCode: 65 },
  KeyS: { key: 's', code: 'KeyS', keyCode: 83 },
  KeyD: { key: 'd', code: 'KeyD', keyCode: 68 },
  KeyC: { key: 'c', code: 'KeyC', keyCode: 67 },
  KeyR: { key: 'r', code: 'KeyR', keyCode: 82 },
  KeyE: { key: 'e', code: 'KeyE', keyCode: 69 },
  KeyQ: { key: 'q', code: 'KeyQ', keyCode: 81 },
  Space: { key: ' ', code: 'Space', keyCode: 32 },
  ShiftLeft: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
  ControlLeft: { key: 'Control', code: 'ControlLeft', keyCode: 17 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
};

export function resolveKeyDef(codeOrName) {
  if (KEY_DEFS[codeOrName]) return KEY_DEFS[codeOrName];
  const upper = codeOrName.toUpperCase();
  if (upper.length === 1 && upper >= 'A' && upper <= 'Z') {
    return { key: upper.toLowerCase(), code: `Key${upper}`, keyCode: upper.charCodeAt(0) };
  }
  return { key: codeOrName, code: codeOrName, keyCode: 0 };
}

export class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        const fns = this.listeners.get(msg.method) || [];
        for (const fn of fns) fn(msg.params);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      const desc =
        res.exceptionDetails.exception?.description ||
        res.exceptionDetails.text ||
        JSON.stringify(res.exceptionDetails);
      throw new Error(`Page eval error: ${desc}`);
    }
    return res.result?.value;
  }

  async screenshot(filePath) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
    return filePath;
  }

  async keyDown(codeOrName) {
    const k = resolveKeyDef(codeOrName);
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      code: k.code,
      key: k.key,
      windowsVirtualKeyCode: k.keyCode,
      nativeVirtualKeyCode: k.keyCode,
    });
  }

  async keyUp(codeOrName) {
    const k = resolveKeyDef(codeOrName);
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      code: k.code,
      key: k.key,
      windowsVirtualKeyCode: k.keyCode,
      nativeVirtualKeyCode: k.keyCode,
    });
  }

  async pressKey(codeOrName, holdMs = 100) {
    await this.keyDown(codeOrName);
    await sleep(holdMs);
    await this.keyUp(codeOrName);
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

export async function launchChromeSession(options = {}) {
  const {
    width = 1280,
    height = 800,
    headed = false,
    chromePath = findChromeExecutable(),
  } = options;

  const port = await findFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modulus-playtest-'));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ];
  if (!headed) {
    args.push('--headless=new');
  }
  args.push('about:blank');

  const proc = spawn(chromePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const wsUrl = await waitForDevTools(port);
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  const cdp = new CdpClient(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const logs = {
    consoleErrors: [],
    consoleWarnings: [],
    exceptions: [],
    failedRequests: [],
  };
  const requestUrls = new Map();

  cdp.on('Runtime.consoleAPICalled', (p) => {
    const text = (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
    if (p.type === 'error') logs.consoleErrors.push(text);
    else if (p.type === 'warning') logs.consoleWarnings.push(text);
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    const desc =
      p.exceptionDetails?.exception?.description ||
      p.exceptionDetails?.text ||
      'Unknown uncaught exception';
    logs.exceptions.push(desc);
  });
  cdp.on('Log.entryAdded', (p) => {
    if (p.entry?.level === 'error') {
      logs.consoleErrors.push(`[BrowserLog] ${p.entry.text}`);
    }
  });
  cdp.on('Network.requestWillBeSent', (p) => {
    requestUrls.set(p.requestId, p.request.url);
  });
  cdp.on('Network.responseReceived', (p) => {
    if (p.response.status >= 400) {
      logs.failedRequests.push({
        url: p.response.url,
        status: p.response.status,
      });
    }
  });
  cdp.on('Network.loadingFailed', (p) => {
    logs.failedRequests.push({
      url: requestUrls.get(p.requestId) || p.requestId,
      errorText: p.errorText,
    });
  });

  async function dispose() {
    cdp.close();
    try {
      proc.kill();
    } catch {
      // ignore
    }
    await sleep(250);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup races on Windows
    }
  }

  return { cdp, logs, dispose };
}
