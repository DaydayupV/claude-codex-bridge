---
description: 在终端里实时查看 Codex 任务的运行情况
argument-hint: [run_id | last | 组名]
---

打开 Codex 实时进度。参数是 `$ARGUMENTS`。

按 `codex-bridge:dispatch` skill 里"实时查看"一节的做法运行 watch 启动器：有 `run_in_terminal` 工具就用它在终端面板里打开，没有就把命令发给用户，请用户在另一个终端里运行。参数：
- 没有参数：跟踪当前正在运行的任务，没有的话显示最近一次
- 给了 run_id 或 `last`：在命令后面加 `--run <参数>`
- 给了任务组名：在命令后面加 `--group <参数>`，一次跟踪整组
- 用户要看完整细节（思考过程、每条命令及其输出、token 用量）时，再加 `--verbose`。默认的简洁显示只有 Codex 说的话、折叠后的命令、文件改动和最终结果。

在终端面板里打开的，把标签页链接发给用户。
