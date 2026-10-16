# 配置字段说明

配置文件是 JSON，按顺序叠加，后面的覆盖前面的：脚本内置默认值 → 用户配置 `~/.claude/foreman/config.json`（可用环境变量 `FOREMAN_CONFIG` 换路径）→ 项目配置 `<项目目录>/.claude/foreman.json`。

配置分三块：

| 块 | 回答的问题 |
|---|---|
| `dispatch` | 插件怎么派活：是否主动派、并发数、超时等 |
| `agents` | 有哪些协作方，怎么连接 |
| `levels` | 每类任务的每个等级交给谁，用什么模型和推理强度 |

连接方式只写在 `agents`，分派只写在 `levels`。模型在 `agents` 里写默认值，`levels` 里需要时再覆盖。

## dispatch

| 字段 | 作用 | 默认 |
|---|---|---|
| `auto` | 是否主动派活（见 skill 的"授权"一节） | `true` |
| `watch` | `auto`：派活后打开实时查看；`off`：不主动打开 | `auto` |
| `discuss_max_rounds` | 一场讨论最多几轮（第 1 轮加上之后的续接），每个参与方各自计数；超出后脚本拒绝续接 | `2` |
| `timeout_min` | 单次任务的总超时（分钟） | `480` |
| `stall_min` | 多久没有动静判定为卡死（分钟，0 为关闭）。Codex：没有任何事件，也没有命令在执行；API 协作方：流式输出里没有任何数据；opencode 协作方：没有输出任何事件 | `40` |
| `busy_ask_min` | API 协作方因为服务繁忙排队超过多少分钟，就由 Claude 决定要不要终止它（0 为不处理） | `2` |
| `runs_dir` | 运行记录目录（也可用环境变量 `FOREMAN_RUNS_DIR`） | `~/.claude/foreman/runs` |

## agents

键是协作方的名字，`levels` 里用这个名字引用。`claude` 是保留字。`type` 决定要填哪些字段。

**`type: "codex"`**（必需，有且只有一个，内置的叫 `codex`）

| 字段 | 作用 | 默认 |
|---|---|---|
| `bin` | codex 可执行文件或 `codex.js` 路径（也可用环境变量 `CODEX_BIN`） | `null`，自动查找 |
| `model` | 默认模型 | `null`，沿用 `~/.codex/config.toml` |
| `max_parallel` | 同时最多运行几个 Codex 任务，所有任务组和会话加起来算（见 skill 的"并发拆分"一节） | `4` |
| `sandbox` | `run` / `review` / `discuss` 各自的沙箱：`read-only` / `workspace-write` / `danger-full-access` | 全部 `null`，沿用 Codex 配置 |
| `approval` | 审批策略 | 不写时用 `never`（无人值守，没人能审批） |

**`type: "openai-compatible"`**（兼容 OpenAI 接口的模型，可以有多个；目前只能参加讨论）

| 字段 | 作用 |
|---|---|
| `base_url` | 接口地址，例如 `https://api.deepseek.com`，脚本请求 `<base_url>/chat/completions` |
| `api_key` | API key 本身。明文保存在配置文件里，改完立即生效；只能写在用户配置中。留空 `""` 表示还没填 |
| `api_key_env` | 存放 API key 的环境变量名；设置环境变量后要重启 Claude Code 才能读到。都填时用 `api_key`；两个都没有的协作方不能参加讨论，放进讨论等级会在运行时报错 |
| `model` | 默认模型 |
| `max_parallel` | 可选，同时最多运行几个任务，默认 `4` |
| `extra_body` | 可选，原样并进请求体的参数，比如 `{ "max_tokens": 65536 }` |

**`type: "opencode"`**（通过本机的 opencode CLI 调用模型，可以有多个；只能参加讨论）

| 字段 | 作用 |
|---|---|
| `model` | 模型，写成 `厂商/模型`，比如 `opencode-go/glm-5.3`。`opencode models` 列出的都能用 |
| `bin` | 可选，opencode 可执行文件路径。默认自动查找 |
| `max_parallel` | 可选，同时最多运行几个任务，默认 `4` |

