---
description: Talk a complex plan, design or idea through with Codex (discussion only, nothing is carried out; Claude decides)
argument-hint: <topic> [--level normal|complex | --effort <effort>] [--model <model>]
---

The user wants to discuss this topic with Codex:

$ARGUMENTS

Follow the "Discussion mode" section of the `codex-bridge-en:codex-dispatch` skill (load it first if it isn't loaded). The user asked for it, so skip the check for when to start one:

1. Get clear on the topic, constraints and the questions to answer. If key information is missing and can't be worked out from the code or context, ask the user first.
2. Write the round 1 topic brief (without your own leaning) and start it in the background with `codex-run.mjs discuss`. Tell the user in the chat which model and effort it uses (taken from the first line the script prints), and handle the live view as in the skill's "Live view" section. If the user gave `--level`, `--effort` or `--model`, use it; otherwise use `--level complex`.
3. Before reading Codex's result, write down your own proposal.
4. Critique each other following the process, at most 3 rounds.
5. Rule on each of Codex's points and report to the user in the decision record format.
