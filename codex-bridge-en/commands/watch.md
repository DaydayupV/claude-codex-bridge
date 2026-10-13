---
description: Watch a Codex run live in a terminal
argument-hint: [run_id | last | group name]
---

Open Codex's live progress. The argument is `$ARGUMENTS`.

Run the watch launcher as described in the "Live view" section of the `codex-bridge-en:dispatch` skill: if the `run_in_terminal` tool is available, use it to open the view in the terminal panel; otherwise send the user the command and ask them to run it in another terminal. Arguments:
- No argument: follow the run in progress, or show the most recent one if none is running
- A run_id or `last`: add `--run <argument>` to the command
- A group name: add `--group <argument>` to follow the whole group at once
- If the user wants every detail (reasoning, each command and its output, token usage), also add `--verbose`. The default concise view shows only what Codex says, folded commands, file changes and the final result.

If it was opened in the terminal panel, send the user the tab link.
