import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'grokbot-bridge-test-'));
process.env.GROKBOT_PERSISTENCE_DIR = dir;
process.env.GROKBOT_POLL_MS = '50';
process.env.GROKBOT_DISABLE_KEYCHAIN = '1';

const { base32Encode, base32Decode } = await import('../src/cache.js');
const bridge = await import('../src/bridge.js');

const ACCT = 'sand.client.slice.account.' + encodeURIComponent('auth0|u1') + '.';
const ROB = '11111111-aaaa-bbbb-cccc-000000000001';
const JEN = '11111111-aaaa-bbbb-cccc-000000000002';
const GRP = '11111111-aaaa-bbbb-cccc-000000000003';
const T0 = Date.now() - 3600_000;

function blob(name, value) {
  writeFileSync(join(dir, base32Encode(name) + '.blob'), JSON.stringify({ schemaVersion: 1, value }));
}
function transcript(id, entries) { blob(ACCT + 'transcript.replicas.' + id, { entries, persistedAt: Date.now() }); }
const userMsg = (seq, text, ts = T0 + seq) => ({ kind: 'message', id: 'u' + seq, role: 'user', content: text, seq, timestampMs: ts, isStreaming: false });
const botMsg = (seq, text, ts = T0 + seq, author) => ({ kind: 'send-message', id: 'b' + seq, message: { type: 'text', content: text }, author, seq, timestampMs: ts });

let robEntries;
before(() => {
  blob('sand.client.slice.client-meta.account-slot', 'auth0|u1');
  blob('sand.client.slice.first-run.device-onboarded', { onboarded: true });
  blob(ACCT + 'roster.last-roster', { rows: [
    { id: ROB, name: 'Rob', unreadCount: 0, awaitingUserResponse: false, lastActivityAt: T0 + 3 },
    { id: JEN, name: 'Jenny', unreadCount: 2, awaitingUserResponse: true, lastActivityAt: T0 + 9 },
    { id: GRP, name: 'Rob, Jenny', isGroup: true, unreadCount: 0, lastActivityAt: T0 },
    { id: 'gone', name: 'Removed', isRemovedFromSidebar: true },
  ] });
  robEntries = [userMsg(1, 'hi Rob'), botMsg(2, 'hello'), { kind: 'event', id: 'e3', seq: 3, timestampMs: T0 + 3, event: { type: 'automation-changed' } },
    botMsg(4, '', T0 + 4), { kind: 'send-message', id: 'w5', seq: 5, timestampMs: T0 + 5, message: { type: 'widget' } }];
  transcript(ROB, robEntries);
  transcript(JEN, [userMsg(1, 'status?'), botMsg(2, 'working on it')]);
  transcript(GRP, [botMsg(1, 'group hello', T0 + 1, { id: JEN, name: 'Jenny' })]);
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('base32 names round-trip like the app writes them', () => {
  const name = 'sand.client.slice.account.auth0%7Cuser_TEST.transcript.replicas.00000000-0000';
  assert.equal(base32Decode(base32Encode(name)), name);
  assert.equal(base32Decode('onqw4zbomnwgszlooqxhg3djmnss4zjsfvzgk43pnr3gkza'), 'sand.client.slice.e2-resolved');
});

test('times are local with an explicit offset and round-trip to the same instant', () => {
  const ms = Date.UTC(2026, 10, 21, 13, 41, 27);
  const s = bridge.iso(ms);
  assert.match(s, /^2026-11-\d\dT\d\d:\d\d:27[+-]\d\d:\d\d$/);
  assert.equal(Date.parse(s), ms);
  assert.equal(bridge.iso(null), null);
});

test('list_bots reads the roster, hides removed rows and marks webhook state', () => {
  process.env.GROKBOT_WEBHOOKS = JSON.stringify({ Jenny: { url: 'https://example.invalid/h', key: 'k' } });
  const bots = bridge.listBots();
  delete process.env.GROKBOT_WEBHOOKS;
  assert.deepEqual(bots.map(b => b.name), ['Rob', 'Jenny', 'Rob, Jenny']);
  const jen = bots.find(b => b.name === 'Jenny');
  assert.equal(jen.unread, 2);
  assert.equal(jen.awaitingUserResponse, true);
  assert.equal(jen.webhookConfigured, true);
  assert.equal(bots.find(b => b.name === 'Rob').webhookConfigured, false);
});

test('read_messages returns the chat oldest first with senders, and after_seq pages forward', () => {
  const r = bridge.readMessages({ bot: 'rob' });
  assert.equal(r.bot, 'Rob');
  assert.deepEqual(r.messages.map(m => [m.sender, m.text]), [['You', 'hi Rob'], ['Rob', 'hello'], ['Rob', ''], ['Rob', '[widget]']]);
  assert.equal(r.cursor, 5);
  assert.deepEqual(bridge.readMessages({ bot: 'Rob', afterSeq: 4 }).messages.map(m => m.text), ['[widget]']);
  assert.deepEqual(bridge.readMessages({ bot: 'Rob', afterSeq: 5 }).messages, []);
  const g = bridge.readMessages({ bot: 'Rob, Jenny' });
  assert.equal(g.messages[0].sender, 'Jenny');
});

test('bot names resolve by exact name, unique prefix or id, and explain ambiguity', () => {
  assert.equal(bridge.readMessages({ bot: 'jen' }).bot, 'Jenny');
  assert.equal(bridge.readMessages({ bot: JEN }).bot, 'Jenny');
  assert.equal(bridge.readMessages({ bot: 'Rob' }).bot, 'Rob'); // exact beats the "Rob, Jenny" prefix
  assert.throws(() => bridge.readMessages({ bot: 'ro' }), /matches several bots: Rob, Rob, Jenny/);
  assert.throws(() => bridge.readMessages({ bot: 'nobody' }), /No bot named "nobody". Available: Rob, Jenny/);
});

// A fake Grok Bot: accepts the webhook, then writes the tagged reply into a cached transcript.
function fakeBot({ status = 200, replyTo = ROB, parts = ['answer part 1', 'answer part 2'], delayMs = 100 } = {}) {
  const calls = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      const json = JSON.parse(body);
      calls.push({ headers: req.headers, body: json });
      res.writeHead(status).end();
      if (status !== 200 || !parts) return;
      setTimeout(() => {
        const now = Date.now();
        const base = replyTo === ROB ? robEntries : [];
        const entries = [...base, userMsg(100, json.message, now)];
        parts.forEach((p, i) => entries.push(botMsg(101 + i, i === 0 ? json.reply_tag + ' ' + p : p, now + i + 1)));
        entries.push(userMsg(200, 'a later unrelated question', now + 50));
        entries.push(botMsg(201, 'unrelated answer', now + 51));
        transcript(replyTo, entries);
      }, delayMs);
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, calls, url: 'http://127.0.0.1:' + server.address().port + '/hook' })));
}

