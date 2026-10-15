'use strict';
// Native Windows integration tests: real Tauri IPC, child processes and loopback HTTP.
// Requires existing rustc/Playwright/WebView2; never installs or downloads anything.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {spawn, execFileSync} = require('node:child_process');
const {createRequire} = require('node:module');

const root = path.resolve(__dirname, '../..');
assert.equal(process.platform, 'win32', 'This suite verifies Windows process-tree shutdown.');
const tools = process.env.AI_NEXUS_UI_TEST_TOOLS;
assert(tools, 'Set AI_NEXUS_UI_TEST_TOOLS to an already installed Playwright package directory.');
const {chromium} = createRequire(path.join(tools, 'package.json'))('playwright');
const fixtureRoot = path.join(root, '.test-fixtures');
const fixture = path.join(fixtureRoot, 'lifecycle-' + process.pid + '-' + Date.now());
const output = path.join(root, '.build', 'lifecycle');
const resultPath = path.join(output, 'results.json');
const exe = path.join(output, 'ai-nexus-dummy-server.exe');
const appExe = path.resolve(process.env.AI_NEXUS_TEST_APP || path.join(root, '.build/desktop/debug/ai-nexus-dev.exe'));
assert(appExe.startsWith(root + path.sep) && fs.existsSync(appExe), 'Build the separate development app first.');
const appSha256 = digest(appExe);
fs.mkdirSync(fixture, {recursive: true});
fs.mkdirSync(output, {recursive: true});
const eventsFile = path.join(fixture, 'dummy-events.jsonl');
const tests = [];
const skipped = [];
const skipDeadline = process.argv.includes('--skip-deadline');
const sessions = [];
let sentinel;
let finalFailure;
let suiteCompleted = false;
const startedAt = new Date().toISOString();
const hashes = new Map();
for (const name of ['launcher.config.json', 'launcher.config.previous.json']) {
  const p = path.join(root, '.ai-nexus-data', name);
  hashes.set(p, fs.existsSync(p) ? digest(p) : null);
}
const placeholders = ['TEST ONLY - alpha.gguf', 'TEST ONLY - beta.gguf',
  'TEST ONLY - projector.gguf', 'TEST ONLY - draft.gguf'].map(name => path.join(fixture, name));
