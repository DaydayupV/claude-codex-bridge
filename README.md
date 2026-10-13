# claude-codex-bridge

[English](README.en.md)

一个 Claude Code 插件：让 Claude 把执行类编码工作派给 OpenAI Codex，再由 Claude 验收；也可以让 Codex 独立审查代码，或者在复杂方案上和 Claude 讨论。

分工的思路是：Claude 负责规划、核心决策、设计和文字，Codex 负责其余的执行工作。Codex 用的是你自己的 OpenAI 额度，不占 Claude 的额度。

## 能做什么

| 命令 | 作用 |
|---|---|
| `/codex-bridge:rescue <任务>` | 把一个执行任务派给 Codex，完成后 Claude 审查改动、实际运行验证，不合格就返工 |
| `/codex-bridge:discuss <议题>` | 就复杂的方案和 Codex 讨论，最多 3 轮交叉挑错，由 Claude 逐条裁决，最后给出决策记录 |
| `/codex-bridge:review` | 让 Codex 审查未提交的改动、某个分支或某次提交，Claude 逐条核实，排除误报 |
| `/codex-bridge:status` | 查看最近的 Codex 任务，或某次任务的详细结果。会列出每次任务的 token 消耗、最近一次请求的用量和 Codex 额度已用比例 |
| `/codex-bridge:watch` | 实时查看 Codex 正在做什么。默认简洁显示：Codex 说的话、折叠后的命令、文件改动和结果；加 `--verbose` 看全部细节 |
| `/codex-bridge:config` | 查看或修改插件配置 |

不用命令也可以。插件自带的 skill 会让 Claude 自己判断：执行类任务达到一定规模时主动派给 Codex，遇到复杂又不确定的方案时先和 Codex 讨论，高风险改动交付前请 Codex 审查。大任务能拆成几份互不相干的部分时，Claude 会同时派给几个 Codex 会话，缩短等待时间（见下文的 `max_parallel`）。这个行为可以关掉，见下文的 `auto_dispatch`。为了不让 Claude 忘了这件事（项目里有自己的 skill 时尤其容易漏），插件会在每个会话开始时提醒它一次，并附上你的偏好文件。

每次派活，Claude 都会在对话里写明这次用的模型和推理强度。

## 前提

