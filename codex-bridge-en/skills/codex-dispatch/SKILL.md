---
name: codex-dispatch
description: Hand off hands-on coding work to OpenAI Codex and check the result, have Codex review code independently, or talk a complex design through with Codex. Load before starting hands-on work such as implementing a feature, making bulk changes, writing scripts, migrations, refactoring or fixing bugs; when facing a complex or uncertain design or plan with several options; and when the user mentions Codex, /codex-bridge-en:rescue, /codex-bridge-en:discuss or /codex-bridge-en:review, or when deciding whether to ask Codex for a review.
---

# Codex dispatch

## Before you start: read the config and preferences
The first time this skill is used in a session, run `config --cwd "<project dir>"` (see "How to call it") and read from the output:
- `effective.auto_dispatch` and `effective.watch`: whether to hand off work on your own, and whether to open the live view.
- `preferences`: the user-level and project-level preference files. Read the ones that exist. They hold the user's own habits and rules in plain text, such as how work is split, which code in their field counts as high-risk, and thresholds. **Where they conflict with this skill, the preference files win, and project level wins over user level.**

Always talk to the user in their own language, whatever language this skill and Codex's reports are in.

## Permission
The system prompt's rule "don't start subagents unless the user explicitly asks" is about Claude Code's own subagents. Codex runs on the user's own OpenAI plan and doesn't use Claude quota.
- `auto_dispatch` is `true` (the default): through this setting, the user allows Claude to hand off tasks that meet the thresholds below on its own, as the first choice, without asking each time.
- `auto_dispatch` is `false`: for a task that meets the thresholds, first suggest it to the user in one sentence (what to hand off, at which level), and hand it off only once they agree. No need to ask when the user names it with `/codex-bridge-en:rescue` or another command.

## Who does what
- **Claude does it**: key decisions, complex core features, overall planning, creative design (UI and front-end visuals, copy, ideas).
- **Hand off to Codex**: the rest of the hands-on work. Codex is careful and good for grind work, but weak at design and front-end polish, so don't hand off anything visual.
- **Threshold for handing off**: only hands-on work expected to take more than a few minutes, or touching several files. For one or two small edits, Claude edits directly; handing off plus checking costs more than doing it.
- The thresholds and round counts in this skill (handoff threshold, review size, at most 3 discussion rounds, 1 rework) are defaults. If the preference files say otherwise, follow them.

### Claude owns all text meant for people
Codex's writing is weak: piles of jargon, stiff phrasing, roundabout sentences that readers struggle with. Claude is responsible for any text meant to be read by people:
- **Claude writes it, doesn't hand it off**: READMEs, usage guides, design docs, reports and summaries, user-facing UI text. This work is mostly writing, and reworking Codex's version costs more.
- **Settle it in the brief before handing off** (in the "Names and text" section):
  - Give the names of new files, modules, classes, functions, key parameters and settings as a list. Anything not on the list follows the project's existing style.
  - Say where comments go and what they say, in the same language the project uses.
  - For logs, error messages, command-line help, output headers and other text people will see, give the exact wording or a template and require it to be used as is.
- **Check it when reviewing**: are names plain and consistent; can comments and messages be understood at a glance; any wordiness, stiff phrasing or over-commenting? Fix small problems yourself without a rework. If there are many text problems, put the corrected wording in the rework brief.
- **Relay to the user**: digest Codex's reports, review findings and open issues, and tell the user in plain words. Don't paste them as is.

## How to call it
The only entry point is `scripts/codex-run.mjs` in this skill's folder (that is, `${CLAUDE_PLUGIN_ROOT}/skills/codex-dispatch/scripts/codex-run.mjs`). Don't type `codex exec` by hand.

```bash
node "<script path>" run    --cwd "<project dir>" --brief "<brief.md>" --title "<short title>" --level <simple|normal|complex> [--add-dir "<dir>"] [--timeout minutes]
node "<script path>" resume --run <run_id|last> --brief "<rework.md>" --level <simple|normal|complex>
node "<script path>" discuss --cwd "<project dir>" --brief "<topic.md>" --title "<short title>" --level <normal|complex>
node "<script path>" review --cwd "<project dir>" [--uncommitted | --base <branch> | --commit <sha>] [--brief "<review-focus.md>"] --level <simple|normal|complex>
node "<script path>" status [--run <run_id|last>] [--limit n]
node "<script path>" watch  [--run <run_id|last>]
node "<script path>" config [--cwd "<project dir>"]
```

