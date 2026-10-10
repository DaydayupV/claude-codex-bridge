---
description: Show or change codex-bridge settings (model and effort per level, sandbox, time limits, etc.)
argument-hint: [setting to change, e.g. "switch complex tasks to gpt-6.1-sol with ultra"]
---

The user wants to see or change the codex-bridge settings. Arguments:

$ARGUMENTS

1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/codex-dispatch/scripts/codex-run.mjs" config --cwd "<current project dir>"` to see the settings in effect and the config file paths. The "Configuration" section of the `codex-bridge-en:codex-dispatch` skill explains each setting.
2. With no arguments, show the user a short table of each setting's current value and where it comes from (built-in default, user config or project config), and stop there.
3. With arguments, change the config file as asked:
   - Change the user config by default. If the user says it's for this project only, change the project config instead, but `auto_dispatch`, `watch`, sandbox, approval, `codex_bin` and `runs_dir` can only go in the user config.
   - Change only the settings the user mentioned and leave the rest as they are.
4. Run `config` again to confirm, and tell the user what changed.
