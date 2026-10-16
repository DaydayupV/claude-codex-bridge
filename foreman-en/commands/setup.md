---
description: Setup guide - detect which tools this machine has (Codex, opencode, API keys), explain the current setup, and add the models you want
argument-hint: [optional: a model to add, e.g. "add DeepSeek" or "use GLM through opencode"]
---

The user wants to set up foreman. Arguments:

$ARGUMENTS

The script is `${CLAUDE_PLUGIN_ROOT}/skills/dispatch/scripts/cli.mjs`. The config format is described in `${CLAUDE_PLUGIN_ROOT}/skills/dispatch/references/config.md`; read it before changing the config. Go through these steps in order, and tell the user the result of each one briefly.

1. **Check the environment**: run `node "<script path>" check` and `node "<script path>" config --cwd "<current project dir>"`.
   - Use one table to show what this machine has, from the `environment` field of `config`:
     - Codex: whether it's there and signed in;
     - opencode: whether it's there and how many models are available;
     - API keys: which environment variables were found.
   - Use a second table for the check result of each agent in the config, from `agents` in `check`; pass on the `fix` for any that fail.
   - If Node.js fails, the plugin can't be used: pass on its `fix` and stop. If Git fails, tell the user change tracking won't work and suggest installing it, but carry on. If the live view (`watch`) fails, it only affects opening live progress automatically in the desktop app's terminal panel, so carry on.
   - If the script printed "First run: created config file", pass on what it found and what it generated.
2. **Explain the current setup**: use a table to explain `resolved_levels`: who each level of hands-on work, reviews and discussions goes to, with which model and effort. Describe `"claude code"` as "Claude does it itself" or "no outside model".
3. **Suggest by environment**: if the arguments already say what to add, do that; otherwise make a recommendation for the situation below and ask whether to add it. Only change what the user confirms.
   - **Codex is there**: keep hands-on work and reviews as they are. You can ask whether they want other models in discussions.
   - **opencode is there**:
     - Run `opencode models` (read-only) to see which models are available. If the model the user wants isn't listed, ask them to run `opencode` in their own terminal and sign in with `/connect` there (choose OpenCode Go for a Go subscription), then check again.
     - Recommend one or two models for discussions. With OpenCode Go, explain that limits are per model, so premium models with small limits (such as Kimi K3 or Qwen Max) are best kept for the complex level.
     - Once the user chooses, add `{ "type": "opencode cli", "model": "<provider/model>" }` under `agents` in the user config for each model, using the model name (the part after `/`) as the ID, and add it to the chosen levels under `levels.discuss`. Leave effort out unless the user names a variant.
     - opencode can do reviews and discussions; to have it review, add it to the chosen levels under `levels.review`.
     - Ask the user whether it should also do hands-on work, explaining the two levels:
       - `"edit"`: only changes files in the project and can't run commands; Claude runs the tests afterwards;
       - `"shell"`: can also run commands. opencode has no OS sandbox, so the commands run with the user's account permissions and can reach the whole machine.

       Only after the user clearly agrees and picks a level, write `run_access` into that agent and add it to the chosen levels under `levels.run`. If the user picks `shell`, ask them to explicitly confirm they accept "no OS sandbox".
   - **API keys are there, or the user wants a provider's API**:
     - The generated config already has an agent for each provider whose key was found, just not in any discussion yet. Ask whether to add them, and at which levels.
     - For a provider not in the config yet (such as GLM, Qwen or OpenRouter), confirm the provider, the model name and the API address; if unsure, check the provider's official docs and don't guess. Add `{ "type": "api", "base_url": "...", "model": "..." }` under `agents`, using the model name as the ID.
     - The key can go in one of two places; ask the user which they prefer:
       - **In the config file** (takes effect immediately): tell the user to open `~/.claude/foreman/config.json` and add a line `"api_key": "<key>"` to that agent themselves. Remind them the key is stored in plain text, so the file shouldn't be committed or shared.
       - **In an environment variable**: write `"api_key_env": "<name>"` in the config and tell the user to set it themselves: on Windows, add a user variable under "System Properties → Environment Variables", or run `[Environment]::SetEnvironmentVariable('<name>', '<key>', 'User')` in PowerShell; on macOS and Linux, put it in the shell's startup file. Claude Code must be restarted to see it.
     - **Don't ask the user to paste the key into the chat.** If the user has already pasted one and explicitly asks for it to be written into the config, you may put it in `api_key` in the user config (never a project config), and remind them that the key is now in the conversation history and should be replaced with a new one later.
   - **Only API, no Codex or opencode**: explain that hands-on work and reviews can only be done by Claude itself; for an outside agent to do work or reviews, Codex or opencode is needed.
   - **Nothing at all**: explain that Claude currently does all the work itself. To bring in outside models, the user can:
     - install the Codex CLI (`npm install -g @openai/codex`, then run `codex login`);
     - install opencode (`npm install -g @opencode/cli`);
     - or get an API key.

     Then run `/foreman-en:setup` again.
4. **Confirm**: run `config` afterwards to confirm the change, and `check --agent <ID>` for each new agent. With an environment variable, check only after the user restarts; you can ask them to run `/foreman-en:setup` again then.
5. **Wrap up**: in two or three sentences, say:
   - what works now and what's still missing;
   - how to use it day to day: just ask Claude to do things; larger tasks go out per the config, and complex designs get discussed first; `/foreman-en:run`, `/foreman-en:discuss` and `/foreman-en:review` name a task type directly.