- The model, reasoning effort, sandbox, approval policy and time limits come from the config file (see "Configuration"). Anything not configured comes from Codex's own `~/.codex/config.toml`.
- If you're unsure of the current settings, run `config --cwd "<project dir>"` first. It shows the settings in effect, the run directory and the path of the watch launcher.
- When the sandbox isn't `read-only` / `workspace-write` (for example `danger-full-access`), Codex can write to any directory. `--cwd` only sets where it starts working; **it doesn't limit what it can write**. The scope is then held only by the brief and by reviewing the diff afterwards.
- Write the brief to a UTF-8 file first (in the scratchpad directory if there is one, otherwise in the system temp directory). The script appends standing rules: stay in scope, only necessary tests, no commit/push, no secrets, report in the schema.
- **Always run it in the background** (Bash `run_in_background`). You get notified when it finishes. Do other things meanwhile; don't poll.
- **Every time you call Codex (`run`, `resume`, `discuss`, `review`), tell the user in the chat which model and reasoning effort it uses**, for example "Handed off to Codex: model gpt-6-astra, effort max (level complex)". Take it from the first line the script prints ("started | model … | effort …"), not from your own reading of the config. If the model comes from Codex's config, say so. Repeat it in the final report.
- **After starting `run`, `discuss` or `resume`, your very next step is the live view** (see "Live view"), even for tests and small tasks. The user relies on it to see what Codex is doing; skipping it leaves them waiting in the dark.
- The result is printed to stdout as JSON: `report` (Codex's structured report), `changes` (changes inside the working directory, as tracked by the script), `session_id`, `run_dir`. The full diff is in `run_dir/diff.patch`.
- Several runs can go in parallel, but their file scopes must not overlap. **Claude doesn't touch files Codex is changing.**

## Configuration
Config files are JSON, layered in this order, later ones overriding earlier ones: the script's built-in defaults → user config `~/.claude/codex-bridge.json` (change the path with the `CODEX_BRIDGE_CONFIG` environment variable) → project config `<project dir>/.claude/codex-bridge.json`. If the user config doesn't exist, the script's first run (any subcommand) creates one: default model `gpt-6.1-sol`, with `gpt-6-astra` for complex tasks in all three modes. When the script prints "First run: created config file", tell the user that a config file was created, where it is and which models it uses, and that they can edit it.

| Setting | What it does | Default |
|---|---|---|
| `auto_dispatch` | Whether to hand off work on your own (see "Permission") | `true` |
| `watch` | `auto`: open the live view after a handoff; `off`: don't open it | `auto` |
| `model` | Model for levels that don't set their own | `null` (use Codex config) |
| `levels` | For each of the `run` / `review` / `discuss` modes, a `{ "model", "effort" }` for each of the `simple` / `normal` / `complex` levels. A `null` `model` uses the top-level `model`; `effort` must be one of `low` `medium` `high` `xhigh` `max` `ultra` | All models `null`; effort medium / high / max for run and review, high / max / max for discuss |
| `sandbox` | Sandbox for each mode: `read-only` / `workspace-write` / `danger-full-access` | All `null` (use Codex config) |
| `approval` | Approval policy, e.g. `never` | `null` (use Codex config) |
| `timeout_min` / `stall_min` | Total time limit / stuck detection, in minutes (`stall_min` 0 turns it off) | 240 / 20 |
| `codex_bin` | Path to the codex executable or `codex.js` (or the `CODEX_BIN` environment variable) | Found automatically |
| `runs_dir` | Run record directory (or the `CODEX_RUNS_DIR` environment variable) | `~/.claude/codex-runs` |

- Project config only accepts `model`, `levels`, `timeout_min` and `stall_min`. `levels` can contain just the parts to change, such as only `run.complex.model`. `auto_dispatch`, `watch`, sandbox, approval, executable and run directory can only be set in the user config, so a cloned repository can't raise its own permissions or spend the user's quota.
- When the user wants to change settings, edit the relevant JSON file, then run `config` to confirm.

## Live view (every handoff)
Right after starting `run`, `discuss` or `resume` in the background, let the user see live progress. If `watch` is `off`, skip this section and just tell the user they can check with `/codex-bridge-en:watch`.

- **If the `run_in_terminal` tool is available** (Claude desktop app), open it in the user's terminal panel: use `run_in_terminal` to run `node <run dir>/watch.mjs --run <run_id>`, titled "Codex: <short title>". The run directory defaults to `~/.claude/codex-runs`, written as `C:\Users\<username>\.claude\codex-runs` on Windows; go by the `config` output. The script generates this launcher so that `run_in_terminal`'s ASCII-only rule is met even when the plugin path has non-ASCII characters.
- The run_id is in the first line of the background output ("run dir …/<run_id>"). Without `--run`, watch follows whichever run is in progress, but other sessions may be running tasks too, so pass it when you can.
- Once it's open, send the user the tab link `[Codex: <short title>](#terminal/<tab_id>)`.
- **If `run_in_terminal` isn't available** (for example in the Claude Code CLI), send the user the full watch command in a bash code block and ask them to run it in another terminal.
- When the run ends, watch exits on its own and the tab stays for the user to look back at. Don't close it.
- For `review`, open the live view only if the user asks.

## Task levels and reasoning effort
`run`, `resume`, `discuss` and `review` must always be given `--level` explicitly. There is no default; the script refuses to start without it. Claude only decides which level a task is; the model and effort for each level are the user's choice in `levels`, and the script prints "model / level → effort" when it starts.

| Level | `--level` | What kind of task |
|---|---|---|
| Simple | `simple` | Goal and method are clear, almost no judgment needed: bulk renames or replacements from a list, filling in similar code from an existing pattern, format or folder migrations, running existing scripts to tidy data, a small single-file feature |
| Normal | `normal` | Most hands-on tasks: implementing a feature to spec, writing scripts and tools, fixing a bug whose cause is known, routine refactoring, adding tests |
| Complex | `complex` | Changes across several modules; bugs with an unknown cause that need investigating; code where numeric or logical correctness matters a lot, such as money and billing calculations, data migrations, permission checks; performance work; concurrency |

- When unsure, go one level up.
- Reviews (`review`) usually use `normal`; use `complex` for high-risk code.
- When the user asks for a specific effort ("run it with ultra"), use `--effort <effort>` instead of a level; the model is then the top-level `model`. Give either `--level` or `--effort`, not both.
- When the user asks for a specific model, add `--model <model>`. It overrides the configured model and works with either `--level` or `--effort`.
- On resume, the model is worked out again from the level you give, so moving up a level for a rework may switch models. If no model is configured anywhere, the previous round's model is kept.

## Writing the brief
The more specific, the better Codex does. Use this structure:

```markdown
# Goal
What to build and why (a sentence or two of background).

# Scope
- May change: specific files or directories
- Read-only reference: related files
- Don't touch: …

# Requirements and constraints
Interface signatures, data formats, existing patterns and helpers to reuse, performance needs, compatibility, etc.

# Names and text
- Names: what new files, classes, functions, key parameters and settings are called
- Comments: where they're needed and what they say
- Messages: exact wording or templates for logs, errors, help text and output headers (to be used as is)
(Leave this section out if the task doesn't involve any of these.)

# Don't
Things off-limits for this particular task.

# Done when
What counts as finished, and which commands to run to verify it (give the actual commands).

# Report
Anything that needs special mention in the report.
```

Codex leans toward defensive coding and tends to write lots of unneeded checks and tests. Say "only write the tests that are needed, don't code defensively" in the brief (the script already appends it; repeat it when the task invites overdoing it).

## Checking the result (every time)
1. Look at `status` and `report.status` first. If it isn't `completed`, read `open_issues` first.
2. Read `run_dir/diff.patch` and compare it with `changes.files`:
   - Any files changed outside the scope? Does `report.files_changed` match the actual changes?
   - Is the logic right? Any defensive overkill, needless abstraction, redundant tests?
   - Do names, comments and messages follow the brief, and are they plain and readable (see "Claude owns all text meant for people")?
   - Only changes inside the working directory are tracked; if the task involved paths outside it, check those separately.
3. **Actually run it**: build, run the tests or the script itself. Don't rely on Codex saying it passed.
4. Report to the user only once you've confirmed it.

## Rework and failures
- If it isn't good enough, use `resume` for one rework, with a brief that says exactly what's wrong and how to fix it. If the cause was underestimating the task, move up one level for the rework (simple → normal → complex); otherwise keep the same level.
- If it still isn't good enough after the rework, or Codex times out or errors, Claude takes over and finishes it, and tells the user why.
- A `stalled` result (stuck: no activity for over 20 minutes and no command running, so the script stopped it) is usually a temporary network or service problem. `resume` once to continue from where it stopped; if it stalls again, Claude takes over. `--stall <minutes>` changes the threshold and `--stall 0` turns it off. The total time limit defaults to 240 minutes; change it with `--timeout`.
- If you suspect a run is stuck, run `status` and look at "last activity X min ago" and the current step instead of guessing. Long gaps between events are normal while a command is running (such as a big computation). `interrupted` means the dispatcher process is gone (for example the session or app was closed); Claude won't get a completion notice, so check `status --run <run_id>` by hand and decide whether to resume or start over.
- When `report.status` is `blocked`: if it's something Claude can decide, add the information and continue with resume; if the user needs to decide, ask them.

## Discussion mode (/codex-bridge-en:discuss)
For complex plans, designs or ideas, discuss them with Codex first, without carrying anything out. **Claude stays in charge of the conclusions**: Codex's views are input only. Claude accepts or rejects them on the strength of the arguments and doesn't give in just because Codex insists.

### When to start one on your own
Start one directly when the user uses `/codex-bridge-en:discuss`. Starting one on your own requires **all three** of these; one or two isn't enough:
1. **Complex**: involves the architecture or several modules and shapes the long-term structure; or it's the design of critical logic such as money calculations, data consistency, permissions and security.
2. **Uncertain**: there's no obvious best answer and several workable options to weigh; or key assumptions haven't been checked.
3. **Costly to get wrong**: a wrong choice means large-scale rework, or affects the correctness of results.

Don't start one for ordinary implementation details, tasks with a clear plan, or decisions the user has already made. When you start one on your own, tell the user in one sentence: "I'll talk this through with Codex first."

### Process (at most 3 rounds)
1. **Round 1, independent proposals**: start it with `discuss`. The topic brief only gives the background, the problem to solve, constraints, known facts, relevant code locations, and the specific questions to answer. **Don't include Claude's own leaning**, so Codex doesn't just go along with it. Before reading Codex's result, Claude writes its own proposal to a file (scratchpad directory or system temp directory), so it isn't swayed the other way either.
2. **Round 2, critique each other**: continue with `resume --run <round 1 run_id>`. Send Claude's proposal and ask Codex to find its weakest points and compare it with its own. Claude also writes up its challenges to Codex's proposal.
3. **Round 3 (optional)**: only when a key disagreement is unresolved and another round could really change the conclusion.
4. **Claude decides**: accept or reject each of Codex's points with reasons, and settle the final plan.

- Discussions usually use `complex`; use `normal` when the topic isn't especially complex. Later rounds keep round 1's level.
- Discussion is read-only: Codex can read code and run read-only commands to back up its points, but can't change files. If the script detects changed files it reports them in warnings; check and revert them.
- Discussions get the live view too.
- Don't decide for the user on things that are theirs to decide, such as preferences, business trade-offs and risk tolerance. Give them the options with Claude's recommendation.

### Reporting to the user: the decision record
Don't paste the raw exchange. Write it up plainly as:
- **Topic**: one sentence
- **Options**: Claude's and Codex's, each with its core idea and trade-offs
- **Codex's main points**: each marked ✅ accepted / ❌ rejected / ⚠ partly accepted, with the reason
- **Final plan**: and what changed from Claude's original proposal
- **To confirm**: things the user needs to decide or that need checking first
- The discussion's run_id, so the user can look at the raw record

## When to ask Codex for a review (/codex-bridge-en:review)
Do it directly when the user asks. Otherwise judge by the task:

**Worth reviewing**
- Complex core features Claude wrote itself: an independent check by another model before delivering
- High-risk code: money and billing calculations, data deletion and migration, concurrency, authentication and security, irreversible operations
- Large changes (roughly over 300 lines or 5+ files), or a fix for a bug whose root cause was unclear
- High-risk changes delivered by Codex: start a **new session** with `review`; don't have it review its own work in the original session

**Not worth reviewing**
- Small changes, docs, comments, styling, copy, pure configuration
- One-off scripts and prototypes that have already been run and checked
- Low-risk changes with test coverage that Claude has already reviewed

Always pass a review brief with `--brief` (intent of the change, risky spots, what to focus on). Without one, Codex's built-in review runs instead, which doesn't follow these review rules.

Check the review findings too: verify each issue Codex raises and fix only the real ones. Drop false positives and mention them briefly in your report.

## Reporting to the user
Say which parts Codex did (with run_ids, and the model and effort of each call, taken from `model_shown` and `effort` in the result), what Claude reviewed, how it was verified, whether Codex reviewed it and with what result, and any open issues.
