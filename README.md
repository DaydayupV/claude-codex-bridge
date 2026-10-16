# claude-foreman

[English](README.en.md)

一个 Claude Code 插件：Claude 负责规划、决策和验收，把执行类编码工作按配置派给 OpenAI Codex 等 CLI 工具；也可以请它们独立审查代码，或者在复杂方案上让 Codex、opencode 接入的各家模型和 API 模型（比如 DeepSeek）一起给意见，由 Claude 裁决。

分工的思路是：Claude 负责规划、核心决策、设计和文字，其余的执行工作按等级交给你配置的协作方。它们用的是你自己的额度（Codex 订阅、opencode 订阅或 API 余额），不占 Claude 的额度。

## 能做什么

| 命令 | 作用 |
|---|---|
| `/foreman:run <任务>` | 把一个执行任务派给 Codex，完成后 Claude 审查改动、实际运行验证，不合格就返工 |
| `/foreman:discuss <议题>` | 就复杂的方案和 Codex（以及配置的其他模型）讨论，交叉挑错（轮数上限可配置，默认 2 轮），由 Claude 逐条裁决，最后给出决策记录 |
| `/foreman:review` | 让 Codex 审查未提交的改动、某个分支或某次提交，Claude 逐条核实，排除误报 |
| `/foreman:status` | 查看最近的任务，或某次任务的详细结果。会列出每次任务的 token 消耗、最近一次请求的用量和 Codex 额度已用比例 |
| `/foreman:watch` | 实时查看各个模型正在做什么。默认是一条时间线：左边是时间，模型说的话、折叠后的命令、文件改动依次往下排，最底下一行实时显示用时、命令数和进度，结束时写出结果；运行中画面随窗口大小重新排版，可以用方向键、翻页键或鼠标滚轮往回翻；加 `--verbose` 看全部细节。跟踪一个任务组（比如多方讨论）时，一个窗口里按模型分块，每块标题行右侧是状态和用时，下面是各自最新的几行 |
| `/foreman:config` | 查看或修改插件配置 |
| `/foreman:setup` | 第一次使用时的设置引导：检查 Codex 等环境是否可用，说明当前配置，按需添加其他模型参加讨论 |

不用命令也可以。插件自带的 skill 会让 Claude 自己判断：执行类任务达到一定规模时主动派给 Codex，遇到复杂又不确定的方案时先和 Codex 等模型讨论，高风险改动交付前请 Codex 审查。大任务能拆成几份互不相干的部分时，Claude 会同时派给几个 Codex 会话，缩短等待时间（见下文的 `agents.<名字>.max_parallel`）。这个行为可以关掉，见下文的 `dispatch.auto`。为了不让 Claude 忘了这件事（项目里有自己的 skill 时尤其容易漏），插件会在每个会话开始时提醒它一次，并附上你的偏好文件。

每次派活，Claude 都会在对话里写明这次交给了谁、用的模型和推理强度。

## 前提

