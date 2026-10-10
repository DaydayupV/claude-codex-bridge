---
description: 在终端面板里实时查看 Codex 任务的运行情况
argument-hint: [run_id | last]
---

在用户的终端面板里打开 Codex 实时进度。参数是 `$ARGUMENTS`。

按 `codex-bridge:codex-dispatch` skill 里"实时查看"一节的做法，用 `run_in_terminal` 运行 watch 启动器：
- 没有参数：跟踪当前正在运行的任务，没有的话显示最近一次
- 给了 run_id 或 `last`：在命令后面加 `--run <参数>`

打开后把标签页链接发给用户。
