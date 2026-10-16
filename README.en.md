# claude-codex-bridge

[中文](README.md)

A Claude Code plugin that lets Claude hand off hands-on coding work to OpenAI Codex and then check the result. Claude can also ask Codex for an independent code review, or have Codex and other models (such as DeepSeek, or any model you can reach through opencode) weigh in on a complex design before Claude decides.

The idea is a split of roles: Claude does the planning, key decisions, design and writing; Codex does the rest of the hands-on work. Codex runs on your own OpenAI plan or API key, so it doesn't use your Claude quota.

## What it does

| Command | What it does |
|---|---|
| `/codex-bridge-en:rescue <task>` | Hands a task to Codex. When it finishes, Claude reviews the diff, runs it to verify, and sends it back for rework if needed |
| `/codex-bridge-en:discuss <topic>` | Discusses a complex design with Codex (and any other configured models): rounds of critiquing each other's proposals (the limit is configurable, 2 by default), then Claude rules on each point and writes up a decision record |
| `/codex-bridge-en:review` | Has Codex review uncommitted changes, a branch or a commit. Claude checks each finding and filters out false positives |
| `/codex-bridge-en:status` | Lists recent runs, or shows the details of one, with each run's token use, the size of its latest request and how much of the Codex quota is used |
| `/codex-bridge-en:watch` | Shows what each model is doing, live. The default view is a timeline: times down the left, with what the model says, folded commands and file changes in order, a bottom line that keeps showing elapsed time, command count and progress, and the result at the end; while the run is going the view re-flows when the window is resized, and you can scroll back with the arrow keys, PgUp/PgDn or the mouse wheel; add `--verbose` for every detail. When following a group (such as a discussion with several models), one window is split into a block per model, with its status and elapsed time on the right of each block's title line and its latest few lines below |
| `/codex-bridge-en:config` | Shows or changes the plugin's settings |
| `/codex-bridge-en:setup` | First-time setup: checks that Codex and the rest of the environment work, explains the current settings, and optionally adds other models to discussions |

You don't have to use the commands. The bundled skill lets Claude decide on its own: hand off hands-on tasks that are big enough, discuss complex and uncertain designs with Codex and other models first, and ask Codex to review risky changes before delivering them. When a big task splits into parts that don't touch each other, Claude hands them to several Codex sessions at once to cut the wait (see `agents.<name>.max_parallel` below). You can turn this off with `dispatch.auto` (see below). So that Claude doesn't forget (easy when a project has its own skills), the plugin reminds it once at the start of every session and includes your preference files.

Every time Claude hands something off, it tells you in the chat who got it and which model and reasoning effort it is using.

## Requirements