test('ask posts to the Bot webhook and returns the tagged reply without the tag', async () => {
  const bot = await fakeBot();
  process.env.GROKBOT_WEBHOOKS = JSON.stringify({ Rob: { url: bot.url, key: 'secret-key' } });
  try {
    const r = await bridge.ask({ bot: 'Rob', message: 'summarize X', waitSeconds: 5, quietSeconds: 0.3 });
    assert.equal(r.status, 'done');
    assert.equal(r.conversation, 'Rob');
    assert.deepEqual(r.replies.map(x => x.text), ['answer part 1', 'answer part 2']); // stops at the next user turn
    const call = bot.calls[0];
    assert.equal(call.headers.authorization, 'Bearer secret-key');
    assert.equal(call.headers['x-automation-key'], 'secret-key');
    assert.equal(call.body.message, 'summarize X');
    assert.equal(call.body.reply_tag, '[mcode:' + r.requestId + ']');
    assert.equal(call.body.request_id, r.requestId);
  } finally { delete process.env.GROKBOT_WEBHOOKS; bot.server.close(); }
});

test('a slow Bot gives pending, and wait_reply later finds the reply even in another chat', async () => {
  const bot = await fakeBot({ replyTo: GRP, delayMs: 600 });
  process.env.GROKBOT_WEBHOOKS = JSON.stringify({ Rob: { url: bot.url, key: 'k' } });
  try {
    const r = await bridge.ask({ bot: 'Rob', message: 'long task', waitSeconds: 0.2, quietSeconds: 0 });
    assert.equal(r.status, 'pending');
    const w = await bridge.waitReply({ requestId: r.requestId, waitSeconds: 5, quietSeconds: 0.2 });
    assert.equal(w.status, 'done');
    assert.equal(w.conversation, 'Rob, Jenny');
    assert.equal(w.replies[0].text, 'answer part 1');
  } finally { delete process.env.GROKBOT_WEBHOOKS; bot.server.close(); transcript(GRP, [botMsg(1, 'group hello', T0 + 1, { id: JEN, name: 'Jenny' })]); }
});

