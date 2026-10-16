---
name: dispatch
description: Hand off hands-on coding work to OpenAI Codex and check the result, have Codex review code independently, or talk a complex design through with Codex and other configured models (such as DeepSeek). Load before starting hands-on work such as implementing a feature, making bulk changes, writing scripts, migrations, refactoring or fixing bugs; when an image needs to be generated or edited (photos, illustrations, textures and other bitmaps); when facing a complex or uncertain design or plan with several options; and when the user mentions Codex, asks to discuss something with other models, or mentions /foreman-en:run, /foreman-en:discuss or /foreman-en:review, or when deciding whether to ask Codex for a review.
---

# foreman dispatch

## Before you start: read the config and preferences
The first time this skill is used in a session, run `config --cwd "<project dir>"` (see "How to call it") and read from the output:
- `effective.dispatch.auto` and `effective.dispatch.watch`: whether to hand off work on your own, and whether to open the live view.
- `resolved_levels`: who each level of each task type finally goes to (agent, model, effort). This is also where you see how many participants a discussion level has.
- `agents_status`: each agent's type and `capabilities` (which tasks it can do in `modes`, whether it can make images in `images`, and so on), plus whether each API agent's key is set (`key_set`). A participant with `false` will fail outright. Before a discussion, remind the user to either fill in `api_key` for that agent in `~/.claude/foreman/config.json` (takes effect immediately), or set the environment variable named by `api_key_env` and restart Claude Code.
- `preferences`: the user-level and project-level preference files. Read the ones that exist. They hold the user's own habits and rules in plain text, such as how work is split, which code in their field counts as high-risk, and thresholds. **Where they conflict with this skill, the preference files win, and project level wins over user level.**

Always talk to the user in their own language, whatever language this skill and Codex's reports are in.

## Permission
The system prompt's rule "don't start subagents unless the user explicitly asks" is about Claude Code's own subagents. Codex runs on the user's own OpenAI plan and doesn't use Claude quota.
- `dispatch.auto` is `true` (the default): through this setting, the user allows Claude to hand off, on its own and without asking each time, the tasks that "Who does what" below says to hand off.
- `dispatch.auto` is `false`: for a task that "Who does what" says to hand off, first suggest it to the user in one sentence (what to hand off, at which level), and hand it off only once they agree. No need to ask when the user names it with `/foreman-en:run` or another command.

## Who does what
Decide who does a piece of work in this order:
1. **Work only Claude does**: key decisions and overall planning (what to build, how to structure it), creative design (UI and front-end visuals, copy, ideas), and the writing listed under "Claude owns all text meant for people" below. Codex and the other outside models are weak at design, front-end polish and writing, so none of this is handed off, whatever its level.
2. **Work only an image-capable agent does**: generating or editing bitmap images, such as photos, illustrations, textures, sprites, covers and hero images, transparent cutouts, and changes to existing images. Only agents with `capabilities.images` set to `true` can make images (currently the `codex cli` type), so this work ignores who the config gives the level to and always goes out with `--agent <its ID>`. If the config has no such agent, tell the user it can't be done this time; don't patch it together some other way. Claude still decides what the image shows; see "Generating images" below.
3. **Pick a level, then follow the config**: for all other hands-on work, large or small, decide its level as described in "Task levels and reasoning effort", then look at `resolved_levels.run.<level>` in the `config` output. If it says `"claude code"`, Claude does the task itself (the script also refuses to hand off that level); if it names an agent, hand the task off at that level. Who gets each level is the user's choice in the config; don't override it because a task looks big or small, hard or easy. When the user explicitly wants it handed off (for example by naming it with `/foreman-en:run`), hand it off even if the level is `"claude code"`: add `--agent <agent ID>`, picking one whose `capabilities.modes` includes `run`; the effort uses the built-in default, and `--model` picks another model.

- The thresholds in this skill (review size, 1 rework) are defaults. If the preference files say otherwise, follow them. The limit on discussion rounds comes from the `dispatch.discuss_max_rounds` setting (2 by default), and the script refuses resumes beyond it.

### Claude owns all text meant for people
Codex's writing is weak: piles of jargon, stiff phrasing, roundabout sentences that readers struggle with. Claude is responsible for any text meant to be read by people:
- **Claude writes it, doesn't hand it off**: READMEs, usage guides, design docs, reports and summaries, user-facing UI text. This work is mostly writing, and reworking Codex's version costs more.
- **Settle it in the brief before handing off** (in the "Names and text" section):
  - Give the names of new files, modules, classes, functions, key parameters and settings as a list. Anything not on the list follows the project's existing style.
  - Say where comments go and what they say, in the same language the project uses.
  - For logs, error messages, command-line help, output headers and other text people will see, give the exact wording or a template and require it to be used as is.
- **Check it when reviewing**: are names plain and consistent; can comments and messages be understood at a glance; any wordiness, stiff phrasing or over-commenting? Fix small problems yourself without a rework. If there are many text problems, put the corrected wording in the rework brief.
- **Relay to the user**: digest Codex's reports, review findings and open issues, and tell the user in plain words. Don't paste them as is.

