#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { serve } from './server.js';
import { listBots, readMessages } from './bridge.js';
import { loadRoster, resolveBot, persistenceDir } from './cache.js';
import { storeWebhook, removeWebhook, getWebhook } from './secrets.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const [cmd = 'serve', ...rest] = process.argv.slice(2);

export const ROUTINE_PROMPT = [
  'Create a routine named "MCode inbox" that runs only on a webhook trigger, with no schedule.',
  'Routine instruction: The webhook JSON body is a request from me, sent from MiniMax Code on my computer.',
  'Do body.message as a new request from me, in this chat.',
  'Begin your first reply with body.reply_tag exactly as given (for example [mcode:m1a2b3c4d5]), then answer.',
  'Ask me in this chat before sending, buying, posting or deleting anything.',
].join('\n');

function prompt(question, { hidden = false } = {}) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    if (!stdin.isTTY) {
      let buf = '';
      stdin.setEncoding('utf8');
      const onData = d => {
        buf += d;
        const i = buf.indexOf('\n');
        if (i >= 0) { stdin.off('data', onData); stdin.pause(); resolve(buf.slice(0, i).trim()); }
      };
      stdin.on('data', onData);
      stdin.resume();
      return;
    }
    let value = '';
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    const cleanup = () => { stdin.off('data', onData); stdin.setRawMode(false); stdin.pause(); stdout.write('\n'); };
    const onData = s => {
      for (const ch of s) {
        if (ch === '\r' || ch === '\n') { cleanup(); resolve(value.trim()); return; }
        if (ch === '\u0003') { cleanup(); reject(new Error('cancelled')); return; }
        if (ch === '\u007f' || ch === '\b') { if (value) { value = value.slice(0, -1); if (!hidden) stdout.write('\b \b'); } continue; }
        value += ch;
        if (!hidden) stdout.write(ch);
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  switch (cmd) {
    case 'serve':
      serve({ version });
      return;
    case 'bots': {
      for (const b of listBots()) {
        console.log((b.webhookConfigured ? '● ' : '  ') + b.name + (b.isGroup ? ' (group)' : '')
          + (b.unread ? '  unread ' + b.unread : '') + (b.awaitingUserResponse ? '  waiting on you' : ''));
      }
      console.log('\n● = webhook saved for sending');
      return;
    }
    case 'read': {
      const [bot, count] = rest;
      const r = readMessages({ bot, count: Number(count) || 10 });
      for (const m of r.messages) console.log('[' + m.time + '] ' + m.sender + ': ' + m.text + '\n');
      return;
    }
    case 'routine-prompt':
      console.log(ROUTINE_PROMPT);
      return;
    case 'setup': {
      const b = resolveBot(rest.join(' '), loadRoster());
      console.log('Saving the routine webhook for ' + b.name + '.');
      console.log('Copy both values from ' + b.name + "'s details > Details > MCode inbox > Webhook.\n");
      const url = await prompt('Webhook URL: ');
      const key = await prompt('Webhook key (hidden): ', { hidden: true });
      storeWebhook(b, url, key);
      console.log('Saved to the macOS keychain (service grokbot-bridge) for ' + b.name + '.');
      return;
    }
    case 'remove': {
      const b = resolveBot(rest.join(' '), loadRoster());
      removeWebhook(b);
      console.log('Removed the saved webhook for ' + b.name + '.');
      return;
    }
    case 'doctor': {
      console.log('grokbot-bridge ' + version + ', Node ' + process.version);
      console.log('Cache: ' + persistenceDir());
      const bots = loadRoster();
      console.log('✓ ' + bots.length + ' bots and groups in the local cache');
      const ready = bots.filter(b => getWebhook(b));
      console.log((ready.length ? '✓ ' : '• ') + 'webhooks saved: ' + (ready.map(b => b.name).join(', ') || 'none yet (run: grokbot-bridge setup <bot>)'));
      return;
    }
    case '--version': case '-v':
      console.log(version); return;
    default:
      console.log([
        'grokbot-bridge ' + version + ': talk to Grok Bot Bots from MCP clients without bringing Grok Bot to the front.',
        '',
        '  grokbot-bridge serve           MCP server over stdio (default)',
        '  grokbot-bridge bots            list Bots from the local cache',
        '  grokbot-bridge read <bot> [n]  print the last n messages of a Bot',
        '  grokbot-bridge routine-prompt  print the message that sets up the "MCode inbox" routine',
        '  grokbot-bridge setup <bot>     save that Bot routine webhook in the keychain',
        '  grokbot-bridge remove <bot>    delete the saved webhook',
        '  grokbot-bridge doctor          check the cache and saved webhooks',
      ].join('\n'));
  }
}

main().catch(e => { console.error('Error: ' + (e.message || e)); process.exit(1); });
