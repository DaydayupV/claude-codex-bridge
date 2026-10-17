# 配置字段说明

配置文件是 JSON，按下面的顺序叠加，后面的覆盖前面的：
1. 脚本内置默认值；
2. 用户配置 `~/.claude/foreman/config.json`（可以用环境变量 `FOREMAN_CONFIG` 换路径）；
3. 项目配置 `<项目目录>/.claude/foreman.json`。

配置分三块：

| 块 | 回答的问题 |
|---|---|
| `dispatch` | 插件怎么派活：是否主动派、并发数、超时等 |
| `agents` | 有哪些协作方，怎么连接 |
| `levels` | 每类任务的每个等级交给谁，用什么推理强度 |

连接方式只写在 `agents`，分派只写在 `levels`。

示例：

```json
{
  "agents": {
    "gpt-6.1-sol": { "type": "codex cli", "model": "gpt-6.1-sol" },
    "gpt-6-astra": { "type": "codex cli", "model": "gpt-6-astra" },
    "glm-5.3":     { "type": "opencode cli", "model": "opencode-go/glm-5.3" },
    "deepseek-v4-pro": { "type": "api", "base_url": "https://api.deepseek.com", "api_key_env": "DEEPSEEK_API_KEY", "model": "deepseek-v4-pro" }
  },
  "levels": {
    "run":     { "simple": "claude code", "normal": "claude code", "complex": { "agent": "gpt-6.1-sol", "effort": "max" } },
    "review":  { "simple": { "agent": "gpt-6.1-sol", "effort": "medium" }, "normal": { "agent": "gpt-6.1-sol", "effort": "high" }, "complex": { "agent": "gpt-6-astra", "effort": "max" } },
    "discuss": { "simple": "claude code", "normal": [{ "agent": "gpt-6.1-sol", "effort": "high" }], "complex": [{ "agent": "gpt-6-astra", "effort": "max" }, { "agent": "glm-5.3" }, { "agent": "deepseek-v4-pro", "effort": "max" }] }
  }
}
```

## dispatch

| 字段 | 作用 | 默认 |
|---|---|---|
| `auto` | 是否主动派活（见 skill 的"授权"一节） | `true` |
| `watch` | `auto`：只要派给了其他模型（执行、续接、讨论、审查）就打开实时查看；`off`：不主动打开，想看时用 `/foreman:watch` | `auto` |
| `discuss_max_rounds` | 一场讨论最多几轮（第 1 轮加上之后的续接），每个参与方各自计数；超出后脚本拒绝续接 | `2` |
| `timeout_min` | 单次任务的总超时（分钟） | `480` |
| `stall_min` | 多久没有动静判定为卡死（分钟，0 为关闭）。Codex：没有任何事件，也没有命令在执行；API：流式输出里没有任何数据；opencode：没有输出任何事件；pi：没有输出任何事件，也没有工具在运行 | `40` |
| `busy_ask_min` | API 协作方因为服务繁忙排队超过多少分钟，就由 Claude 决定要不要终止它（0 为不处理） | `2` |
| `runs_dir` | 运行记录目录（也可用环境变量 `FOREMAN_RUNS_DIR`） | `~/.claude/foreman/runs` |

## agents

- 键是协作方的**代号**，`levels` 和 `--agent` 用它引用。建议直接用模型名。
- 代号只能用字母、数字、`.`、`-`、`_`，以字母或数字开头；不能叫 `claude` 或 `claude code`。
- `type` 决定怎么连接、要填哪些字段，只有三种。同一种可以配多个，各用不同的模型。
- Codex 不是必需的，一个协作方都不配也行：那样所有任务都由 Claude 自己做。

**`type: "codex cli"`**（本机的 Codex CLI）

