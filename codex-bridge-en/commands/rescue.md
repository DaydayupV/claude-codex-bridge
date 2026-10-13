---
description: Hand a task off to Codex (pick a level by task complexity; model and effort come from the config)
argument-hint: <task> [--level simple|normal|complex | --effort <effort>] [--model <model>]
---

The user wants this task handed off to Codex:

$ARGUMENTS

Follow the `codex-bridge-en:dispatch` skill (load it first if it isn't loaded). The user asked for Codex by name, so skip the handoff threshold check:

1. Get clear on the goal, scope and what counts as done. If key information is missing and can't be worked out from the code, ask the user first.
2. Write the brief file using the skill's structure, and decide the working directory and task level: if the user gave `--level`, `--effort` or `--model`, use it; otherwise pick `--level` from the skill's level table. If names, comments or messages are involved, settle them in the brief.
3. Run `bridge.mjs run` in the background, and tell the user in the chat which model and effort it uses (taken from the first line the script prints).
4. When it finishes, follow the skill's checking steps: review the diff, actually run it, send it back for rework if needed, then report to the user.
