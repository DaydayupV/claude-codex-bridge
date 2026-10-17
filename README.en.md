# claude-foreman

[中文](README.md)

A Claude Code plugin where Claude plans, decides and checks the results, handing off hands-on coding work to CLI agents such as OpenAI Codex according to your config. Claude can also ask them for independent code reviews, or have Codex, models reached through opencode, and API models (such as DeepSeek) weigh in on a complex design before Claude decides.

The idea is a split of roles: Claude does the planning, key decisions, design and writing; the rest of the hands-on work goes to the agents you configure, level by level. They run on your own plans or balances (a Codex plan, an opencode subscription, API credit), so they don't use your Claude quota.

## What it does

| Command | What it does |
|---|---|
| `/foreman-en:run <task>` | Hands a task to Codex. When it finishes, Claude reviews the diff, runs it to verify, and sends it back for rework if needed |
| `/foreman-en:discuss <topic>` | Discusses a complex design with Codex (and any other configured models): rounds of critiquing each other's proposals (the limit is configurable, 2 by default), then Claude rules on each point and writes up a decision record |
| `/foreman-en:review` | Has Codex review uncommitted changes, a branch or a commit. Claude checks each finding and filters out false positives |
| `/foreman-en:status` | Lists recent runs, or shows the details of one, with each run's token use, the size of its latest request and how much of the Codex quota is used |
| `/foreman-en:watch` | Shows what each model is doing, live. The default view is a timeline: times down the left, with what the model says, folded commands and file changes in order, a bottom line that keeps showing elapsed time, command count and progress, and the result at the end; while the run is going the view re-flows when the window is resized, and you can scroll back with the arrow keys, PgUp/PgDn or the mouse wheel; add `--verbose` for every detail. When following a group (such as a discussion with several models), one window is split into a block per model, with its status and elapsed time on the right of each block's title line and its latest few lines below. The first time it opens for a newly dispatched conversation, a few seconds of intro play first: the model's pixel avatar and a few jokes; any key skips it, and `dispatch.intro` in the config turns it off |
| `/foreman-en:config` | Shows or changes the plugin's settings |
| `/foreman-en:setup` | Setup guide: detects this machine's tools, lists the models and efforts available, gives one complete recommendation, changes the config after you adjust it item by item, and finishes with an overview of the whole config. Run it again after installing a new tool or to change models |

You don't have to use the commands. The bundled skill lets Claude decide on its own: hand off hands-on tasks that are big enough, discuss complex and uncertain designs with Codex and other models first, and ask Codex to review risky changes before delivering them. When a big task splits into parts that don't touch each other, Claude hands them to several Codex sessions at once to cut the wait (see `agents.<name>.max_parallel` below). You can turn this off with `dispatch.auto` (see below). So that Claude doesn't forget (easy when a project has its own skills), the plugin reminds it once at the start of every session and includes your preference files.

Every time Claude hands something off, it tells you in the chat who got it and which model and reasoning effort it is using.

## Requirements

