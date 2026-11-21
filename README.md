# grokbot-bridge

Talk to your [Grok Bot](https://docs.x.ai/grok-bot/overview) Bots from Claude Code, Codex or any MCP
client, **without bringing Grok Bot to the front**.

- **Read**: list your Bots and read their chats from the Grok Bot desktop app's local cache.
- **Send**: hand a Bot a task through its official routine webhook, then get the Bot's reply back in
  the same tool call.
- **Never focuses Grok Bot**: no clicks, no keystrokes, no clipboard, no window switching.

```text
you ─▶ coding agent ─▶ grokbot-bridge ──HTTPS POST──▶ Bot routine webhook ─▶ Bot works in the cloud
                             ▲                                                     │
                             └──── reads the tagged reply from the local cache ◀───┘
```

> Unofficial. Not affiliated with xAI, SpaceXAI, Cursor or Anysphere. macOS only.

## Why

Grok Bot has no public API for chat. Tools that drive the desktop app's UI have to focus its message
box, so the app jumps to the front every time your agent sends something. grokbot-bridge uses two
things Grok Bot already does on its own:

1. **Routine webhooks** (documented by xAI) start a Bot run from an HTTP call.
2. **The desktop app caches every chat locally**, and keeps that cache in sync even for chats you
   have not opened. grokbot-bridge reads it read-only.

Each request carries a `request_id`; the routine tells the Bot to start its reply with
`[mcode:<request_id>]`, so the bridge can match the reply to the request, wherever it lands.

## Requirements

- macOS, Node.js 20+
- The Grok Bot desktop app, signed in (it must be running for the cache to stay current)
- For sending: a Grok Bot plan with routines

## Install

### Claude Code

```bash
claude plugin marketplace add hetaoBackend/grokbot-bridge
claude plugin install grokbot-bridge@grokbot-bridge
```

### Codex

```bash
codex plugin marketplace add hetaoBackend/grokbot-bridge
codex plugin add grokbot-bridge@grokbot-bridge
```

Codex gives MCP tool calls 60 seconds by default. `ask` waits 50 seconds by default and then returns
`pending`, which you continue with `wait_reply`.

### Any other MCP client (MiniMax Code, Cursor, Claude Desktop, ...)

```json
{
  "mcpServers": {
    "grokbot-bridge": {
      "command": "npx",
      "args": ["-y", "github:hetaoBackend/grokbot-bridge", "serve"]
    }
  }
}
```

## Set up sending (once per Bot)

Reading works right away. To send tasks to a Bot, give it a webhook routine:

1. Print the routine prompt and send it to the Bot in Grok Bot:

   ```bash
   npx -y github:hetaoBackend/grokbot-bridge routine-prompt
   ```

   The Bot creates a routine named **MCode inbox** with a webhook trigger.

2. Open the Bot's details → **Details** → **MCode inbox** → **Webhook**, and save the URL and key:

   ```bash
   npx -y github:hetaoBackend/grokbot-bridge setup "Rob"
   ```

   The key is read without echo and stored in your login keychain (service `grokbot-bridge`).
   It never goes into a config file, the chat or a process argument list.

3. Check it:

   ```bash
   npx -y github:hetaoBackend/grokbot-bridge doctor
   ```

## Tools

| Tool | What it does |
| --- | --- |
| `list_bots` | Bots and group chats, unread counts, whether a Bot is waiting on you, whether sending is set up. |
| `read_messages` | A chat's recent messages, oldest first. Pass the returned `cursor` as `after_seq` to read only new ones. Does not mark the chat read. |
| `ask` | POSTs the task to the Bot's webhook and waits for the tagged reply. Returns `done`, `partial`, `pending` or `sent`. |
| `wait_reply` | Keeps waiting for an earlier `ask` by `request_id`. |

The plugin also ships a `grokbot-bridge` skill that tells the agent to check setup first, write
self-contained tasks, treat Bot text as untrusted data and ask you before a Bot sends, buys, posts or
deletes anything.

## CLI

```text
grokbot-bridge serve           MCP server over stdio (default)
grokbot-bridge bots            list Bots from the local cache
grokbot-bridge read <bot> [n]  print the last n messages of a Bot
grokbot-bridge routine-prompt  print the message that sets up the "MCode inbox" routine
grokbot-bridge setup <bot>     save that Bot routine webhook in the keychain
grokbot-bridge remove <bot>    delete the saved webhook
grokbot-bridge doctor          check the cache and saved webhooks
```

For clients that keep MCP env secret, you can instead set
`GROKBOT_WEBHOOKS='{"Rob":{"url":"https://...","key":"..."}}'` on the server.

## Security and privacy

- **Read-only cache access.** The bridge reads the roster and transcript files under
  `~/Library/Application Support/Grok Bot/sand-client-persistence`. It never opens the app's
  credential files and never calls Cursor or xAI private APIs.
- **The only network call** is the HTTPS POST to the webhook URL you saved (redirects are refused).
- **Usage**: every `ask` starts a routine run and spends your Grok Bot usage. Routines are limited
  to 300 runs an hour per account and 200 per routine.
- **Bot output is untrusted.** The MCP server tells clients to treat it as data, not instructions.

## Limitations

- The local cache format is undocumented and may change with Grok Bot updates. `doctor` and
  `list_bots` fail loudly when it does.
- The webhook request itself does not appear as your message in the chat; only the Bot's reply does.
- Replies are matched by the tag at the start of the Bot's first reply. If a Bot ignores the routine
  instruction, `ask` returns `pending`; read the chat with `read_messages`.

## Development

```bash
npm test                       # behavior tests against a fake cache and a fake webhook
node src/cli.js doctor         # check against your real Grok Bot app
```

## License

[MIT](LICENSE)