### Generating images
- **Scope**: bitmaps only. Charts, flowcharts, icons, SVG vector graphics, and anything HTML, CSS or canvas can draw don't count; handle them under points 1 and 3 above.
- **Claude decides what to draw**: the brief gives the subject, style, composition, size and purpose; for any text in the image, give the exact wording and require it to be used as is. Codex only produces the image. Unless the user asks for variants, ask for one image.
- **Level**: image quality depends on the image model, not much on reasoning effort, so `simple` usually fits. If the same task also changes code (such as wiring the image into a page), pick the level for the code part.
- **Brief**: require Codex's built-in `image_gen` tool, with no scripts, SVG or other stand-ins, and give the path and file name in the project for each image. Codex first saves images in `~/.codex/generated_images/<session id>/`, outside the working directory; change tracking only sees them once they are copied into the project.
- **Checking**: `generated_images` in the result lists the original files of the images Codex generated in this round (full paths; on a resume, only the ones new in that round). First check the count; if the field is missing, the image tool wasn't called and the image was made some other way, so rework it. Then check `changes` to confirm each image was copied to its place, open it with Read and look at it yourself: subject, style, composition and any text. If it isn't right, rework it with `resume` and say exactly what to change.
- An image takes tens of seconds, so the live view sitting on the previous step meanwhile is normal; once the image is ready, a "Generated image …" line appears in the timeline.

## How to call it
The only entry point is `scripts/cli.mjs` in this skill's folder (that is, `${CLAUDE_PLUGIN_ROOT}/skills/dispatch/scripts/cli.mjs`). Don't type `codex exec` by hand.

- **No exceptions**: tests, checks, trial runs and one-off questions all go through this script too. Use `discuss` for read-only questions. The plugin includes a hook that blocks commands calling `codex exec` or `codex review` directly.
- **Stop on sandbox problems**: if the sandbox stops Codex from starting commands or it errors, tell the user the exact error and your assessment, and let them decide whether to change the config. Don't switch the sandbox, edit config files or look for a way around the script yourself.

```bash
node "<script path>" run    --cwd "<project dir>" --brief "<brief.md>" --title "<short title>" --level <simple|normal|complex> [--add-dir "<dir>"] [--track "<path>"] [--group <name> --scope "<path>"] [--timeout minutes]
node "<script path>" resume --run <run_id|last> --brief "<rework.md>" --level <simple|normal|complex> [--track "<path>"] [--file "<path>[:start-end]"]
node "<script path>" discuss --cwd "<project dir>" --brief "<topic.md>" --title "<short title>" --level <simple|normal|complex> [--agent <agent>] [--file "<path>[:start-end]"] [--group <name>]
node "<script path>" review --cwd "<project dir>" [--uncommitted | --base <branch> | --commit <sha>] [--brief "<review-focus.md>"] --level <simple|normal|complex>
node "<script path>" status [--run <run_id|last> | --group <name>] [--limit n]
node "<script path>" watch  [--run <run_id|last> | --group <name>]
node "<script path>" config [--cwd "<project dir>"]
node "<script path>" check  [--agent <agent>]
node "<script path>" await-busy (--group <name> | --run <run_id>) [--after minutes]
node "<script path>" cancel --run <run_id>
```

- `check` tests whether the environment works: Node.js, Git, and every agent in the config, with results under `agents.<ID>`.
  - Codex CLI: whether it starts and is signed in;
  - API: whether the key is set, plus a tiny request to confirm it connects;
  - opencode: whether it starts, whether `opencode models` lists the model, plus a tiny request to confirm it works; for each reasoning effort (variant) the levels configure for it, one more tiny request, with any the model doesn't support listed under `variants`.

  The overall `ok` only counts Node.js and the agents the levels use; a failure in an unused agent is reported but doesn't block anything. For each failed item, `fix` in the result says what to do; pass it on to the user. When a handoff or discussion fails because of the environment (codex not found, not signed in, a 401 from an API, and so on), run `check` first to confirm the cause.

