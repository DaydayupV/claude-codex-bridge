---
description: 查看或修改 foreman 的配置（协作方、各等级交给谁、模型和推理强度、沙箱、超时等）
argument-hint: [要改的设置，例如"复杂任务换成 gpt-6.1-sol、ultra"]
---

用户要查看或修改 foreman 的配置。参数：

$ARGUMENTS

1. 运行 `node "${CLAUDE_PLUGIN_ROOT}/skills/dispatch/scripts/cli.mjs" config --cwd "<当前项目目录>"`，查看实际生效的配置和配置文件路径。字段含义见 `foreman:dispatch` skill 目录下的 `references/config.md`。
2. 没有参数时，用简短的中文表格向用户展示：
   - `resolved_levels`：每类任务每个等级交给谁、什么模型和推理强度；
   - `agents_status`：有哪些协作方，API 协作方的 key 是否已设置；
   - `dispatch` 里的各项，以及每项的来源（内置默认、用户配置或项目配置）。
   展示完就结束。
3. 有参数时，按用户要求修改配置文件：
   - 默认改用户配置。用户说只对当前项目生效时，改项目配置，但项目配置只认 `dispatch.timeout_min`、`dispatch.stall_min`、`agents.codex.model` 和 `levels`，而且不能新增 API 协作方。
   - 只改用户提到的字段，其余保持原样。
   - 新增 API 协作方时，key 可以写在用户配置的 `api_key` 里（明文，立即生效），也可以放在环境变量里、配置只写 `api_key_env`（设置后要重启 Claude Code）。让用户选，并请用户自己填 key 或设环境变量，不要让用户把 key 发到对话里。key 只能写在用户配置，项目配置里写了也不生效。
4. 改完再运行一次 `config` 确认生效，告诉用户改了什么。
