---
description: 把一个执行任务派给 Codex（gpt-6-astra，按任务等级选 medium/high/max）
argument-hint: <任务描述> [--effort medium|high|max]
---

用户要求把下面的任务派给 Codex：

$ARGUMENTS

按 `codex-bridge:codex-dispatch` skill 的流程执行（如果尚未加载，先加载它）。用户是明确点名要派给 Codex 的，所以跳过派活门槛判断：

1. 弄清目标、范围和完成标准。缺少关键信息且无法从代码推断时，先问用户。
2. 按 skill 中的结构写任务说明文件，确定工作目录和推理强度：用户写了 `--effort` 就照用，否则按 skill 里的任务等级表选。涉及命名、注释或提示文字的，在任务说明里提前写好。
3. 用 `codex-run.mjs run` 在后台运行。
4. 完成后按 skill 的验收流程审查 diff、实际运行验证，必要时返工，再向用户汇报。