- Who gets the work, the model, reasoning effort, sandbox, approval policy and time limits come from the config file (see "Configuration"). Anything not configured for Codex comes from its own `~/.codex/config.toml`.
- `--agent <agent>` picks which entry under `agents` in the config gets this call. Without it, the one configured for that level is used; it's required when a discussion level has several participants. Which tasks an agent can do is in `capabilities.modes` in the `config` output; for now `api` agents can only take part in `discuss`; `opencode cli` agents can do `review` and `discuss`, and `run` too when the config gives them `run_access`. Old IDs from before the upgrade (such as `codex`) still work, and the script says what the new ID is. opencode agents also go only through this script; don't run `opencode run` directly to bring one into a discussion.
- If you're unsure of the current settings, run `config --cwd "<project dir>"` first. It shows the settings in effect, the run directory and the path of the watch launcher.
- When the sandbox isn't `read-only` / `workspace-write` (for example `danger-full-access`), `--cwd` **doesn't limit what Codex can write**. The scope is then held only by the brief and by reviewing the diff afterwards.
- If the allowed scope includes paths ignored by `.gitignore` (such as `tests/` or a results folder), pass them with `--track "<path>"` (can be given more than once); otherwise change tracking can't see those files. Resume keeps the previous round's `--track`.
- Write the brief to a UTF-8 file first (in the scratchpad directory if there is one, otherwise in the system temp directory). The script appends standing rules: stay in scope, do a preflight check, when to stop and ask, only necessary tests, no commit/push, no secrets, report in the schema.
- **Always run it in the background** (Bash `run_in_background`). You get notified when it finishes. Do other things meanwhile; don't poll.
- **Every call (`run`, `resume`, `discuss`, `review`), tell the user in the chat which model and reasoning effort it uses**, for example "Handed off: gpt-6-astra (Codex CLI, effort max), level complex"; for a discussion with several participants, list each one, for example "Discussion started: gpt-6-astra (Codex CLI, effort max), deepseek-v4-pro (API, effort max)". Take it from the first line the script prints ("<mode> started | <model> (<channel>, effort …) | level … | run dir …"), not from your own reading of the config. If the model comes from Codex's config, say so. Repeat it in the final report.
- **After starting `run`, `discuss` or `resume`, your very next step is the live view** (see "Live view"), even for tests and small tasks. The user relies on it to see what Codex is doing; skipping it leaves them waiting in the dark.
- The result is printed to stdout as JSON. The main fields:
  - `report`: Codex's structured report.
  - `changes`: changes inside the working directory, as tracked by the script. Each file has `by`: `agent` means a tool event shows the agent doing the work changed it (records from before the rename say `codex`); `reported` means only its report claims the change, which is common for files written by commands or scripts; `unknown` means it isn't known who did.
  - `notes`: informational messages, such as changes of unknown origin, or files Codex reported but tracking didn't see.
  - `questions` and `needs_decision`: things the agent needs answered; see "When an agent needs an answer".
  - `session_id`, `run_dir`: the full diff is in `run_dir/diff.patch`.
  - Token use: `usage` is this call's input, cached and output tokens (when `usage_scope` is `session_total`, it's the whole session's total); `last_request` is the size of the latest request and the model's context window; `rate_limit` is how much of the Codex quota is used.
  - `agent`: which agent this call went to. Results from API and opencode agents have no change tracking (`changes.available` is `false`); for API agents `files` lists the files that were attached, and opencode agents add `cost_usd`.
- Several runs can go in parallel, but their file scopes must not overlap; see "Splitting work to run in parallel". **Claude doesn't touch files Codex is changing.**

## Configuration
The user config is `~/.claude/foreman/config.json` and the project config is `<project dir>/.claude/foreman.json`; the latter overrides the former. What each setting means and its default are in `references/config.md`; read it when the user asks about or wants to change settings.
- When the script prints "First run: created config file", pass on what it found (Codex, opencode, API keys) and who now gets each kind of task, and suggest running `/foreman-en:setup` to choose models.
- When the script prints that it rewrote the config file in the new format, tell the user: the config uses the new format (`type` is now `codex cli` / `opencode cli` / `api`, `"claude"` is now `"claude code"`), agent IDs were renamed after their models (pass on the list the script printed), the models and efforts actually used are unchanged, and where the original was backed up.
- **On Windows, don't set `sandbox` to `read-only`**: Codex's Windows sandbox may fail to start even file-reading commands in read-only mode. The read-only requirement for discussions and reviews is held by the rules the script appends, and the script checks afterwards whether any files changed.
- When the user wants to change settings, edit the relevant JSON file, then run `config` to confirm.

## Live view (every handoff)
Right after starting `run`, `discuss` or `resume` in the background, let the user see live progress. If `dispatch.watch` is `off`, skip this section and just tell the user they can check with `/foreman-en:watch`.

- **If the `run_in_terminal` tool is available** (Claude desktop app), open it in the user's terminal panel: use `run_in_terminal` to run `node <run dir>/watch.mjs --run <run_id>`, titled "<model>: <short title>", for example "gpt-6-astra: <short title>". For a discussion with several participants in one group, open a single tab: `node <run dir>/watch.mjs --group <name>`, titled "Discussion: <short title>". The run directory defaults to `~/.claude/foreman/runs`, written as `C:\Users\<username>\.claude\foreman\runs` on Windows; go by the `config` output. The script generates this launcher so that `run_in_terminal`'s ASCII-only rule is met even when the plugin path has non-ASCII characters. If `watch_launcher_ascii` is `false` in the `config` output (the run directory path has non-ASCII characters), `run_in_terminal` will refuse the command: send the user the command in a code block instead, ask them to run it in their own terminal, and pass on the fix from `watch.fix` in the `check` output.
- The run_id is in the first line of the background output ("run dir …/<run_id>"). Without `--run`, watch follows whichever run is in progress, but other sessions may be running tasks too, so pass it when you can.
- Right after it opens, switch the terminal panel to that tab so the user sees it: call the tool that shows panes (in the Claude desktop app its name contains `show_pane`; you may need to load it with ToolSearch first) with `pane` set to `terminal` and `tab_id` set to the tab_id you just got. Opening a tab alone can leave the terminal panel hidden behind another panel. Skip this if there's no such tool.
- Then send the user the tab link `[<title>](#terminal/<tab_id>)`.
- When a discussion has API participants, also start the queue check `await-busy` in the background (once per group; opencode participants don't need it). The "Queue check" line the script prints at startup gives the full command; run it as is. What to do when it exits is in "When an API participant is busy" under the discussion mode.
- **If `run_in_terminal` isn't available** (for example in the Claude Code CLI), send the user the full watch command in a bash code block and ask them to run it in another terminal.
- When the run ends, watch exits on its own and the tab stays for the user to look back at. Don't close it.
- A tab whose watch has exited won't show new runs. So for every resume (a discussion's next round, a rework), open a new tab as above; don't send the user back to the previous round's tab. A discussion's next round still uses `--group <name>`, titled "Discussion: <short title> (round N)", and the view shows only that round's participants.
- The default view is concise. Add `--verbose` when the user wants every detail.
- For `review`, open the live view only if the user asks.

