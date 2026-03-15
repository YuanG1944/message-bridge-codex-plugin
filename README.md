# message-bridge-codex-plugin

Feishu mobile remote console for a Codex host. The bot runs on your computer, talks to the official `codex app-server`, and lets you drive threads, approvals, files, and safe host-control tools from your phone.

## Prerequisites

- Bun `>= 1.3.8`
- A working `codex` CLI on the host machine
- `codex login` already completed on the host machine
- A Feishu custom app with a bot enabled

Optional Linux host tools used by `host-control`:

- screenshots: `gnome-screenshot` or `grim` or ImageMagick `import`
- window listing/focus: `wmctrl`
- clipboard: `wl-paste` and `wl-copy` or `xclip`
- notifications: `notify-send`

macOS host tools use built-in commands such as `open`, `pbcopy`, `pbpaste`, `screencapture`, and `osascript`.

## Quick Start

1. Install dependencies:

```bash
bun install
```

2. Copy the example config and fill in your real values:

```bash
cp bridge.config.example.json bridge.config.local.json
```

3. Edit `bridge.config.local.json`.

4. Start the bridge in dev mode:

```bash
bun run dev
```

5. Add the Feishu bot to a private chat or group and send:

```text
/status
/host status
/help
```

## First-Time Initialization

When you run this project on a new machine for the first time, make sure these are configured before debugging runtime issues:

1. Codex login and CLI:

```bash
codex --version
codex login status
```

2. Local config file:

- Create `bridge.config.local.json` from the example.
- Fill real values for:
  - `feishu.app_id`
  - `feishu.app_secret`
  - `feishu.callback_url`
  - `feishu.verification_token`
  - `feishu.signing_secret`

3. Feishu event/callback mode:

- In Feishu Developer Console, enable long connection receive mode (`ws`) for message events.
- Configure callback URL (HTTPS) for card actions and verification.

4. Codex trusted project (recommended):

- If logs show project `.codex/config.toml` is ignored, mark this repo as trusted in `~/.codex/config.toml`.
- Create project config from the example:

```bash
cp .codex/config.example.toml .codex/config.toml
```

- Add:

```toml
[projects."/absolute/path/to/message-bridge-codex-plugin"]
trust_level = "trusted"
```

5. Start and smoke test:

```bash
bun run dev
```

Then verify in Feishu:

- `/status`
- `/host status`
- `/new`
- A simple prompt like `只回复OK`

## Feishu Setup

This project works best in `ws` mode for message receive events, but it still starts a local callback server for webhook verification and card action callbacks. That means you should configure both:

- WebSocket or long connection event delivery for message events
- A reachable HTTPS callback URL for interactive card callbacks

Recommended setup:

1. Create a Feishu custom app and enable a bot.
2. Enable event subscription for receiving chat messages.
3. Subscribe to `im.message.receive_v1`.
4. Set a callback URL that points to your host, for example `https://your-domain.example`.
5. Put the same verification token and signing secret into `bridge.config.local.json`.
6. Only fill `encrypt_key` if you also enable payload encryption in Feishu.
7. Install the app into the tenant and add the bot to the chat you want to test with.

If your host is not publicly reachable, use a tunnel such as `ngrok`, `frp`, or `cloudflared` and point `callback_url` to the tunnel base URL.

## Config Reference

See [bridge.config.example.json](./bridge.config.example.json). Important fields:

- `feishu.app_id` and `feishu.app_secret`: required
- `feishu.mode`: use `ws` first
- `feishu.port`: local callback server port, default `18080`
- `feishu.callback_url`: public callback base URL; both `/` and `/feishu/webhook` are accepted automatically
- `codex.binary_path`: defaults to `codex`
- `codex.workspace_roots`: allowed roots for `/cwd`
- `codex.allow_free_cwd`: keep `false` unless you really want unrestricted directory switching
- `security.allowed_sender_ids`: leave empty for first local test, then lock it down to your own `open_id`
- `host_control.enabled`: keep `true` to expose safe desktop tools
- `security.enable_host_danger_tools`: keep `false` in normal use

Paths in the config are resolved relative to the config file location.

## Real Test Checklist

After the process starts:

1. Send `/status` to verify the bot can answer.
2. Send `/host status` to verify the host-control provider is working.
3. Send `/workspace` to check workspace profiles are loaded.
4. Ask a simple Codex task like `列出当前仓库结构并说明入口文件`.
5. Upload an image and ask Codex to inspect it.
6. Use `/savefile` and then upload a file to verify file ingestion.
7. Ask Codex to do a task that requires approval and confirm the approval card works.

Useful commands:

- `/new`
- `/threads`
- `/switch <id>`
- `/fork`
- `/compact`
- `/interrupt`
- `/model`
- `/workspace`
- `/cwd`
- `/actions`
- `/run <name>`
- `/approve once`
- `/approve session`
- `/deny`
- `/sendfile <path>`

## Troubleshooting

- `Missing Feishu app_id/app_secret in bridge config.`
  Fill `feishu.app_id` and `feishu.app_secret`.

- `Failed to connect to codex app-server websocket`
  Make sure the `codex` binary is installed, runnable on the host, and already authenticated.

- Text messages arrive but card buttons do nothing
  Your `callback_url` is not publicly reachable or the Feishu callback security settings do not match the local config.

- `/host status` works but screenshots or clipboard fail
  Your OS-specific helper tools are missing. Install the commands listed above.

## Official References

- OpenAI Codex App Server: https://developers.openai.com/codex/app-server
- OpenAI Codex CLI: https://developers.openai.com/codex/cli
- OpenAI Codex SDK: https://developers.openai.com/codex/sdk
- Feishu Open Platform: https://open.feishu.cn/