| 字段 | 作用 | 默认 |
|---|---|---|
| `model` | 模型 | 不写就沿用 `~/.codex/config.toml` |
| `bin` | codex 可执行文件或 `codex.js` 路径（也可以用环境变量 `CODEX_BIN`） | 自动查找 |
| `max_parallel` | 这个协作方同时最多运行几个任务，所有任务组和会话加起来算（见 skill 的"并发拆分"一节） | `4` |
| `sandbox` | `run` / `review` / `discuss` 各自的沙箱：`read-only` / `workspace-write` / `danger-full-access` | 全部 `null`，沿用 Codex 配置 |
| `approval` | 审批策略 | 不写时用 `never`：无人值守，没人能审批 |

**`type: "opencode cli"`**（本机的 opencode CLI）

| 字段 | 作用 |
|---|---|
| `model` | 必填，写成 `提供方/模型`，比如 `opencode-go/glm-5.3`。`opencode models` 列出的都能用 |
| `bin` | 可选，opencode 可执行文件路径。默认自动查找 |
| `max_parallel` | 可选，默认 `4` |
| `run_access` | 可选，允许它做执行任务：`"edit"` 只能读写项目目录里的文件、不能运行命令；`"shell"` 还能运行命令。不写就不能放进 `levels.run`，也不能被点名派执行 |

登录和 key 都由 opencode 自己管（比如 OpenCode Go 要先在 opencode 里运行 `/connect` 登录），插件不碰。讨论和审查时，脚本给 opencode 注入一个只读代理，只有读文件、搜索和列目录的工具：它能自己翻项目里的代码，但不能运行命令，也不能改文件。审查时要看的改动由脚本用 git 算好附给它。

执行时注入的代理按 `run_access` 开放写文件，`shell` 档再开放运行命令。opencode **没有系统沙箱**：
- `edit` 档写不了项目目录以外的文件，也没有运行命令的工具；
- `shell` 档的命令以你的账户权限运行，能访问整台机器。

两档都必须先拍改动快照才开始执行（不能 `--no-snapshot`），改动靠事后审查 diff 把关。

**`type: "pi cli"`**（本机的 pi CLI，npm 包 `@earendil-works/pi-coding-agent`）

| 字段 | 作用 |
|---|---|
| `model` | 必填，写成 `提供方/模型`，比如 `deepseek/deepseek-flash`。`pi --list-models` 列出的都能用 |
| `bin` | 可选，pi 可执行文件或它的 `cli.js` 的路径。默认自动查找 |
| `max_parallel` | 可选，默认 `4` |
| `run_access` | 可选，和 opencode 一样：`"edit"` 或 `"shell"`，只能写在用户配置里。不写就不能放进 `levels.run`，也不能被点名派执行 |

登录和 key 由 pi 自己管（在 pi 里用 `/login`，或者设置厂商的 API key 环境变量），插件不碰。pi 本身没有权限系统，脚本每次调用都：
- 只开放这次任务需要的工具：讨论和审查只有读文件、搜索和列目录；执行的 `edit` 档再加编辑和写文件，`shell` 档再加运行命令；
- 注入 foreman 的守卫扩展：文件工具的路径不能出项目目录（`shell` 档运行的命令不受它限制）；
- 不加载你装的扩展、skill、提示模板、MCP 和项目里的 `.pi` 设置；项目的 AGENTS.md / CLAUDE.md 照常读；
- 会话存在 pi 的默认位置，在 pi 里用 `/resume` 也能找到。

和 opencode 一样没有系统沙箱，两档都必须先拍改动快照才开始执行。

**`type: "api"`**（兼容 OpenAI 接口的模型）

| 字段 | 作用 |
|---|---|
| `base_url` | 接口地址，例如 `https://api.deepseek.com`，脚本请求 `<base_url>/chat/completions` |
| `api_key` | API key 本身。明文保存在配置文件里，改完立即生效；只能写在用户配置中。留空 `""` 表示还没填 |
| `api_key_env` | 存放 API key 的环境变量名；设置环境变量后要重启 Claude Code 才能读到。两个都填时用 `api_key`；两个都没有的协作方不能参加讨论，放进讨论等级会在运行时报错 |
| `model` | 必填，模型 |
| `max_parallel` | 可选，默认 `4` |
| `extra_body` | 可选，原样并进请求体的参数，比如 `{ "max_tokens": 65536 }` |

