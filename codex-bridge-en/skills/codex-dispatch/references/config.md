# Configuration settings

Config files are JSON, layered in this order, later ones overriding earlier ones: the script's built-in defaults → user config `~/.claude/codex-bridge.json` (change the path with the `CODEX_BRIDGE_CONFIG` environment variable) → project config `<project dir>/.claude/codex-bridge.json`.

| Setting | What it does | Default |
|---|---|---|
| `auto_dispatch` | Whether to hand off work on your own (see "Permission" in the skill) | `true` |
| `watch` | `auto`: open the live view after a handoff; `off`: don't open it | `auto` |
| `max_parallel` | How many runs in one group may run at once (see "Splitting work to run in parallel" in the skill) | `3` |
| `model` | Model for levels that don't set their own | `null` (use Codex config) |
| `levels` | For each of the `run` / `review` / `discuss` modes, a `{ "model", "effort" }` for each of the `simple` / `normal` / `complex` levels. A `null` `model` uses the top-level `model`; `effort` must be one of `low` `medium` `high` `xhigh` `max` `ultra` | All models `null`; effort medium / high / max for run and review, high / max / max for discuss |
| `sandbox` | Sandbox for each mode: `read-only` / `workspace-write` / `danger-full-access` | All `null` (use Codex config) |
| `approval` | Approval policy, e.g. `never` | `null` (use Codex config) |
| `timeout_min` / `stall_min` | Total time limit / stuck detection, in minutes (`stall_min` 0 turns it off) | 240 / 20 |
| `codex_bin` | Path to the codex executable or `codex.js` (or the `CODEX_BIN` environment variable) | Found automatically |
| `runs_dir` | Run record directory (or the `CODEX_RUNS_DIR` environment variable) | `~/.claude/codex-runs` |

- If the user config doesn't exist, the script's first run (any subcommand) creates one: default model `gpt-6.1-sol`, with `gpt-6-astra` for complex tasks in all three modes.
- Project config only accepts `model`, `levels`, `timeout_min` and `stall_min`. `levels` can contain just the parts to change, such as only `run.complex.model`.
- `auto_dispatch`, `watch`, `max_parallel`, sandbox, approval, executable and run directory can only be set in the user config, so a cloned repository can't raise its own permissions or spend the user's quota.
- When the sandbox isn't `read-only` / `workspace-write` (for example `danger-full-access`), Codex can write to any directory. `--cwd` only sets where it starts working; **it doesn't limit what it can write**. The scope is then held only by the brief and by reviewing the diff afterwards.
