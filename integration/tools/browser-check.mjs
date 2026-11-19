import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';

const chromePath = process.argv[2];
assert.ok(chromePath, 'Pass the Chrome executable path.');
const fixtures = [
  { node: 'NODE-BD-01', dosage: 'Tablets', certification: 'WHO-GMP', moq: 50000 },
  { node: 'NODE-GJ-02', dosage: 'Capsules', certification: 'Schedule M', moq: 25000 },
  { node: 'NODE-MH-03', dosage: 'Injectables', certification: 'WHO-GMP', moq: 10000 },
];
const submissions = [];
let html;
const host = createServer(async (req, res) => {
  if (req.url?.startsWith('/?width=')) {
    res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
    return res.end(html);
  }
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/catalog') return res.end(JSON.stringify({ items: fixtures }));
  if (req.url === '/rfq' && req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    submissions.push(JSON.parse(Buffer.concat(chunks).toString()));
    return res.end(JSON.stringify({ ok: true }));
  }
  res.writeHead(204).end();
}).listen(0, '127.0.0.1');
await once(host, 'listening');
const origin = 'http://127.0.0.1:' + host.address().port;
const section = execFileSync(process.execPath,
  [fileURLToPath(new URL('../../commerce/build-section.mjs', import.meta.url)), 'https://fixture.example'],
  { encoding: 'utf8' });
html = '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">' +
  section.replace('https://fixture.example', origin);
const profile = await mkdtemp(join(tmpdir(), 'jollyrx-chrome-'));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
let socket;
try {
  let port;
  for (let attempt = 0; attempt < 80 && !port; attempt++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]; }
    catch { await wait(100); }
  }
  assert.ok(port, 'Chrome debugging port did not start.');
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const pending = new Map();
  const errors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown' ||
        message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.method);
    const callback = pending.get(message.id);
    if (callback) callback(message);
  });
  let id = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(method + ' timed out')); }, 10000);
    pending.set(key, message => {
      clearTimeout(timer);
      pending.delete(key);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    socket.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async expression => {
    for (let step = 0; step < 60; step++) {
      const value = await evaluate(expression);
      if (value) return value;
      await wait(75);
    }
    throw new Error('Condition timed out: ' + expression);
  };
  await send('Runtime.enable');
  for (const [i, width] of [375, 768, 1440].entries()) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: origin + '/?width=' + width });
    await until('location.search === "?width=' + width + '" && document.querySelectorAll(".jrx-card").length === 3');
    assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".jrx-card h3"), h => h.textContent)'), fixtures.map(item => item.node));
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    await evaluate('document.querySelectorAll(".jrx-card button")[' + i + '].click()');
    assert.equal(await evaluate('document.querySelector("dialog").open'), true);
    assert.equal(await evaluate('document.querySelector("input[name=node]").value'), fixtures[i].node);
    assert.equal(await evaluate('document.querySelector("dialog").getBoundingClientRect().width < innerWidth'), true);
    await evaluate('(() => { const f=document.querySelector("[data-rfq]"); f.elements.name.value="Rahul Sharma"; f.elements.email.value="rahul@example.com"; f.elements.quantity.value="75000"; f.requestSubmit(); })()');
    await until('document.querySelector("[data-rfq-status]").textContent.includes("Request received")');
    assert.equal(submissions[i].node, fixtures[i].node);
    assert.equal(submissions[i].quantity, 75000);
    console.log(width + 'px: three cards, no horizontal overflow, modal and fixture RFQ confirmed for ' + fixtures[i].node);
  }
  assert.equal(submissions.length, 3);
  assert.deepEqual(errors, []);
  console.log('Chrome fixture checks passed with no uncaught exceptions or console.error calls.');
} finally {
  socket?.close();
  chrome.kill();
  host.close();
}
