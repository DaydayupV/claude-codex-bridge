# claude-codex-bridge

[中文](README.md)

A Claude Code plugin that lets Claude hand off hands-on coding work to OpenAI Codex and then check the result. Claude can also ask Codex for an independent code review, or talk a complex design through with it before deciding.

The idea is a split of roles: Claude does the planning, key decisions, design and writing; Codex does the rest of the hands-on work. Codex runs on your own OpenAI plan or API key, so it doesn't use your Claude quota.

## What it does

| Command | What it does |
|---|---|
| `/codex-bridge-en:rescue <task>` | Hands a task to Codex. When it finishes, Claude reviews the diff, runs it to verify, and sends it back for rework if needed |
| `/codex-bridge-en:discuss <topic>` | Discusses a complex design with Codex: up to 3 rounds of critiquing each other's proposals, then Claude rules on each point and writes up a decision record |
| `/codex-bridge-en:review` | Has Codex review uncommitted changes, a branch or a commit. Claude checks each finding and filters out false positives |
| `/codex-bridge-en:status` | Lists recent Codex runs, or shows the details of one, with each run's token use, the size of its latest request and how much of the Codex quota is used |
| `/codex-bridge-en:watch` | Shows what Codex is doing, live. The default view is concise (what Codex says, folded commands, file changes, the result); add `--verbose` for every detail |
| `/codex-bridge-en:config` | Shows or changes the plugin's settings |

You don't have to use the commands. The bundled skill lets Claude decide on its own: hand off hands-on tasks that are big enough, discuss complex and uncertain designs with Codex first, and ask Codex to review risky changes before delivering them. You can turn this off with `auto_dispatch` (see below). So that Claude doesn't forget (easy when a project has its own skills), the plugin reminds it once at the start of every session and includes your preference files.

Every time Claude calls Codex, it tells you in the chat which model and reasoning effort it is using.

## Requirements

