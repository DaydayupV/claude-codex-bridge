# claude-codex-bridge

[English](README.en.md)

一个 Claude Code 插件：让 Claude 把执行类编码工作派给 OpenAI Codex，再由 Claude 验收；也可以让 Codex 独立审查代码，或者在复杂方案上让 Codex 和其他模型（比如 DeepSeek）一起给意见，由 Claude 裁决。

分工的思路是：Claude 负责规划、核心决策、设计和文字，Codex 负责其余的执行工作。Codex 用的是你自己的 OpenAI 额度，不占 Claude 的额度。

## 能做什么

| 命令 | 作用 |
|---|---|
| `/codex-bridge:rescue <任务>` | 把一个执行任务派给 Codex，完成后 Claude 审查改动、实际运行验证，不合格就返工 |
| `/codex-bridge:discuss <议题>` | 就复杂的方案和 Codex（以及配置的其他模型）讨论，交叉挑错（轮数上限可配置，默认 2 轮），由 Claude 逐条裁决，最后给出决策记录 |
| `/codex-bridge:review` | 让 Codex 审查未提交的改动、某个分支或某次提交，Claude 逐条核实，排除误报 |
| `/codex-bridge:status` | 查看最近的任务，或某次任务的详细结果。会列出每次任务的 token 消耗、最近一次请求的用量和 Codex 额度已用比例 |
| `/codex-bridge:watch` | 实时查看 Codex 或其他模型正在做什么。默认简洁显示：说的话、折叠后的命令、文件改动和结果；加 `--verbose` 看全部细节 |
| `/codex-bridge:config` | 查看或修改插件配置 |
| `/codex-bridge:setup` | 第一次使用时的设置引导：检查 Codex 等环境是否可用，说明当前配置，按需添加其他模型参加讨论 |

不用命令也可以。插件自带的 skill 会让 Claude 自己判断：执行类任务达到一定规模时主动派给 Codex，遇到复杂又不确定的方案时先和 Codex 等模型讨论，高风险改动交付前请 Codex 审查。大任务能拆成几份互不相干的部分时，Claude 会同时派给几个 Codex 会话，缩短等待时间（见下文的 `agents.<名字>.max_parallel`）。这个行为可以关掉，见下文的 `dispatch.auto`。为了不让 Claude 忘了这件事（项目里有自己的 skill 时尤其容易漏），插件会在每个会话开始时提醒它一次，并附上你的偏好文件。

每次派活，Claude 都会在对话里写明这次交给了谁、用的模型和推理强度。

## 前提

