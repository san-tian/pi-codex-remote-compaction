# pi-codex-remote-compaction

Project-local `pi` extension that keeps Codex-style remote compaction on the OpenAI Responses path without changing `pi` core.

## What this repository is
Clone this repository directly into a target project's `.pi/extensions/` directory. Once the folder exists at `.pi/extensions/codex-remote-compaction`, `pi` loads it automatically for that project.

This extension is strict about visibility:
- it tries remote Codex-style compaction first
- if remote compaction fails, it warns and falls back to default `pi` compaction
- debug artifacts are always written to `.tmp/codex-remote-compaction/`

## When it activates
The extension is always loaded after installation, but it only takes over compaction when the active model uses the OpenAI Responses path:
- model `api` is `openai-responses`
- model has a `baseUrl`
- backend supports `POST /responses/compact`

That means it works with:
- OpenAI-compatible backends
- OpenAI relay or proxy services
- OpenAI-compatible middleboxes that expose both `/responses` and `/responses/compact`

If the backend does not support that path, the extension shows a warning and falls back to default `pi` compaction.

## Install for a project
From the target project root:

```bash
mkdir -p .pi/extensions
git clone https://github.com/san-tian/pi-codex-remote-compaction.git .pi/extensions/codex-remote-compaction
```

Notes:
- keep the folder name `codex-remote-compaction`
- no build step is required
- the extension is project-local, not global

## Install for a `pi` agent
If a `pi` agent is reading this README to install the extension, it should do exactly this inside the target project:

```bash
mkdir -p .pi/extensions
if [ -d .pi/extensions/codex-remote-compaction ]; then mv .pi/extensions/codex-remote-compaction .pi/extensions/codex-remote-compaction.bak.$(date +%s); fi
git clone https://github.com/san-tian/pi-codex-remote-compaction.git .pi/extensions/codex-remote-compaction
```

Then verify installation:

```bash
pi -C "$PWD" --no-session -p 'Reply with exactly: extension smoke ok'
```

Optional backend check inside `pi`:

```text
/codex-compact-probe
```

## 给 pi agent 的中文安装指令
如果你是 `pi` agent，并且用户要求你安装这个扩展，请在目标项目根目录执行以下步骤：

```bash
mkdir -p .pi/extensions
if [ -d .pi/extensions/codex-remote-compaction ]; then mv .pi/extensions/codex-remote-compaction .pi/extensions/codex-remote-compaction.bak.$(date +%s); fi
git clone https://github.com/san-tian/pi-codex-remote-compaction.git .pi/extensions/codex-remote-compaction
pi -C "$PWD" --no-session -p 'Reply with exactly: extension smoke ok'
```

如果 smoke test 返回 `extension smoke ok`，说明扩展已经被 `pi` 正常加载。

如果用户还要求确认后端是否支持远程 compaction，可以在 `pi` 里再执行：

```text
/codex-compact-probe
```

如果后端不支持 `/responses/compact`，扩展会给出 warning，然后自动回退到默认 `pi` compaction；这表示远程 compaction 没有生效，但对话仍然可以继续。

## Update an existing install
From the target project root:

```bash
cd .pi/extensions/codex-remote-compaction
git pull --ff-only
```

## Repository layout
- `index.ts`: extension entrypoint and hook wiring
- `src/types.ts`: compaction detail and cached-template types
- `src/state.ts`: session-scoped caches
- `src/wrapper.ts`: AGENTS or CLAUDE wrapper synthesis
- `src/codex-input.ts`: `pi` session history to Codex Responses input conversion
- `src/provider-request.ts`: request-template capture and post-compaction payload override
- `src/remote-client.ts`: `/responses/compact` transport
- `src/debug.ts`: debug artifact persistence
- `tools/proxy.py`: local request logger plus overflow injector
- `tools/verify_auto_compaction.mjs`: SDK harness for forced auto-compaction checks
- `tools/normalize-request.mjs`: request normalizer for parity checks
- `tools/compare_requests.mjs`: normalized diff for Codex vs `pi` request captures
- `fixtures/codex/post-compaction.request.json`: sanitized Codex reference request fixture
- `fixtures/pi/overflow-retry.request.json`: sanitized `pi` overflow retry fixture

## Verification commands
Compare the committed Codex fixture against the committed `pi` overflow fixture:

```bash
node tools/compare_requests.mjs fixtures/codex/post-compaction.request.json fixtures/pi/overflow-retry.request.json
```

Exercise the SDK auto-compaction harness:

```bash
node tools/verify_auto_compaction.mjs --pi-root /path/to/pi-coding-agent --provider <provider-id> --model <model-id>
```

Run the local proxy logger or overflow injector:

```bash
UPSTREAM=https://api.example.com/openai/v1 python3 tools/proxy.py
```

## Fixture privacy
The committed fixtures are intentionally sanitized:
- no real authorization headers
- no local absolute host paths
- no private workspace prompts
- only the normalized request shape needed for parity regression checks

## Current guarantees
- manual post-compaction request parity is verified
- first overflow immediate retry request parity is verified after normalization
- request-shape regressions can be checked against committed fixtures
- remote compaction failures warn and then fall back to default `pi` compaction

## Requirements
- `pi` with project-local extension loading enabled
- a model on the `openai-responses` path
- a backend that supports `/responses` and `/responses/compact`
- Node.js for the maintenance scripts
- Python 3 for `tools/proxy.py`
