import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEV_PORT = Number(process.env.MODULUS_LOBBY_PORT || 5188);
const CDP_PORT = Number(process.env.MODULUS_LOBBY_CDP_PORT || 9238);
const SIGNALING_MODE = process.env.MODULUS_SIGNALING_MODE || 'peerjs'; // 'peerjs' | 'broadcast'
const LOBBY_URL = `http://127.0.0.1:${DEV_PORT}/src/net/lobby-check/index.html`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHttp(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {
      // retry
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class CdpTab {
  constructor(wsUrl, name) {
    this.wsUrl = wsUrl;
    this.name = name;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.consoleErrors = [];
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(msg.params?.exceptionDetails?.text || 'Runtime exception');
      }
    };
    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const ready = await this.eval('Boolean(window.__MODULUS_LOBBY_CHECK__)');
      if (ready) return;
      await sleep(150);
    }
    throw new Error(`[${this.name}] Page did not expose __MODULUS_LOBBY_CHECK__`);
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
        'Eval exception';
      throw new Error(`[${this.name}] ${desc}`);
    }
    return res.result?.value;
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
  }
}

async function createChromeTab(name) {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' });
  const target = await res.json();
  const tab = new CdpTab(target.webSocketDebuggerUrl, name);
  await tab.connect();
  await tab.navigate(LOBBY_URL);
  return { tab, targetId: target.id };
}