- [Claude Code](https://claude.com/claude-code)
- 推荐：[Codex CLI](https://github.com/openai/codex)，已安装并登录。执行、审查和生成图片目前都靠它；没有它时，这些工作由 Claude 自己做
- Node.js 18 或更高版本。在 WSL 里运行 Claude Code 时，WSL 里也要装 Node.js，否则插件的钩子会在每条命令前报错
- Git 2.25 或更高版本，用来追踪协作方改了哪些文件
- 可选：想让其他模型参加讨论时，需要对应厂商的 API key（比如 DeepSeek），或者装好 [opencode](https://opencode.ai) 2.x

## 安装

在 Claude Code 里运行：

```
/plugin marketplace add DaydayupV/claude-foreman
/plugin install foreman@claude-foreman
```

装好后运行 `/foreman:setup`。它会检测本机有哪些工具（Codex、opencode、API key），说明各类任务现在交给谁，再按你的情况建议加哪些模型。之后想查看或修改配置，用 `/foreman:config`。

### 从 codex-bridge 升级

这个插件原来叫 codex-bridge，现在改名为 foreman。Claude Code 不会把旧插件自动升级成新名字，需要手动换一次：

1. 卸载旧插件：`/plugin uninstall codex-bridge@claude-codex-bridge`。新旧插件同时装着时，两边的钩子会重复拦截、重复提醒。
2. 按上面的步骤添加新的 marketplace，安装 `foreman`。
3. 用桌面版"我的上传"装过旧插件的，在那里把它删掉。

你的设置会自动搬过去。新插件第一次运行时：
- 配置 `~/.claude/codex-bridge.json` 复制到 `~/.claude/foreman/config.json`；
- 偏好 `~/.claude/codex-bridge.md` 复制到 `~/.claude/foreman/preferences.md`；
- 运行记录 `~/.claude/codex-runs` 整个搬到 `~/.claude/foreman/runs`。旧目录里还有任务在跑时，这次先不搬，下次再搬。

配置还会改成新写法：`type` 改为 `codex cli` / `opencode cli` / `api`，`"claude"` 改为 `"claude code"`，协作方代号改成模型名（比如 `codex` 改为 `gpt-6-astra`）。每一级实际用的模型和推理强度不变，原文件备份为 `config.json.bak`。旧配置和旧偏好文件保留，确认没问题后可以自己删掉。项目里的 `.claude/codex-bridge.json` 和 `.claude/codex-bridge.md` 照常能读，会提示你改名为 `.claude/foreman.json` 和 `.claude/foreman.md`。环境变量 `CODEX_BRIDGE_CONFIG`、`CODEX_RUNS_DIR`、`CODEX_BRIDGE_LANG` 改名为 `FOREMAN_CONFIG`、`FOREMAN_RUNS_DIR`、`FOREMAN_LANG`，旧名字暂时还认。`/codex-bridge:rescue` 改名为 `/foreman:run`。

## 配置

用户配置在 `~/.claude/foreman/config.json`，项目配置在 `<项目目录>/.claude/foreman.json`。想调整时直接编辑文件，或者在 Claude 里说"用 `/foreman:config` 把复杂任务改成 ultra"。字段的完整说明见 [references/config.md](foreman/skills/dispatch/references/config.md)。

### 第一次使用

第一次运行时，插件先检测本机有什么，再生成配置：

| 检测到 | 生成的安排 |
|---|---|
| 能用的 Codex（已安装、已登录） | simple 和 normal 的执行任务由 Claude 自己做，复杂的执行任务交给 Codex 的 `gpt-6.1-sol`；审查和讨论交给 Codex，复杂的用 `gpt-6-astra` |
| 没有 Codex | 所有任务暂时由 Claude 自己做 |
| API key 环境变量（DeepSeek、Kimi、MiMo） | 写进配置，但先不加入讨论 |
| opencode | 不自动加，用哪个模型由你选 |

花钱或有安全影响的选择不会自动做。运行 `/foreman:setup`，Claude 会按你本机的情况给出建议，你确认后再改配置。以后装了新工具，重跑 setup 就能补进来。

### 配置的结构

配置分三块：

| 块 | 管什么 |
|---|---|
| `dispatch` | 插件怎么派活：是否主动派、实时查看、讨论轮数、超时、记录目录 |
| `agents` | 有哪些协作方、怎么连接 |
| `levels` | 每类任务的每个等级交给谁，用什么推理强度 |

一个有 Codex、opencode 和 DeepSeek 的例子：

```json
{
  "agents": {
    "gpt-6.1-sol":     { "type": "codex cli", "model": "gpt-6.1-sol" },
    "gpt-6-astra":     { "type": "codex cli", "model": "gpt-6-astra" },
    "glm-5.3":         { "type": "opencode cli", "model": "opencode-go/glm-5.3" },
    "deepseek-v4-pro": { "type": "api", "base_url": "https://api.deepseek.com", "api_key_env": "DEEPSEEK_API_KEY", "model": "deepseek-v4-pro" }
  },
  "levels": {
    "run": {
      "simple":  "claude code",
      "normal":  "claude code",
      "complex": { "agent": "gpt-6.1-sol", "effort": "max" }
    },
    "review": {
      "simple":  { "agent": "gpt-6.1-sol", "effort": "medium" },
      "normal":  { "agent": "gpt-6.1-sol", "effort": "high" },
      "complex": { "agent": "gpt-6-astra", "effort": "max" }
    },
    "discuss": {
      "simple":  "claude code",
      "normal":  [{ "agent": "gpt-6.1-sol", "effort": "high" }],
      "complex": [
        { "agent": "gpt-6-astra", "effort": "max" },
        { "agent": "glm-5.3" },
        { "agent": "deepseek-v4-pro", "effort": "max" }
      ]
    }
  }
}
```

**agents**
- 键是协作方的代号，建议直接用模型名。代号可以用字母、数字、`.`、`-`、`_`。
- `type` 有三种：

  | type | 是什么 | 能做的任务 |
  |---|---|---|
  | `codex cli` | 本机的 Codex CLI | 执行、审查、讨论、生成图片 |
  | `opencode cli` | 本机的 opencode CLI，能用它接入的各家模型 | 审查、讨论（执行以后的版本开放） |
  | `api` | 兼容 OpenAI 接口的模型，比如 DeepSeek、Kimi、MiMo | 讨论 |

- 同一种可以配多个，各用不同模型。Codex 不是必需的。

**levels**
- 三种任务（`run` 执行、`review` 审查、`discuss` 讨论）各分 `simple`、`normal`、`complex` 三级。
- 每一级写交给谁：执行和审查写一个协作方，讨论写一组参与方。
- 写成 `"claude code"` 表示 Claude 自己做；对审查和讨论来说，就是这一级不找外部模型。
- `effort` 是推理强度，不写就用默认值：
  - Codex：`low` 到 `ultra`；
  - API：原样作为 `reasoning_effort` 发出，比如 DeepSeek 接受 `low` / `high` / `max`；
  - opencode：模型的 variant。

### 任务等级

Claude 只判断任务属于哪一级：简单 `simple`、常规 `normal`、复杂 `complex`。等级看的是需要多少判断、出错的代价有多大，不看改动多少：照清单机械地改 20 个文件是简单，改模块之间的接口是复杂。每一级交给谁、用什么推理强度，由你在 `levels` 里决定。Claude 每次都必须给出等级，漏了脚本直接报错，不会悄悄按某个档位运行。

- 你想临时指定时，可以对 Claude 说"用 ultra 跑"或"用某某模型跑"，Claude 会改用 `--effort` 或 `--model`。
- 某一级写成 `"claude code"` 时，你仍然可以明确要求把某个任务派出去，Claude 会用 `--agent` 点名。
- 小任务也按等级走：做法明确的小改动算 `simple`。默认 `simple` 由 Claude 自己做；把它改成交给 Codex 的话，连很小的改动也会派出去。

### 接入 API 模型

1. **配置协作方**：自动生成的配置里，检测到 key 的厂商已经有了。别的厂商只要兼容 OpenAI 接口（GLM、通义千问、OpenRouter 等），就在 `agents` 里加一项 `{ "type": "api", "base_url": "...", "model": "..." }`；有特殊参数时写在 `extra_body` 里，会原样并进请求。
2. **填 API key**，两种方式任选一种：
   - 写在配置文件里：在这个协作方里加 `"api_key": "sk-..."`，改完立即生效。key 是明文保存的，这个文件不要提交到仓库或发给别人。
   - 放在环境变量里：写 `"api_key_env": "DEEPSEEK_API_KEY"`，再设置这个环境变量。Windows 上在"系统属性 → 环境变量"里加一个用户变量；macOS 和 Linux 写进 shell 的启动文件。设置后要重启 Claude Code 才能读到。
3. **加进讨论等级**：在 `levels.discuss` 里需要的等级加上它。

这些步骤也可以交给 `/foreman:setup`，比如运行 `/foreman:setup 加 DeepSeek`。key 由你自己填，不需要发到对话里。API 模型自己翻不了代码，Claude 会把相关文件随议题一起发过去（每次上限约 30 万字符），并对照原文核实它对代码的说法。

### 接入 opencode

装了 [opencode](https://opencode.ai)（2.x）的话，opencode 里能用的模型都可以参加讨论，比如 [OpenCode Go](https://opencode.ai/docs/go/) 订阅里的 GLM、Kimi、Qwen、MiniMax、DeepSeek 等。和 API 模型相比，它们能自己读项目里的代码、搜索文件，不用 Claude 挑文件附过去；代价是每读一次文件都多一次请求，更费额度。

1. **在 opencode 里登录**：终端运行 `opencode`，用 `/connect` 登录（OpenCode Go 选 OpenCode Go），再运行 `opencode models` 看能用哪些模型。免费模型（名字带 `-free` 的）不用登录。
2. **加进配置**：每个模型加一项 `{ "type": "opencode cli", "model": "opencode-go/glm-5.3" }`，代号用模型名，再加进需要的讨论等级。也可以交给 `/foreman:setup`。

讨论和审查时，插件给 opencode 注入一个只读代理，只有读文件、搜索和列目录的工具：它不能运行命令，也不能改文件。审查时要看的改动由插件用 git 算好附给它，范围和 Codex 原生审查一致。key 和登录都留在 opencode 里，插件的配置文件里不写。结果里会带上这一轮折算的费用（`cost_usd`），OpenCode Go 的额度就按这个扣。Go 的额度按模型分开算，几个模型一起讨论能把额度摊开；高档模型额度少，建议只放在复杂讨论里。

### 项目配置

项目配置只能收紧，不能放宽：
- 只认 `dispatch.timeout_min`、`dispatch.stall_min`、`dispatch.busy_ask_min` 和 `levels`；
- 每一级只能改成 `"claude code"`，或者从用户配置这一级已有的协作方里选（可以改推理强度）。

这样别人的仓库没法借项目配置换掉执行方、把代码发给新的厂商，或者擅自花你的额度。敏感项目可以把讨论改成只留 Codex，或者直接写成 `"claude code"`。

### 偏好文件

有些习惯不好写成 JSON，比如你的项目里哪类代码算高风险、哪些活不想派给 Codex。这些可以用文字写在偏好文件里，Claude 每个会话开始用插件时会读：

- 用户级：`~/.claude/foreman/preferences.md`
- 项目级：`<项目目录>/.claude/foreman.md`

和插件自带的规则冲突时，以偏好文件为准，项目级优先于用户级。例如：

```markdown
# foreman 偏好

- 这个项目的计费和对账代码按高风险处理：派活用 complex，改完都请 Codex 审查。
- 数据库迁移脚本不派给 Codex，由 Claude 自己写。
- 改动超过 200 行就请 Codex 审查。
```

## 安全提示

- **沙箱以 Codex 的配置为准。** 如果你的 Codex 配置是 `danger-full-access`，Codex 能读写电脑上的任何目录。任务说明会限定它的改动范围，Claude 事后也会审查 diff，但这些都不是技术上的隔离。想要技术隔离，就在配置里把 `agents.codex.sandbox` 设成 `workspace-write` 或 `read-only`。注意 Codex 在 Windows 上的沙箱支持可能不完整，改了之后要实际测试。
- **Claude 只能通过插件调用 Codex。** 插件带有一个钩子：Claude 直接运行 `codex exec` 或 `codex review` 的命令会被拦下，这样每次调用都有记录、改动追踪和明确的模型和推理强度。你自己在终端里运行 codex 不受影响。
- **协作方不会因为等人回答而卡住。** Codex 默认不需要审批，opencode 不开放提问和需要确认的权限；协作方要人回答的事（交回的问题、被权限挡住的操作、等终端输入的提示）都收集在结果里，由 Claude 判断：在你已有的授权内的直接决定后续接，业务取舍、扩大范围、花钱和不可逆的操作才问你。
- **你的代码和任务说明会发给 OpenAI。** 加了 API 模型参与讨论后，议题和附带的代码也会发给对应厂商。涉及敏感代码的项目，先确认这样做没问题，必要时用项目配置只留 Codex。
- **API key 可以写在用户配置里，也可以放在环境变量里。** 写在配置里是明文，`~/.claude/foreman/config.json` 不要提交或分享；项目配置里写的 key 不会生效。`config` 命令不显示 key，脚本也不会把 key 写进运行记录。
- **按量计费的都会产生费用。** Codex 用 API key 计费时每次派活都花钱；API 模型每场讨论都会扣账户余额。不想让 Claude 自动派活，就把 `dispatch.auto` 设成 `false`。

## 运行记录

每次调用都会在 `~/.claude/foreman/runs/<run_id>/` 留档：任务说明、事件流、diff、最终报告。API 模型的运行没有 diff，另外多一份对话历史 `messages.json`，续接时接着发。`/foreman:status` 可以查看。改动追踪用的是放在这个记录目录里的独立 git 仓库，不会碰你项目里的 `.git`。

改动追踪比较的是任务开始和结束时的整个工作目录，所以同一时间你、Claude 或别的会话改的文件也会被看到。脚本会把有证据是 Codex 改的文件（Codex 的文件改动事件和报告里列出的文件）和归属未知的文件分开标出，Claude 不会直接还原归属未知的改动。被 `.gitignore` 忽略的路径默认不追踪，派活时用 `--track` 指定后才会追踪。

Codex 额度用完、API 模型余额不足时，任务会标记为 `quota_exhausted`，不会自动重试；Codex 的会带上预计恢复时间。调度进程意外退出、卡死或超时的任务，下次在这个项目里开会话时，Claude 会收到提醒。

## 平台支持

Windows 上已经实际测试过，包括命令行版和桌面版（含 Microsoft Store 版）。macOS 和 Linux 的代码路径已经写好，但还没有实际测试，欢迎反馈问题。

几点注意：
- **桌面版的实时查看**开在终端面板里，终端面板只接受 ASCII 命令。记录目录（默认 `~/.claude/foreman/runs`）的路径里有中文等字符时（比如 Windows 用户名是中文），`/foreman:setup` 会提示；在配置里把 `dispatch.runs_dir` 设成纯英文路径就行。命令行版不受影响。
- **从图形界面启动的程序**（比如 macOS 桌面版）PATH 里可能没有 Homebrew、nvm 等目录。脚本找不到 `codex` 时，会再到 node 所在的目录、`/opt/homebrew/bin`、`/usr/local/bin` 等常见位置找；仍然找不到，就在配置的 `agents.codex.bin` 里写上 `codex` 的完整路径。插件的钩子要用 `node`，也需要能在 PATH 里找到它。
- 实时查看用到全屏重画，Windows Terminal、macOS 的终端和 iTerm2、VS Code 的终端以及常见的 Linux 终端都支持；`TERM=dumb` 这类简单终端会改成逐行输出。

## 中文版和英文版

插件市场里有两个插件，规则和输出的语言不同，其余完全一样：

- `foreman`：中文版，命令是 `/foreman:…`
- `foreman-en`：英文版，命令是 `/foreman-en:…`

只装其中一个就行。两者共用同一份配置文件、偏好文件和运行记录，换装另一个不用重新配置。

## 开发

两个插件的脚本是同一份：`skills/dispatch/scripts/` 下除 `language.json` 以外的全部文件（入口是 `cli.mjs`），以及 `hooks/` 下的两个钩子。只改 `foreman/` 里的那份，再运行同步工具复制到英文插件：

```bash
node tools/sync-shared.mjs
```

提交前可以用 `node tools/sync-shared.mjs --check` 检查两份脚本、两份 schema 的结构和两个插件的版本号是否一致。终端提示、发给 Codex 的约束和发给 API 模型的提示等文字都在 `messages.mjs` 里，中英文各一份；SKILL.md、`references/`、命令说明和 schema 两个插件各写各的。

## 许可证

[MIT](LICENSE)