- [Claude Code](https://claude.com/claude-code)
- [Codex CLI](https://github.com/openai/codex), installed and signed in. If `codex exec "hello"` gets a reply in your terminal, you're set
- Node.js 18 or later. If you run Claude Code inside WSL, Node.js must be installed inside WSL too, or the plugin's hooks will error before every command
- Git 2.25 or later (used to track which files Codex changed)

## Install

In Claude Code, run:

```
/plugin marketplace add DaydayupV/claude-codex-bridge
/plugin install codex-bridge-en@claude-codex-bridge
```

Then run `/codex-bridge-en:config` to see the settings in effect.

## Configuration

On first use, the plugin creates a user config at `~/.claude/codex-bridge.json` containing the example from "Task levels, models and reasoning effort" below: `gpt-6.1-sol` by default and `gpt-6-astra` for complex tasks. It doesn't set the sandbox or approval policy; those still come from Codex's own `~/.codex/config.toml`.

To change things, edit that file, or tell Claude something like "use `/codex-bridge-en:config` to switch complex tasks to ultra".

Config files are JSON. Later ones override earlier ones:

1. The plugin's built-in defaults
2. User config: `~/.claude/codex-bridge.json` (change the path with the `CODEX_BRIDGE_CONFIG` environment variable)
3. Project config: `<project>/.claude/codex-bridge.json`

### Task levels, models and reasoning effort

Claude only decides which level a task is: `simple`, `normal` or `complex`. You decide which model and reasoning effort each level uses. There are no hidden defaults: Claude must give a level every time, and the script refuses to start without one instead of quietly picking an effort.

```json
{
  "model": "gpt-6.1-sol",
  "levels": {
    "run": {
      "simple":  { "model": null, "effort": "medium" },
      "normal":  { "model": null, "effort": "high" },
      "complex": { "model": "gpt-6-astra", "effort": "max" }
    },
    "review": {
      "simple":  { "model": null, "effort": "medium" },
      "normal":  { "model": null, "effort": "high" },
      "complex": { "model": "gpt-6-astra", "effort": "max" }
    },
    "discuss": {
      "simple":  { "model": null, "effort": "high" },
      "normal":  { "model": null, "effort": "max" },
      "complex": { "model": "gpt-6-astra", "effort": "max" }
    }
  }
}
```

- A level with `"model": null` uses the top-level `model`. If that is `null` too, Codex's own configured model is used. This is just one possible setup; pick models your account has and that suit your tasks.
- `effort` can be `low`, `medium`, `high`, `xhigh`, `max` or `ultra`. If a model doesn't support an effort, Codex rejects it and the error shows up in the result.
- To override for one task, tell Claude "run it with ultra" or "use model X"; Claude will pass `--effort` or `--model` instead.

### All settings

| Setting | What it does | Default |
|---|---|---|
| `auto_dispatch` | `true`: Claude hands suitable tasks to Codex on its own. `false`: Claude suggests it first and waits for your OK | `true` |
| `watch` | `auto`: open the live view after each handoff. `off`: don't open it | `auto` |
| `model` | Model for levels that don't set their own | `null` (use Codex config) |
| `levels` | See above | All models `null`; effort medium / high / max for run and review, high / max / max for discuss |
| `sandbox` | Sandbox for each of `run` / `discuss` / `review`: `read-only`, `workspace-write` or `danger-full-access` | All `null` (use Codex config) |
| `approval` | Codex approval policy, e.g. `never` | `null` (use Codex config) |
| `timeout_min` | Total time limit per run, in minutes | `240` |
| `stall_min` | Stop a run after this many minutes with no activity and no command running; `0` turns it off | `20` |
| `codex_bin` | Path to the codex executable or `codex.js` (or set `CODEX_BIN`) | Found automatically |
| `runs_dir` | Where run records go (or set `CODEX_RUNS_DIR`) | `~/.claude/codex-runs` |

Project config only accepts `model`, `levels`, `timeout_min` and `stall_min`. Everything else must go in your user config, so that a repository you cloned can't loosen the sandbox, swap the executable, or spend your quota on its own.

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

- **The sandbox is whatever Codex is configured with.** If your Codex config uses `danger-full-access`, Codex can read and write any directory on your machine. The task brief limits what it should touch, and Claude reviews the diff afterwards, but that is not isolation. For real isolation, set `sandbox` to `workspace-write` or `read-only`. Codex's sandbox support on Windows may be incomplete, so test after changing it.
- **Claude can only call Codex through the plugin.** The plugin includes a hook that blocks Claude's commands that run `codex exec` or `codex review` directly, so every call is recorded, has its changes tracked, and uses an explicit model and effort. Running codex yourself in a terminal isn't affected.
- **Background runs need the approval policy set to `never`**, or Codex will hang waiting for a confirmation.
- **Your code and task briefs are sent to OpenAI.** Check that this is acceptable for sensitive projects.
- **With API-key billing, every handoff costs money.** Set `auto_dispatch` to `false` if you don't want Claude handing off work on its own.

## Run records

Each call is recorded in `~/.claude/codex-runs/<run_id>/`: the brief, Codex's event stream, the diff and the final report. `/codex-bridge-en:status` reads them. Change tracking uses a separate git repository inside that record folder and never touches your project's `.git`.

Change tracking compares the whole working directory at the start and end of a run, so files that you, Claude or another session change at the same time are seen too. The script marks files with evidence that Codex changed them (Codex's file-change events and the files listed in its report) separately from files of unknown origin, and Claude won't simply revert changes of unknown origin. Paths ignored by `.gitignore` aren't tracked unless you pass them with `--track` when handing off.

When the Codex quota runs out, the run is marked `quota_exhausted` with the expected reset time and isn't retried automatically. Runs whose dispatcher exited unexpectedly, got stuck or timed out are flagged to Claude the next time you start a session in that project.

## Platforms

Tested on Windows. The macOS and Linux code paths are written but not yet tested; issue reports are welcome.

## English and Chinese versions

The marketplace has two plugins that differ only in the language of their rules and output:

- `codex-bridge-en`: English, commands are `/codex-bridge-en:…`
- `codex-bridge`: Chinese, commands are `/codex-bridge:…`

Install just one. Both share the same config file, preference files and run records, so switching doesn't mean setting things up again.

## Development

Both plugins use the same scripts (`codex-run.mjs`, `messages.mjs` and the hooks `hooks/guard-codex.mjs` and `hooks/session-reminder.mjs`). Only edit the copy in `codex-bridge/`, then run the sync tool to copy it into the English plugin:

```bash
node tools/sync-shared.mjs
```

Before committing, `node tools/sync-shared.mjs --check` checks that both copies of the scripts, the structure of both sets of schemas and both plugin versions match. Terminal messages, the rules sent to Codex and other text live in `messages.mjs`, with a Chinese and an English set; each plugin has its own SKILL.md, `references/`, command docs and schemas.

## License

[MIT](LICENSE)