## Task levels and reasoning effort
`run`, `resume`, `discuss` and `review` must always be given `--level` explicitly. There is no default; the script refuses to start without it. Claude only decides which level a task is; the model and effort for each level are the user's choice in `levels`, and the first line the script prints shows the model and effort actually used. When the user hasn't given a level or effort, whether Claude is handing work off on its own or the user started it with `/foreman-en:run`, `/foreman-en:review` or `/foreman-en:discuss`, decide it by the criteria below; there is no default level.

**The level depends on how much judgment the task needs and how costly a mistake would be, not on how much it changes**: changing 20 files by mechanically renaming from a list is `simple`; changing the interfaces between modules is `complex`; a bug with an unknown cause is `complex` even if the fix is a few lines.

Hands-on tasks (`run`, `resume`):

| Level | `--level` | How to tell | Examples |
|---|---|---|---|
| Simple | `simple` | The method is already settled, almost no judgment is needed, and the result can be checked item by item | A small feature or script with a clear approach, a small fix whose change is already clear, filling in similar code from an existing pattern, bulk renames or replacements from a list, format or folder migrations, running existing scripts to tidy data |
| Normal | `normal` | There's a spec or the cause is known, but the approach and local details need designing; mistakes show up easily in tests or when it runs | Implementing a feature to spec, writing scripts and tools, fixing a bug whose cause is known but whose fix needs designing, routine refactoring, adding tests |
| Complex | `complex` | Any one of: the cause is unknown and needs investigating; a mistake wouldn't easily show up in tests and would be costly; the interfaces or contracts between modules change; performance or concurrency work that needs repeated trade-offs and checks | Bugs with an unknown cause, money and billing calculations, data migrations, permission checks, cross-module interface changes, performance work, concurrency |

Reviews (`review`) are levelled by the risk of the change under review:
- `simple`: large but mechanical changes, such as bulk renames and replacements or folder migrations.
- `normal`: ordinary feature changes and bug fixes.
- `complex`: high-risk code (money and billing, deleting or migrating data, concurrency, auth and security, irreversible operations), or a fix for a bug whose cause was unknown.

Discussions (`discuss`) are levelled by the topic:
- `simple`: a one-off question, checking a fact or an understanding of some code, with no options to compare.
- `normal`: a few options to compare, but the impact is limited and a wrong choice is easy to change.
- `complex`: meets all three conditions for starting a discussion on its own under "Discussion mode" (complex, uncertain, costly to get wrong); evidence reviews before a conclusion is used also take this level.

- When unsure, go one level up.
- When the user asks for a specific effort ("run it with ultra"), use `--effort <effort>` instead of a level; the model is then that agent's default model under `agents`. Without `--agent`, the agent configured for that level is used; when the level is `"claude code"` or no level is given, the one agent that can do this kind of task is used, and if there are several, `--agent` is required. Give either `--level` or `--effort`, not both.
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

# Size
Roughly how many lines and files the change should be, and what isn't needed this time, such as command-line options, settings, compatibility with old data, or tests.

# Requirements and constraints
Interface signatures, data formats, existing patterns and helpers to reuse, performance needs, compatibility, etc.

# Allowed adaptations
Things Codex may handle without stopping to ask. For example:
- If the given test entry point won't run, use an equivalent one that covers the same tests
- May fix a particular test fixture, but must not weaken any assertion
(Write "none" if there are none.)

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

Codex tends to do everything and do it heavy: even simple tasks get extra options, settings, abstraction layers, compatibility branches and lots of tests. The "Size" section is there to prevent this: state the expected size and what isn't needed, and check against it when reviewing. The standing rules the script appends also say "keep to the size, only necessary tests, don't code defensively"; repeat it in the brief when the task invites overdoing it. Keep the brief itself in proportion too; don't write pages for a simple task.

Grant "Allowed adaptations" by meaning, not by size: a one-line change can move an out-of-sample boundary, a fee rate or an assertion. Anything beyond the scope that isn't in this section makes the standing rules tell Codex to stop and ask in the report's `decision_requests`. Write foreseeable environment problems (such as a same-named `tests` package in the project) into this section up front to save a stop.

## Splitting work to run in parallel
Most of the time a Codex run takes goes into the model thinking, and only a small part into running commands. So splitting a big task across several Codex sessions running at once noticeably cuts the wait. The cost is more tokens in total (each session reads the background on its own), and Claude has to write more briefs and check more results.