### 能做什么（能力表）
`config` 输出的 `agents_status.<代号>.capabilities` 列出每个协作方能做什么。配置校验也按它来：把协作方放进它做不了的任务，会报错。

| | codex cli | opencode cli | pi cli | api |
|---|---|---|---|---|
| 能做的任务（`modes`） | 执行、审查、讨论 | 执行（要写 `run_access`）、审查、讨论 | 执行（要写 `run_access`）、审查、讨论 | 讨论 |
| 隔离（`isolation`） | 系统沙箱（`os`），看沙箱配置 | 只有工具权限（`tools`） | 只有工具权限加守卫扩展（`tools`） | 无（`none`），只收发文字 |
| 自己读代码（`reads_code`） | 能 | 能 | 能 | 不能，靠附带文件 |
| 原生格式约束（`native_schema`） | 有 | 没有，靠提示词加一次修复 | 没有，同左 | 没有，同左 |
| 原生审查（`native_review`） | 有 | 没有 | 没有 | 没有 |
| 出图（`images`） | 能 | 不能 | 不能 | 不能 |

## levels

`run` / `review` / `discuss` 三种任务，各有 `simple` / `normal` / `complex` 三级。每一级可以写：
- `"claude code"`：执行由 Claude 自己做；审查和讨论表示这一级不找外部协作方。三种任务都可以这样写。
- `run` 和 `review`：`{ "agent": "<代号>", "effort": "<推理强度>" }`。
- `discuss`：参与方数组，可以一方也可以多方，例如 `[{ "agent": "gpt-6-astra", "effort": "max" }, { "agent": "deepseek-v4-pro", "effort": "max" }]`。同一个协作方在一级里只能出现一次。

`effort` 可以不写，不写就用工具或模型自己的默认值。各类型的写法：
- `codex cli`：`low`、`medium`、`high`、`xhigh`、`max`、`ultra`。每个模型支持哪些以 Codex 自带的模型清单为准（比如 gpt-5.5 最高到 `xhigh`），`check` 会按清单核对。
- `api`：原样作为 `reasoning_effort` 发出（DeepSeek 接受 `low` / `high` / `max`）；写 `null` 表示不发。没有推理强度参数的模型写 `null`，比如小米 MiMo（只有思考开关，默认开启）。
- `opencode cli`：模型的 variant（比如 `high`），拼成 `-m 模型#variant` 传给 opencode；`null` 表示用模型的默认设置。各模型有哪些 variant 不一样（比如免费的 DeepSeek 模型接受 `low`、`high`、`max`，不接受 `medium`），写错了 opencode 会报错。写 `default` 和不写一样。改完运行 `check`：opencode 的模型清单里没有的 variant 直接报出，其余逐个试一遍。
- `pi cli`：`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`，作为 `--thinking` 传给 pi。每个模型支持哪些不一样（比如 deepseek-flash 是 off / low / high / max），以 pi 的模型清单为准。**写了不支持的档位，pi 不会报错，会悄悄换成最接近的一档**（先往高处找，所以可能更贵），改完一定要运行 `check`，它按清单核对。

向用户汇报时，不写和 `null` 都说成"推理强度：默认"。

各模型能选哪些推理强度，运行 `models` 查看：Codex、opencode 和 pi 读它们自带的模型清单；API 只能列出模型名，推理强度要查厂商的官方文档。

等级里还可以写 `model` 覆盖协作方的模型，旧配置里有这种写法照常能用。新配置不推荐：代号和实际模型会对不上。想换模型，就新加一个协作方。

内置默认值：没有协作方，九格都是 `"claude code"`。实际的安排来自第一次运行时生成的配置（见下文）。

## 第一次运行时生成的配置
用户配置不存在时，脚本第一次运行（任何子命令）会先检测本机，再生成配置。`config` 输出的 `environment` 字段也会列出检测结果。检测这几样：
- 有没有能用的 Codex：能启动、已登录；
- 有没有 opencode：能启动，`opencode models` 列出了几个模型；
- 有没有 pi：能启动，`pi --list-models` 列出了几个模型；
- 常见 API key 的环境变量：`DEEPSEEK_API_KEY`、`KIMI_API_KEY` / `MOONSHOT_API_KEY`、`MIMO_API_KEY`。

