# Configuration settings

Config files are JSON, layered in this order, later ones overriding earlier ones: the script's built-in defaults → user config `~/.claude/codex-bridge.json` (change the path with the `CODEX_BRIDGE_CONFIG` environment variable) → project config `<project dir>/.claude/codex-bridge.json`.

The config has three parts:

| Part | What it answers |
|---|---|
| `dispatch` | How the plugin hands off work: whether to do it on its own, parallel runs, time limits, etc. |
| `agents` | Which agents there are and how to reach them |
| `levels` | Who each level of each task type goes to, with which model and effort |

How to reach an agent goes only under `agents`; who gets what goes only under `levels`. Default models are set under `agents` and can be overridden per level under `levels`.

## dispatch

| Setting | What it does | Default |
|---|---|---|
| `auto` | Whether to hand off work on your own (see "Permission" in the skill) | `true` |
| `watch` | `auto`: open the live view after a handoff; `off`: don't open it | `auto` |
| `discuss_max_rounds` | How many rounds one discussion may have (round 1 plus later resumes), counted per participant; the script refuses resumes beyond it | `2` |
| `timeout_min` | Total time limit for one run, in minutes | `480` |
| `stall_min` | How long without activity counts as stuck, in minutes (0 turns it off). Codex: no events and no command running; API agents: no data at all in the stream | `40` |
| `runs_dir` | Run record directory (or the `CODEX_RUNS_DIR` environment variable) | `~/.claude/codex-runs` |

## agents

Each key is an agent's name, which `levels` uses to refer to it. `claude` is reserved. `type` decides which fields are needed.

**`type: "codex"`** (required, exactly one; the built-in one is called `codex`)

| Setting | What it does | Default |
|---|---|---|
| `bin` | Path to the codex executable or `codex.js` (or the `CODEX_BIN` environment variable) | `null`, found automatically |
| `model` | Default model | `null`, use `~/.codex/config.toml` |
| `max_parallel` | How many Codex runs may go at once, counted across all groups and sessions (see "Splitting work to run in parallel" in the skill) | `4` |
| `sandbox` | Sandbox for `run` / `review` / `discuss`: `read-only` / `workspace-write` / `danger-full-access` | All `null` (use Codex config) |
| `approval` | Approval policy, e.g. `never` | `null` (use Codex config) |

**`type: "openai-compatible"`** (models with an OpenAI-compatible API; there can be several; for now they can only take part in discussions)

| Setting | What it does |
|---|---|
| `base_url` | API address, for example `https://api.deepseek.com`; the script calls `<base_url>/chat/completions` |
| `api_key` | The API key itself. Stored in plain text in the config file and takes effect immediately; only allowed in the user config |
| `api_key_env` | Name of the environment variable that holds the API key; after setting the variable, restart Claude Code so it can see it. Set at least one of this and `api_key`; if both are set, `api_key` is used |
| `model` | Default model |
| `max_parallel` | Optional; how many runs may go at once, `4` by default |
| `extra_body` | Optional parameters merged into the request body as is, for example `{ "max_tokens": 65536 }` |

## levels

Three modes, `run` / `review` / `discuss`, each with three levels, `simple` / `normal` / `complex`.

- Each `run` and `review` level: `{ "agent": "<agent>", "model": "<optional>", "effort": "<effort>" }`. A `run` level can also be written as `"claude"` as a whole, meaning Claude does that level itself instead of handing it off.
- Each `discuss` level: an array of participants, one or several, for example `[{ "agent": "codex", "effort": "max" }, { "agent": "deepseek", "effort": "max" }]`. An agent can appear only once per level.
- Leave out `model` to use that agent's default model under `agents`.
- `effort`: for Codex, one of `low` `medium` `high` `xhigh` `max` `ultra`; for API agents it's sent as is as `reasoning_effort` (DeepSeek takes `low` / `high` / `max`), and `null` means don't send it. Use `null` for models with no reasoning effort parameter, such as Xiaomi MiMo (only a thinking on/off switch, on by default). When reporting to the user, describe `null` as "effort: default".
- For now, `run` and `review` can only use the codex agent.

Defaults: run uses `"claude"` for simple and normal and Codex max for complex; review uses Codex medium / high / max; discuss has only Codex at all three levels, with medium / high / max.

## Other rules

- If the user config doesn't exist, the script's first run (any subcommand) creates one: `gpt-6.1-sol` as Codex's default model, and `gpt-6-astra` for complex reviews and discussions.
- A user config in the old layout (`auto_dispatch`, top-level `model`, `sandbox` and so on at the top level) is rewritten into the new layout the first time the script runs, with the original saved as `codex-bridge.json.bak`.
- Project config only accepts `dispatch.timeout_min`, `dispatch.stall_min`, `agents.codex.model` and `levels`. `levels` can contain just the parts to change. Project config **can't add API agents**: an API agent that the user config doesn't have at that level is dropped even if the project config adds it. It can remove them, though, which is how a sensitive project turns API agents off. A project config in the old layout is converted when read; the file isn't rewritten.
- Each agent's parallel limit counts only its own runs in progress, across all groups and sessions; at the limit the script refuses to start a new run, and the error lists the runs holding the slots.
- Everything else (handing off on your own, parallel limits, executable, API address and key, sandbox, approval, run directory) can only be set in the user config, so a cloned repository can't raise its own permissions, send code elsewhere, or spend the user's quota.
- When the sandbox isn't `read-only` / `workspace-write` (for example `danger-full-access`), Codex can write to any directory. `--cwd` only sets where it starts working; **it doesn't limit what it can write**. The scope is then held only by the brief and by reviewing the diff afterwards.
- After the user changes settings, run `config`: `resolved_levels` in the output shows who each level finally goes to, with model and effort, and `agents_status` shows whether each API agent's environment variable is set.