### When to split
Split only when **all** of these hold; otherwise hand it off as one task:
1. It splits into 2 or more parts, no more than that agent's parallel limit (`agents_status.<ID>.max_parallel` in the `config` output, 4 by default; that agent's runs from other sessions take slots too); the parts **write to no shared files** and **don't depend on each other's output**.
2. Claude can settle the interfaces between the parts (function signatures, data formats, file paths) before handing off, and write them into every brief. If they can't be settled, don't split.
3. Each part is expected to take more than 10 minutes. For small tasks, the fixed overhead outweighs the time saved.

**Don't split**: bugs with an unknown cause that need investigating; refactors that touch shared core files; research stages that build on each other; work that needs one consistent design; tasks that are mostly heavy computation (running them at once fights over the CPU; have Codex write a batch script that runs them in parallel instead).

Good cases: several independent scripts or modules; once the interface is set, one part writes the implementation and another the tests; bulk changes split by folder.

### How to hand it off
- Level each part by its own difficulty (see "Task levels and reasoning effort"). If a part's level is `"claude code"` in the config, Claude does that part itself, also staying out of the other parts' files; hand off the rest as usual.
- Give the group a name (a short title plus the date, such as `factor-scripts-1013`; use a different name for each group within a conversation; names repeated across conversations are fine, since the view only counts runs from the current conversation; only letters, digits and `. _ -`, because the live view puts it on a terminal command line, and the script rejects other characters) and hand off each part with `run --group <name> --scope <path it may change>`; `--scope` can be given more than once. Start the parts together in the background, in the same message.
- The script refuses two cases: the agent already has as many runs in progress as its limit allows (counted across all groups and sessions), or the write scope overlaps with a run in progress in the same group. If refused, split the scope again as the error says, or wait for an earlier run to finish.
- Besides the general structure, each brief says:
  - What the other parts of the group do and which files they change; those files are off-limits.
  - The shared interface agreements, copied word for word into every brief.
  - How to verify this part on its own.
- Open just one live-view tab: `node <run dir>/watch.mjs --group <name>`, titled "Group: <name>". It splits one window into a block per model, shows the latest few lines from each run side by side, and leaves a summary when they all finish.
- Tell the user how many parts there are and what each does, with the model and effort of each.

### Checking the results
- Check each part on its own as in "Checking the result", and send back only the parts that fail (resume keeps the group and scope).
- Once all pass, Claude does an **overall check**: run the full tests or scripts on the combined result, since each part was only verified on its own.
- In the report, list each part's run_id and token use, then the total.

## Research and analysis tasks
Research tasks are work whose conclusions rest on experiments and data, such as strategy and factor research, data analysis, comparison experiments and performance investigations. The risk here isn't buggy code; it's conclusions that go beyond the evidence.

### Checklist for research briefs
When handing research to Codex, the brief must cover the items below on top of the general structure above. If an item doesn't apply, say so and why instead of leaving it out. Questions and hypotheses already settled in a discussion go straight in; don't discuss them again.
- **Questions and hypotheses**: the questions to answer, and each hypothesis with the criteria for judging it. Fix the criteria in advance; don't change them after seeing results.
- **Controls**: which controls and baselines are needed, and what each one answers.
- **Robustness**: how to check that a result isn't a fluke of one parameter point or one period, for example parameter neighborhoods, splitting time periods, different starting points.
- **Confounders**: list what could distort the conclusions, and require each to be ruled out or explained as not applicable. Common ones: capital or size path (changing capital, round-lot limits), sample exposure (choosing after seeing results), multiple testing, survivorship bias, changes in how data is defined.
- **Statistics**: how to judge whether a difference is significant, and how to correct for comparing many groups.
- **Deliverables**: the evidence behind each conclusion (files, numbers, a way to recompute it), and anything that couldn't be verified.

### Evidence review before conclusions are recorded
Before research conclusions go into long-term records, reports or docs, or are handed to the user as settled, whether Claude or Codex did the research, start an evidence review with `discuss` (`--level complex`, in a new session, not the one that did the research):
- The topic brief lists each conclusion with where its evidence is and the key numbers.
- Ask the participants to judge each one: is the evidence enough for this conclusion, does it overstate, are there uncontrolled confounders, does it hold up statistically.
- Claude rules on each point as in discussion mode and corrects the conclusions before recording them. If a conclusion already recorded is overturned, correct it with an appended revision rather than editing the original.

## Checking the result (every time)
1. Look at `status` and `report.status` first. If it isn't `completed`, read `open_issues` first.
2. Read `run_dir/diff.patch` and compare it with `changes.files`:
   - Any files changed outside the scope? Does `report.files_changed` match the actual changes?
   - For files with `by` set to `reported`, check the diff to confirm they are changes this task should have made. Files with `by` set to `unknown` may have been changed by Claude itself or another session, or written by the agent with a command it didn't report. Find out who changed them first; **don't just revert them**.
   - Is the logic right? Any defensive overkill, needless abstraction, redundant tests?
   - **Was it overdone?** The change is clearly bigger than the "Size" section expected (say, more than twice), or it adds options, settings, abstraction layers, compatibility branches or tests nobody asked for. Trim small things yourself; if there's a lot, use resume for a rework and list what to remove in the rework brief.
   - Do names, comments and messages follow the brief, and are they plain and readable (see "Claude owns all text meant for people")?
   - Only changes inside the working directory are tracked; if the task involved paths outside it, check those separately.
