// Webhook credentials per bot. Stored in the macOS login keychain (service "grokbot-bridge",
// accounts "url:<agentId>" and "key:<agentId>"), or supplied through the GROKBOT_WEBHOOKS env var
// (JSON {"<bot name or id>": {"url": "...", "key": "..."}}) for MCP clients that keep env secret.
import { execFileSync, spawnSync } from 'node:child_process';

export const SERVICE = 'grokbot-bridge';

function envWebhooks() {
  const raw = process.env.GROKBOT_WEBHOOKS;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('GROKBOT_WEBHOOKS is not valid JSON'); }
}

function keychainGet(account) {
  if (process.env.GROKBOT_DISABLE_KEYCHAIN === '1') return null;
  try {
    return execFileSync('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\n$/, '');
  } catch { return null; }
}

export function getWebhook(bot) {
  const env = envWebhooks();
  const e = env[bot.id] || env[bot.name];
  if (e?.url && e?.key) return { url: e.url, key: e.key, source: 'env' };
  const url = keychainGet('url:' + bot.id);
  const key = keychainGet('key:' + bot.id);
  if (url && key) return { url, key, source: 'keychain' };
  return null;
}

// Values go to "security -i" on stdin, so they never appear in a process argument list.
export function storeWebhook(bot, url, key) {
  for (const v of [url, key]) {
    if (!v || /["\\\r\n]/.test(v)) throw new Error('value must be non-empty and contain no quotes, backslashes or newlines');
  }
  validateUrl(url);
  const cmds = [
    'add-generic-password -U -s ' + SERVICE + ' -a "url:' + bot.id + '" -l "grokbot-bridge ' + bot.id + ' url" -w "' + url + '"',
    'add-generic-password -U -s ' + SERVICE + ' -a "key:' + bot.id + '" -l "grokbot-bridge ' + bot.id + ' key" -w "' + key + '"',
  ].join('\n') + '\n';
  const r = spawnSync('security', ['-i'], { input: cmds, encoding: 'utf8' });
  if (r.status !== 0 || /error|could not/i.test(r.stderr || '')) {
    throw new Error('Could not write to the keychain: ' + (r.stderr || '').trim());
  }
}

export function removeWebhook(bot) {
  for (const a of ['url:' + bot.id, 'key:' + bot.id]) {
    spawnSync('security', ['delete-generic-password', '-s', SERVICE, '-a', a], { stdio: 'ignore' });
  }
}

export function validateUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('webhook URL is not a valid URL'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('webhook URL must use https');
  return u;
}
