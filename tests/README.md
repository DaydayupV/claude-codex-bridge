# foreman 黑盒回归基线

在仓库根目录运行 `npm test`。单文件可用 `node --test tests/discuss.test.mjs`，也可替换为下面任意测试文件。仅使用 Node 内置模块和已有的 Git，不安装依赖。

所有产品调用都是子进程：`node foreman/skills/dispatch/scripts/cli.mjs` 或 `foreman/hooks/*.mjs`。仅导入允许的 `messages.mjs` 取提示文字。基线固定当前实现，不预先要求设计文档中后续阶段的行为。

每个测试在 `os.tmpdir()` 下创建独立用户目录，设置 `HOME`、`USERPROFILE`、`CODEX_HOME`、`APPDATA`，只继承启动所需系统变量。`PATH` 仅保留 Git 和系统工具目录，防止初始配置查询 npm 全局路径时找到真实 npm/CLI；Git 的全局和系统配置也隔离。语言默认中文、时区 UTC、会话为 `test-session`。假 API 仅监听 `127.0.0.1` 的随机端口，所有 key 都是合成字符串。

结束时先回收仍在运行的测试子进程，再删除对应临时目录。活动状态、事件和并发会合使用有上限的轮询；不会靠固定 sleep 猜任务是否已启动。没有读取真实运行记录或复制真实配置。

## 假工具与夹具

- `helpers.mjs`：临时用户目录、配置、子进程、轮询、Git、记录读取、路径占位替换。
- `fake/codex.mjs`、`fake/opencode.mjs`：通过 `agents.<名字>.bin` 指定，`FAKE_SCENARIO` 指向合成 JSON 剧本。
- 剧本的 `capture` 指定 JSONL 调用日志；记录工具、操作、argv、stdin、cwd、pid 及指定的环境变量。`calls` 按同一工具/操作的调用序号覆盖基础剧本，用于续接和报告修复。
- `steps` 中每步支持 `event`、`delay_ms`、`wait_for`（临时放行文件）、`files`、`stderr`。根级支持 `files`、`last_message`、`exit_code`、`stderr` 和 `hold`。
- Codex 另支持 `logged_in`、`version`、`session_id`、`stats`、`usage`、`images`；`stats` 生成带 `token_count` 的合成会话 JSONL，图片为合成的单像素 PNG。
- opencode 另支持 `models`、`session_id`、`export_messages`、`export_error` 和可选 `step_finish`。导出的消息可以用 `created: "old"` 模拟本轮开始前的历史。
- `fake/api-server.mjs`：按请求序号提供 SSE 剧本，支持正常流、保活排队、401/402、拒绝 `response_format`、报告修复、残缺流和取消；请求保存在测试内存中。
- `fixtures/`：完全合成的报告、用量和四类 watch 记录。`expected/`：五份已人工核对的非 TTY 文本；仅替换临时路径为 `<HOME>`/`<CWD>`，事件时刻为 `<TIME>`，状态、用量、文案和排版均保留。

## 覆盖清单

表中名称与 `node:test` 输出一致；同一行的多个测试共同覆盖该项。