3. **Actually run it**: build, run the tests or the script itself. Don't rely on the agent saying it passed.
4. **Take a closer look at runs without an OS sandbox** (`isolation` is `tools` in the result; currently opencode):
   - With `run_access` set to `edit`, it can't run commands: Claude runs every test and script itself, and a report saying "passed" counts for nothing.
   - With `run_access` set to `shell`, its commands can reach outside the working directory, where change tracking can't see. Go through the diff file by file; if the task touches outside paths, installs dependencies or goes online, check what it actually did (`opencode.jsonl` in `run_dir` has every command it ran).
   - Write-tool events count as evidence of who changed a file (`by: agent`); files the report merely claims don't.
4. Report to the user only once you've confirmed it.

## Rework and failures
- If it isn't good enough, use `resume` for one rework, with a brief that says exactly what's wrong and how to fix it. If the cause was underestimating the task, move up one level for the rework (simple → normal → complex); if that level is `"claude code"` in the config, don't resume, and Claude takes over instead. Otherwise keep the same level.
- If it still isn't good enough after the rework, or Codex times out or errors, Claude takes over and finishes it, and tells the user why.
- A `stalled` result (stuck: no activity for over `dispatch.stall_min` minutes and no command running, so the script stopped it; the minutes are in the `config` output) is usually a temporary network or service problem. `resume` once to continue from where it stopped; if it stalls again, Claude takes over. `--stall <minutes>` changes the threshold and `--stall 0` turns it off. The total time limit is `dispatch.timeout_min`; change it with `--timeout`.
- If you suspect a run is stuck, run `status` and look at "last activity X min ago" and the current step instead of guessing. Long gaps between events are normal while a command is running (such as a big computation). `interrupted` means the dispatcher process is gone (for example the session or app was closed); Claude won't get a completion notice, so check `status --run <run_id>` by hand and decide whether to resume or start over.
- When `needs_decision` is `true` (including `report.status` set to `blocked`, and the status `needs_input`), follow "When an agent needs an answer".
- A `quota_exhausted` status means the quota is used up: the plan quota for Codex, or the account balance for an API agent. Don't retry, and don't switch to Claude redoing the work on your own. Tell the user the quota is used up and when it should reset (`quota_resets_at`), and let them decide whether to resume once it resets or have Claude take over.
- When Claude takes over a run, or the user decides to drop it, and its status is `interrupted`, `stalled`, `timeout`, `quota_exhausted` or `needs_input`, run `cancel --run <run_id>` to mark it handled: the session-start reminder only lists hands-on runs that haven't been handled.
- If the reminder at the start of the session lists runs that didn't finish normally, mention it to the user at a suitable moment and handle them as the user wants.

## When an agent needs an answer
Runs are unattended: nobody can answer an agent while it runs. The script makes sure no agent gets stuck waiting:
- Codex needs no approvals by default;
- opencode gets no question tool and no permissions that need confirming;
- a CLI added later that prints a "(y/n)"-style prompt and then goes quiet is stopped after 3 minutes with the status `needs_input`.

Every question is collected in the result's `questions`. When `needs_decision` is `true`, something needs deciding; the run has finished, it isn't stuck.

**Claude decides these directly, without asking the user.** Write the decision into the resume brief and continue with resume; Claude can also do a small finishing step itself.
- Technical approaches and trade-offs within the user's existing authority and the task's scope;
- Contradictions or gaps in the brief: these are usually Claude's own brief, so clarify what was meant;
- Missing material or information: Claude looks it up and passes it on.

**Leave these to the user,** with the question, the options and Claude's recommendation: business trade-offs and preferences, risk tolerance, widening scope or authority, extra spending, irreversible steps.

By `source`:
- `decision_request`: a question returned in a hands-on report. `recommendation` says which option it already went with. If Claude agrees, nothing changes; if not, say what to change in the resume brief.
- `permission_denied`: an action the tool tried was blocked by permissions, for example opencode reading a file outside the project. The permissions are a deliberate boundary, so don't change the config to let it through; read the material it needs yourself and put it in the resume brief, or attach it with `--file`.
- `final_question`: the final answer is a question, not a report. Claude answers it and resumes, asking for the report in the required format.
- `input_prompt` (status `needs_input`): the tool is waiting for terminal input. Look at the prompt: if Claude can decide it under the rules above, resume and write the answer in the brief; otherwise leave it to the user.
- `asked_mid_run`: a question asked mid-run that nobody answered; it carried on with its own judgement. When checking the work, compare the approach it chose against the report, and treat it as a rework if it's wrong. These don't count toward `needs_decision`.
- `open_question`: an open question in a discussion report; handle it as part of the discussion flow.

A resume to answer questions doesn't count as a rework.

