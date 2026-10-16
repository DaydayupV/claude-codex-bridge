---
description: Have Codex review code changes independently
argument-hint: [--base <branch> | --commit <sha>] [--level simple|normal|complex | --effort <effort>] [--model <model>] [focus]
---

The user wants Codex to review code. Arguments:

$ARGUMENTS

Follow the `foreman-en:dispatch` skill (load it first if it isn't loaded). The user asked for it, so don't judge whether a review is worth it:

1. Decide the working directory and what to review: uncommitted changes (`--uncommitted`) by default; use `--base` or `--commit` if given. If the directory isn't a git repository, put the files to review and what to look at in the review brief.
2. **Always write a review brief** and pass it with `--brief`: the intent of the change, the risky spots, and any focus given in the arguments. Only with a brief does the review follow the "review only, no changes, plain words" rules; without one, Codex's built-in review runs instead.
3. Run `bridge.mjs review` in the background, and tell the user in the chat which model and effort it uses (taken from the first line the script prints). If the user gave `--level` or `--effort`, use it; otherwise decide `--level` by the skill's review level criteria; add any `--model` the user gave.
4. When the results are in, check each issue Codex raised: list the real ones and how you plan to fix them; for false positives, say why they don't hold. Ask the user before fixing, unless they've already said to fix them.
