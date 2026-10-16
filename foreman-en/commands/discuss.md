---
description: Talk a complex plan, design or idea through with Codex and other configured models (discussion only, nothing is carried out; Claude decides)
argument-hint: <topic> [--level simple|normal|complex | --effort <effort>] [--model <model>] [--agent <agent>]
---

The user wants to start a discussion on this topic:

$ARGUMENTS

Follow the "Discussion mode" section of the `foreman-en:dispatch` skill (load it first if it isn't loaded). The user asked for it, so skip the check for when to start one:

1. Get clear on the topic, constraints and the questions to answer. If no topic is given, the topic is the question the conversation was just on. If key information is missing and can't be worked out from the code or context, ask the user first.
2. Pick the level: if the user gave `--level` or `--effort`, use it; otherwise decide `--level` by the skill's discussion level criteria; add any `--model` the user gave. The participants come from `resolved_levels.discuss.<level>` in the `config` output; if the user gave `--agent`, send it only to that one. If the level is `simple` (a one-off question), follow the short version in the skill's discussion mode and skip writing your own proposal, the critique round and the decision record below.
3. Write the round 1 topic brief (without your own leaning), write down your own proposal first, then start one `bridge.mjs discuss` per participant in the background together (with several participants, use the same `--group` and `--agent` for each; name the relevant files with `--file`: API agents get their contents, Codex and opencode agents get only the paths and read them themselves). Tell the user in the chat which model and effort each one uses (taken from the first line the script prints), and handle the live view as in the skill's "Live view" section: once it's open, switch the terminal panel to that tab; when there are API participants, also start the queue check `await-busy` in the background.
4. Critique each other following the process, up to the round limit in `dispatch.discuss_max_rounds` (2 by default).
5. Rule on each participant's points and report to the user in the decision record format.