- [Claude Code](https://claude.com/claude-code)
- [Codex CLI](https://github.com/openai/codex)，已安装并登录。在终端里运行 `codex exec "hello"` 能正常回复就行
- Node.js 18 或更高版本。在 WSL 里运行 Claude Code 时，WSL 里也要装 Node.js，否则插件的钩子会在每条命令前报错
- Git 2.25 或更高版本，用来追踪 Codex 改了哪些文件

## 安装

在 Claude Code 里运行：

```
/plugin marketplace add DaydayupV/claude-codex-bridge
/plugin install codex-bridge@claude-codex-bridge
```

装好后可以先运行 `/codex-bridge:config`，看看当前生效的配置。

## 配置

第一次使用时，插件会自动生成用户配置 `~/.claude/codex-bridge.json`，内容就是下文"任务等级、模型和推理强度"里的示例：默认用 `gpt-6.1-sol`，复杂任务用 `gpt-6-astra`。沙箱和审批不在里面设置，沿用 Codex 自己的 `~/.codex/config.toml`。

想调整时，直接编辑这个文件，或者在 Claude 里说"用 `/codex-bridge:config` 把复杂任务改成 ultra"。

配置文件是 JSON，后面的覆盖前面的：

1. 插件内置默认值
2. 用户配置 `~/.claude/codex-bridge.json`（可以用环境变量 `CODEX_BRIDGE_CONFIG` 换路径）
3. 项目配置 `<项目目录>/.claude/codex-bridge.json`

### 任务等级、模型和推理强度

Claude 只判断任务属于哪一级：简单 `simple`、常规 `normal`、复杂 `complex`。每一级用哪个模型和推理强度，由你在配置里决定。没有隐式默认：Claude 每次都必须给出等级，漏了脚本直接报错，不会悄悄按某个档位运行。

```json
{
  "model": "gpt-6.1-sol",
  "levels": {
    "run": {
      "simple":  { "model": null, "effort": "medium" },
      "normal":  { "model": null, "effort": "high" },
      "complex": { "model": "gpt-6-astra", "effort": "max" }
    },
    "review": {
      "simple":  { "model": null, "effort": "medium" },
      "normal":  { "model": null, "effort": "high" },
      "complex": { "model": "gpt-6-astra", "effort": "max" }
    },
    "discuss": {
      "simple":  { "model": null, "effort": "high" },
      "normal":  { "model": null, "effort": "max" },
      "complex": { "model": "gpt-6-astra", "effort": "max" }
    }
  }
}
```

- 某一级的 `model` 为 `null` 时用顶层的 `model`；顶层也是 `null`，就用 Codex 自己配置的模型。示例只是一种搭配，换成你账号能用、适合你任务的模型。
- `effort` 可选 `low`、`medium`、`high`、`xhigh`、`max`、`ultra`。模型不支持的档位会被 Codex 拒绝，报错会出现在结果里。
- 你想临时指定时，可以对 Claude 说"用 ultra 跑"或"用某某模型跑"，Claude 会改用 `--effort` 或 `--model`。
- `run` 的某一级想让 Claude 自己做、不派给 Codex，就把那一级的 `model` 写成 `"claude"`，比如 `"simple": { "model": "claude" }`。Claude 遇到这一级的执行任务会自己动手，脚本也会拒绝把它派出去。审查和讨论需要另一个模型，不支持这样写。
- 不管怎么配置，改动不到约 100 行、做法明确的小任务，Claude 都会自己做：这类任务派出去不划算，Codex 也容易做得过重。

### 全部字段

| 字段 | 作用 | 默认 |
|---|---|---|
| `auto_dispatch` | `true`：符合条件的任务由 Claude 主动派给 Codex；`false`：Claude 先提议，你同意后再派 | `true` |
| `watch` | `auto`：派活后自动打开实时查看；`off`：不主动打开 | `auto` |
| `max_parallel` | 一个大任务拆开并发时，同一组最多同时运行几个 Codex 任务。拆得越多等得越短，但总 token 更多；设成 `1` 就不并发 | `3` |
| `model` | 各等级没单独写模型时用的模型 | `null`，沿用 Codex 配置 |
| `levels` | 见上文 | 模型都是 `null`；推理强度 run 和 review 为 medium / high / max，discuss 为 high / max / max |
| `sandbox` | `run` / `discuss` / `review` 各自的沙箱：`read-only`、`workspace-write`、`danger-full-access` | 都是 `null`，沿用 Codex 配置 |
| `approval` | Codex 的审批策略，比如 `never` | `null`，沿用 Codex 配置 |
| `timeout_min` | 单次任务的总超时（分钟） | `240` |
| `stall_min` | 连续多少分钟没有任何活动、也没有命令在执行，就判定为卡死并结束；`0` 表示关闭 | `20` |
| `codex_bin` | codex 可执行文件或 `codex.js` 的路径（也可以用环境变量 `CODEX_BIN`） | 自动查找 |
| `runs_dir` | 运行记录目录（也可以用环境变量 `CODEX_RUNS_DIR`） | `~/.claude/codex-runs` |

项目配置只认 `model`、`levels`、`timeout_min`、`stall_min`。其余字段只能写在用户配置里，这样别人的仓库没法通过项目配置放宽沙箱、换掉可执行文件，或者擅自花你的额度。

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

- **沙箱以 Codex 的配置为准。** 如果你的 Codex 配置是 `danger-full-access`，Codex 能读写电脑上的任何目录。任务说明会限定它的改动范围，Claude 事后也会审查 diff，但这些都不是技术上的隔离。想要技术隔离，就在配置里把 `sandbox` 设成 `workspace-write` 或 `read-only`。注意 Codex 在 Windows 上的沙箱支持可能不完整，改了之后要实际测试。
- **Claude 只能通过插件调用 Codex。** 插件带有一个钩子：Claude 直接运行 `codex exec` 或 `codex review` 的命令会被拦下，这样每次调用都有记录、改动追踪和明确的模型和推理强度。你自己在终端里运行 codex 不受影响。
- **后台运行时审批策略要设成 `never`**，否则 Codex 会卡在等待确认上。
- **你的代码和任务说明会发给 OpenAI。** 涉及敏感代码的项目，先确认这样做没问题。
- **用 API key 计费时，每次派活都会产生费用。** 不想让 Claude 自动派活，就把 `auto_dispatch` 设成 `false`。

## 运行记录

每次调用都会在 `~/.claude/codex-runs/<run_id>/` 留档：任务说明、Codex 的事件流、diff、最终报告。`/codex-bridge:status` 可以查看。改动追踪用的是放在这个记录目录里的独立 git 仓库，不会碰你项目里的 `.git`。

改动追踪比较的是任务开始和结束时的整个工作目录，所以同一时间你、Claude 或别的会话改的文件也会被看到。脚本会把有证据是 Codex 改的文件（Codex 的文件改动事件和报告里列出的文件）和归属未知的文件分开标出，Claude 不会直接还原归属未知的改动。被 `.gitignore` 忽略的路径默认不追踪，派活时用 `--track` 指定后才会追踪。

Codex 额度用完时，任务会标记为 `quota_exhausted`，并带上预计恢复时间，不会自动重试。调度进程意外退出、卡死或超时的任务，下次在这个项目里开会话时，Claude 会收到提醒。

## 平台支持

Windows 上已经实际测试过。macOS 和 Linux 的代码路径已经写好，但还没有测试，欢迎反馈问题。

## 中文版和英文版

插件市场里有两个插件，规则和输出的语言不同，其余完全一样：

- `codex-bridge`：中文版，命令是 `/codex-bridge:…`
- `codex-bridge-en`：英文版，命令是 `/codex-bridge-en:…`

只装其中一个就行。两者共用同一份配置文件、偏好文件和运行记录，换装另一个不用重新配置。

## 开发

两个插件的脚本（`codex-run.mjs`、`messages.mjs` 和钩子 `hooks/guard-codex.mjs`、`hooks/session-reminder.mjs`）是同一份。只改 `codex-bridge/` 里的那份，再运行同步工具复制到英文插件：

```bash
node tools/sync-shared.mjs
```

提交前可以用 `node tools/sync-shared.mjs --check` 检查两份脚本、两份 schema 的结构和两个插件的版本号是否一致。终端提示和发给 Codex 的约束等文字都在 `messages.mjs` 里，中英文各一份；SKILL.md、`references/`、命令说明和 schema 两个插件各写各的。

## 许可证

[MIT](LICENSE)