## Discussion mode (/foreman-en:discuss)
For complex plans, designs or ideas, discuss them with other models first, without carrying anything out. The participants come from `levels.discuss.<level>` in the config: Codex alone, or Codex plus API agents (such as DeepSeek) and opencode agents, all giving their views at the same time. **Claude stays in charge of the conclusions**: the participants' views are input only. Claude accepts or rejects them on the strength of the arguments, doesn't give in just because someone insists, and doesn't go by majority vote.

When `resolved_levels.discuss.<level>` is `"claude code"`, that level uses no outside model; Claude thinks it through itself.

### When to start one on your own
Start one directly when the user uses `/foreman-en:discuss` or explicitly asks to discuss something with Codex or other models. Starting one on your own requires **all three** of these; one or two isn't enough:
1. **Complex**: involves the architecture or several modules and shapes the long-term structure; or it's the design of critical logic such as money calculations, data consistency, permissions and security.
2. **Uncertain**: there's no obvious best answer and several workable options to weigh; or key assumptions haven't been checked.
3. **Costly to get wrong**: a wrong choice means large-scale rework, or affects the correctness of results.

**Apply the same three conditions when the user only asks for advice and hasn't decided whether to do anything yet**, for example "what research directions do you suggest?" or "which architecture should we pick?". If all three hold, discuss first and give the user the conclusion after ruling on it; don't answer directly yourself. To write the topic brief, you may first read code and data and run read-only statistics to get the facts straight.

Don't start one for ordinary implementation details, tasks with a clear plan, or decisions the user has already made. When you start one on your own, tell the user in one sentence, for example: "I'll talk this through with the other models first."

### Three kinds of participants
- **Codex**: can read the code and run read-only commands to check things itself.
- **opencode agents** (`type` is `opencode cli` in the config, such as `opencode-go/glm-5.3`): models called through the opencode CLI on this machine. The script gives them only the read, search and list tools, so they can look through the project's code themselves but can't run commands or change files. So:
  - `--file` works as it does for Codex: the paths are listed as "key files" without their contents. They can only read files inside the project directory; put material from outside the project into the topic itself.
  - Every file they read is another request, so they use more quota than API agents. Put premium models with tight subscription limits (such as Kimi K3 or Qwen Max on OpenCode Go) only at the `complex` level.
  - `cost_usd` in the result is this round's cost at the provider's prices; OpenCode Go quota is charged by this. Include it when reporting tokens.
  - Check what they say about the code before accepting it, too.
- **API agents** (`type` is `api` in the config, such as DeepSeek): see only the topic and the attached material and can't look through the code themselves. So:
  - Attach the relevant files with `--file "<path>"` (can be given more than once); `--file "<path>:<start>-<end>"` attaches just those lines. Attach the code the topic mentions and the core modules under discussion. There's a size limit (about 300,000 characters); the script errors if it's exceeded, so pick files more carefully or use line ranges. The script also attaches the project's file list.
  - The attached material is sent to that provider. Don't add API agents for projects whose preference file or project config says not to.
  - Check what it says about the code against the source before accepting it.
  - Files it asks for in `open_questions` get attached with `--file` in the next round.
- When the same `--file` is passed to Codex or an opencode agent, the script only lists the paths as "key files" without their contents; they read the files themselves.

