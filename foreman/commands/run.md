---
description: 把一个执行任务派给 Codex（按任务复杂度选等级，模型和推理强度见配置）
argument-hint: <任务描述> [--level simple|normal|complex | --effort <推理强度>] [--model <模型>]
---

用户要求把下面的任务派给 Codex：

$ARGUMENTS

按 `foreman:dispatch` skill 的流程执行（如果尚未加载，先加载它）。用户是明确点名要派给 Codex 的，所以不再判断这项工作该由谁做：

1. 弄清目标、范围和完成标准。缺少关键信息且无法从代码推断时，先问用户。
2. 按 skill 中的结构写任务说明文件，确定工作目录和任务等级：用户写了 `--level` 或 `--effort` 就照用，否则按 skill 里执行任务的等级标准判断 `--level`；用户写的 `--model` 一起加上。这一级在配置里是 `"claude"` 时，因为用户点名要派给 Codex，照样派出：加 `--agent <Codex 协作方>`（一般是 `codex`，见 skill 的"分工"）。涉及命名、注释或提示文字的，在任务说明里提前写好。
3. 用 `bridge.mjs run` 在后台运行，并在对话里告诉用户这次用的模型和推理强度（以脚本启动时输出的第一行为准）。
4. 完成后按 skill 的验收流程审查 diff、实际运行验证，必要时返工，再向用户汇报。