- [Claude Code](https://claude.com/claude-code)
- Recommended: the [Codex CLI](https://github.com/openai/codex), installed and signed in. Hands-on work, reviews and image generation currently rely on it; without it, Claude does that work itself
- Node.js 18 or later. If you run Claude Code inside WSL, Node.js must be installed inside WSL too, or the plugin's hooks will error before every command
- Git 2.25 or later (used to track which files the agents changed)
- Optional: to have other models join discussions, an API key from that provider (for example DeepSeek), or [opencode](https://opencode.ai) 2.x or [pi](https://github.com/earendil-works/pi) installed

## Install

In Claude Code, run:

```
/plugin marketplace add DaydayupV/claude-foreman
/plugin install foreman-en@claude-foreman
```

Then run `/foreman-en:setup`. It detects which tools this machine has (Codex, opencode, API keys), lists the models available and the efforts each supports, and gives one complete recommendation for your situation; after you adjust it item by item, it changes the config and shows an overview: who gets each level of each kind of task, which agents aren't used, and anything to watch out for. Later, use `/foreman-en:config` to see or change the settings.

### Upgrading from codex-bridge

This plugin used to be called codex-bridge and is now foreman. Claude Code doesn't upgrade a plugin to a new name on its own, so switch over once by hand:

1. Uninstall the old plugin: `/plugin uninstall codex-bridge-en@claude-codex-bridge`. With both installed, their hooks block and remind twice.
2. Add the new marketplace and install `foreman-en` as above.
3. If you installed the old plugin through "My Uploads" in the desktop app, delete it there.

Your settings move over automatically the first time the new plugin runs:
- the config `~/.claude/codex-bridge.json` is copied to `~/.claude/foreman/config.json`;
- the preferences `~/.claude/codex-bridge.md` are copied to `~/.claude/foreman/preferences.md`;
- the run directory `~/.claude/codex-runs` is moved to `~/.claude/foreman/runs`. If runs are still in progress there, it waits and moves on a later run.

The config is also rewritten in the new format: `type` becomes `codex cli` / `opencode cli` / `api`, `"claude"` becomes `"claude code"`, and agent IDs are renamed after their models (for example `codex` becomes `gpt-6-astra`). The model and effort each level actually uses stay the same, and the original is backed up as `config.json.bak`. The old config and preferences files are kept; delete them yourself once everything works. A project's `.claude/codex-bridge.json` and `.claude/codex-bridge.md` are still read, with a suggestion to rename them to `.claude/foreman.json` and `.claude/foreman.md`. The environment variables `CODEX_BRIDGE_CONFIG`, `CODEX_RUNS_DIR` and `CODEX_BRIDGE_LANG` are now `FOREMAN_CONFIG`, `FOREMAN_RUNS_DIR` and `FOREMAN_LANG`; the old names still work for now. `/codex-bridge-en:rescue` is now `/foreman-en:run`.

## Configuration

The user config is `~/.claude/foreman/config.json`, and a project config is `<project dir>/.claude/foreman.json`. To change things, edit the file directly, or tell Claude something like "use `/foreman-en:config` to switch complex tasks to ultra". Every setting is described in [references/config.md](foreman-en/skills/dispatch/references/config.md).

### First run

On first run, the plugin checks what this machine has, then generates a config:

| Found | Resulting setup |
|---|---|
| A usable Codex (installed and signed in) | Claude does simple and normal hands-on tasks itself; complex ones go to Codex's `gpt-6.1-sol`. Reviews and discussions go to Codex, with `gpt-6-astra` for complex ones |
| No Codex | Claude does every task itself for now |
| API key environment variables (DeepSeek, Kimi, MiMo) | Added to the config, but not to any discussion yet |
| opencode | Not added automatically; you pick the model |

Choices that cost money or affect safety are never made automatically. Run `/foreman-en:setup` and Claude suggests a setup for your machine, then changes the config once you confirm. The models and efforts to choose from come from the model lists built into Codex and opencode; when you add an API model, Claude checks the provider's official docs. Running setup again later picks up newly installed tools.

When Claude checks the environment (`check`), it confirms each agent works and that each level's effort is supported by its model, and also finishes with the overview.

### How the config is laid out

It has three parts:

| Part | What it covers |
|---|---|
| `dispatch` | How the plugin hands off work: whether to do it on its own, the live view, discussion rounds, time limits, the run directory |
| `agents` | Which agents there are and how to reach them |
| `levels` | Who each level of each task type goes to, and with what effort |

An example with Codex, opencode and DeepSeek:

```json
{
  "agents": {
    "gpt-6.1-sol":     { "type": "codex cli", "model": "gpt-6.1-sol" },
    "gpt-6-astra":     { "type": "codex cli", "model": "gpt-6-astra" },
    "glm-5.3":         { "type": "opencode cli", "model": "opencode-go/glm-5.3" },
    "deepseek-v4-pro": { "type": "api", "base_url": "https://api.deepseek.com", "api_key_env": "DEEPSEEK_API_KEY", "model": "deepseek-v4-pro" }
  },
  "levels": {
    "run": {
      "simple":  "claude code",
      "normal":  "claude code",
      "complex": { "agent": "gpt-6.1-sol", "effort": "max" }
    },
    "review": {
      "simple":  { "agent": "gpt-6.1-sol", "effort": "medium" },
      "normal":  { "agent": "gpt-6.1-sol", "effort": "high" },
      "complex": { "agent": "gpt-6-astra", "effort": "max" }
    },
    "discuss": {
      "simple":  "claude code",
      "normal":  [{ "agent": "gpt-6.1-sol", "effort": "high" }],
      "complex": [
        { "agent": "gpt-6-astra", "effort": "max" },
        { "agent": "glm-5.3" },
        { "agent": "deepseek-v4-pro", "effort": "max" }
      ]
    }
  }
}
```

**agents**
- Each key is the agent's ID; naming it after its model works best. IDs may use letters, digits, `.`, `-` and `_`.
- There are three `type`s:

  | type | What it is | Tasks it can do |
  |---|---|---|
  | `codex cli` | The Codex CLI on this machine | hands-on work, reviews, discussions, images |
  | `opencode cli` | The opencode CLI on this machine, with any model it can reach | hands-on work (when turned on), reviews, discussions |
  | `api` | A model with an OpenAI-compatible API, such as DeepSeek, Kimi or MiMo | discussions |

- You can have several agents of one type, each with a different model. Codex isn't required.

**levels**
- Each of the three task types (`run` for hands-on work, `review`, `discuss`) has `simple`, `normal` and `complex` levels.
- Each level says who gets it: one agent for hands-on work and reviews, a set of participants for discussions.
- `"claude code"` means Claude does it itself; for reviews and discussions, that level uses no outside model.
- `effort` is the reasoning effort; leave it out for the default:
  - Codex: `low` to `ultra`;
  - API: sent as `reasoning_effort` as is (DeepSeek takes `low` / `high` / `max`);
  - opencode: the model's variant.

### Task levels

Claude only decides which level a task is: `simple`, `normal` or `complex`. The level depends on how much judgement it takes and how costly a mistake would be, not on how much changes: renaming across 20 files from a list is simple, while changing an interface between modules is complex. Who gets each level, and with what effort, is up to you in `levels`. Claude must give a level every time; if it's missing, the script errors out rather than quietly picking one.

- To choose on the spot, tell Claude "run it with ultra" or "use such-and-such model"; Claude switches to `--effort` or `--model`.
- When a level is `"claude code"`, you can still explicitly ask for a task to be handed off, and Claude names an agent with `--agent`.
- Small tasks follow the levels too: a small change with a clear approach is `simple`. By default Claude does `simple` itself; give `simple` to Codex and even tiny changes get handed off.

### Adding API models

1. **Set up the agent**: the generated config already has one for each provider whose key was found. Any other provider with an OpenAI-compatible API (GLM, Qwen, OpenRouter and so on) gets an entry `{ "type": "api", "base_url": "...", "model": "..." }` under `agents`; provider-specific parameters go in `extra_body` and are merged into the request as is.
2. **Fill in the API key**, either way:
   - In the config file: add `"api_key": "sk-..."` to that agent; it takes effect immediately. The key is stored in plain text, so don't commit or share this file.
   - In an environment variable: write `"api_key_env": "DEEPSEEK_API_KEY"`, then set that variable. On Windows, add a user variable under "System Properties → Environment Variables"; on macOS and Linux, put it in your shell's startup file. Restart Claude Code so it can see it.
3. **Add it to discussion levels**: list it at the levels you want under `levels.discuss`.

You can also leave this to `/foreman-en:setup`, for example `/foreman-en:setup add DeepSeek`. You fill in the key yourself; there's no need to paste it into the chat. API models can't look through your code themselves, so Claude sends the relevant files along with the topic (up to about 300,000 characters each time) and checks what they say about the code against the source.

### Adding opencode

If you have [opencode](https://opencode.ai) (2.x) installed, any model it can use can join discussions, for example GLM, Kimi, Qwen, MiniMax or DeepSeek from an [OpenCode Go](https://opencode.ai/docs/go/) subscription. Unlike API models, they read your project's code and search files themselves, so Claude doesn't have to pick files to send; the trade-off is that every file they read is another request, which uses more quota.

1. **Sign in inside opencode**: run `opencode` in a terminal and sign in with `/connect` (choose OpenCode Go for a Go subscription), then run `opencode models` to see which models you can use. Free models (names ending in `-free`) need no sign-in.
2. **Add them to the config**: one entry per model, `{ "type": "opencode cli", "model": "opencode-go/glm-5.3" }`, with the model name as its ID, then add it to the discussion levels you want. `/foreman-en:setup` can do this for you.

**Letting opencode do hands-on work**: give it `run_access` in the user config, then put it in `levels.run`. Two levels:
- `"edit"`: reads and writes files in the project directory only, with no commands. Claude runs the tests afterwards.
- `"shell"`: can also run commands, such as tests. opencode has no OS sandbox, so its commands run with your account's permissions and can reach the whole machine; use this only for projects and models you trust.

Both levels take a change snapshot first, and Claude reviews the diff file by file afterwards.

For discussions and reviews the plugin gives opencode a read-only agent with only the read, search and list tools: it can't run commands or change files. For a review, the plugin works out the changes with git and attaches them, with the same scope as Codex's native review. Keys and sign-in stay in opencode; the plugin's config file holds none. Results include this round's cost (`cost_usd`), which is what OpenCode Go quota is charged by. Go's limits are per model, so several models in one discussion spread the load; premium models have small limits, so keep them for complex discussions.

### Adding pi

If you have [pi](https://github.com/earendil-works/pi) installed (`npm install -g @earendil-works/pi-coding-agent`), any model it can use can join discussions and do reviews, and hands-on work once you turn it on. It works like opencode: the models read your project's code themselves, and results include this round's cost (`cost_usd`).

1. **Sign in inside pi**: run `pi` in a terminal and sign in to the providers you want with `/login` (or set the provider's API key environment variable), then run `pi --list-models` to see which models you can use.
2. **Add them to the config**: one entry per model, `{ "type": "pi cli", "model": "deepseek/deepseek-flash" }`, with the model name as its ID (add `-pi` if another agent already has that name), then add it to the levels you want. `/foreman-en:setup` can do this for you.

The effort is pi's thinking level (`off` to `max`), and each model supports its own set. **If you set a level the model doesn't support, pi doesn't report an error; it quietly switches to the nearest one**, so run `check` after a change: it checks against pi's model list and says which level would be used instead.

pi has no permission system of its own. Every call from the plugin enables only the tools the task needs and injects a guard extension that keeps file reads and writes inside the project directory; your own extensions, skills and MCP servers aren't loaded. The project's AGENTS.md / CLAUDE.md are read as usual, and sessions stay in pi's default location, so `/resume` inside pi finds them too. Hands-on work also needs `run_access` (`"edit"` or `"shell"`) in the user config, with the same rules as opencode, and likewise no OS sandbox.

### Project config

A project config can only tighten, never loosen:
- it only accepts `dispatch.timeout_min`, `dispatch.stall_min`, `dispatch.busy_ask_min` and `levels`;
- each level can only become `"claude code"`, or pick from the agents the user config already has at that level (with a different effort if wanted).

This way a repository you cloned can't use its project config to swap the agent doing the work, send your code to a new provider, or spend your quota on its own. For a sensitive project, keep only Codex in discussions, or set them to `"claude code"`.

### Preference files

Some habits don't fit in JSON, such as which code in your project counts as high-risk, or what you never want handed to Codex. Write those in plain text in a preference file. Claude reads it the first time it uses the plugin in a session:

- User level: `~/.claude/foreman/preferences.md`
- Project level: `<project>/.claude/foreman.md`

Preference files win over the plugin's built-in rules, and project level wins over user level. For example:

```markdown
# foreman preferences

- Treat billing and reconciliation code in this project as high-risk: hand it off as complex, and always have Codex review the changes.
- Don't hand database migration scripts to Codex; Claude writes them.
- Ask Codex for a review when a change is over 200 lines.
```

## Safety notes

- **The sandbox is whatever Codex is configured with.** If your Codex config uses `danger-full-access`, Codex can read and write any directory on your machine. The task brief limits what it should touch, and Claude reviews the diff afterwards, but that is not isolation. For real isolation, set `agents.codex.sandbox` to `workspace-write` or `read-only`. Codex's default elevated sandbox on Windows needs a one-time setup with administrator rights, and if that setup is broken, every command fails (with `windows sandbox failed`). After changing the sandbox, have Claude run `check`: it tests the sandbox without calling a model and lists fixes if it's broken, such as switching to `[windows] sandbox = "unelevated"`. Leave `approval` at the default `never`: nobody can approve in a handed-off task, and a broken sandbox needs fixing at the sandbox.
- **opencode and pi have no OS sandbox when doing hands-on work.** With `run_access` set to `edit` it can't write outside the project or run commands; with `shell` its commands can reach the whole machine. It's off by default; only you can turn it on, in the user config, and a project config can't.
- **Claude can only call agents through the plugin.** The plugin includes a hook that blocks Claude's commands that run `codex exec`, `codex review`, `opencode run` or a pi task directly, so every call is recorded, has its changes tracked, and uses an explicit model and effort. Running them yourself in a terminal isn't affected.
- **Agents don't get stuck waiting for an answer.** Codex needs no approvals by default, opencode gets no way to ask questions or request confirmable permissions, and pi has no question tool. Anything an agent needs answered (returned questions, actions blocked by permissions, prompts waiting for terminal input) is collected in the result, and Claude decides: within the authority you've already given, it decides and resumes; it only asks you about business trade-offs, wider scope, extra cost and irreversible steps.
- **Your code and task briefs are sent to OpenAI.** Once API models join discussions, the topic and the attached code are also sent to those providers. Check that this is acceptable for sensitive projects, and use the project config to keep only Codex if needed.
- **API keys can go in the user config or in environment variables.** In the config they're plain text, so don't commit or share `~/.claude/foreman/config.json`; keys in a project config are ignored. The `config` command never shows keys, and the script never writes them into run records.
- **Pay-as-you-go means real costs.** With API-key billing, every Codex handoff costs money, and every discussion with an API model draws on that account's balance. Set `dispatch.auto` to `false` if you don't want Claude handing off work on its own.

## Run records

Each call is recorded in `~/.claude/foreman/runs/<run_id>/`: the brief, the event stream, the diff and the final report. Runs by API models have no diff, but add the conversation history `messages.json`, which a resume continues from. `/foreman-en:status` reads them. Change tracking uses a separate git repository inside that record folder and never touches your project's `.git`.

Change tracking compares the whole working directory at the start and end of a run, so files that you, Claude or another session change at the same time are seen too. The script marks files with evidence that Codex changed them (Codex's file-change events and the files listed in its report) separately from files of unknown origin, and Claude won't simply revert changes of unknown origin. Paths ignored by `.gitignore` aren't tracked unless you pass them with `--track` when handing off.

When the Codex quota runs out or an API model's balance is too low, the run is marked `quota_exhausted` and isn't retried automatically; for Codex it includes the expected reset time. Runs whose dispatcher exited unexpectedly, got stuck or timed out are flagged to Claude the next time you start a session in that project.

## Platforms

Tested on Windows, in both the CLI and the desktop app (including the Microsoft Store version). The macOS and Linux code paths are written but not yet tested in practice; issue reports are welcome.

A few things to know:
- **The live view in the desktop app** opens in the terminal panel, which only accepts ASCII commands. If the run directory (`~/.claude/foreman/runs` by default) has non-English characters in its path (for example a Windows user name in Chinese), `/foreman-en:setup` will point it out; set `dispatch.runs_dir` in the config to a plain-English path. The CLI isn't affected.
- **Programs started from a graphical app** (such as the macOS desktop app) may have a PATH without Homebrew, nvm and similar directories. If the script can't find `codex`, it also looks in the directory node runs from, `/opt/homebrew/bin`, `/usr/local/bin` and other common places; if it's still not found, put the full path to `codex` in `agents.codex.bin` in the config. The plugin's hooks run `node`, so it also needs to be on the PATH.
- The live view redraws the whole screen. Windows Terminal, macOS Terminal and iTerm2, the VS Code terminal and common Linux terminals all support this; simple terminals such as `TERM=dumb` get line-by-line output instead.

## English and Chinese versions

The marketplace has two plugins that differ only in the language of their rules and output:

- `foreman-en`: English, commands are `/foreman-en:…`
- `foreman`: Chinese, commands are `/foreman:…`

Install just one. Both share the same config file, preference files and run records, so switching doesn't mean setting things up again.

## Development

Both plugins use the same scripts: everything under `skills/dispatch/scripts/` except `language.json` (the entry point is `cli.mjs`), plus the two hooks under `hooks/`. Only edit the copy in `foreman/`, then run the sync tool to copy it into the English plugin:

```bash
node tools/sync-shared.mjs
```

Before committing, `node tools/sync-shared.mjs --check` checks that both copies of the scripts, the structure of both sets of schemas and both plugin versions match. Terminal messages, the rules sent to Codex, the prompts sent to API models and other text live in `messages.mjs`, with a Chinese and an English set; each plugin has its own SKILL.md, `references/`, command docs and schemas.

## License

[MIT](LICENSE)
