# 配置字段说明

配置文件是 JSON，按顺序叠加，后面的覆盖前面的：脚本内置默认值 → 用户配置 `~/.claude/codex-bridge.json`（可用环境变量 `CODEX_BRIDGE_CONFIG` 换路径）→ 项目配置 `<项目目录>/.claude/codex-bridge.json`。

| 字段 | 作用 | 默认 |
|---|---|---|
| `auto_dispatch` | 是否主动派活（见 skill 的"授权"一节） | `true` |
| `watch` | `auto`：派活后打开实时查看；`off`：不主动打开 | `auto` |
| `max_parallel` | 同一任务组里最多同时运行几个任务（见 skill 的"并发拆分"一节） | `4` |
| `discuss_max_rounds` | 一场讨论最多几轮（第 1 轮加上之后的续接）；超出后脚本拒绝续接 | `2` |
| `model` | 各等级没单独写模型时用的模型 | `null`，沿用 Codex 配置 |
| `levels` | `run` / `review` / `discuss` 三种模式下，`simple` / `normal` / `complex` 三级任务各自的 `{ "model", "effort" }`。`model` 为 `null` 时用顶层 `model`；`run` 的某一级整项写成 `"claude"`（比如 `"simple": "claude"`），表示这一级由 Claude 自己做、不派给 Codex；`effort` 只能是 `low` `medium` `high` `xhigh` `max` `ultra` | run 的 simple、normal 为 `"claude"`，complex 为 max；review 和 discuss 为 medium / high / max；模型都是 `null` |
| `sandbox` | 三种模式各自的沙箱：`read-only` / `workspace-write` / `danger-full-access` | 全部 `null`，沿用 Codex 配置 |
| `approval` | 审批策略，如 `never` | `null`，沿用 Codex 配置 |
| `timeout_min` / `stall_min` | 总超时 / 卡死判定（分钟，`stall_min` 为 0 时关闭） | 480 / 40 |
| `codex_bin` | codex 可执行文件或 `codex.js` 路径（也可用环境变量 `CODEX_BIN`） | 自动查找 |
| `runs_dir` | 运行记录目录（也可用环境变量 `CODEX_RUNS_DIR`） | `~/.claude/codex-runs` |

- 用户配置不存在时，脚本第一次运行（任何子命令）会自动生成一份：在内置默认值的基础上，顶层模型用 `gpt-6.1-sol`，复杂的审查和讨论用 `gpt-6-astra`。
- 项目配置只认 `model`、`levels`、`timeout_min`、`stall_min`。`levels` 可以只写要改的那几项，比如只改 `run.complex.model`。
- `auto_dispatch`、`watch`、`max_parallel`、`discuss_max_rounds`、沙箱、审批、可执行文件和记录目录只能写在用户配置里，以免克隆来的仓库给自己提权，或者擅自花用户的额度。
- 沙箱不是 `read-only` / `workspace-write` 时（比如 `danger-full-access`），Codex 能写任何目录，`--cwd` 只决定它从哪里开始工作，**不限制写入范围**。这时范围只能靠任务说明约束，再靠事后审查 diff 把关。
