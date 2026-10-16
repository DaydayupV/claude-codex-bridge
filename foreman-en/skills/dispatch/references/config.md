# Configuration reference

The config is JSON. These layers are applied in order, later ones overriding earlier ones:
1. the script's built-in defaults;
2. the user config `~/.claude/foreman/config.json` (the environment variable `FOREMAN_CONFIG` changes the path);
3. the project config `<project dir>/.claude/foreman.json`.

It has three parts:

| Part | What it answers |
|---|---|
| `dispatch` | How the plugin hands off work: whether to do it on its own, parallel runs, time limits and so on |
| `agents` | Which agents there are and how to reach them |
| `levels` | Who each level of each task type goes to, and with what effort |

How to reach an agent goes only in `agents`; who gets what goes only in `levels`.

Example:

```json
{
  "agents": {
    "gpt-6.1-sol": { "type": "codex cli", "model": "gpt-6.1-sol" },
    "gpt-6-astra": { "type": "codex cli", "model": "gpt-6-astra" },
    "glm-5.3":     { "type": "opencode cli", "model": "opencode-go/glm-5.3" },
    "deepseek-v4-pro": { "type": "api", "base_url": "https://api.deepseek.com", "api_key_env": "DEEPSEEK_API_KEY", "model": "deepseek-v4-pro" }
  },
  "levels": {
    "run":     { "simple": "claude code", "normal": "claude code", "complex": { "agent": "gpt-6.1-sol", "effort": "max" } },
    "review":  { "simple": { "agent": "gpt-6.1-sol", "effort": "medium" }, "normal": { "agent": "gpt-6.1-sol", "effort": "high" }, "complex": { "agent": "gpt-6-astra", "effort": "max" } },
    "discuss": { "simple": "claude code", "normal": [{ "agent": "gpt-6.1-sol", "effort": "high" }], "complex": [{ "agent": "gpt-6-astra", "effort": "max" }, { "agent": "glm-5.3" }, { "agent": "deepseek-v4-pro", "effort": "max" }] }
  }
}
```

## dispatch

| Setting | What it does | Default |
|---|---|---|
| `auto` | Whether to hand off work on its own (see "Permission" in the skill) | `true` |
| `watch` | `auto`: open the live view after a handoff; `off`: don't | `auto` |
| `discuss_max_rounds` | The most rounds one discussion can have (round 1 plus later resumes), counted per participant; the script refuses resumes beyond it | `2` |
| `timeout_min` | Total time limit for one run, in minutes | `480` |
| `stall_min` | How long without activity counts as stuck, in minutes (0 turns it off). Codex: no events and no command running; API: no data at all in the stream; opencode: no events at all | `40` |
| `busy_ask_min` | Once an API agent has been queued this many minutes because its service is busy, Claude decides whether to stop it (0 turns this off) | `2` |
| `runs_dir` | Run directory (or the environment variable `FOREMAN_RUNS_DIR`) | `~/.claude/foreman/runs` |

## agents

- Each key is the agent's **ID**, used by `levels` and `--agent`. Naming it after its model works best.
- IDs may only use letters, digits, `.`, `-` and `_`, must start with a letter or digit, and can't be `claude` or `claude code`.
- `type` decides how it's reached and which settings it takes. There are three types, and you can have several agents of one type, each with a different model.
- Codex isn't required. With no agents at all, Claude does everything itself.

**`type: "codex cli"`** (the Codex CLI on this machine)

| Setting | What it does | Default |
|---|---|---|
| `model` | Model | If not set, uses `~/.codex/config.toml` |
| `bin` | Path to the codex executable or `codex.js` (or the environment variable `CODEX_BIN`) | Found automatically |
| `max_parallel` | How many runs this agent may have going at once, across all groups and sessions (see "Splitting work to run in parallel" in the skill) | `4` |
| `sandbox` | Sandbox for each of `run` / `review` / `discuss`: `read-only` / `workspace-write` / `danger-full-access` | All `null` (use Codex config) |
| `approval` | Approval policy | `never` when not set: runs are unattended, so nobody can approve |

**`type: "opencode cli"`** (the opencode CLI on this machine)

| Setting | What it does |
|---|---|
| `model` | Required, written as `provider/model`, for example `opencode-go/glm-5.3`. Anything `opencode models` lists works |
| `bin` | Optional path to the opencode executable. Found automatically by default |
| `max_parallel` | Optional; `4` by default |

Sign-in and keys are handled by opencode itself (for OpenCode Go, sign in first by running `/connect` in opencode); the plugin doesn't touch them. For discussions and reviews the script gives opencode a read-only agent with only the read, search and list tools: it can look through the project's code itself, but can't run commands or change files. For a review, the script works out the changes with git and attaches them.

**`type: "api"`** (models with an OpenAI-compatible API)

| Setting | What it does |
|---|---|
| `base_url` | API address, for example `https://api.deepseek.com`; the script calls `<base_url>/chat/completions` |
| `api_key` | The API key itself. Stored in plain text in the config file and takes effect immediately; only allowed in the user config. An empty `""` means not filled in yet |
| `api_key_env` | Name of the environment variable that holds the API key; after setting it, restart Claude Code so it can see it. If both are set, `api_key` is used; an agent with neither can't take part in discussions, and listing it in a discussion level fails at run time |
| `model` | Required, the model |
| `max_parallel` | Optional; `4` by default |
| `extra_body` | Optional parameters merged into the request body as is, for example `{ "max_tokens": 65536 }` |

### What each type can do
`agents_status.<ID>.capabilities` in the `config` output lists what each agent can do, and config checks use it: putting an agent at a task it can't do is an error.

