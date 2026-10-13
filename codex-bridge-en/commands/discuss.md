---
description: Talk a complex plan, design or idea through with Codex and other configured models (discussion only, nothing is carried out; Claude decides)
argument-hint: <topic> [--level normal|complex | --effort <effort>] [--model <model>] [--agent <agent>]
---

The user wants to start a discussion on this topic:

$ARGUMENTS

Follow the "Discussion mode" section of the `codex-bridge-en:dispatch` skill (load it first if it isn't loaded). The user asked for it, so skip the check for when to start one:

1. Get clear on the topic, constraints and the questions to answer. If key information is missing and can't be worked out from the code or context, ask the user first.
2. Pick the level: if the user gave `--level`, `--effort` or `--model`, use it; otherwise use `--level complex`. The participants come from `resolved_levels.discuss.<level>` in the `config` output; if the user gave `--agent`, send it only to that one.
3. Write the round 1 topic brief (without your own leaning), write down your own proposal first, then start one `bridge.mjs discuss` per participant in the background together (with several participants, use the same `--group` and `--agent` for each; attach the relevant files for API agents with `--file`). Tell the user in the chat which model and effort each one uses (taken from the first line the script prints), and handle the live view as in the skill's "Live view" section.
4. Critique each other following the process, up to the round limit in `dispatch.discuss_max_rounds` (2 by default).
5. Rule on each participant's points and report to the user in the decision record format.