登录和 key 都由 opencode 自己管（比如 OpenCode Go 要先在 opencode 里运行 `/connect` 登录），插件不碰。讨论时脚本给 opencode 注入一个只读代理，只有读文件、搜索和列目录的工具：参与方能自己翻项目里的代码，但不能运行命令，也不能改文件。

## levels

`run` / `review` / `discuss` 三种模式，各有 `simple` / `normal` / `complex` 三级。

- `run` 和 `review` 的每一级：`{ "agent": "<协作方>", "model": "<可选>", "effort": "<推理强度>" }`。`run` 的某一级也可以整项写成 `"claude"`，表示这一级由 Claude 自己做，不派出去。
- `discuss` 的每一级：参与方数组，可以一方也可以多方，例如 `[{ "agent": "codex", "effort": "max" }, { "agent": "deepseek", "effort": "max" }]`。同一个协作方在一级里只能出现一次。
- `model` 不写就用 `agents` 里这个协作方的默认模型。
- `effort`：Codex 只能是 `low` `medium` `high` `xhigh` `max` `ultra`；API 协作方原样作为 `reasoning_effort` 发出（DeepSeek 接受 `low` / `high` / `max`），写 `null` 表示不发。没有推理强度参数的模型写 `null`，比如小米 MiMo（只有思考开关，默认开启）。opencode 协作方写的是模型的 variant（比如 `high`），拼成 `-m 模型#variant` 传给 opencode；`null` 表示用模型的默认设置。各模型有哪些 variant 不一样，写错了 opencode 会报错。向用户汇报时，`null` 说成"推理强度：默认"。
- 目前 `run` 和 `review` 只能用 codex 类型的协作方。

默认值：run 的 simple、normal 为 `"claude"`，complex 为 Codex max；review 为 Codex medium / high / max；discuss 三级都只有 Codex，推理强度 medium / high / max。

## 其他规则

- 用户配置不存在时，脚本第一次运行（任何子命令）会自动生成一份：Codex 的默认模型用 `gpt-6.1-sol`，复杂的审查和讨论用 `gpt-6-astra`；另外有 `deepseek` 和 `mimo` 两个示例协作方，`api_key` 留空、不在讨论等级里，用来提醒用户可以加。`check` 会把它们报成"还没有 API key"，用户不打算用时不必处理。
- 旧写法（`auto_dispatch`、顶层 `model`、`sandbox` 等平铺在顶层）的用户配置，脚本第一次运行时会自动改写成新结构，原文件备份为 `config.json.bak`。
- 项目配置只认 `dispatch.timeout_min`、`dispatch.stall_min`、`dispatch.busy_ask_min`、`agents.codex.model` 和 `levels`。`levels` 可以只写要改的那几项。项目配置**不能新增 Codex 以外的协作方**（API 和 opencode）：用户配置里某一级没有的，项目配置加了也会被去掉；但可以删掉，敏感项目用这个办法只留 Codex。旧写法的项目配置在读取时转换，不改写文件。
- 每个协作方的并发上限按它自己正在运行的任务算，不分任务组、不分会话；达到上限时脚本拒绝启动新任务，报错里列出占着名额的任务。
- 其余字段（是否主动派活、并发上限、可执行文件、接口地址和 key、沙箱、审批、记录目录）只能写在用户配置里，以免克隆来的仓库给自己提权、把代码发到别处，或者擅自花用户的额度。
- 沙箱不是 `read-only` / `workspace-write` 时（比如 `danger-full-access`），Codex 能写任何目录，`--cwd` 只决定它从哪里开始工作，**不限制写入范围**。这时范围只能靠任务说明约束，再靠事后审查 diff 把关。
- 用户改配置时，改完运行 `config`：输出里 `resolved_levels` 列出每一级最终用谁、什么模型和推理强度，`agents_status` 列出每个 API 协作方的 key 是否已设置，以及每个 opencode 协作方实际用的可执行文件。