- [Claude Code](https://claude.com/claude-code)
- [Codex CLI](https://github.com/openai/codex)，已安装并登录（必需）。在终端里运行 `codex exec "hello"` 能正常回复就行
- Node.js 18 或更高版本。在 WSL 里运行 Claude Code 时，WSL 里也要装 Node.js，否则插件的钩子会在每条命令前报错
- Git 2.25 或更高版本，用来追踪 Codex 改了哪些文件
- 可选：想让其他模型参加讨论时，需要对应厂商的 API key（比如 DeepSeek）

## 安装

在 Claude Code 里运行：

```
/plugin marketplace add DaydayupV/claude-codex-bridge
/plugin install codex-bridge@claude-codex-bridge
```

装好后运行 `/codex-bridge:setup`。它会检查 Node.js、Git 和 Codex 能不能用，说明各类任务默认交给谁，并问你要不要让其他模型参加讨论。之后想查看或修改配置，用 `/codex-bridge:config`。

## 配置

第一次使用时，插件会自动生成用户配置 `~/.claude/codex-bridge.json`：simple 和 normal 的执行任务由 Claude 自己做，复杂的执行任务派给 Codex 用 `gpt-6.1-sol`，复杂的审查和讨论用 `gpt-6-astra`。沙箱和审批不在里面设置，沿用 Codex 自己的 `~/.codex/config.toml`。

想调整时，直接编辑这个文件，或者在 Claude 里说"用 `/codex-bridge:config` 把复杂任务改成 ultra"。

配置文件是 JSON，后面的覆盖前面的：

1. 插件内置默认值
2. 用户配置 `~/.claude/codex-bridge.json`（可以用环境变量 `CODEX_BRIDGE_CONFIG` 换路径）
3. 项目配置 `<项目目录>/.claude/codex-bridge.json`

从 0.10 以前的版本升级时，旧写法的用户配置会在第一次运行时自动改成下面的新结构，原文件备份为 `codex-bridge.json.bak`。

### 配置的结构

配置分三块：

| 块 | 管什么 |
|---|---|
| `dispatch` | 插件怎么派活：是否主动派、实时查看、并发、讨论轮数、超时、记录目录 |
| `agents` | 有哪些协作方、怎么连接：Codex 的可执行文件、默认模型、沙箱；API 模型的接口地址、API key（直接写在配置里，或者指定存放它的环境变量）、默认模型 |
| `levels` | 每类任务的每个等级交给谁，用什么模型和推理强度 |

连接方式只写在 `agents`，分派只写在 `levels`。下面是第一次使用时自动生成的配置：

```json
{
  "dispatch": {
    "auto": true,
    "watch": "auto",
    "discuss_max_rounds": 2,
    "timeout_min": 480,
    "stall_min": 40,
    "runs_dir": null
  },
  "agents": {
    "codex": {
      "type": "codex",
      "bin": null,
      "model": "gpt-6.1-sol",
      "max_parallel": 4,
      "sandbox": { "run": null, "review": null, "discuss": null },
      "approval": null
    },
    "deepseek": {
      "type": "openai-compatible",
      "base_url": "https://api.deepseek.com",
      "api_key": "",
      "model": "deepseek-v4-pro"
    },
    "mimo": {
      "type": "openai-compatible",
      "base_url": "https://api.xiaomimimo.com/v1",
      "api_key": "",
      "model": "mimo-v2.6-pro"
    }
  },
  "levels": {
    "run": {
      "simple":  "claude",
      "normal":  "claude",
      "complex": { "agent": "codex", "effort": "max" }
    },
    "review": {
      "simple":  { "agent": "codex", "effort": "medium" },
      "normal":  { "agent": "codex", "effort": "high" },
      "complex": { "agent": "codex", "model": "gpt-6-astra", "effort": "max" }
    },
    "discuss": {
      "simple":  [{ "agent": "codex", "effort": "medium" }],
      "normal":  [{ "agent": "codex", "effort": "high" }],
      "complex": [{ "agent": "codex", "model": "gpt-6-astra", "effort": "max" }]
    }
  }
}
```

其中 `deepseek` 和 `mimo` 是示例：`api_key` 留空，也没有加进讨论等级，所以讨论默认只有 Codex。想让它们参加，见下文"让其他模型参加讨论"。

### 任务等级、模型和推理强度

Claude 只判断任务属于哪一级：简单 `simple`、常规 `normal`、复杂 `complex`。每一级交给谁、用哪个模型和推理强度，由你在 `levels` 里决定。没有隐式默认：Claude 每次都必须给出等级，漏了脚本直接报错，不会悄悄按某个档位运行。

- 每一级写 `agent`（交给 `agents` 里的哪一方）和 `effort`（推理强度）；需要时再写 `model`，覆盖这一方的默认模型。不写 `model` 时用 `agents` 里的默认模型；Codex 的默认模型也是 `null` 时，用 Codex 自己配置的模型。示例只是一种搭配，换成你账号能用、适合你任务的模型。
- Codex 的 `effort` 可选 `low`、`medium`、`high`、`xhigh`、`max`、`ultra`。模型不支持的档位会被 Codex 拒绝，报错会出现在结果里。
- 你想临时指定时，可以对 Claude 说"用 ultra 跑"或"用某某模型跑"，Claude 会改用 `--effort` 或 `--model`。
- `run` 的某一级想让 Claude 自己做、不派给 Codex，就把那一级整个写成 `"claude"`，比如 `"simple": "claude"`。这一级没有模型和推理强度可设：Claude 遇到这一级的执行任务会自己动手，脚本也会拒绝把它派出去。你明确要求某个任务派给 Codex 时，Claude 会加 `--model`，推理强度用内置默认值。审查和讨论需要另一个模型，不支持这样写。
- 不管怎么配置，改动不到约 100 行、做法明确的小任务，Claude 都会自己做：这类任务派出去不划算，Codex 也容易做得过重。

### 让其他模型参加讨论

讨论（`discuss`）的每一级是一个参与方数组：可以只有 Codex，也可以加上兼容 OpenAI 接口的模型。几方同时、各自独立给出意见，Claude 再逐条裁决。以上面配置里的 DeepSeek 示例为例：

1. **填 API key**，两种方式任选一种：
   - **写在配置文件里**：把示例里的 `"api_key": ""` 填上。改完立即生效，不用重启：

     ```json
     "deepseek": {
       "type": "openai-compatible",
       "base_url": "https://api.deepseek.com",
       "api_key": "sk-你的 key",
       "model": "deepseek-v4-pro"
     }
     ```

     key 是明文保存的，这个文件不要提交到仓库或发给别人。
   - **放在环境变量里**：`api_key` 留空，加一行 `"api_key_env": "DEEPSEEK_API_KEY"`，再设置这个环境变量。Windows 上在"系统属性 → 环境变量"里加一个用户变量；macOS 和 Linux 写进 shell 的启动文件。设置后要重启 Claude Code 才能读到。

   两个都填时用 `api_key`。
2. **加进讨论等级**：在 `levels.discuss` 里需要的等级加上它。比如只让复杂的讨论多一方：

   ```json
   "discuss": {
     "simple":  [{ "agent": "codex", "effort": "medium" }],
     "normal":  [{ "agent": "codex", "effort": "high" }],
     "complex": [
       { "agent": "codex", "model": "gpt-6-astra", "effort": "max" },
       { "agent": "deepseek", "effort": "max" }
     ]
   }
   ```

   DeepSeek 的 `effort` 可选 `low`、`high`、`max`。小米 MiMo 没有推理强度可调，只有思考开关（默认开启），写 `{ "agent": "mimo", "effort": null }`。
3. 运行 `/codex-bridge:setup` 确认：模型能连通，每一级的参与方都对。

配置里没有示例的厂商（Kimi、GLM、通义千问、OpenRouter 等），只要兼容 OpenAI 接口，就在 `agents` 里照着示例的格式加一项，名字自己起，再按上面的步骤做；有特殊参数时写在 `extra_body` 里，会原样并进请求。这些步骤也可以交给 `/codex-bridge:setup`，比如运行 `/codex-bridge:setup 加 DeepSeek`：它会帮你改好配置，再告诉你 key 填在哪里。key 由你自己填，不需要发到对话里。

API 模型自己翻不了代码，Claude 会把相关文件随议题一起发过去（每次上限约 30 万字符），并对照原文核实它对代码的说法。目前 API 模型只能参加讨论，不能执行任务或审查。

### 全部字段

| 字段 | 作用 | 默认 |
|---|---|---|
| `dispatch.auto` | `true`：符合条件的任务由 Claude 主动派给 Codex；`false`：Claude 先提议，你同意后再派 | `true` |
| `dispatch.watch` | `auto`：派活后自动打开实时查看；`off`：不主动打开 | `auto` |
| `dispatch.discuss_max_rounds` | 一场讨论最多几轮（第 1 轮加上之后的续接），每个参与方各自计数。达到上限后脚本拒绝再续接，Claude 按已有结果裁决 | `2` |
| `dispatch.timeout_min` | 单次任务的总超时（分钟） | `480` |
| `dispatch.stall_min` | 连续多少分钟没有动静就判定为卡死并结束：Codex 是没有任何活动、也没有命令在执行；API 模型是流式输出里没有任何数据。`0` 表示关闭 | `40` |
| `dispatch.runs_dir` | 运行记录目录（也可以用环境变量 `CODEX_RUNS_DIR`） | `~/.claude/codex-runs` |
| `agents.codex.bin` | codex 可执行文件或 `codex.js` 的路径（也可以用环境变量 `CODEX_BIN`） | 自动查找 |
| `agents.codex.model` | Codex 的默认模型 | `null`，沿用 Codex 配置 |
| `agents.<名字>.max_parallel` | 这个协作方同时最多运行几个任务，所有任务组和会话加起来算（服务商的限流和额度都是按账号的）。达到上限时新任务会被拒绝。对 Codex 来说，拆开并发的份数越多等得越短，但总 token 更多；设成 `1` 就不并发 | `4` |
| `agents.codex.sandbox` | `run` / `review` / `discuss` 各自的沙箱：`read-only`、`workspace-write`、`danger-full-access` | 都是 `null`，沿用 Codex 配置 |
| `agents.codex.approval` | Codex 的审批策略，比如 `never` | `null`，沿用 Codex 配置 |
| `agents.<名字>`（API 模型） | `type` 为 `openai-compatible`；`base_url`、`model` 必填；`api_key`（key 本身，还没填就留空）和 `api_key_env`（存放 key 的环境变量名）任选，都填时用 `api_key`，都没有的不能参加讨论；`extra_body` 可选 | 无 |
| `levels` | 见上文 | run 的 simple、normal 为 `"claude"`，complex 为 Codex max；review 为 Codex medium / high / max；discuss 三级都只有 Codex，medium / high / max |

项目配置只认 `dispatch.timeout_min`、`dispatch.stall_min`、`agents.codex.model` 和 `levels`，而且不能新增 API 模型参与方，只能去掉。其余字段只能写在用户配置里，这样别人的仓库没法通过项目配置放宽沙箱、换掉可执行文件、把代码发到别的地址，或者擅自花你的额度。敏感项目可以在项目配置的 `levels.discuss` 里只留 Codex，关掉 API 模型。

### 偏好文件

有些习惯不好写成 JSON，比如你的项目里哪类代码算高风险、哪些活不想派给 Codex。这些可以用文字写在偏好文件里，Claude 每个会话开始用插件时会读：

- 用户级：`~/.claude/codex-bridge.md`
- 项目级：`<项目目录>/.claude/codex-bridge.md`

和插件自带的规则冲突时，以偏好文件为准，项目级优先于用户级。例如：

```markdown
# codex-bridge 偏好

- 这个项目的计费和对账代码按高风险处理：派活用 complex，改完都请 Codex 审查。
- 数据库迁移脚本不派给 Codex，由 Claude 自己写。
- 改动超过 200 行就请 Codex 审查。
```

## 安全提示

- **沙箱以 Codex 的配置为准。** 如果你的 Codex 配置是 `danger-full-access`，Codex 能读写电脑上的任何目录。任务说明会限定它的改动范围，Claude 事后也会审查 diff，但这些都不是技术上的隔离。想要技术隔离，就在配置里把 `agents.codex.sandbox` 设成 `workspace-write` 或 `read-only`。注意 Codex 在 Windows 上的沙箱支持可能不完整，改了之后要实际测试。
- **Claude 只能通过插件调用 Codex。** 插件带有一个钩子：Claude 直接运行 `codex exec` 或 `codex review` 的命令会被拦下，这样每次调用都有记录、改动追踪和明确的模型和推理强度。你自己在终端里运行 codex 不受影响。
- **后台运行时审批策略要设成 `never`**，否则 Codex 会卡在等待确认上。
- **你的代码和任务说明会发给 OpenAI。** 加了 API 模型参与讨论后，议题和附带的代码也会发给对应厂商。涉及敏感代码的项目，先确认这样做没问题，必要时用项目配置只留 Codex。
- **API key 可以写在用户配置里，也可以放在环境变量里。** 写在配置里是明文，`~/.claude/codex-bridge.json` 不要提交或分享；项目配置里写的 key 不会生效。`config` 命令不显示 key，脚本也不会把 key 写进运行记录。
- **按量计费的都会产生费用。** Codex 用 API key 计费时每次派活都花钱；API 模型每场讨论都会扣账户余额。不想让 Claude 自动派活，就把 `dispatch.auto` 设成 `false`。

## 运行记录

每次调用都会在 `~/.claude/codex-runs/<run_id>/` 留档：任务说明、事件流、diff、最终报告。API 模型的运行没有 diff，另外多一份对话历史 `messages.json`，续接时接着发。`/codex-bridge:status` 可以查看。改动追踪用的是放在这个记录目录里的独立 git 仓库，不会碰你项目里的 `.git`。

改动追踪比较的是任务开始和结束时的整个工作目录，所以同一时间你、Claude 或别的会话改的文件也会被看到。脚本会把有证据是 Codex 改的文件（Codex 的文件改动事件和报告里列出的文件）和归属未知的文件分开标出，Claude 不会直接还原归属未知的改动。被 `.gitignore` 忽略的路径默认不追踪，派活时用 `--track` 指定后才会追踪。

Codex 额度用完、API 模型余额不足时，任务会标记为 `quota_exhausted`，不会自动重试；Codex 的会带上预计恢复时间。调度进程意外退出、卡死或超时的任务，下次在这个项目里开会话时，Claude 会收到提醒。

## 平台支持

Windows 上已经实际测试过。macOS 和 Linux 的代码路径已经写好，但还没有测试，欢迎反馈问题。

## 中文版和英文版

插件市场里有两个插件，规则和输出的语言不同，其余完全一样：

- `codex-bridge`：中文版，命令是 `/codex-bridge:…`
- `codex-bridge-en`：英文版，命令是 `/codex-bridge-en:…`

只装其中一个就行。两者共用同一份配置文件、偏好文件和运行记录，换装另一个不用重新配置。

## 开发

两个插件的脚本（`codex-run.mjs`、`api-chat.mjs`、`messages.mjs` 和钩子 `hooks/guard-codex.mjs`、`hooks/session-reminder.mjs`）是同一份。只改 `codex-bridge/` 里的那份，再运行同步工具复制到英文插件：

```bash
node tools/sync-shared.mjs
```

提交前可以用 `node tools/sync-shared.mjs --check` 检查两份脚本、两份 schema 的结构和两个插件的版本号是否一致。终端提示、发给 Codex 的约束和发给 API 模型的提示等文字都在 `messages.mjs` 里，中英文各一份；SKILL.md、`references/`、命令说明和 schema 两个插件各写各的。

## 许可证

[MIT](LICENSE)