| 要求 | 文件 | 测试名 |
|---|---|---|
| 1 初始配置和提示 | config.test.mjs | 没有用户配置时生成初始配置并提示首次使用；英文覆盖变量使用英文首次提示 |
| 1 旧结构和备份 | config.test.mjs | 零点十以前的配置自动改写并保留原文备份 |
| 1 校验错误 | config.test.mjs | 未知协作方类型被拒绝；执行等级不能使用 API 协作方；opencode 模型必须带厂商斜杠；讨论等级不能为空；同一讨论等级不能重复参与方 |
| 1 项目字段限制 | config.test.mjs | 项目配置忽略不允许的字段并保留允许的覆盖 |
| 1 非 Codex 参与方限制 | config.test.mjs | 项目配置不能把额外的 API 或 opencode 加入讨论等级 |
| 1 config 输出 | config.test.mjs | config 输出解析后的等级、协作方状态、偏好及记录目录 |
| 2 旧配置和偏好 | migration.test.mjs | 旧配置和旧偏好在第一次运行时复制到新位置，旧文件保留 |
| 2 记录搬迁及启动器 | migration.test.mjs | 旧记录目录整体迁移并重写 watch 启动器 |
| 2 活跃 PID | migration.test.mjs | 旧目录里有活着的任务时延后迁移 |
| 2 并发迁移 | migration.test.mjs | 四个进程同时启动只迁移一次且记录完整 |
| 2 自定义记录目录 | migration.test.mjs | 用户通过配置指定记录目录时不搬旧目录；用户通过环境变量指定记录目录时不搬旧目录 |
| 2 旧环境变量 | migration.test.mjs | 旧环境变量仍生效并提示改名；旧语言环境变量生效时也提示改名 |
| 2 项目旧文件名 | migration.test.mjs | 项目里的旧配置和偏好文件名照常读取并提示改名 |
| 3 成功、改动归属、用量 | run.test.mjs | 执行成功写报告、补丁、事件归属和会话用量 |
| 3 未知归属 | run.test.mjs | 没有事件或报告证据的文件变化归属未知 |
| 3 退出错误 | run.test.mjs | 非零退出把 stderr 最后五行带入 errors |
| 3 超时 | run.test.mjs | 小数分钟超时终止未结束的执行 |
| 3 卡死和执行中命令 | run.test.mjs | 卡死检测终止无活动任务，执行中的命令不判卡死 |
| 3 用户取消 | run.test.mjs | cancel 终止正在执行的任务并保存取消结果 |
| 3 额度 | run.test.mjs | 额度用完保留会话、恢复时间和额度提示 |
| 3 断线重连 | run.test.mjs | 断线重连事件只记警告不导致任务失败 |
| 3 组与范围 | run.test.mjs | 组名非法、缺少写入范围和范围重叠均被拒绝 |
| 3 并发上限 | run.test.mjs | 达到协作方并发上限时拒绝新任务 |
| 3 图片 | run.test.mjs | 会话图片收集到 generated_images 和事件文件 |
| 3 交回问题 | run.test.mjs | 交回问题的执行任务提示 Claude 决定，watch 用问号列出问题和推荐 |
| 4 会话、组、track 续接 | resume-review.test.mjs | 续接使用上一轮会话并沿用组、范围和 track，用量只算新增 |
| 4 讨论轮数 | resume-review.test.mjs | 讨论续接到轮数上限后拒绝再开一轮 |
| 5 原生审查 | resume-review.test.mjs | 没有审查重点时使用原生 exec review --uncommitted；没有审查重点时使用原生 exec review --base；没有审查重点时使用原生 exec review --commit |
| 5 带重点审查 | resume-review.test.mjs | 有审查重点时普通 exec 提示词包含 uncommitted 范围；有审查重点时普通 exec 提示词包含 base 范围；有审查重点时普通 exec 提示词包含 commit 范围 |
| 5 非 Git 审查 | resume-review.test.mjs | 非 Git 目录审查要求说明并使用普通 exec |
| 6 Codex 讨论 | discuss.test.mjs | Codex 讨论解析报告并传递只读规则和附件范围 |
| 6 API 材料、清单、正常 SSE | discuss.test.mjs | API 讨论发送附件行范围和项目清单，保存流式事件与用量 |
| 6 API 材料上限 | discuss.test.mjs | API 附件超过材料上限时拒绝请求 |
| 6 API 格式参数重试 | discuss.test.mjs | API 拒绝 response_format 后去掉该字段重试 |
| 6 API 报告修复 | discuss.test.mjs | API 非 JSON 报告只修复一次并累计两次用量；API 第二次报告仍不合法时保留原文并停止修复 |
| 6 API 错误状态和提示 | discuss.test.mjs | API 401 保存正确状态和提示；API 402 保存正确状态和提示 |
| 6 API 排队 | discuss.test.mjs | API 保活注释产生排队事件，放行后继续回答 |
| 6 API 取消 | discuss.test.mjs | API 取消正在排队的请求并保存取消结果 |
| 6 API 回答中断 | discuss.test.mjs | API 回答中途断开后重试一次且不拼接残缺回答 |
| 6 opencode 权限、PWD、事件、用量 | discuss.test.mjs | opencode 注入只读代理、设置 PWD 并翻译工具事件和导出用量（包含最后一步无 step_finish、旧消息排除和 cost_usd） |
| 6 opencode 修复会话 | discuss.test.mjs | opencode 修复报告时续接同一会话且仍使用只读权限 |
| 6 opencode 导出失败 | discuss.test.mjs | opencode 会话导出失败时保留报告并提示缺少用量 |
| 6 同组并发及 await-busy | discuss.test.mjs | 同组多方并发，await-busy 列出超过阈值的 API 参与方 |
| 7 status 列表与汇总 | status-watch.test.mjs | status 列表按记录排序并汇总当前会话的组 |
| 7 status 活动 | status-watch.test.mjs | status 对正在运行的任务给出当前命令和活动时间 |
| 7 watch 单任务文本 | status-watch.test.mjs | watch --run 非 TTY 的Codex 执行输出与期望一致；watch --run 非 TTY 的API 讨论输出与期望一致；watch --run 非 TTY 的opencode 讨论输出与期望一致；watch --run 非 TTY 的失败任务输出与期望一致 |
| 7 watch 组文本 | status-watch.test.mjs | watch --group 非 TTY 的四类任务汇总与期望一致 |
| 7 取消已结束任务 | status-watch.test.mjs | cancel 对已完成任务不改结果，对未正常结束任务标记已处理 |
| 8 Codex 检查 | check.test.mjs | check 识别 Codex 已登录状态；check 识别 Codex 未登录状态；check 找不到指定 Codex 时提示安装且不调用真实 CLI |
| 8 API 检查 | check.test.mjs | check 报告 API 可连通且不改变 Codex 总体结果；check 报告 API 认证失败且不改变 Codex 总体结果 |
| 8 opencode 检查 | check.test.mjs | check 检查 opencode 模型存在于 models；check 检查 opencode 模型不存在于 models |
| 9 首次会话提醒 | hooks.test.mjs | 会话提醒首次使用并且不创建配置或迁移目录 |
| 9 偏好位置兼容 | hooks.test.mjs | 会话提醒带上新位置用户和项目偏好；会话提醒带上旧位置用户和项目偏好 |
| 9 未完成任务与取消 | hooks.test.mjs | 会话提醒列出未正常结束的执行任务，取消后不再列出 |
| 9 直接调用拦截 | hooks.test.mjs | 直接调用守卫拦截 codex exec；直接调用守卫拦截 codex review；直接调用守卫拦截 node codex.js exec；直接调用守卫拦截 npx Codex |
| 9 查询与普通文字放行 | hooks.test.mjs | 直接调用守卫放行版本查询；直接调用守卫放行登录状态；直接调用守卫放行普通文本提及；直接调用守卫放行带分隔符的文字 |
| 11 协作方要人回答 | questions.test.mjs | 六种来源各自收集进 questions，needs_decision 只算需要决定的四种；Codex 默认 approval_policy=never、配置了就用配置的；opencode 注入的权限里 question 被拒；最终回答是问题时不修复，像 JSON 或长篇分析时照常修复；终端提示加 3 分钟静默触发看门狗、结束进程树并记 needs_input，模型消息静默和执行中的命令不触发；watch、status 和组计数里问题的显示 |
| 12 新配置写法和迁移 | structure-migration.test.mjs | 真实结构配置迁移后按模型改名、每格模型和强度不变、有备份和别名；部分字段的旧等级先补全；模型覆盖拆成新协作方；同名合并或加后缀；Codex 没写模型时取 config.toml；项目配置的旧代号；并发迁移只备份一次、校验失败不改文件；旧记录在 status、watch、resume 和并发准入里照常可用 |
| 13 通用化 | generalization.test.mjs | 多个 Codex、没有 Codex、能力表校验；代号规则；三种任务的 "claude code" 和点名派出；--effort 选协作方；check 的新结构和总体结果；项目配置只能收紧；按环境生成初始配置和 environment 字段；没有协作方时的会话提醒 |
| 10 共用文件同步 | sync.test.mjs | 中英文插件的共用文件、schema 结构和版本号一致 |

## 说明

- 整套约 40 秒，大头是几处真实等待：Codex 卡死检测每 30 秒查一次，测试要等无活动的任务真的被判卡死；API 断流后的重试固定等 5 秒；已结束任务组的 watch 固定停留 5 秒。
- Node 24 第一次运行 `config` 时可能附带 DEP0190 警告，测试只核对插件自己的提示行。
- 不覆盖：真实的 Codex 和 opencode、外部 API、终端里的实时画面（TTY）。这些发布前按设计文档 9.2 节的清单手工冒烟。
- 改了 watch 的排版，要人工核对新输出后再更新 `expected/` 里的文本。
- 加了新行为，同时在上面的覆盖表里补一行。
