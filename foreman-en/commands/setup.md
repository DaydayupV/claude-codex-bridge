---
description: First-time setup: check Codex and the environment, review the settings, and optionally add other models to discussions
argument-hint: [optional: a model to add, e.g. "add DeepSeek"]
---

The user wants to set up foreman. Arguments:

$ARGUMENTS

The script is `${CLAUDE_PLUGIN_ROOT}/skills/dispatch/scripts/cli.mjs`. Go through these steps in order, and tell the user the result of each one briefly:

1. **Check the environment**: run `node "<script path>" check` and show each result in a table (Node.js, Git, Codex, live view, each API model and opencode model).
   - Codex is required. If `codex.ok` is `false`, pass on the `fix` from the result (for example installing the Codex CLI or running `codex login`), ask the user to run `/foreman-en:setup` again once that's done, and stop here.
   - If Git fails, tell the user change tracking won't work and suggest installing it, but carry on.
   - If the live view (`watch`) fails, pass on its `fix`: it only affects opening live progress automatically in the desktop app's terminal panel, so carry on.
   - API models and opencode models are optional. If one fails, pass on its `fix` and carry on. The generated config has DeepSeek and MiMo examples that show as failing until their key is filled in; that's expected, so just say they'll work once a key is added.
   - If the script printed "First run: created config file", tell the user where the config file is.
2. **Review the settings**: run `node "<script path>" config --cwd "<current project dir>"` and use a table to explain `resolved_levels`: who each level of hands-on work, reviews and discussions goes to, with which model and effort. Add that `/foreman-en:config` changes them.
3. **Other models (optional)**: ask the user whether they want other models to join discussions, unless the arguments already name one. If not, skip to step 4. If so:
   - First ask how to connect: the provider's API directly (needs an API key), or through opencode on this machine (models and sign-in are managed in opencode, for example an OpenCode Go subscription). If the user mentions opencode or OpenCode Go, or opencode is installed and the user has no API key, take the "Through opencode" path below.
   - **Through opencode**: run `opencode models` first (it's read-only) to see which models this machine can use. If the model the user wants isn't listed, ask them to run `opencode` in their own terminal and sign in with `/connect` there (choose OpenCode Go for a Go subscription), then check again. Then add `{ "type": "opencode", "model": "<provider/model>" }` under `agents` in the user config (name it after the model, for example `glm` or `kimi`) and add it to the chosen levels under `levels.discuss`; set effort to `null` unless the user names a variant. Finally run `check --agent <name>` to confirm it works. No key is involved, so skip the key steps below.
   - If the config already has an example for the model the user wants (such as DeepSeek or MiMo), don't add a new one; fill in the key on the example and add it to the discussion levels.
   - Confirm the provider (such as DeepSeek, Kimi, GLM, Qwen, OpenRouter, or another OpenAI-compatible service), the model name, and which discussion levels it should join. If you're unsure of the API address or model name, check the provider's official docs; don't guess.
   - Add an agent with `type` set to `openai-compatible` under `agents` in the user config, and add it to the chosen levels under `levels.discuss`. The key can go in one of two places; ask the user which they prefer:
     - **In the config file** (takes effect immediately, no restart): tell the user to open `~/.claude/foreman/config.json` and add a line `"api_key": "<key>"` to that agent themselves. Remind them the key is stored in plain text, so the file shouldn't be committed or shared.
     - **In an environment variable**: write `"api_key_env": "<name>"` in the config (for example `DEEPSEEK_API_KEY`) and tell the user to set it themselves: on Windows, add a user variable under "System Properties → Environment Variables", or run `[Environment]::SetEnvironmentVariable('<name>', '<key>', 'User')` in PowerShell; on macOS and Linux, put it in the shell's startup file. Claude Code must be restarted to see it.
   - **Don't ask the user to paste the key into the chat.** If the user has already pasted one and explicitly asks for it to be written into the config, you may put it in `api_key` in the user config (never a project config), and remind them that the key is now in the conversation history and should be replaced with a new one later.
   - Run `config` afterwards to confirm, then `check --agent <name>` to confirm it connects. With an environment variable, check only after the user restarts; you can ask them to run `/foreman-en:setup` again then.
4. **Wrap up**: in two or three sentences, say what works now, what's still missing, and how to use the plugin day to day (just ask Claude to do things; big tasks are handed to Codex and complex designs are discussed first automatically; `/foreman-en:run`, `/foreman-en:discuss` and `/foreman-en:review` call them by name).
