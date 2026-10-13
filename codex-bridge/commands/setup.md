---
description: 第一次使用时的设置引导：检查 Codex 等环境，查看配置，按需添加其他模型参加讨论
argument-hint: [可选：要添加的模型，例如"加 DeepSeek"]
---

用户要设置 codex-bridge。参数：

$ARGUMENTS

脚本路径是 `${CLAUDE_PLUGIN_ROOT}/skills/codex-dispatch/scripts/codex-run.mjs`。按下面的顺序进行，每一步用简短的中文告诉用户结果：

1. **检查环境**：运行 `node "<脚本路径>" check`，用表格展示每一项的结果（Node.js、Git、Codex、各个 API 模型）。
   - Codex 是必需的。`codex.ok` 为 `false` 时，把结果里的 `fix` 转告用户（比如安装 Codex CLI、运行 `codex login`），请用户处理好之后再运行一次 `/codex-bridge:setup`，到这里就结束。
   - Git 不通过时，告诉用户改动追踪用不了，建议安装，但可以继续。
   - API 模型是可选的，不通过时转告 `fix`，不影响继续。
   - 脚本输出了"首次使用，已生成配置文件"时，告诉用户配置文件在哪里。
2. **查看配置**：运行 `node "<脚本路径>" config --cwd "<当前项目目录>"`，用表格说明 `resolved_levels`：执行、审查、讨论的每个等级分别交给谁、什么模型和推理强度。再说一句：想改的话用 `/codex-bridge:config`。
3. **其他模型（可选）**：问用户要不要让其他模型参加讨论；参数里已经写了要加的模型就不用问。不要的话跳到第 4 步。要的话：
   - 确认厂商（比如 DeepSeek、Kimi、GLM、通义千问、OpenRouter，或者其他兼容 OpenAI 接口的服务）、模型名，以及参加哪些等级的讨论。接口地址和模型名拿不准时，查该厂商的官方文档，不要猜。
   - 在用户配置的 `agents` 里加一项 `type` 为 `openai-compatible` 的协作方，在 `levels.discuss` 的对应等级加上它。key 有两种放法，问用户选哪种：
     - **写在配置文件里**（改完立即生效，不用重启）：告诉用户打开 `~/.claude/codex-bridge.json`，在这个协作方里加一行 `"api_key": "<key>"`，自己填上。提醒用户 key 是明文保存的，这个文件不要提交或分享。
     - **放在环境变量里**：配置里写 `"api_key_env": "<变量名>"`（比如 `DEEPSEEK_API_KEY`），告诉用户自己设置：Windows 上在"系统属性 → 环境变量"里加一个用户变量，或者在 PowerShell 里运行 `[Environment]::SetEnvironmentVariable('<变量名>', '<key>', 'User')`；macOS 和 Linux 写进 shell 的启动文件。设置后要重启 Claude Code 才能读到。
   - **不要让用户把 key 发到对话里。** 用户已经主动发了、并明确要求写进配置时，可以写进用户配置的 `api_key`（不能写进项目配置），同时提醒用户：这个 key 已经出现在对话记录里，建议之后换一个新的。
   - 改完运行 `config` 确认，再运行 `check --agent <名字>` 确认能连通。环境变量方式要等用户重启之后再检查，可以请用户重启后再运行一次 `/codex-bridge:setup`。
4. **结束**：用两三句话总结：现在哪些可以用、还有什么没弄好，以及平时怎么用（直接让 Claude 做事即可，大任务会自动派给 Codex，复杂方案会先讨论；也可以用 `/codex-bridge:rescue`、`/codex-bridge:discuss`、`/codex-bridge:review` 点名）。
