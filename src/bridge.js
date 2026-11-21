// Core operations shared by the MCP tools and the CLI.
import { randomBytes } from 'node:crypto';
import { loadRoster, resolveBot, loadTranscript, loadAllTranscripts } from './cache.js';
import { getWebhook, validateUrl } from './secrets.js';

const POLL_MS = Number(process.env.GROKBOT_POLL_MS) || 2000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Local time with offset, e.g. 2026-11-21T21:41:27+08:00.
export const iso = ms => {
  if (!ms) return null;
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const pad = n => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    + ':' + pad(d.getSeconds()) + (off >= 0 ? '+' : '-') + pad(off / 60) + ':' + pad(off % 60);
};

export function tagFor(requestId) { return '[mcode:' + requestId + ']'; }

export function listBots() {
  return loadRoster().map(b => ({
    name: b.name,
    id: b.id,
    isGroup: b.isGroup,
    unread: b.unread,
    awaitingUserResponse: b.awaitingUserResponse,
    lastActivityAt: iso(b.lastActivityAt),
    webhookConfigured: !!safeWebhook(b),
  }));
}

function safeWebhook(b) { try { return getWebhook(b); } catch { return null; } }

function view(e) {
  return { seq: e.seq, time: iso(e.timestampMs), sender: e.sender, fromBot: e.fromBot, text: e.text };
}

export function readMessages({ bot, count = 10, afterSeq } = {}) {
  const b = resolveBot(bot, loadRoster());
  const n = Math.min(Math.max(Number(count) || 10, 1), 50);
  let { entries, persistedAt } = loadTranscript(b.id, b.name);
  if (afterSeq !== undefined && afterSeq !== null) entries = entries.filter(e => (e.seq ?? 0) > Number(afterSeq));
  const msgs = entries.slice(-n).map(view);
  const cursor = entries.length ? entries[entries.length - 1].seq : (afterSeq ?? null);
  return { bot: b.name, id: b.id, cachedAt: iso(persistedAt), cursor, messages: msgs };
}

export async function postWebhook(hook, body, fetchImpl = fetch) {
  validateUrl(hook.url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  const raw = hook.key.replace(/^bearer /i, '');
  try {
    const res = await fetchImpl(hook.url, {
      method: 'POST',
      redirect: 'error',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + raw, 'x-automation-key': raw },
      body: JSON.stringify(body),
    });
    if (res.status !== 200) {
      const hint = res.status === 401 || res.status === 403 ? ' (check the key, or re-run setup)' : ' (is the routine paused?)';
      throw new Error('Grok Bot webhook returned HTTP ' + res.status + hint);
    }
  } finally { clearTimeout(timer); }
}

// Find the tagged reply in any cached transcript and collect the bot messages that follow it.
export function findReply(requestId, { sinceMs = 0, dir } = {}) {
  const tag = tagFor(requestId);
  for (const t of loadAllTranscripts(dir)) {
    const idx = t.entries.findIndex(e => e.fromBot && e.text.includes(tag) && (e.timestampMs ?? 0) >= sinceMs);
    if (idx < 0) continue;
    const parts = [];
    for (const e of t.entries.slice(idx)) {
      if (!e.fromBot) break; // stop at the next user turn
      parts.push(e);
    }
    return {
      conversation: t.name,
      conversationId: t.agentId,
      replies: parts.map(e => ({ ...view(e), text: e.text.replace(tag, '').trim() })),
    };
  }
  return null;
}

// Wait until the tagged reply exists and no further bot message has arrived for quietSeconds.
export async function waitReply({ requestId, waitSeconds = 120, quietSeconds = 15, sinceMs = 0, signal } = {}) {
  if (!/^[a-z0-9-]{4,64}$/i.test(String(requestId || ''))) throw new Error('invalid request_id');
  const deadline = Date.now() + Math.min(Math.max(Number(waitSeconds) || 0, 0), 900) * 1000;
  const quietMs = Math.min(Math.max(Number(quietSeconds ?? 15), 0), 120) * 1000;
  let lastLen = 0, lastChange = 0;
  for (;;) {
    if (signal?.aborted) throw new Error('cancelled');
    const found = findReply(requestId, { sinceMs });
    if (found) {
      const len = found.replies.length;
      if (len !== lastLen) { lastLen = len; lastChange = Date.now(); }
      if (Date.now() - lastChange >= quietMs) return { requestId, status: 'done', ...found };
    }
    if (Date.now() >= deadline) {
      return found
        ? { requestId, status: 'partial', note: 'The bot may still be adding messages. Call wait_reply again.', ...found }
        : { requestId, status: 'pending', note: 'No tagged reply in the local cache yet. The bot may still be working; call wait_reply later.' };
    }
    await sleep(POLL_MS);
  }
}

export async function ask({ bot, message, waitSeconds = 120, quietSeconds = 15, signal, fetchImpl } = {}) {
  const text = String(message || '').trim();
  if (!text) throw new Error('message is required');
  if (Buffer.byteLength(text) > 16000) throw new Error('message is longer than 16 KB');
  const b = resolveBot(bot, loadRoster());
  const hook = getWebhook(b);
  if (!hook) throw new Error('No webhook is set up for "' + b.name + '". Run: grokbot-bridge setup "' + b.name + '"');
  const requestId = 'm' + randomBytes(5).toString('hex');
  const sinceMs = Date.now() - 5000;
  await postWebhook(hook, { request_id: requestId, reply_tag: tagFor(requestId), source: 'MiniMax Code', message: text }, fetchImpl);
  if (!(Number(waitSeconds) > 0)) {
    return { requestId, bot: b.name, status: 'sent', note: 'Webhook accepted. Use wait_reply with this request_id.' };
  }
  const r = await waitReply({ requestId, waitSeconds, quietSeconds, sinceMs, signal });
  return { bot: b.name, ...r };
}