test('wait_seconds 0 only sends; a stale tag from before the send is ignored', async () => {
  const bot = await fakeBot({ parts: null });
  process.env.GROKBOT_WEBHOOKS = JSON.stringify({ Rob: { url: bot.url, key: 'k' } });
  try {
    const r = await bridge.ask({ bot: 'Rob', message: 'fire and forget', waitSeconds: 0 });
    assert.equal(r.status, 'sent');
    transcript(JEN, [botMsg(1, '[mcode:' + r.requestId + '] too old', T0)]);
    const w = await bridge.waitReply({ requestId: r.requestId, waitSeconds: 0.2, quietSeconds: 0, sinceMs: Date.now() - 60_000 });
    assert.equal(w.status, 'pending');
  } finally { delete process.env.GROKBOT_WEBHOOKS; bot.server.close(); }
});

test('ask explains a missing webhook, a rejected key and an insecure URL', async () => {
  await assert.rejects(bridge.ask({ bot: 'Rob', message: 'x' }), /No webhook is set up for "Rob". Run: grokbot-bridge setup "Rob"/);
  const bot = await fakeBot({ status: 401 });
  process.env.GROKBOT_WEBHOOKS = JSON.stringify({ Rob: { url: bot.url, key: 'bad' } });
  try {
    await assert.rejects(bridge.ask({ bot: 'Rob', message: 'x' }), /HTTP 401 \(check the key/);
  } finally { bot.server.close(); }
  process.env.GROKBOT_WEBHOOKS = JSON.stringify({ Rob: { url: 'http://example.com/hook', key: 'k' } });
  try {
    await assert.rejects(bridge.ask({ bot: 'Rob', message: 'x' }), /must use https/);
    await assert.rejects(bridge.ask({ bot: 'Rob', message: '   ' }), /message is required/);
  } finally { delete process.env.GROKBOT_WEBHOOKS; }
  await assert.rejects(bridge.waitReply({ requestId: 'x; rm -rf' }), /invalid request_id/);
});

function rpc(lines) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [new URL('../src/cli.js', import.meta.url).pathname, 'serve'], { env: process.env });
    let out = '';
    p.stdout.on('data', d => {
      out += d;
      const msgs = out.trim().split('\n').filter(Boolean);
      if (msgs.length >= lines.filter(l => l.id !== undefined).length) { p.kill(); resolve(msgs.map(m => JSON.parse(m))); }
    });
    p.on('error', reject);
    for (const l of lines) p.stdin.write(JSON.stringify(l) + '\n');
    setTimeout(() => { p.kill(); reject(new Error('timeout: ' + out)); }, 5000);
  });
}

test('MCP over stdio: initialize, list the four tools, call them, report errors', async () => {
  const res = await rpc([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_bots', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'read_messages', arguments: { bot: 'nobody' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope', arguments: {} } },
    { jsonrpc: '2.0', id: 6, method: 'bogus' },
  ]);
  const byId = Object.fromEntries(res.map(r => [r.id, r]));
  assert.equal(byId[1].result.serverInfo.name, 'grokbot-bridge');
  assert.equal(byId[1].result.protocolVersion, '2025-06-18');
  assert.deepEqual(byId[2].result.tools.map(t => t.name), ['list_bots', 'read_messages', 'ask', 'wait_reply']);
  assert.equal(JSON.parse(byId[3].result.content[0].text).length, 3);
  assert.equal(byId[4].result.isError, true);
  assert.match(byId[4].result.content[0].text, /No bot named/);
  assert.equal(byId[5].error.code, -32602);
  assert.equal(byId[6].error.code, -32601);
});
