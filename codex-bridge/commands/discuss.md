---
description: 就复杂的计划、方案或想法与 Codex 讨论（只讨论不执行，由 Claude 主导结论）
argument-hint: <议题> [--effort high|max]
---

用户要求就下面的议题与 Codex 讨论：

$ARGUMENTS

按 `codex-bridge:codex-dispatch` skill 里"讨论模式"一节执行（如果尚未加载，先加载它）。用户已明确要求，所以跳过自动开启的门槛判断：

1. 弄清议题、约束和要回答的问题。缺少关键信息且无法从代码或上下文推断时，先问用户。
2. 写第 1 轮的议题说明（不写自己的倾向），用 `codex-run.mjs discuss` 在后台发起，并打开实时查看标签页。用户写了 `--effort` 就照用，否则用 max。
3. 在读 Codex 的结果之前，先把自己的方案写下来。
4. 按流程进行交叉挑错，最多 3 轮。
5. 逐条裁决 Codex 的观点，用决策记录的格式向用户汇报。