for (const p of placeholders) fs.writeFileSync(p, 'Plain-text lifecycle fixture. The dummy server never opens this file.\n');
const fileHashes = new Map(placeholders.map(p => [p, digest(p)]));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function digest(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } }
function events() {
  return fs.existsSync(eventsFile) ? fs.readFileSync(eventsFile, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
}
async function until(fn, label, timeout = 10000) {
  const end = Date.now() + timeout;
  do { const value = await fn(); if (value) return value; await sleep(100); } while (Date.now() < end);
  throw Error('Timed out: ' + label);
}
async function test(name, fn, continueAfterFailure = false) {
  const start = Date.now();
  try {
    await fn();
    tests.push({name, passed: true, elapsedMs: Date.now() - start});
    console.log('PASS ' + name);
  } catch (error) {
    tests.push({name, passed: false, elapsedMs: Date.now() - start, error: String(error.stack || error)});
    console.error('FAIL ' + name + ': ' + error.message);
    if (!continueAfterFailure) throw error;
  }
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function request(port, route) {
  const r = await fetch('http://127.0.0.1:' + port + route, {signal: AbortSignal.timeout(2500)});
  assert(r.ok, 'Fixture control request failed: ' + r.status);
  return r.json();
}
async function status(port) { return request(port, '/__fixture/status'); }
async function processGone(pid) { await until(() => !alive(pid), 'owned PID ' + pid + ' exits', 10000); }
async function workersGone(pid) {
  for (const event of events().filter(e => e.kind === 'worker' && e.parent === pid)) await processGone(event.pid);
}
async function processAndWorkersGone(pid) { await processGone(pid); await workersGone(pid); }
async function waitWorker(pid) {
  return until(() => events().find(e => e.kind === 'worker' && e.parent === pid), 'dummy worker starts');
}
function environment(data) {
  return {...process.env, AI_NEXUS_DATA_DIR: data, WEBVIEW2_USER_DATA_FOLDER: path.join(data, 'webview'),
    TEMP: data, TMP: data,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--disable-background-networking --disable-component-update --no-first-run'};
}
function configuration(port) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config/launcher.config.example.json'), 'utf8'));
  cfg.runtime = {...cfg.runtime, binary: exe, backend: 'vulkan', port,
    extra_args: ['--fixture-events', eventsFile, '--fixture-worker']};
  const model = (id, file, mode) => ({
    id, name: 'TEST ONLY - ' + id, file, mmproj: '', draft_file: '',
    contexts: [{id: '8K', name: 'Short fixture', ctx_size: 8192}, {id: '16K', name: 'Long fixture', ctx_size: 16384}],
    default_context: '8K', flags: ['--fixture-mode', mode],
  });
  cfg.models = [
    model('alpha', placeholders[0], 'healthy'),
    model('beta', placeholders[1], 'healthy'),
    model('delayed', placeholders[0], 'healthy'),
    model('health-fail', placeholders[0], 'health-fail'),
    model('wrong-alias', placeholders[0], 'wrong-alias'),
    model('bad-json', placeholders[0], 'bad-json'),
    model('models-error', placeholders[0], 'models-error'),
    model('hold-health', placeholders[0], 'hold-health'),
    model('exit-early', placeholders[0], 'exit-early'),
  ];
  cfg.models.find(m => m.id === 'delayed').flags.push('--fixture-ready-delay-ms', '1800');
  assert(cfg.services && Object.values(cfg.services).every(s => !s.enabled));
  assert.equal(cfg.opencode.enabled, false);
  assert.equal(cfg.monitoring.backend, 'unavailable');
  return cfg;
}
async function session(name, cfg) {
  const data = path.join(fixture, name);
  assert(data.startsWith(fixture + path.sep));
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'launcher.config.json'), JSON.stringify(cfg, null, 2));
  const debug = await freePort();
  const env = environment(data);
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS += ' --remote-debugging-address=127.0.0.1 --remote-debugging-port=' + debug;
  const log = fs.openSync(path.join(data, 'native.log'), 'a');
  const child = spawn(appExe, [], {cwd: root, env, windowsHide: true, stdio: ['ignore', log, log]});
  fs.closeSync(log);
  const s = {child, data, port: cfg.runtime.port, closed: false, errors: [], nonlocalRequests: []};
  s.done = new Promise(resolve => child.on('exit', code => { s.closed = true; resolve(code); }));
  sessions.push(s);
  await until(async () => {
    assert(!s.closed, 'Native fixture exited before WebView2 was ready.');
    try { return (await fetch('http://127.0.0.1:' + debug + '/json/version')).ok; } catch { return false; }
  }, 'native debug endpoint', 20000);
  s.browser = await chromium.connectOverCDP('http://127.0.0.1:' + debug);
  s.context = s.browser.contexts()[0];
  const track = p => {
    p.setDefaultTimeout(10000);
    p.on('pageerror', e => s.errors.push(e.message));
    p.on('request', r => {
      const url = new URL(r.url());
      if (['http:', 'https:'].includes(url.protocol) &&
          !['127.0.0.1', 'localhost', 'tauri.localhost', 'ipc.localhost'].includes(url.hostname) &&
          !s.nonlocalRequests.includes(url.origin)) s.nonlocalRequests.push(url.origin);
    });
  };
  s.context.pages().forEach(track);
  s.context.on('page', track);
  s.main = s.context.pages().find(p => !p.url().includes('window=settings')) || s.context.pages()[0];
  await s.main.waitForFunction(() => window.Backend?.isTauri && document.querySelector('.mcard'));
  await s.main.evaluate(() => {
    const banner = document.createElement('div');
    banner.textContent = 'TEST INSTANCE - DUMMY SERVER ONLY';
    banner.style.cssText = 'position:fixed;top:0;left:30%;z-index:99999;background:#431b1b;color:white;padding:4px 9px;font:12px sans-serif;pointer-events:none';
    document.body.appendChild(banner);
    window.fixtureStarts = {};
  });
  s.invoke = (command, args = {}) => s.main.evaluate(({command, args}) => Backend.invoke(command, args), {command, args});
  s.runtime = () => s.invoke('runtime_status');
  s.start = (id, context = '8K') => s.invoke('start_model', {modelId: id, ctxMode: context, tensorSplit: null});
  s.stop = () => s.invoke('stop_model');
  s.pending = async (key, id, context = '8K') => {
    await s.main.evaluate(({key, id, context}) => {
      const entry = window.fixtureStarts[key] = {done: false, began: Date.now()};
      Backend.startModel(id, context, null).then(value => Object.assign(entry, {done: true, value, elapsedMs: Date.now() - entry.began}),
        error => Object.assign(entry, {done: true, error: String(error), elapsedMs: Date.now() - entry.began}));
    }, {key, id, context});
  };
  s.outcome = async (key, timeout = 10000) => {
    await s.main.waitForFunction(key => window.fixtureStarts[key]?.done, key, {timeout});
    return s.main.evaluate(key => window.fixtureStarts[key], key);
  };
  s.waitStarted = async id => {
    await until(async () => (await s.runtime()).active?.id === id, 'native active entry ' + id);
    const info = await until(async () => {
      try { const info = await status(s.port); return info.alias === id && info; } catch { return false; }
    }, 'dummy listening for ' + id);
    await waitWorker(info.pid);
    return info;
  };
  s.save = async edit => {
    const snapshot = await s.invoke('get_config');
    edit(snapshot.configuration);
    return s.invoke('save_config', {configuration: snapshot.configuration, expectedRevision: snapshot.revision});
  };
  return s;
}
async function checkReady(s, id, ctx = 8192) {
  const r = await s.runtime();
  assert.equal(r.active?.id, id);
  assert.equal(r.active?.phase, 'running');
  assert(Object.values(r.services).every(v => v === 'disabled'));
  const info = await status(s.port);
  assert.equal(info.alias, id);
  assert.equal(info.ctx, ctx);
  await waitWorker(info.pid);
  return info;
}
async function expectRejected(s, id, regex, context = '8K') {
  let error;
  try { await s.start(id, context); } catch (e) { error = String(e); }
  assert(error && regex.test(error), 'Expected ' + regex + ', got ' + error);
}
async function close(s) {
  await s.main.getByRole('button', {name: 'Close AI Nexus', exact: true}).click().catch(e => {
    if (!s.closed && !String(e).includes('closed')) throw e;
  });
  const code = await Promise.race([s.done, sleep(10000).then(() => { throw Error('Native app did not exit.'); })]);
  assert.equal(code, 0);
}
async function forceOwnedCleanup() {
  for (const s of sessions) {
    if (!s.closed && s.main && !s.main.isClosed()) {
      try { await Promise.race([s.invoke('win_close'), sleep(2000)]); } catch {}
      await Promise.race([s.done, sleep(2000)]);
    }
    if (!s.closed && alive(s.child.pid)) cleanupPid(s.child.pid, appExe);
    if (s.browser) await s.browser.close().catch(() => {});
  }
  // Only exact PIDs recorded by this run's freshly built dummy executable.
  for (const e of events().reverse()) if (alive(e.pid)) {
    try { cleanupPid(e.pid, exe); }
    catch (error) { if (alive(e.pid)) throw error; }
  }
  if (sentinel && sentinel.exitCode === null) await Promise.race([
    new Promise(resolve => sentinel.once('exit', resolve)), sleep(1000),
  ]);
}
function cleanupPid(pid, expectedExe) {
  execFileSync('powershell.exe', ['-NoProfile', '-File', path.join(__dirname, 'stop-owned-fixture.ps1'),
    '-TargetPid', String(pid), '-ExpectedExecutable', expectedExe], {
    cwd: root, windowsHide: true, stdio: 'pipe',
  });
}
(async () => {
  let success = false;
  try {
    console.log('Compiling the standard-library-only dummy server with installed rustc (no Cargo/dependency acquisition).');
    execFileSync('rustc', ['--edition=2021', path.join(__dirname, 'dummy-server.rs'), '-o', exe], {
      cwd: root, env: {...process.env, TEMP: fixture, TMP: fixture}, windowsHide: true, stdio: 'pipe',
    });
    const port = await freePort();
    const sentinelPort = await freePort();
    sentinel = spawn(exe, ['--host', '127.0.0.1', '--port', String(sentinelPort),
      '--alias', 'unowned-sentinel', '--fixture-events', eventsFile], {
      cwd: fixture, env: environment(fixture), windowsHide: true, stdio: 'ignore',
    });
    await until(async () => { try { return (await status(sentinelPort)).alias === 'unowned-sentinel'; } catch { return false; } }, 'unowned dummy sentinel');
    const s = await session('normal', configuration(port));
    await test('configuration load starts no backend, service or monitoring helper', async () => {
      assert.equal((await s.runtime()).active, null);
      assert.equal(events().filter(e => e.kind === 'spawn').length, 1);
      assert.equal((await s.invoke('get_config')).configuration.monitoring.backend, 'unavailable');
    });
    await test('startup stays Starting until health and alias are ready', async () => {
      await s.pending('delayed', 'delayed');
      const info = await s.waitStarted('delayed');
      assert.equal((await s.runtime()).active.phase, 'starting');
      assert.equal((await s.outcome('delayed')).value.warning, null);
      await checkReady(s, 'delayed');
      await s.stop(); await processAndWorkersGone(info.pid);
    });
    await test('occupied port is rejected without attaching to or stopping its listener', async () => {
      await s.save(cfg => { cfg.runtime.port = sentinelPort; });
      const before = events().length;
      await expectRejected(s, 'alpha', /Port .*occupied or unavailable/);
      assert.equal((await s.runtime()).active, null);
      assert.equal((await status(sentinelPort)).pid, sentinel.pid);
      assert.equal(events().length, before);
      await s.save(cfg => { cfg.runtime.port = port; });
    });
    await test('missing runtime is rejected before attempting execution', async () => {
      const disposable = path.join(fixture, 'TEST ONLY - disposable runtime.exe');
      fs.copyFileSync(exe, disposable);
      await s.save(cfg => { cfg.runtime.binary = disposable; });
      fs.renameSync(disposable, disposable + '.held');
      try { await expectRejected(s, 'alpha', /existing llama\.cpp executable/); }
      finally { fs.renameSync(disposable + '.held', disposable); }
      assert.equal((await s.runtime()).active, null);
      await s.save(cfg => { cfg.runtime.binary = exe; });
    });
    await test('invalid executable reports spawn failure with no active process', async () => {
      const invalid = path.join(fixture, 'TEST ONLY - invalid executable.exe');
      fs.writeFileSync(invalid, 'Plain-text fixture; not an executable.\n');
      await s.save(cfg => { cfg.runtime.binary = invalid; });
      await expectRejected(s, 'alpha', /spawn failed/i);
      assert.equal((await s.runtime()).active, null);
      await s.save(cfg => { cfg.runtime.binary = exe; });
    });
    await test('entry switching stops the previous backend and its worker before readiness', async () => {
      await s.start('alpha');
      const a = await checkReady(s, 'alpha');
      await s.start('beta');
      const b = await checkReady(s, 'beta');
      assert.notEqual(a.pid, b.pid);
      await processAndWorkersGone(a.pid);
    });
    await test('unknown entry/context, invalid split and missing model leave the running entry alive', async () => {
      const before = await checkReady(s, 'beta');
      await expectRejected(s, 'unknown', /Unknown model entry/);
      await expectRejected(s, 'alpha', /Unknown context profile/, 'missing-context');
      await assert.rejects(s.invoke('start_model', {modelId: 'alpha', ctxMode: '8K', tensorSplit: 'NaN,1'}), /split/i);
      fs.renameSync(placeholders[0], placeholders[0] + '.held');
      try { await expectRejected(s, 'alpha', /Selected model file is unavailable/); }
      finally { fs.renameSync(placeholders[0] + '.held', placeholders[0]); }
      assert.equal((await checkReady(s, 'beta')).pid, before.pid);
    });
    await test('missing projector/draft is rejected without stopping the active entry', async () => {
      await s.save(cfg => { const a = cfg.models.find(m => m.id === 'alpha'); a.mmproj = placeholders[2]; a.draft_file = placeholders[3]; });
      const before = await checkReady(s, 'beta');
      for (const [index, label] of [[2, 'projector'], [3, 'draft']]) {
        fs.renameSync(placeholders[index], placeholders[index] + '.held');
        try { await expectRejected(s, 'alpha', new RegExp('Selected ' + label + ' file is unavailable')); }
        finally { fs.renameSync(placeholders[index] + '.held', placeholders[index]); }
      }
      assert.equal((await checkReady(s, 'beta')).pid, before.pid);
    });
    await test('context switching launches a new owned process with the requested token count', async () => {
      const old = await checkReady(s, 'beta');
      await s.start('beta', '16K');
      await checkReady(s, 'beta', 16384);
      assert.equal((await s.runtime()).active.context, '16K');
      await processAndWorkersGone(old.pid);
    });
    await test('active removal/runtime editing are blocked; stopping permits non-destructive removal', async () => {
      await assert.rejects(s.save(cfg => { cfg.models = cfg.models.filter(m => m.id !== 'beta'); }), /Stop the active model/);
      await assert.rejects(s.save(cfg => { cfg.runtime.port += 1; }), /Stop the active model/);
      const info = await checkReady(s, 'beta', 16384);
      await s.stop(); await processAndWorkersGone(info.pid);
      const saved = (await s.invoke('get_config')).configuration;
      await s.save(cfg => { cfg.models = cfg.models.filter(m => m.id !== 'beta'); });
      assert.equal(digest(placeholders[1]), fileHashes.get(placeholders[1]));
      await s.save(cfg => { cfg.models = saved.models; });
    });
    for (const id of ['health-fail', 'bad-json', 'models-error', 'hold-health']) {
      await test(id + ' never becomes Running and Cancel stops its process tree', async () => {
        await s.pending(id, id);
        const info = await s.waitStarted(id);
        await sleep(id === 'hold-health' ? 1500 : 600);
        assert.equal((await s.runtime()).active.phase, 'starting');
        await s.stop();
        const outcome = await s.outcome(id);
        assert.match(outcome.error, /cancelled/);
        await processAndWorkersGone(info.pid);
        assert.equal((await s.runtime()).active, null);
      });
    }
    await test('dashboard START and CANCEL controls operate the real native dummy process', async () => {
      const card = s.main.locator('.mcard').filter({has: s.main.getByText('TEST ONLY - health-fail', {exact: true})});
      await card.getByRole('button', {name: 'START', exact: true}).click();
      const info = await s.waitStarted('health-fail');
      await card.getByRole('button', {name: 'CANCEL', exact: true}).click();
      await processAndWorkersGone(info.pid);
      await until(async () => !(await s.runtime()).active, 'dashboard cancellation clears native state');
      await until(async () => card.getByRole('button', {name: 'START', exact: true}).isEnabled(), 'dashboard Start is re-enabled');
    });
    await test('switch during startup cancels the old readiness task without stopping the replacement', async () => {
      await s.pending('old-generation', 'hold-health');
      const old = await s.waitStarted('hold-health');
      await s.start('alpha');
      const next = await checkReady(s, 'alpha');
      assert.match((await s.outcome('old-generation')).error, /cancelled/);
      await processAndWorkersGone(old.pid);
      await sleep(1800);
      assert.equal((await checkReady(s, 'alpha')).pid, next.pid);
      await s.stop(); await processAndWorkersGone(next.pid);
    });
    await test('backend exiting during startup returns an error and clears active state', async () => {
      // Repeated attempts keep the real UI/runtime poller active during fast exits.
      for (let attempt = 0; attempt < 5; attempt++) {
        await expectRejected(s, 'exit-early', /Backend exited before becoming ready/);
        assert.equal((await s.runtime()).active, null);
        assert.equal((await status(sentinelPort)).pid, sentinel.pid);
      }
    }, true);
    await test('running health loss is shown as Not ready and can recover', async () => {
      await s.start('alpha');
      const info = await checkReady(s, 'alpha');
      await request(port, '/__fixture/mode/health-fail');
      assert.equal((await s.runtime()).active.phase, 'unhealthy');
      await s.main.getByText('Not ready', {exact: true}).waitFor();
      assert(alive(info.pid));
      await request(port, '/__fixture/mode/healthy');
      await checkReady(s, 'alpha');
      await s.main.locator('.mcard.running .runbadge').filter({hasText: 'Running'}).waitFor();
      await s.stop(); await processAndWorkersGone(info.pid);
    });
    if (!skipDeadline) await test('wrong alias hits the actual 120-second readiness deadline and stops owned processes', async () => {
      await s.pending('deadline', 'wrong-alias');
      const info = await s.waitStarted('wrong-alias');
      const pulse = setInterval(() => console.log('WAIT actual 120-second readiness deadline; only dummy processes running'), 20000);
      let outcome;
      try { outcome = await s.outcome('deadline', 130000); } finally { clearInterval(pulse); }
      assert.match(outcome.error, /readiness failed within 120 seconds/);
      assert(outcome.elapsedMs >= 120000 && outcome.elapsedMs < 130000);
      await processAndWorkersGone(info.pid);
      assert.equal((await s.runtime()).active, null);
      assert.equal((await status(sentinelPort)).pid, sentinel.pid);
    });
    else {
      skipped.push('wrong alias hits the actual 120-second readiness deadline and stops owned processes');
      console.log('SKIP 120-second deadline by explicit flag; use the preceding full-run evidence.');
    }
    let finalOwned;
    await test('closing the actual Settings window keeps the running dummy and dashboard alive', async () => {
      await s.start('alpha');
      finalOwned = await checkReady(s, 'alpha');
      const opened = s.context.waitForEvent('page');
      await s.invoke('open_settings');
      const settings = await opened;
      await settings.waitForFunction(() => window.Backend?.isTauri);
      const destroyed = settings.waitForEvent('close');
      await settings.evaluate(() => Backend.winClose()).catch(() => {});
      await destroyed;
      assert(!s.closed && !s.main.isClosed());
      assert.equal((await checkReady(s, 'alpha')).pid, finalOwned.pid);
    });
    await test('main close exits normally, kills its backend/worker and preserves an unregistered dummy', async () => {
      const opened = s.context.waitForEvent('page');
      await s.invoke('open_settings');
      const settings = await opened;
      await settings.waitForFunction(() => window.Backend?.isTauri);
      const settingsClosed = settings.waitForEvent('close');
      await close(s);
      await settingsClosed;
      await processAndWorkersGone(finalOwned.pid);
      assert.equal((await status(sentinelPort)).pid, sentinel.pid);
      assert.deepEqual(s.errors, []);
      assert.deepEqual(s.nonlocalRequests, []);
    });
    const during = await session('close-during-startup', configuration(await freePort()));
    await test('main close during readiness exits without leaving a backend or worker behind', async () => {
      await during.pending('closing', 'hold-health');
      const info = await during.waitStarted('hold-health');
      await close(during);
      await processAndWorkersGone(info.pid);
      assert.equal((await status(sentinelPort)).pid, sentinel.pid);
      assert.deepEqual(during.errors, []);
      assert.deepEqual(during.nonlocalRequests, []);
    });
    await test('all placeholder files and normal development configuration remain byte-for-byte unchanged', async () => {
      for (const [p, hash] of fileHashes) assert.equal(digest(p), hash);
      for (const [p, hash] of hashes) assert.equal(fs.existsSync(p) ? digest(p) : null, hash);
    });
    const crashed = await session('backend-crash', configuration(await freePort()));
    let crashedWorker;
    await test('unexpected backend exit after readiness clears the active entry', async () => {
      await crashed.start('alpha');
      const info = await checkReady(crashed, 'alpha');
      crashedWorker = await waitWorker(info.pid);
      await request(crashed.port, '/__fixture/quit');
      await processGone(info.pid);
      assert.equal((await crashed.runtime()).active, null);
      await processGone(crashedWorker.pid);
    });
    await test('main shutdown after a backend crash also stops its surviving worker', async () => {
      await close(crashed);
      await processGone(crashedWorker.pid);
    }, true);
    const forced = await session('forced-launcher-exit', configuration(await freePort()));
    await test('forced termination of only the test launcher also cleans its owned backend and worker', async () => {
      await forced.start('alpha');
      const info = await checkReady(forced, 'alpha');
      // Child.kill targets only this test app; it does not taskkill the process tree.
      assert(forced.child.kill(), 'Could not terminate the owned test launcher.');
      await Promise.race([forced.done, sleep(10000).then(() => { throw Error('Test launcher did not terminate.'); })]);
      await processAndWorkersGone(info.pid);
      assert.equal((await status(sentinelPort)).pid, sentinel.pid);
    });
    suiteCompleted = true;
    success = tests.every(t => t.passed);
  } catch (error) {
    finalFailure = String(error.stack || error);
    console.error(finalFailure);
  } finally {
    try { await forceOwnedCleanup(); } catch (error) { finalFailure = (finalFailure || '') + '\nCleanup: ' + error.stack; success = false; }
    const surviving = events().filter(e => alive(e.pid));
    if (surviving.length) { success = false; finalFailure = (finalFailure || '') + '\nFixture processes survived cleanup.'; }
    fs.writeFileSync(resultPath, JSON.stringify({
      startedAt, finishedAt: new Date().toISOString(), passed: tests.filter(t => t.passed).length,
      appExecutable: path.relative(root, appExe), appSha256,
      failed: tests.filter(t => !t.passed).length, completed: suiteCompleted, allPassed: success, tests, skipped, fixture,
      fixtureProcessesRemaining: surviving, error: finalFailure || null,
      evidence: 'Actual native app/Tauri IPC, compiled std-only HTTP dummy, Windows child/worker processes and real 120-second deadline. No mocked backend commands.',
      realInferenceStarted: false, optionalServicesStarted: false, monitoringHelperStarted: false,
      downloads: false, personalLaunchersTouched: false,
    }, null, 2));
    console.log('RESULT ' + tests.filter(t => t.passed).length + ' passed; ' + tests.filter(t => !t.passed).length +
      ' failed; completed=' + suiteCompleted + '; results in .build/lifecycle/results.json');
    if (!success) process.exitCode = 1;
  }
})();
