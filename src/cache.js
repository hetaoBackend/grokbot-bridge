// Read-only access to the Grok Bot desktop app's local client cache.
// The app persists one JSON blob per state slice under
// ~/Library/Application Support/Grok Bot/sand-client-persistence, with base32-encoded file names.
// We only read the roster and transcript slices; credentials (sand-secrets.json) are never opened.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function persistenceDir() {
  return process.env.GROKBOT_PERSISTENCE_DIR
    || join(homedir(), 'Library', 'Application Support', 'Grok Bot', 'sand-client-persistence');
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Decode(s) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of s.toUpperCase().replace(/=+$/, '')) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = ((value << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out).toString('utf8');
}

export function base32Encode(str) {
  const bytes = Buffer.from(str, 'utf8');
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffff; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out.toLowerCase();
}

// Map of slice name -> absolute path.
function slices(dir = persistenceDir()) {
  let names;
  try { names = readdirSync(dir); } catch (e) {
    throw new Error('Grok Bot cache not found at ' + dir + '. Install Grok Bot and sign in once.');
  }
  const map = new Map();
  for (const f of names) {
    if (!f.endsWith('.blob')) continue;
    try { map.set(base32Decode(f.slice(0, -5)), join(dir, f)); } catch {}
  }
  return map;
}

// The app may be rewriting a blob while we read it; retry a few times on a parse error.
function readJson(path) {
  let last;
  for (let i = 0; i < 4; i++) {
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { last = e; }
    const until = Date.now() + 50; while (Date.now() < until) {}
  }
  throw last;
}

function accountPrefix(map) {
  const slotPath = map.get('sand.client.slice.client-meta.account-slot');
  if (slotPath) {
    const slot = readJson(slotPath).value;
    if (typeof slot === 'string' && slot) return 'sand.client.slice.account.' + encodeURIComponent(slot) + '.';
  }
  for (const k of map.keys()) {
    const m = /^(sand\.client\.slice\.account\.[^.]+\.)roster\.last-roster$/.exec(k);
    if (m) return m[1];
  }
  throw new Error('No signed-in Grok Bot account found in the local cache. Open Grok Bot and sign in.');
}

export function loadRoster(dir) {
  const map = slices(dir);
  const prefix = accountPrefix(map);
  const p = map.get(prefix + 'roster.last-roster');
  if (!p) throw new Error('Grok Bot has not cached its bot list yet. Open the app once.');
  const rows = readJson(p).value?.rows || [];
  return rows
    .filter(r => !r.isRemovedFromSidebar)
    .map(r => ({
      id: r.id,
      name: r.name || r.title || r.id,
      isGroup: !!r.isGroup,
      unread: r.unreadCount || 0,
      awaitingUserResponse: !!r.awaitingUserResponse,
      lastActivityAt: r.lastActivityAt || null,
    }));
}

export function resolveBot(query, roster) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) throw new Error('bot is required');
  const hit = roster.find(b => b.id.toLowerCase() === q)
    || roster.find(b => b.name.toLowerCase() === q);
  if (hit) return hit;
  for (const pred of [b => b.name.toLowerCase().startsWith(q), b => b.name.toLowerCase().includes(q)]) {
    const hits = roster.filter(pred);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new Error('"' + query + '" matches several bots: ' + hits.map(b => b.name).join(', ') + '. Use the full name.');
  }
  throw new Error('No bot named "' + query + '". Available: ' + roster.map(b => b.name).join(', '));
}

// Normalize one transcript entry into {seq, timestampMs, sender, fromBot, kind, text}, or null.
export function normalizeEntry(en, botName) {
  if (!en || typeof en !== 'object') return null;
  const base = { seq: en.seq ?? null, id: en.id, timestampMs: en.timestampMs ?? null, kind: en.kind };
  if (en.kind === 'message') {
    const fromBot = en.role === 'assistant';
    return { ...base, sender: fromBot ? botName : 'You', fromBot, text: String(en.content ?? '') };
  }
  if (en.kind === 'send-message') {
    const m = en.message || {};
    const text = m.type === 'text' ? String(m.content ?? en.text ?? '') : '[' + (m.type || 'item') + ']';
    return { ...base, sender: en.author?.name || botName, fromBot: true, text };
  }
  if (en.kind === 'notice') return { ...base, sender: 'system', fromBot: false, text: String(en.text ?? '') };
  if (en.kind === 'user-attachment') return { ...base, sender: 'You', fromBot: false, text: '[attachment ' + (en.file_name || '') + ']' };
  return null;
}

export function loadTranscript(agentId, botName, dir) {
  const map = slices(dir);
  const prefix = accountPrefix(map);
  const p = map.get(prefix + 'transcript.replicas.' + agentId);
  if (!p) return { entries: [], persistedAt: null };
  const v = readJson(p).value || {};
  const entries = (v.entries || [])
    .map(e => normalizeEntry(e, botName))
    .filter(Boolean)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || (a.timestampMs ?? 0) - (b.timestampMs ?? 0));
  return { entries, persistedAt: v.persistedAt ?? null };
}

// Every cached transcript, as [{agentId, name, entries}]; used to find a tagged reply wherever it landed.
export function loadAllTranscripts(dir) {
  const map = slices(dir);
  const prefix = accountPrefix(map);
  const roster = new Map(loadRoster(dir).map(b => [b.id, b.name]));
  const out = [];
  for (const k of map.keys()) {
    if (!k.startsWith(prefix + 'transcript.replicas.')) continue;
    const id = k.slice((prefix + 'transcript.replicas.').length);
    out.push({ agentId: id, name: roster.get(id) || id, ...loadTranscript(id, roster.get(id) || id, dir) });
  }
  return out;
}