按检测结果生成：

| 检测到 | 生成的内容 |
|---|---|
| 能用的 Codex | 两个 `codex cli` 协作方 `gpt-6.1-sol` 和 `gpt-6-astra`。执行：simple、normal 由 Claude 做，complex 用 gpt-6.1-sol max。审查：gpt-6.1-sol medium / high，complex 用 gpt-6-astra max。讨论：gpt-6.1-sol medium / high，complex 用 gpt-6-astra max |
| 没有能用的 Codex | 九格都是 `"claude code"` |
| API key | 每家一个 `api` 协作方，`api_key_env` 指向检测到的变量，代号用模型名，**不放进等级** |
| opencode、pi | 不写，要用哪个模型由 `/foreman:setup` 引导用户选 |

花钱或有安全影响的决定（用哪个 opencode 或 pi 模型、让 API 模型参加讨论）都不会自动做，统一由 `/foreman:setup` 问用户。以后装了新工具，重跑 setup 就能补进配置。

## 从旧配置升级
- 从 codex-bridge 升级时，旧的 `~/.claude/codex-bridge.json` 会先复制到新位置。
- 第一次读到旧写法时，脚本自动改写配置文件，原文件备份为 `config.json.bak`：
  - `type`：`codex` → `codex cli`，`opencode` → `opencode cli`，`openai-compatible` → `api`；
  - 等级里的 `"claude"` → `"claude code"`；
  - 协作方代号改成模型名，比如 `codex` → `gpt-6-astra`、`deepseek` → `deepseek-flash`，`levels` 里的引用一起改；
  - 等级里覆盖了模型的，拆成一个新协作方。
- 改写前后，每一级实际用的模型和推理强度不变。
- 新旧代号的对照记在 `~/.claude/foreman/agent-aliases.json`：续接旧任务、`--agent` 写旧代号、项目配置里的旧代号，都会自动换成新代号。
- 更早（0.10 以前）的写法，比如 `auto_dispatch`、顶层的 `model` 和 `sandbox`，也会一并转换。

## 项目配置：只能收紧
- 项目配置只认 `dispatch.timeout_min`、`dispatch.stall_min`、`dispatch.busy_ask_min` 和 `levels`，其他字段都会被忽略并提示，包括 `agents` 整块。
- `levels` 可以只写要改的那几格。每一格只能：
  - 改成 `"claude code"`；
  - `run` / `review`：保留用户配置这一格的同一个协作方，可以改推理强度；
  - `discuss`：从用户配置这一格的参与方里选一部分，可以改推理强度。
- 写了别的协作方、或者覆盖模型的，会被忽略。
- 这样别人的仓库没法借项目配置换掉执行方（比如从有沙箱的 Codex 换成没沙箱的工具）、把代码发给新的厂商，或者擅自花用户的额度。敏感项目可以把讨论改成只留 Codex，或者干脆写成 `"claude code"`。

## 其他规则
- 每个协作方的并发上限按它自己正在运行的任务算，不分任务组、不分会话；达到上限时脚本拒绝启动新任务，报错里列出占着名额的任务。
- 沙箱不是 `read-only` / `workspace-write` 时（比如 `danger-full-access`），Codex 能写任何目录，`--cwd` 只决定它从哪里开始工作，**不限制写入范围**。这时范围只能靠任务说明约束，再靠事后审查 diff 把关。
- 用户改了配置，改完运行 `config` 确认：
  - `resolved_levels` 列出每一级最终用谁、什么模型和推理强度；
  - `agents_status` 列出每个协作方的类型、能力、key 是否已设置、实际用的可执行文件；
  - `summary` 是总配置情况：每一格交给谁，每个协作方用在哪几格，以及提醒（没用到的协作方、明文 key、shell 权限用于执行、`agent-aliases.json` 里指向已不存在代号的旧代号）。`check` 的输出里也有，并带上检查结果。