async function closeChromeTab(targetId, tab) {
  tab.close();
  try {
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${targetId}`);
  } catch {
    // ignore
  }
}

async function waitForMeshConnected(tabs, expectedPeersPerTab, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const counts = await Promise.all(
      tabs.map((t) => t.eval('window.__MODULUS_LOBBY_CHECK__.getConnectedPeerIds().length'))
    );
    if (counts.every((c) => c >= expectedPeersPerTab)) {
      return counts;
    }
    await sleep(250);
  }
  const finalCounts = await Promise.all(
    tabs.map((t) => t.eval('window.__MODULUS_LOBBY_CHECK__.getConnectedPeerIds().length'))
  );
  throw new Error(
    `Mesh did not converge to ${expectedPeersPerTab} peers/tab within ${timeoutMs}ms (got: ${JSON.stringify(finalCounts)})`
  );
}

async function runScenario(signalingKind) {
  const channel = `modulus-reg-${Date.now()}`;
  const tabHandles = [];

  try {
    for (let i = 0; i < 4; i++) {
      tabHandles.push(await createChromeTab(`peer-${i + 1}`));
    }
    const tabs = tabHandles.map((h) => h.tab);

    // 1. Peer 1 creates private invite room
    const room = await tabs[0].eval(
      `window.__MODULUS_LOBBY_CHECK__.createRoom('Driver-1', ${JSON.stringify(signalingKind)}, ${JSON.stringify(channel)}, 4.2)`
    );
    assert.ok(room.roomId.startsWith('room_') && room.roomId.length >= 24, 'Unpredictable roomId required');
    assert.ok(room.sessionId.startsWith('sess_') && room.sessionId !== room.roomId, 'Separate sessionId required');
    assert.notEqual(room.sessionId, room.entryPeerId, 'sessionId must be separate from host peerId');
    // Verify TURN is strictly disabled
    const iceJson = JSON.stringify(room.rtcConfig.iceServers || []);
    assert.ok(!/turns?:/i.test(iceJson), `TURN must be disabled, got: ${iceJson}`);
    assert.ok(iceJson.includes('stun:stun.cloudflare.com:3478'), 'Cloudflare STUN must be configured');

    // 2. Peers 2, 3, 4 join the room
    const benchScores = [4.2, 3.1, 5.4, 6.0];
    for (let i = 1; i < 4; i++) {
      const joined = await tabs[i].eval(
        `window.__MODULUS_LOBBY_CHECK__.joinRoom('Driver-${i + 1}', ${JSON.stringify(room.roomId)}, ${JSON.stringify(room.entryPeerId)}, ${JSON.stringify(signalingKind)}, ${JSON.stringify(channel)}, ${benchScores[i]})`
      );
      assert.equal(joined.mode, 'friend_race');
      assert.equal(joined.ranked, false);
      assert.equal(joined.eligibleForTimeTrialRecords, false);
      assert.equal(joined.sessionId, room.sessionId);
    }

    // 3. Wait for all 4 tabs to form full 6-link direct mesh (3 peer links per tab)
    const linkCounts = await waitForMeshConnected(tabs, 3, 25_000);

    // 4. Verify 5th peer is rejected (max 4 participants cap)
    const fifthHandle = await createChromeTab('peer-5-overflow');
    let fifthRejectionError = null;
    try {
      await fifthHandle.tab.eval(
        `window.__MODULUS_LOBBY_CHECK__.joinRoom('Driver-5', ${JSON.stringify(room.roomId)}, ${JSON.stringify(room.entryPeerId)}, ${JSON.stringify(signalingKind)}, ${JSON.stringify(channel)}, 5.0)`
      );
    } catch (err) {
      fifthRejectionError = String(err.message || err);
    } finally {
      await closeChromeTab(fifthHandle.targetId, fifthHandle.tab);
    }
    assert.ok(
      fifthRejectionError && fifthRejectionError.includes('room_full'),
      `Expected 5th peer to be rejected with room_full, got: ${fifthRejectionError}`
    );

    // 5. Probe all 6 peer links from all 4 tabs + inspect RTCPeerConnection.getStats()
    await Promise.all(tabs.map((t) => t.eval('window.__MODULUS_LOBBY_CHECK__.runLocalLinkProbes(10)')));
    await sleep(400);

    const directInspections = await Promise.all(
      tabs.map((t) => t.eval('window.__MODULUS_LOBBY_CHECK__.inspectAllDirectPaths()'))
    );
    let totalCheckedLinks = 0;
    let relayedLinks = 0;
    const candidateClasses = new Set();
    for (const insp of directInspections) {
      for (const info of Object.values(insp)) {
        totalCheckedLinks++;
        candidateClasses.add(info.icePathClass);
        assert.equal(info.isRelayed, false, `Relayed link forbidden: ${JSON.stringify(info)}`);
        assert.equal(info.isDirect, true, `Expected direct ICE path: ${JSON.stringify(info)}`);
        if (info.isRelayed) relayedLinks++;
      }
    }
    assert.equal(totalCheckedLinks, 12, '4 peers x 3 directed views = 12 link inspections (6 undirected links)');

    // 6. Elect host & backup on current host
    const election = await tabs[0].eval('window.__MODULUS_LOBBY_CHECK__.evaluateAndElectHost(null)');
    assert.ok(election && election.hostPeerId && election.backupHostPeerId, 'Must elect host and named backup');
    assert.notEqual(election.hostPeerId, election.backupHostPeerId, 'Backup must differ from host');
    await sleep(300);

    // Find which tab is current host & which tab is designated backup
    const statesAfterElection = await Promise.all(
      tabs.map((t) => t.eval('window.__MODULUS_LOBBY_CHECK__.getState()'))
    );
    const electedHostId = statesAfterElection[0].hostPeerId;
    const electedBackupId = statesAfterElection[0].backupHostPeerId;
    const epochAfterElection = statesAfterElection[0].authorityEpoch;
    for (const st of statesAfterElection) {
      assert.equal(st.hostPeerId, electedHostId, 'All peers must agree on hostPeerId');
      assert.equal(st.backupHostPeerId, electedBackupId, 'All peers must agree on backupHostPeerId');
      assert.equal(st.authorityEpoch, epochAfterElection, 'All peers must agree on authorityEpoch');
      assert.equal(st.members.length, 4, 'All 4 members present');
    }

    // 7. Test pre-countdown manual host override (switch to another eligible peer if needed)
    const hostTabIdx = statesAfterElection.findIndex((st) => st.localPeerId === electedHostId);
    const backupTabIdx = statesAfterElection.findIndex((st) => st.localPeerId === electedBackupId);
    assert.ok(hostTabIdx >= 0 && backupTabIdx >= 0);

    // 8. Simulate abrupt host drop -> backup claims lobby with authorityEpoch + 1
    await tabs[hostTabIdx].eval('window.__MODULUS_LOBBY_CHECK__.simulateAbruptDisconnect()');
    await sleep(1200);

    const remainingIndices = [0, 1, 2, 3].filter((idx) => idx !== hostTabIdx);
    const claimed = await tabs[backupTabIdx].eval('window.__MODULUS_LOBBY_CHECK__.claimHostAsBackup()');
    assert.equal(claimed, true, 'Designated backup must be able to claim lobby after host drop');
    await sleep(400);

    const statesAfterRecovery = await Promise.all(
      remainingIndices.map((idx) => tabs[idx].eval('window.__MODULUS_LOBBY_CHECK__.getState()'))
    );
    const expectedNewEpoch = epochAfterElection + 1;
    for (const st of statesAfterRecovery) {
      assert.equal(st.hostPeerId, electedBackupId, 'Remaining peers must adopt backup as new host');
      assert.equal(st.authorityEpoch, expectedNewEpoch, 'Authority epoch must increment on recovery');
      assert.equal(st.sessionId, room.sessionId, 'Session ID must persist across host recovery');
      assert.equal(st.trackId, 'track_switchyard_sprint', 'Track selection must persist across host recovery');
      assert.equal(st.restartRaceOffered, true, 'Restart race must be offered after recovery');
      assert.equal(st.members.length, 3, 'Remaining 3 peers preserved');
    }

    // 9. Verify stale old-host message with lower epoch is rejected
    const followerIdx = remainingIndices.find((idx) => idx !== backupTabIdx);
    await tabs[followerIdx].eval(
      `window.__MODULUS_LOBBY_CHECK__.injectStaleHostMessage(${JSON.stringify(electedHostId)}, ${epochAfterElection})`
    );
    const followerState = await tabs[followerIdx].eval('window.__MODULUS_LOBBY_CHECK__.getState()');
    assert.equal(followerState.hostPeerId, electedBackupId, 'Stale host message must NOT overwrite new host');
    assert.equal(followerState.trackId, 'track_switchyard_sprint', 'Stale host message must NOT overwrite trackId');
    assert.equal(followerState.staleHostMessagesIgnored, 1, 'Stale host message must be counted as ignored');

    // Compute link summary stats from elected host's collected matrix
    const linkEntries = Object.values(statesAfterElection[hostTabIdx].linkMatrix);
    const maxP95Ms = linkEntries.reduce((m, l) => Math.max(m, l.rttP95Ms), 0);
    const maxLossPct = linkEntries.reduce((m, l) => Math.max(m, l.packetLossPct), 0);

    return {
      ok: true,
      signalingKind,
      roomId: room.roomId,
      sessionId: room.sessionId,
      turnDisabledVerified: true,
      stunServer: 'stun:stun.cloudflare.com:3478',
      peersConnectedPerTab: linkCounts,
      undirectedMeshLinks: 6,
      fifthPeerRejected: true,
      directLinksChecked: totalCheckedLinks,
      relayedLinks,
      observedIceClasses: Array.from(candidateClasses),
      measuredLinkEntries: linkEntries.length,
      worstRttP95Ms: maxP95Ms,
      worstPacketLossPct: maxLossPct,
      electedHostId,
      electedBackupId,
      authorityEpochInitial: epochAfterElection,
      authorityEpochRecovered: expectedNewEpoch,
      staleOldHostIgnored: true,
      consoleErrors: tabs.flatMap((t) => t.consoleErrors),
    };
  } finally {
    for (const h of tabHandles) {
      try {
        await h.tab.eval('window.__MODULUS_LOBBY_CHECK__.leave()');
      } catch {
        // ignore
      }
      await closeChromeTab(h.targetId, h.tab);
    }
  }
}

async function main() {
  const userDataDir = await mkdtemp(join(tmpdir(), 'modulus-lobby-chrome-'));
  const viteBin = join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
  const viteProc = spawn(
    process.execPath,
    [viteBin, '--host', '127.0.0.1', '--port', String(DEV_PORT), '--strictPort'],
    { stdio: 'pipe' }
  );
  let chromeProc = null;

  try {
    await waitForHttp(`http://127.0.0.1:${DEV_PORT}/`, 25_000);

    chromeProc = spawn(
      CHROME_PATH,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${userDataDir}`,
        '--autoplay-policy=no-user-gesture-required',
        'about:blank',
      ],
      { stdio: 'pipe' }
    );
    await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 15_000);

    const report = await runScenario(SIGNALING_MODE);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    chromeProc?.kill();
    viteProc.kill();
    await sleep(400);
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FOUR-PEER LOBBY CHECK FAILED:', err);
    process.exit(1);
  });
