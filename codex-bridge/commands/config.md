---
description: 查看或修改 codex-bridge 的配置（各等级的模型和推理强度、沙箱、超时等）
argument-hint: [要改的设置，例如"复杂任务换成 gpt-6.1-sol、ultra"]
---

用户要查看或修改 codex-bridge 的配置。参数：

$ARGUMENTS

1. 运行 `node "${CLAUDE_PLUGIN_ROOT}/skills/codex-dispatch/scripts/codex-run.mjs" config --cwd "<当前项目目录>"`，查看实际生效的配置和配置文件路径。字段含义见 `codex-bridge:codex-dispatch` skill 的"配置"一节。
2. 没有参数时，用简短的中文表格向用户展示每项当前的值和来源（内置默认、用户配置或项目配置），就此结束。
3. 有参数时，按用户要求修改配置文件：
   - 默认改用户配置。用户说只对当前项目生效时，改项目配置，但沙箱、审批、`codex_bin`、`runs_dir` 只能写在用户配置里。
   - 只改用户提到的字段，其余保持原样。
4. 改完再运行一次 `config` 确认生效，告诉用户改了什么。