| | codex cli | opencode cli | api |
|---|---|---|---|
| Tasks (`modes`) | hands-on work, reviews, discussions | reviews, discussions | discussions |
| Isolation (`isolation`) | OS sandbox (`os`), per the sandbox setting | tool permissions only (`tools`) | none (`none`); text in and out only |
| Reads code itself (`reads_code`) | yes | yes | no; relies on attached files |
| Native report format (`native_schema`) | yes | no; prompt plus one repair | no; same |
| Native review (`native_review`) | yes | no | no |
| Images (`images`) | yes | no | no |

## levels

Three task types, `run` / `review` / `discuss`, each with three levels, `simple` / `normal` / `complex`. Each level can be:
- `"claude code"`: Claude does hands-on work itself; for reviews and discussions, that level uses no outside agent. All three task types accept it.
- `run` and `review`: `{ "agent": "<ID>", "effort": "<effort>" }`.
- `discuss`: an array of participants, one or more, for example `[{ "agent": "gpt-6-astra", "effort": "max" }, { "agent": "deepseek-v4-pro", "effort": "max" }]`. Each agent can appear only once per level.

`effort` can be left out, which means the tool's or model's own default. What it takes depends on the type:
- `codex cli`: `low`, `medium`, `high`, `xhigh`, `max`, `ultra`.
- `api`: sent as is as `reasoning_effort` (DeepSeek takes `low` / `high` / `max`), and `null` means don't send it. Use `null` for models with no reasoning effort parameter, such as Xiaomi MiMo (only a thinking on/off switch, on by default).
- `opencode cli`: the model's variant (for example `high`), passed to opencode as `-m model#variant`; `null` means the model's default. Each model has its own variants, and opencode reports an error for a wrong one.

When reporting to the user, describe a missing or `null` effort as "effort: default".

A level can also set `model` to override the agent's model; old configs that do this still work. It isn't recommended for new configs, because the ID and the model actually used drift apart. To use another model, add another agent.

Built-in defaults: no agents, and all nine levels are `"claude code"`. The real setup comes from the config generated on first run (below).

## The config generated on first run
When there's no user config, the first run of the script (any subcommand) checks the machine before generating one. The `environment` field in the `config` output shows what it finds. It checks three things:
- whether a usable Codex exists: it starts and is signed in;
- whether opencode exists: it starts, and how many models `opencode models` lists;
- common API key environment variables: `DEEPSEEK_API_KEY`, `KIMI_API_KEY` / `MOONSHOT_API_KEY`, `MIMO_API_KEY`.

What gets generated:

| Found | What's generated |
|---|---|
| A usable Codex | Two `codex cli` agents, `gpt-6.1-sol` and `gpt-6-astra`. Hands-on work: Claude does simple and normal, complex goes to gpt-6.1-sol at max. Reviews: gpt-6.1-sol medium / high, complex on gpt-6-astra at max. Discussions: gpt-6.1-sol medium / high, complex on gpt-6-astra at max |
| No usable Codex | All nine levels are `"claude code"` |
| API keys | One `api` agent per provider, with `api_key_env` pointing at the variable found and the model name as its ID, **not added to any level** |
| opencode | Nothing added; `/foreman-en:setup` helps the user pick a model |

Choices that cost money or affect safety (which opencode model to use, letting API models join discussions) are never made automatically; `/foreman-en:setup` asks the user. Running setup again later picks up newly installed tools.

## Upgrading an old config
- When upgrading from codex-bridge, the old `~/.claude/codex-bridge.json` is copied to the new location first.
- The first time the script reads the old format, it rewrites the config file and backs up the original as `config.json.bak`:
  - `type`: `codex` → `codex cli`, `opencode` → `opencode cli`, `openai-compatible` → `api`;
  - `"claude"` in the levels → `"claude code"`;
  - agent IDs are renamed after their models, for example `codex` → `gpt-6-astra` and `deepseek` → `deepseek-flash`, and references in `levels` are updated too;
  - a level that overrode the model is split out into its own agent.
- The model and effort each level actually uses stay the same.
- The old-to-new ID mapping is kept in `~/.claude/foreman/agent-aliases.json`. Resuming an old run, an old ID passed to `--agent`, and old IDs in a project config are all mapped to the new ID automatically.
- Older formats from before 0.10, such as `auto_dispatch` or top-level `model` and `sandbox`, are converted as well.

## Project config: can only tighten
- A project config only accepts `dispatch.timeout_min`, `dispatch.stall_min`, `dispatch.busy_ask_min` and `levels`. Anything else, including the whole `agents` block, is ignored with a notice.
- `levels` can contain just the cells to change. Each cell can only:
  - become `"claude code"`;
  - for `run` / `review`, keep the same agent as the user config's cell, optionally with a different effort;
  - for `discuss`, keep some of the user config's participants for that cell, optionally with different efforts.
- Any other agent, or a model override, is ignored.
- This way a cloned repository can't use its project config to swap the agent doing the work (say, from a sandboxed Codex to a tool without a sandbox), send your code to a new provider, or spend your quota on its own. For a sensitive project, keep only Codex in discussions, or set them to `"claude code"`.

## Other rules
- Each agent's parallel limit counts its own running runs across all groups and sessions; at the limit, the script refuses new runs and lists the runs holding the slots.
- When the sandbox isn't `read-only` / `workspace-write` (for example `danger-full-access`), Codex can write to any directory: `--cwd` only sets where it starts and **doesn't limit what it can write**. The scope is then held only by the brief and by reviewing the diff afterwards.
- After the user changes settings, run `config` to confirm:
  - `resolved_levels` shows who each level finally goes to, with model and effort;
  - `agents_status` shows each agent's type and capabilities, whether its key is set, and the executable it uses.