### Process (round limit set by `dispatch.discuss_max_rounds`, 2 by default)
1. **Round 1, independent proposals**: the topic brief only gives the background, the problem to solve, constraints, known facts, relevant code locations, and the specific questions to answer. **Don't include Claude's own leaning**, so the participants don't just go along with it. Before reading any participant's result, Claude writes its own proposal to a file (scratchpad directory or system temp directory), so it isn't swayed the other way either. Then, going by `resolved_levels.discuss.<level>` in the `config` output, start one `discuss` per participant: the same brief, the same `--group` (a short title plus the date, such as `config-rework-1013`; a different name for each discussion within a conversation, kept for its later rounds), and `--agent <name>` for each, all started in the background in the same message. When the level has only one participant, `--agent` and `--group` can be left out.
2. **Round 2, critique each other**: only when the proposals (Claude's included) really disagree, or a participant's conclusions include something Claude hasn't checked that would change the outcome; if they broadly agree, go straight to deciding. Label the proposals anonymously as "Proposal A / Proposal B / …" and continue each participant with `resume --run <that participant's round 1 run_id>` (again in parallel, in the same message), asking it to find the weakest points of the other proposals and compare them with its own. Send only summaries and the points of disagreement, not the full reports. Claude also writes up its challenges to each proposal.
3. **Round 3 and later (optional)**: only when a key disagreement is unresolved, another round could really change the conclusion, and `dispatch.discuss_max_rounds` isn't reached. If the script refuses the resume, rule on the results you have.
4. **Claude decides**: accept or reject each participant's points with reasons, and settle the final plan. Judge by evidence, constraints and reversibility; a conclusion all participants share can still be wrong.

- **`simple` (a one-off question) keeps it short**: no need to write down your own proposal first, no round 2, and no decision record; check the participants' answers, then tell the user the conclusion and its basis plainly. Attachments, the live view and busy handling work as usual.
- Pick the level by the discussion criteria in "Task levels and reasoning effort"; discussions started on their own meet all three conditions, so they use `complex`. Later rounds keep round 1's level.
- Each participant has its own run_id, and the round limit applies to each participant separately. Each participant takes one of its own agent's parallel slots; if one is refused because its agent is at the limit, start it again once that agent's running tasks finish rather than skipping it.
- If one participant fails (for example `quota_exhausted` from a low balance, an API error, a missing key, or `cancelled` because the user stopped it), the others carry on: tell the user which one failed and why, and continue with the other participants' results. Don't change the config just to get every participant in.
- Discussion is read-only: Codex can read code and run read-only commands to back up its points, but can't change files. If `warnings` says Codex changed files, check the diff and revert what Codex changed. Don't revert changes of unknown origin listed in `notes`; most likely someone else made them. API and opencode agents can't change files.
- Discussions get the live view too.

### When an API participant is busy
When an API agent's service is busy, the request waits in the server's queue without starting, and the server may eventually drop it. Don't leave the user waiting:
- When a discussion you start (or resume) has an API participant and `effective.dispatch.busy_ask_min` in the `config` output is above 0, also start `await-busy --group <name>` in the background right away (use `--run <run_id>` when the level has a single participant and no group). It sends no requests; it exits when a participant has been queued longer than `busy_ask_min` minutes, or when they've all finished, and you're notified when it does.
- When it exits, read its output. If `busy` is empty, there's nothing to do. Otherwise Claude decides directly, without asking the user:
  - If the other participants already have usable results, or this one has been queued for over 10 minutes: run `cancel --run <run_id>` to stop it and go ahead with the other results. Its result is marked `cancelled`; say it's missing when you decide.
  - Otherwise wait 5 more minutes: start `await-busy --run <run_id> --after <minutes queued so far + 5>` in the background, and stop it if it's still queued then.
  - Afterwards, tell the user in one sentence which participant was stopped and why.
- The user can also press x in the live view to stop a queued model, which does the same as `cancel`. Carry on as usual when a result comes back `cancelled`.
- Don't decide for the user on things that are theirs to decide, such as preferences, business trade-offs and risk tolerance. Give them the options with Claude's recommendation.

### Reporting to the user: the decision record
Don't paste the raw exchange. Write it up plainly as follows (not needed for `simple` questions):
- **Topic**: one sentence
- **Options**: Claude's and each participant's, each with its core idea and trade-offs
- **Each participant's main points**: listed per participant, called by model name (such as gpt-6-astra, deepseek-v4-pro), each marked ✅ accepted / ❌ rejected / ⚠ partly accepted, with the reason
- **Final plan**: and what changed from Claude's original proposal
- **To confirm**: things the user needs to decide or that need checking first
- Each participant's run_id, model, effort and token use, so the user can look at the raw record

## When to ask an outside agent for a review (/foreman-en:review)
Do it directly when the user asks. Otherwise judge by the task. When `resolved_levels.review.<level>` is `"claude code"`, that level gets no outside review; Claude reviews it carefully itself.

**Worth reviewing**
- Complex changes Claude made itself (`complex`-level work, including when the config gives that level to Claude): an independent check by another model before delivering
- High-risk code: money and billing calculations, data deletion and migration, concurrency, authentication and security, irreversible operations
- Large changes (roughly over 300 lines or 5+ files), or a fix for a bug whose root cause was unclear
- Research conclusions before they're recorded or reported: an evidence review with `discuss`, see "Evidence review before conclusions are recorded"
- High-risk changes delivered by Codex: start a **new session** with `review`; don't have it review its own work in the original session

**Not worth reviewing**
- Small changes, docs, comments, styling, copy, pure configuration
- One-off scripts and prototypes that have already been run and checked
- Low-risk changes with test coverage that Claude has already reviewed

Always pass a review brief with `--brief` (intent of the change, risky spots, what to focus on). Without one, Codex runs its built-in review instead, which is in English and doesn't follow these review rules.

The script works out the review scope with git first:
- `--uncommitted` (the default): staged and unstaged changes plus untracked new files;
- `--base <branch>`: from the merge-base with that branch to the current working tree, both committed and uncommitted, without untracked files;
- `--commit <sha>`: the changes that commit introduced.

This matches what Codex's native review means. With no changes at all, the script stops with an error instead of handing anything off.

- The full patch is saved as `review.patch` in the run directory. `review_scope` in the result gives the scope, file count and fingerprint; if the changes moved while the review ran, `warnings` says so, and the review may not cover the latest changes.
- Codex reads the changes itself. opencode agents get the patch the script computed, plus read-only tools for context, and can't run commands.
- If the patch is too large (about 200,000 characters), an opencode review is refused: review commit by commit (`--commit`), or give the review to Codex.

Check the review findings too: verify each issue the reviewer raises and fix only the real ones. Drop false positives and mention them briefly in your report.

## Reporting to the user
Say which parts Codex or other agents did (with run_ids, and the agent, model and effort of each call, taken from `agent`, `model_shown` and `effort` in the result), the token use of each call (this call's input and how much was cached, and output; say so when `usage_scope` is `session_total`), what Claude reviewed, how it was verified, whether Codex reviewed it and with what result, and any open issues.
