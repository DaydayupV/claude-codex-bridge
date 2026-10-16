---
description: 设置引导：检测本机有哪些工具（Codex、opencode、API key），说明现在的安排，按需加入要用的模型
argument-hint: [可选：要添加的模型，例如"加 DeepSeek"、"用 opencode 的 GLM"]
---

用户要设置 foreman。参数：

$ARGUMENTS

脚本路径是 `${CLAUDE_PLUGIN_ROOT}/skills/dispatch/scripts/cli.mjs`。配置的写法见 `${CLAUDE_PLUGIN_ROOT}/skills/dispatch/references/config.md`，动手改配置前先读它。按下面的顺序进行，每一步用简短的中文告诉用户结果。

1. **检查环境**：运行 `node "<脚本路径>" check` 和 `node "<脚本路径>" config --cwd "<当前项目目录>"`。
   - 用一张表说明本机有什么，来自 `config` 的 `environment` 字段：
     - Codex：有没有、登录没有；
     - opencode：有没有、几个可用模型；
     - API key：检测到哪些环境变量。
   - 用另一张表说明配置里每个协作方的检查结果，来自 `check` 的 `agents`。不通过的转告 `fix`。
   - Node.js 不通过时插件用不了，转告 `fix` 后结束。Git 不通过时，告诉用户改动追踪用不了、建议安装，但可以继续。实时查看（`watch`）不通过只影响桌面版终端面板里自动打开实时进度，可以继续。
   - 脚本输出了"首次使用，已生成配置文件"时，转告它检测到了什么、生成了什么。
2. **说明现在的安排**：用表格说明 `resolved_levels`：执行、审查、讨论的每一级交给谁、什么模型和推理强度。写成 `"claude code"` 的说成"Claude 自己做"或"不找外部模型"。
3. **按环境给建议**：参数里已经写了要加什么就直接做；否则按下面的情况给出推荐，问用户要不要加。每次只改用户确认了的部分。
   - **有 Codex**：执行和审查保持现在的安排即可。可以问一句要不要加别的模型参加讨论。
   - **有 opencode**：
     - 运行 `opencode models`（只读）看能用哪些模型。要的模型不在列表里时，请用户自己在终端运行 `opencode`，在里面用 `/connect` 登录（OpenCode Go 选 OpenCode Go），登录后再看一次。
     - 推荐一两个模型参加讨论。用 OpenCode Go 时说明：额度按模型分开算，额度少的高档模型（比如 Kimi K3、Qwen Max）建议只放在复杂级。
     - 用户选好后，在用户配置的 `agents` 里每个模型加一项 `{ "type": "opencode cli", "model": "<提供方/模型>" }`，代号用模型名（`/` 后面那段），加进 `levels.discuss` 的对应等级。推理强度不写，用户指定了 variant 再写。
     - opencode 能做审查和讨论，执行以后的版本才支持。想让它做审查，加进 `levels.review` 的对应等级。
   - **有 API key，或者用户要接某家的 API**：
     - 自动生成的配置里，检测到 key 的厂商已经有协作方，只是还没加入讨论。问用户要不要加入，加哪几级。
     - 配置里还没有的厂商（比如 GLM、通义千问、OpenRouter）：确认厂商、模型名和接口地址，拿不准时查厂商的官方文档，不要猜。在 `agents` 里加一项 `{ "type": "api", "base_url": "...", "model": "..." }`，代号用模型名。
     - key 有两种放法，问用户选哪种：
       - **写在配置文件里**（改完立即生效）：告诉用户打开 `~/.claude/foreman/config.json`，在这个协作方里加一行 `"api_key": "<key>"`，自己填上。提醒用户 key 是明文保存的，这个文件不要提交或分享。
       - **放在环境变量里**：配置里写 `"api_key_env": "<变量名>"`，告诉用户自己设置：Windows 上在"系统属性 → 环境变量"里加一个用户变量，或者在 PowerShell 里运行 `[Environment]::SetEnvironmentVariable('<变量名>', '<key>', 'User')`；macOS 和 Linux 写进 shell 的启动文件。设置后要重启 Claude Code 才能读到。
     - **不要让用户把 key 发到对话里。** 用户已经主动发了、并明确要求写进配置时，可以写进用户配置的 `api_key`（不能写进项目配置），同时提醒用户：这个 key 已经出现在对话记录里，建议之后换一个新的。
   - **只有 API、没有 Codex 和 opencode**：说明执行和审查只能由 Claude 自己做；想让外部模型干活或审查，需要装 Codex 或 opencode。
   - **什么都没有**：说明插件现在由 Claude 自己完成所有工作。想接入外部模型，可以：
     - 装 Codex CLI（`npm install -g @openai/codex`，再运行 `codex login`）；
     - 装 opencode（`npm install -g @opencode/cli`）；
     - 或者准备一个 API key。

     装好后再运行一次 `/foreman:setup`。
4. **确认**：改完运行 `config` 确认生效，对新加的协作方运行 `check --agent <代号>` 确认能用。环境变量方式要等用户重启之后再检查，可以请用户重启后再运行一次 `/foreman:setup`。
5. **结束**：用两三句话总结：
   - 现在哪些可以用、还有什么没弄好；
   - 平时怎么用：直接让 Claude 做事即可，大任务会按配置派出去，复杂方案会先讨论；也可以用 `/foreman:run`、`/foreman:discuss`、`/foreman:review` 点名。