- [Claude Code](https://claude.com/claude-code)
- [Codex CLI](https://github.com/openai/codex), installed and signed in (required). If `codex exec "hello"` gets a reply in your terminal, you're set
- Node.js 18 or later. If you run Claude Code inside WSL, Node.js must be installed inside WSL too, or the plugin's hooks will error before every command
- Git 2.25 or later (used to track which files Codex changed)
- Optional: to have other models join discussions, an API key from that provider (for example DeepSeek), or [opencode](https://opencode.ai) 2.x installed

## Install

In Claude Code, run:

```
/plugin marketplace add DaydayupV/claude-codex-bridge
/plugin install codex-bridge-en@claude-codex-bridge
```

Then run `/codex-bridge-en:setup`. It checks that Node.js, Git and Codex work, explains who gets each kind of task by default, and asks whether you want other models to join discussions. Later, use `/codex-bridge-en:config` to see or change the settings.

## Configuration

On first use, the plugin creates a user config at `~/.claude/codex-bridge.json`: Claude does simple and normal hands-on tasks itself, complex ones go to Codex with `gpt-6.1-sol`, and complex reviews and discussions use `gpt-6-astra`. It doesn't set the sandbox or approval policy; those still come from Codex's own `~/.codex/config.toml`.

To change things, edit that file, or tell Claude something like "use `/codex-bridge-en:config` to switch complex tasks to ultra".

Config files are JSON. Later ones override earlier ones:

1. The plugin's built-in defaults
2. User config: `~/.claude/codex-bridge.json` (change the path with the `CODEX_BRIDGE_CONFIG` environment variable)
3. Project config: `<project>/.claude/codex-bridge.json`

When you upgrade from a version before 0.10, a user config in the old layout is rewritten into the layout below on first run, and the original is saved as `codex-bridge.json.bak`.

### How the config is laid out

The config has three parts:

| Part | What it covers |
|---|---|
| `dispatch` | How the plugin hands off work: whether to do it on its own, the live view, parallel runs, discussion rounds, time limits, the run directory |
| `agents` | Which agents there are and how to reach them: Codex's executable, default model and sandbox; an API model's address, its API key (written in the config, or the environment variable holding it), and its default model; the model name for models called through opencode |
| `levels` | Who each level of each task type goes to, with which model and reasoning effort |

How to reach an agent goes only under `agents`; who gets what goes only under `levels`. Here's the config generated on first use:

```json
{
  "dispatch": {
    "auto": true,
    "watch": "auto",
    "discuss_max_rounds": 2,
    "timeout_min": 480,
    "stall_min": 40,
    "busy_ask_min": 2,
    "runs_dir": null
  },
  "agents": {
    "codex": {
      "type": "codex",
      "bin": null,
      "model": "gpt-6.1-sol",
      "max_parallel": 4,
      "sandbox": { "run": null, "review": null, "discuss": null },
      "approval": null
    },
    "deepseek": {
      "type": "openai-compatible",
      "base_url": "https://api.deepseek.com",
      "api_key": "",
      "model": "deepseek-v4-pro"
    },
    "mimo": {
      "type": "openai-compatible",
      "base_url": "https://api.xiaomimimo.com/v1",
      "api_key": "",
      "model": "mimo-v2.6-pro"
    }
  },
  "levels": {
    "run": {
      "simple":  "claude",
      "normal":  "claude",
      "complex": { "agent": "codex", "effort": "max" }
    },
    "review": {
      "simple":  { "agent": "codex", "effort": "medium" },
      "normal":  { "agent": "codex", "effort": "high" },
      "complex": { "agent": "codex", "model": "gpt-6-astra", "effort": "max" }
    },
    "discuss": {
      "simple":  [{ "agent": "codex", "effort": "medium" }],
      "normal":  [{ "agent": "codex", "effort": "high" }],
      "complex": [{ "agent": "codex", "model": "gpt-6-astra", "effort": "max" }]
    }
  }
}
```

`deepseek` and `mimo` are examples: their `api_key` is empty and they aren't in any discussion level, so discussions have only Codex by default. To have them join, see "Adding other models to discussions" below.

### Task levels, models and reasoning effort

Claude only decides which level a task is: `simple`, `normal` or `complex`. The level depends on how much judgment a task needs and how costly a mistake would be, not on how much it changes: mechanically changing 20 files from a list is simple; changing the interfaces between modules is complex. You decide in `levels` who gets each level (Claude itself included) and which model and reasoning effort it uses. There are no hidden defaults: Claude must give a level every time, and the script refuses to start without one instead of quietly picking an effort.

- Each level names an `agent` (which entry under `agents` gets it) and an `effort`; add `model` when you want to override that agent's default model. Without `model`, the agent's default model under `agents` is used; if Codex's default model is `null` too, Codex's own configured model is used. This is just one possible setup; pick models your account has and that suit your tasks.
- Codex's `effort` can be `low`, `medium`, `high`, `xhigh`, `max` or `ultra`. If a model doesn't support an effort, Codex rejects it and the error shows up in the result.
- To override for one task, tell Claude "run it with ultra" or "use model X"; Claude will pass `--effort` or `--model` instead.
- To have Claude do a `run` level itself instead of handing it to Codex, write the whole level as `"claude"`, for example `"simple": "claude"`. That level then has no model or effort to set: Claude does its tasks itself, and the script refuses to hand them off. If you explicitly want a task handed to Codex, Claude adds `--agent codex`, which uses Codex's default model, and the effort uses the built-in default. Reviews and discussions need a second model, so this isn't supported there.
- Small tasks follow the levels too: a small change with a clear approach is `simple`. In the default config Claude does `simple` itself; if you give `simple` to Codex, even very small changes get handed off.

### Adding other models to discussions

Each `discuss` level is a list of participants: Codex alone, or Codex plus models with an OpenAI-compatible API. They give their views independently and at the same time, and Claude rules on each point. Taking the DeepSeek example from the config above:

1. **Provide the API key**, either way:
   - **In the config file**: fill in the example's `"api_key": ""`. It takes effect immediately, no restart needed:

     ```json
     "deepseek": {
       "type": "openai-compatible",
       "base_url": "https://api.deepseek.com",
       "api_key": "sk-your-key",
       "model": "deepseek-v4-pro"
     }
     ```

     The key is stored in plain text, so don't commit or share this file.
   - **In an environment variable**: leave `api_key` empty, add a line `"api_key_env": "DEEPSEEK_API_KEY"`, then set that variable. On Windows, add a user variable under "System Properties → Environment Variables"; on macOS and Linux, put it in your shell's startup file. Restart Claude Code afterwards so it can see it.

   If both are set, `api_key` is used.
2. **Add it to discussion levels**: add it to the levels you want under `levels.discuss`. For example, to add a participant to complex discussions only:

   ```json
   "discuss": {
     "simple":  [{ "agent": "codex", "effort": "medium" }],
     "normal":  [{ "agent": "codex", "effort": "high" }],
     "complex": [
       { "agent": "codex", "model": "gpt-6-astra", "effort": "max" },
       { "agent": "deepseek", "effort": "max" }
     ]
   }
   ```

   DeepSeek's `effort` can be `low`, `high` or `max`. Xiaomi MiMo has no adjustable effort, only a thinking on/off switch (on by default), so write `{ "agent": "mimo", "effort": null }`.
3. Run `/codex-bridge-en:setup` to check that the model connects and that each level has the right participants.

For providers without an example in the config (Kimi, GLM, Qwen, OpenRouter and so on), as long as they have an OpenAI-compatible API, add an agent under `agents` in the same format as the examples, with a name of your choice, then follow the steps above; provider-specific parameters go in `extra_body` and are merged into the request as is. You can also leave these steps to `/codex-bridge-en:setup`, for example `/codex-bridge-en:setup add DeepSeek`: it updates the config for you and tells you where the key goes. You fill in the key yourself; there's no need to paste it into the chat.

API models can't look through your code themselves, so Claude sends the relevant files along with the topic (up to about 300,000 characters each time) and checks what they say about the code against the source. For now, API models can only take part in discussions, not do hands-on work or reviews.

### More models through opencode

If you have [opencode](https://opencode.ai) (2.x) installed, any model it can use can join discussions, for example GLM, Kimi, Qwen, MiniMax or DeepSeek from an [OpenCode Go](https://opencode.ai/docs/go/) subscription. Unlike API models, they read your project's code and search files themselves, so Claude doesn't have to pick files to send; the trade-off is that every file they read is another request, which uses more quota.

1. **Sign in inside opencode**: run `opencode` in a terminal and sign in with `/connect` (choose OpenCode Go for a Go subscription), then run `opencode models` to see which models you can use. Free models (names ending in `-free`) need no sign-in.
2. **Add them to the config**: add one entry per model under `agents`, with a name of your choice, then add it to the discussion levels you want:

   ```json
   "agents": {
     "glm":  { "type": "opencode", "model": "opencode-go/glm-5.3" },
     "kimi": { "type": "opencode", "model": "opencode-go/kimi-k3" }
   },
   "levels": {
     "discuss": {
       "complex": [
         { "agent": "codex", "model": "gpt-6-astra", "effort": "max" },
         { "agent": "glm",  "effort": null },
         { "agent": "kimi", "effort": null }
       ]
     }
   }
   ```

   `effort` is opencode's variant (for example `high`); `null` means the model's default. Each model has its own variants.
3. Run `/codex-bridge-en:setup` to confirm each model works.

For discussions the plugin gives opencode a read-only agent with only the read, search and list tools: it can't run commands or change files. Keys and sign-in stay in opencode; the plugin's config file holds none. Results include this round's cost (`cost_usd`), which is what OpenCode Go quota is charged by. Go's limits are per model, so several models in one discussion spread the load; premium models have small limits, so keep them for complex discussions.

### All settings

| Setting | What it does | Default |
|---|---|---|
| `dispatch.auto` | `true`: Claude hands suitable tasks to Codex on its own. `false`: Claude suggests it first and waits for your OK | `true` |
| `dispatch.watch` | `auto`: open the live view after each handoff. `off`: don't open it | `auto` |
| `dispatch.discuss_max_rounds` | How many rounds one discussion may have (round 1 plus later resumes), counted per participant. Once reached, the script refuses further resumes and Claude rules on what it has | `2` |
| `dispatch.timeout_min` | Total time limit per run, in minutes | `480` |
| `dispatch.stall_min` | Stop a run after this many minutes without activity: for Codex, no activity and no command running; for API models, no data at all in the stream. `0` turns it off | `40` |
| `dispatch.busy_ask_min` | Once an API model has been queued this many minutes because its service is busy, Claude asks whether to stop it and go ahead with the other participants' results. `0` means never ask | `2` |
| `dispatch.runs_dir` | Where run records go (or set `CODEX_RUNS_DIR`) | `~/.claude/codex-runs` |
| `agents.codex.bin` | Path to the codex executable or `codex.js` (or set `CODEX_BIN`) | Found automatically |
| `agents.codex.model` | Codex's default model | `null` (use Codex config) |
| `agents.<name>.max_parallel` | How many runs this agent may have going at once, counted across all groups and sessions (providers rate-limit and bill per account). New runs beyond it are refused. For Codex, splitting a task into more parts means a shorter wait but more tokens in total; `1` turns parallel runs off | `4` |
| `agents.codex.sandbox` | Sandbox for each of `run` / `review` / `discuss`: `read-only`, `workspace-write` or `danger-full-access` | All `null` (use Codex config) |
| `agents.codex.approval` | Codex approval policy, e.g. `never` | `null` (use Codex config) |
| `agents.<name>` (API model) | `type` is `openai-compatible`; `base_url` and `model` are required; `api_key` (the key itself, left empty until filled in) and/or `api_key_env` (the environment variable holding it), with `api_key` used if both are set; an agent with neither can't take part in discussions; `extra_body` is optional | None |
| `agents.<name>` (opencode model) | `type` is `opencode`; `model` is required, written as `provider/model`; `bin` (path to the opencode executable) is optional and found automatically by default | None |
| `levels` | See above | run: `"claude"` for simple and normal, Codex max for complex; review: Codex medium / high / max; discuss: only Codex at all three levels, medium / high / max |

Project config only accepts `dispatch.timeout_min`, `dispatch.stall_min`, `dispatch.busy_ask_min`, `agents.codex.model` and `levels`, and it can't add participants other than Codex (API or opencode models), only remove them. Everything else must go in your user config, so that a repository you cloned can't loosen the sandbox, swap the executable, send your code to another address, or spend your quota on its own. For a sensitive project, keep only Codex under `levels.discuss` in its project config to turn the other models off.

### Preference files

Some habits don't fit in JSON, such as which code in your project counts as high-risk, or what you never want handed to Codex. Write those in plain text in a preference file. Claude reads it the first time it uses the plugin in a session:

- User level: `~/.claude/codex-bridge.md`
- Project level: `<project>/.claude/codex-bridge.md`

Preference files win over the plugin's built-in rules, and project level wins over user level. For example:

```markdown
# codex-bridge preferences

- Treat billing and reconciliation code in this project as high-risk: hand it off as complex, and always have Codex review the changes.
- Don't hand database migration scripts to Codex; Claude writes them.
- Ask Codex for a review when a change is over 200 lines.
```

## Safety notes

- **The sandbox is whatever Codex is configured with.** If your Codex config uses `danger-full-access`, Codex can read and write any directory on your machine. The task brief limits what it should touch, and Claude reviews the diff afterwards, but that is not isolation. For real isolation, set `agents.codex.sandbox` to `workspace-write` or `read-only`. Codex's sandbox support on Windows may be incomplete, so test after changing it.
- **Claude can only call Codex through the plugin.** The plugin includes a hook that blocks Claude's commands that run `codex exec` or `codex review` directly, so every call is recorded, has its changes tracked, and uses an explicit model and effort. Running codex yourself in a terminal isn't affected.
- **Background runs need the approval policy set to `never`**, or Codex will hang waiting for a confirmation.
- **Your code and task briefs are sent to OpenAI.** Once API models join discussions, the topic and the attached code are also sent to those providers. Check that this is acceptable for sensitive projects, and use the project config to keep only Codex if needed.
- **API keys can go in the user config or in environment variables.** In the config they're plain text, so don't commit or share `~/.claude/codex-bridge.json`; keys in a project config are ignored. The `config` command never shows keys, and the script never writes them into run records.
- **Pay-as-you-go means real costs.** With API-key billing, every Codex handoff costs money, and every discussion with an API model draws on that account's balance. Set `dispatch.auto` to `false` if you don't want Claude handing off work on its own.

## Run records

Each call is recorded in `~/.claude/codex-runs/<run_id>/`: the brief, the event stream, the diff and the final report. Runs by API models have no diff, but add the conversation history `messages.json`, which a resume continues from. `/codex-bridge-en:status` reads them. Change tracking uses a separate git repository inside that record folder and never touches your project's `.git`.

Change tracking compares the whole working directory at the start and end of a run, so files that you, Claude or another session change at the same time are seen too. The script marks files with evidence that Codex changed them (Codex's file-change events and the files listed in its report) separately from files of unknown origin, and Claude won't simply revert changes of unknown origin. Paths ignored by `.gitignore` aren't tracked unless you pass them with `--track` when handing off.

When the Codex quota runs out or an API model's balance is too low, the run is marked `quota_exhausted` and isn't retried automatically; for Codex it includes the expected reset time. Runs whose dispatcher exited unexpectedly, got stuck or timed out are flagged to Claude the next time you start a session in that project.

## Platforms

Tested on Windows, in both the CLI and the desktop app (including the Microsoft Store version). The macOS and Linux code paths are written but not yet tested in practice; issue reports are welcome.

A few things to know:
- **The live view in the desktop app** opens in the terminal panel, which only accepts ASCII commands. If the run directory (`~/.claude/codex-runs` by default) has non-English characters in its path (for example a Windows user name in Chinese), `/codex-bridge-en:setup` will point it out; set `dispatch.runs_dir` in the config to a plain-English path. The CLI isn't affected.
- **Programs started from a graphical app** (such as the macOS desktop app) may have a PATH without Homebrew, nvm and similar directories. If the script can't find `codex`, it also looks in the directory node runs from, `/opt/homebrew/bin`, `/usr/local/bin` and other common places; if it's still not found, put the full path to `codex` in `agents.codex.bin` in the config. The plugin's hooks run `node`, so it also needs to be on the PATH.
- The live view redraws the whole screen. Windows Terminal, macOS Terminal and iTerm2, the VS Code terminal and common Linux terminals all support this; simple terminals such as `TERM=dumb` get line-by-line output instead.

## English and Chinese versions

The marketplace has two plugins that differ only in the language of their rules and output:

- `codex-bridge-en`: English, commands are `/codex-bridge-en:…`
- `codex-bridge`: Chinese, commands are `/codex-bridge:…`

Install just one. Both share the same config file, preference files and run records, so switching doesn't mean setting things up again.

## Development

Both plugins use the same scripts (`bridge.mjs`, `api-chat.mjs`, `messages.mjs` and the hooks `hooks/guard-codex.mjs` and `hooks/session-reminder.mjs`). Only edit the copy in `codex-bridge/`, then run the sync tool to copy it into the English plugin:

```bash
node tools/sync-shared.mjs
```

Before committing, `node tools/sync-shared.mjs --check` checks that both copies of the scripts, the structure of both sets of schemas and both plugin versions match. Terminal messages, the rules sent to Codex, the prompts sent to API models and other text live in `messages.mjs`, with a Chinese and an English set; each plugin has its own SKILL.md, `references/`, command docs and schemas.

## License

[MIT](LICENSE)
