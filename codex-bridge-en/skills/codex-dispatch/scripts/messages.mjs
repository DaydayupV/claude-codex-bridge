// codex-run.mjs 里所有给人看的文字：终端提示、报错，以及附加给 Codex 的固定约束。
// 中英两个插件共用这份文件，由同目录的 language.json 决定用哪种语言。

const zh = {
  list: (items) => items.join('、'),

  // ---------- 配置 ----------
  configBadJson: (file, err) => `配置文件不是合法 JSON：${file}（${err}）`,
  starterCreated: (file, model, complexModel) => `首次使用，已生成配置文件 ${file}（默认模型 ${model}，复杂任务用 ${complexModel}），可按需修改`,
  starterFailed: (file, err) => `无法生成配置文件 ${file}（${err}），本次按内置默认值运行`,
  projectIgnored: (keys) => `项目配置里的 ${keys} 只能写在用户配置中，已忽略`,

  // ---------- 参数 ----------
  usage: '用法：codex-run.mjs <run|discuss|resume|review|status|watch|config> [选项]，run / resume / discuss / review 支持 [--track <路径>]...，run / resume / discuss 支持 [--group <组名>] [--scope <路径>]...，status / watch 支持 [--group <组名>]，详见文件头部注释',
  badMaxParallel: 'max_parallel 必须是不小于 1 的整数（在 ~/.claude/codex-bridge.json 里设置）',
  groupNeedsScope: '用 --group 派活时必须用 --scope 写明允许改动的路径（可以给多次），用来检查同组任务的范围是否重叠',
  groupFull: (group, n, max) => `任务组 ${group} 里已有 ${n} 个任务在运行，达到并发上限 ${max}。等其中一个结束再派，或者调大 ~/.claude/codex-bridge.json 里的 max_parallel`,
  scopeOverlap: (group, other, paths) => `和任务组 ${group} 里正在运行的任务 ${other} 写入范围重叠：${paths.join('、')}。同组任务写入的文件不能重叠，请重新划分范围`,
  groupNotFound: (group) => `24 小时内没有找到任务组 ${group} 的任务`,
  statusGroup: (group) => `［组 ${group}］`,
  groupHeader: (group, n) => `Codex 任务组｜${group}｜${n} 个任务`,
  groupSummary: (total, running, ok, failed) => `共 ${total} 个任务：运行中 ${running}，成功 ${ok}，失败 ${failed}`,
  badArg: (a) => `无法识别的参数：${a}`,
  missingValue: (a) => `缺少参数值：${a}`,
  missingOpt: (key) => `缺少 --${key}`,
  levelAndEffort: '--level 和 --effort 只能给一个',
  effortChoices: (list) => `--effort 只能是 ${list}`,
  missingLevel: (levels, efforts) => `缺少 --level（${levels}）或 --effort（${efforts}）`,
  levelChoices: (list) => `--level 只能是 ${list}`,
  badLevelConfig: (key, value, list) => `配置 ${key} 的值 ${value} 无效，只能是 ${list}`,
  levelForClaude: (level) => `按配置（levels.run.${level}.model 为 "claude"），${level} 等级的执行任务由 Claude 自己做，不派给 Codex。用户明确要求派给 Codex 时，用 --model 指定模型`,
  claudeOnlyRun: (key) => `配置 ${key} 不能是 "claude"：只有 run 的等级可以交给 Claude 自己做，审查和讨论需要另一个模型`,
  claudeNotTopLevel: '顶层 model 不能是 "claude"；要让某一级任务由 Claude 自己做，在 levels.run 里把那一级的 model 写成 "claude"',
  dirMissing: (dir) => `目录不存在：${dir}`,
  emptyBrief: '任务说明为空',
  noRuns: '还没有任何运行记录',
  runNotFound: (ref) => `找不到运行记录：${ref}`,
  noSession: (id) => `运行 ${id} 没有 session id，无法续接`,
  reviewNoResume: '审查会话不支持续接，请用 run 发起修复任务',

  // ---------- 执行 ----------
  gitFailed: (cmd, err) => `git ${cmd} 失败：${err}`,
  tooManyFiles: (n, max) => `文件数 ${n} 超过 ${max}，跳过快照`,
  stalled: (min) => `超过 ${min} 分钟没有任何活动，且没有命令在执行，判定为卡死并已终止`,
  spawnFailed: (err) => `启动 codex 失败：${err}`,
  exitCode: (code, tail) => `codex 退出码 ${code}：${tail}`,
  unknownModel: '未知',
  modelFromCodex: (name) => `${name}（来自 Codex 配置）`,
  started: (mode, model, effort, level, dir) =>
    `${mode} 开始｜模型 ${model}｜推理强度 ${effort}${level ? `（等级 ${level}）` : '（直接指定）'}｜记录目录 ${dir}`,
  trackingUnavailable: (err) => `改动追踪不可用：${err}`,
  trackingFailed: (err) => `改动追踪失败：${err}`,
  readonlyChanged: (kind, n) => `${kind === 'discuss' ? '讨论' : '审查'}本应只读，但 Codex 改动了 ${n} 个文件，请检查 diff.patch`,
  unattributedChanges: (n) => `任务期间工作目录里另有 ${n} 个文件发生变化，没有证据表明是 Codex 改的，可能来自 Claude 或其他会话；Codex 用命令或脚本写的文件也会归到这里。不要直接还原，先确认是谁改的`,
  reportedNotTracked: (paths) => `Codex 报告改动了这些文件，但它们不在追踪范围内（可能被忽略规则排除），diff.patch 里没有：${paths.join('、')}。需要追踪时，派活时用 --track 指定`,
  quotaExhausted: (resets) => `Codex 额度已用完${resets ? `，预计 ${resets} 恢复` : ''}。不要重试；会话已保留，额度恢复后可以用 resume 继续`,
  lastMessageTruncated: (file) => `last_message 只保留了前 8000 字，全文见 ${file}`,
  badReport: '最终报告不是合法 JSON，见 last_message',
  trackNote: '只追踪工作目录内的改动',

  // ---------- 发给 Codex 的约束 ----------
  footer: (cwd, addDirs) => `---
## 固定约束（调度方自动附加）
- 工作目录：${cwd}${addDirs.length ? `；另可改动：${addDirs.join('、')}` : ''}。只改任务说明列出的文件和范围。任务说明"允许的适配"一节写明的事可以直接做，在报告里说明做了什么、为什么等效；没写明的越界都不要做。
- 开始前先花很少的成本做预检：解释器和依赖能用、测试能被发现、任务需要的输入存在。只做检查，不要因此跑耗时的完整验收。
- 遇到下面的情况，停在当前位置，把问题写进报告的 decision_requests，status 填 blocked：需要突破上面的范围或授权；需要改变研究口径、样本外纪律或验收标准；要做不可逆的操作；问题的答案不同会让后面耗时的工作作废。
- 其他拿不准的地方，选保守、可逆的做法继续，并在报告里写明；能先做不受这个问题影响的部分就先做，问题攒到一起再提，不要每个小疑问都停下。
- 测试只写任务说明要求的，或者确实需要用来验证这次改动的；小改动不另写测试。不要过度防御：不加多余的参数校验、try/catch、兜底分支和重复测试。
- 按任务说明的规模做，不要做成更大的工程：不新增任务没要求的命令行参数、配置项、抽象层和兼容分支，能用现有函数就不新写。实际改动明显超过任务说明里预计的规模时，先想想是不是做多了；确实需要的，在报告里说明为什么。
- 命名、注释和提示文字以任务说明为准，给了原文就照用。没有指定的：命名沿用项目现有风格，起直白、能看出用途的名字；注释只在不显而易见的地方用一句简短的话说明"为什么"，不要长篇解释，也不要逐行注释。
- 不执行 git commit / git push / git reset --hard 或任何改写历史的操作；不删除范围外的文件；不读取或修改密钥、凭据、.env 等敏感文件。
- 不安装全局依赖，不改系统配置；项目内确需新增依赖时在报告里说明。
- 完成后按给定的 JSON schema 输出最终报告，如实填写：没做到或没验证的写进 open_issues，不要粉饰。`,
  resumeFooter: `---
（调度方提示：前面的固定约束仍然有效。完成后同样按 JSON schema 输出最终报告。）`,
  discussFooter: (cwd) => `---
## 讨论规则（调度方自动附加）
- 这是方案讨论，不是执行任务。可以阅读 ${cwd} 下的代码和数据、运行只读命令来支撑观点，但不要修改、创建或删除任何文件。
- 独立思考，不要迎合。不同意就直说，并给出理由；同意也要说清楚为什么。
- 结论先行，用短句和直白的话，像跟同事当面讲清楚一样。不要堆砌术语，不要套话。
- 每个观点都要有依据：代码位置、数据或清楚的推理。拿不准的明确标出来。
- 最后按给定的 JSON schema 输出。`,
  discussResumeFooter: `---
（调度方提示：前面的讨论规则仍然有效：只读、不迎合、说人话、有依据。最后同样按 JSON schema 输出。）`,
  reviewFooter: `---
## 审查要求（调度方自动附加）
- 只审查，不要修改任何文件，不要执行会改动文件的命令。
- 只报告真实存在的问题：正确性 bug、逻辑漏洞、边界条件、并发与数据一致性、安全问题、明显的性能问题。不报告纯风格偏好。
- 每个问题写清：文件:行号、问题、触发场景（什么输入或状态会出错）、修复建议，按严重程度从高到低排列。
- 没发现问题就明确说"未发现问题"，不要凑数。`,
  reviewScopeBase: (base) => `当前分支相对 ${base} 的改动（git diff ${base}...HEAD）`,
  reviewScopeCommit: (sha) => `提交 ${sha} 引入的改动（git show ${sha}）`,
  reviewScopeUncommitted: '所有未提交的改动，包括已暂存、未暂存和未跟踪的文件（git status、git diff HEAD）',
  reviewPromptGit: (cwd, scope) => `请审查 ${cwd} 中${scope}。`,
  reviewPromptPlain: (cwd) => `请审查以下内容（工作目录：${cwd}）：`,

  // ---------- status ----------
  noEvents: '尚未产生事件',
  stepCommand: (cmd) => `执行命令：${cmd}`,
  stepSaid: (text) => `刚说：${text}`,
  stepFileChanged: '刚改完文件，思考下一步',
  stepCommandDone: '命令刚结束，思考下一步',
  stepLastEvent: (ev) => `上一个事件：${ev}`,
  statusActivity: (min, step) => `最后活动 ${min} 分钟前｜${step}`,
  tokenCount: (n) => (n >= 1e8 ? `${(n / 1e8).toFixed(2)} 亿` : n >= 1e4 ? `${(n / 1e4).toFixed(1)} 万` : String(n)),
  tokenSummary: (u, last, fmt, sessionTotal) => `token：输入 ${fmt(u.input_tokens)}（缓存 ${u.input_tokens ? Math.round((u.cached_input_tokens / u.input_tokens) * 100) : 0}%），输出 ${fmt(u.output_tokens)}`
    + (sessionTotal ? '（会话累计）' : '')
    + (last ? `｜最近一次请求 ${fmt(last.tokens)} / 窗口 ${fmt(last.window)}` : ''),
  lastRequestNow: (last, fmt) => `｜最近一次请求 ${fmt(last.tokens)} / 窗口 ${fmt(last.window)}`,
  rateLimit: (r) => `Codex 额度：${r.window_minutes >= 1440 ? `${Math.round(r.window_minutes / 1440)} 天` : `${Math.round(r.window_minutes / 60)} 小时`}窗口已用 ${r.used_percent}%`,

  // ---------- watch ----------
  watchFallback: '没有正在运行的任务，显示最近一次：',
  watchWaiting: '等待 Codex 任务开始…',
  watchHeader: (mode, title, model, effort, level, cwd, dir) =>
    `Codex ${mode}｜${title}｜模型 ${model}｜推理强度 ${effort}${level ? `（等级 ${level}）` : ''}\n工作目录 ${cwd}\n记录目录 ${dir}`,
  watchSession: (id) => `会话 ${id}`,
  watchTurnFailed: (msg) => `本轮失败：${msg}`,
  watchTokens: (u) => `tokens 输入 ${u.input_tokens}（缓存 ${u.cached_input_tokens}），输出 ${u.output_tokens}`,
  watchOpinion: (text) => `观点：${text}`,
  watchReport: (status, summary) => `报告：${status}｜${summary}`,
  watchExit: (code, tail) => `退出码 ${code}${tail ? ` → ${tail}` : ''}`,
  fileKinds: { add: '新增', update: '修改', delete: '删除' },
  watchChanged: (n, unknown) => `改动 ${n} 个文件${unknown ? `，另有 ${unknown} 个归属未知` : ''}`,
  watchNotTracked: '改动未追踪',
  watchFinished: (status, seconds, changed) => `结束：${status}，用时 ${seconds}s，${changed}`,
  watchInterrupted: '调度进程已退出，任务可能被中断',
  watchEnded: (status) => `结束：${status}`,
  watchMoreLines: (n) => `（还有 ${n} 行，加 --verbose 看完整内容）`,
  watchPlan: '计划',
  watchFoldedCommands: (n) => `… 另有 ${n} 条命令（加 --verbose 查看）`,
  watchFoldedLive: (n, cmd) => `… 另有 ${n} 条命令，最新：$ ${cmd}`,
  watchOpenIssues: '遗留问题',
};

const en = {
  list: (items) => items.join(', '),

  // ---------- config ----------
  configBadJson: (file, err) => `Config file is not valid JSON: ${file} (${err})`,
  starterCreated: (file, model, complexModel) => `First run: created config file ${file} (default model ${model}, ${complexModel} for complex tasks). Edit it as needed`,
  starterFailed: (file, err) => `Could not create config file ${file} (${err}); using built-in defaults for this run`,
  projectIgnored: (keys) => `${keys} can only be set in the user config; ignored in the project config`,

  // ---------- arguments ----------
  usage: 'Usage: codex-run.mjs <run|discuss|resume|review|status|watch|config> [options]; run / resume / discuss / review support [--track <path>]...; run / resume / discuss support [--group <name>] [--scope <path>]...; status / watch support [--group <name>]; see the comment at the top of the file',
  badMaxParallel: 'max_parallel must be a whole number of at least 1 (set it in ~/.claude/codex-bridge.json)',
  groupNeedsScope: 'When handing off with --group, give the paths the task may change with --scope (can be repeated), so overlapping scopes in the group can be caught',
  groupFull: (group, n, max) => `Group ${group} already has ${n} runs in progress, the parallel limit of ${max}. Wait for one to finish, or raise max_parallel in ~/.claude/codex-bridge.json`,
  scopeOverlap: (group, other, paths) => `The write scope overlaps with run ${other} in progress in group ${group}: ${paths.join(', ')}. Runs in the same group must not write the same files; split the scope again`,
  groupNotFound: (group) => `No runs found for group ${group} in the last 24 hours`,
  statusGroup: (group) => `[group ${group}] `,
  groupHeader: (group, n) => `Codex group | ${group} | ${n} runs`,
  groupSummary: (total, running, ok, failed) => `${total} runs: ${running} running, ${ok} succeeded, ${failed} failed`,
  badArg: (a) => `Unknown argument: ${a}`,
  missingValue: (a) => `Missing value for ${a}`,
  missingOpt: (key) => `Missing --${key}`,
  levelAndEffort: 'Give either --level or --effort, not both',
  effortChoices: (list) => `--effort must be one of ${list}`,
  missingLevel: (levels, efforts) => `Missing --level (${levels}) or --effort (${efforts})`,
  levelChoices: (list) => `--level must be one of ${list}`,
  badLevelConfig: (key, value, list) => `Config ${key} is ${value}, which is not valid; must be one of ${list}`,
  levelForClaude: (level) => `Per the config (levels.run.${level}.model is "claude"), ${level}-level tasks are done by Claude itself, not handed to Codex. If the user explicitly wants Codex to do it, pass a model with --model`,
  claudeOnlyRun: (key) => `Config ${key} can't be "claude": only run levels can be left to Claude itself; reviews and discussions need a second model`,
  claudeNotTopLevel: 'The top-level model can\'t be "claude". To have Claude do a level itself, set that level\'s model to "claude" under levels.run',
  dirMissing: (dir) => `Directory not found: ${dir}`,
  emptyBrief: 'The brief is empty',
  noRuns: 'No runs recorded yet',
  runNotFound: (ref) => `Run not found: ${ref}`,
  noSession: (id) => `Run ${id} has no session id and can't be resumed`,
  reviewNoResume: "Review sessions can't be resumed; start a fix task with run",

  // ---------- running ----------
  gitFailed: (cmd, err) => `git ${cmd} failed: ${err}`,
  tooManyFiles: (n, max) => `${n} files is more than ${max}; skipping the snapshot`,
  stalled: (min) => `No activity for ${min} minutes and no command running; treated as stuck and stopped`,
  spawnFailed: (err) => `Failed to start codex: ${err}`,
  exitCode: (code, tail) => `codex exited with code ${code}: ${tail}`,
  unknownModel: 'unknown',
  modelFromCodex: (name) => `${name} (from Codex config)`,
  started: (mode, model, effort, level, dir) =>
    `${mode} started | model ${model} | effort ${effort}${level ? ` (level ${level})` : ' (set directly)'} | run dir ${dir}`,
  trackingUnavailable: (err) => `Change tracking unavailable: ${err}`,
  trackingFailed: (err) => `Change tracking failed: ${err}`,
  readonlyChanged: (kind, n) => `The ${kind === 'discuss' ? 'discussion' : 'review'} should be read-only, but Codex changed ${n} files; check diff.patch`,
  unattributedChanges: (n) => `${n} other files changed in the working directory during the run, with no evidence that Codex changed them. They may come from Claude or another session; files Codex wrote through commands or scripts also land here. Don't revert them before finding out who changed them`,
  reportedNotTracked: (paths) => `Codex reported changing these files, but they are outside tracking (probably excluded by ignore rules) and are not in diff.patch: ${paths.join(', ')}. Pass them with --track to track them`,
  quotaExhausted: (resets) => `The Codex quota is used up${resets ? `; it should reset at ${resets}` : ''}. Don't retry; the session is kept and can be resumed once the quota resets`,
  lastMessageTruncated: (file) => `last_message keeps only the first 8000 characters; the full text is in ${file}`,
  badReport: 'The final report is not valid JSON; see last_message',
  trackNote: 'Only changes inside the working directory are tracked',

  // ---------- constraints sent to Codex ----------
  footer: (cwd, addDirs) => `---
## Standing rules (added by the dispatcher)
- Working directory: ${cwd}${addDirs.length ? `; you may also change: ${addDirs.join(', ')}` : ''}. Only change the files and scope listed in the brief. Things written in the brief's "Allowed adaptations" section may be done directly; say in the report what you did and why it is equivalent. Don't go beyond the scope in any other way.
- Before starting, do a cheap preflight: the interpreter and dependencies work, tests can be discovered, and the inputs the task needs exist. Only check; don't run a long full verification for this.
- In these cases, stop where you are, put the question in the report's decision_requests and set status to blocked: you would need to go beyond the scope or authorization above; the research definitions, out-of-sample discipline or acceptance criteria would change; an irreversible operation is needed; or different answers would make later time-consuming work wasted.
- For anything else you are unsure about, take the conservative, reversible option, keep going and note it in the report. Do the parts the question doesn't affect first, and collect questions to ask together; don't stop for every small doubt.
- Only write tests the brief asks for, or that are really needed to verify this change; don't add tests for small changes. Don't code defensively: no extra argument checks, try/catch, fallback branches or duplicate tests.
- Keep to the size the brief describes; don't turn it into a bigger project. Don't add command-line options, settings, abstraction layers or compatibility branches the task didn't ask for, and use existing functions instead of writing new ones where you can. If your change ends up clearly bigger than the size the brief expects, ask yourself whether you've overdone it; if it really is needed, say why in the report.
- Follow the brief for names, comments and user-facing text; if it gives exact wording, use it as is. Otherwise, follow the project's existing naming style and pick plain names that show what things are for. Comment only where something isn't obvious, with one short sentence on why. No long explanations, no line-by-line comments.
- Don't run git commit / git push / git reset --hard or anything that rewrites history. Don't delete files outside the scope. Don't read or change keys, credentials, .env or other secrets.
- Don't install global dependencies or change system settings. If the project really needs a new dependency, say so in the report.
- When done, output the final report in the given JSON schema, in English. Be honest: anything not done or not verified goes in open_issues.`,
  resumeFooter: `---
(Note from the dispatcher: the standing rules above still apply. When done, output the final report in the same JSON schema.)`,
  discussFooter: (cwd) => `---
## Discussion rules (added by the dispatcher)
- This is a design discussion, not a task to carry out. You may read the code and data under ${cwd} and run read-only commands to back up your points, but don't change, create or delete any files.
- Think for yourself; don't just agree. If you disagree, say so and give your reasons. If you agree, say why.
- Lead with the conclusion. Use short, plain sentences, as if explaining to a colleague face to face. No jargon piles, no filler.
- Back every point with evidence: a code location, data or clear reasoning. Mark anything you're unsure about.
- Finish with output in the given JSON schema, in English.`,
  discussResumeFooter: `---
(Note from the dispatcher: the discussion rules above still apply: read-only, don't just agree, speak plainly, back it up. Finish with output in the same JSON schema.)`,
  reviewFooter: `---
## Review rules (added by the dispatcher)
- Review only. Don't change any files or run commands that change files.
- Report only real problems: correctness bugs, logic errors, edge cases, concurrency and data consistency, security issues, clear performance problems. Not style preferences.
- For each problem give: file:line, the problem, when it goes wrong (what input or state triggers it), and a suggested fix. Order by severity, most severe first.
- If you find nothing, say "No issues found." Don't pad the list.
- Write the review in English.`,
  reviewScopeBase: (base) => `the changes on the current branch relative to ${base} (git diff ${base}...HEAD)`,
  reviewScopeCommit: (sha) => `the changes introduced by commit ${sha} (git show ${sha})`,
  reviewScopeUncommitted: 'all uncommitted changes, including staged, unstaged and untracked files (git status, git diff HEAD)',
  reviewPromptGit: (cwd, scope) => `Please review, in ${cwd}, ${scope}.`,
  reviewPromptPlain: (cwd) => `Please review the following (working directory: ${cwd}):`,

  // ---------- status ----------
  noEvents: 'No events yet',
  stepCommand: (cmd) => `Running: ${cmd}`,
  stepSaid: (text) => `Just said: ${text}`,
  stepFileChanged: 'Just changed files, deciding what to do next',
  stepCommandDone: 'Command just finished, deciding what to do next',
  stepLastEvent: (ev) => `Last event: ${ev}`,
  statusActivity: (min, step) => `last activity ${min} min ago | ${step}`,
  tokenCount: (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n)),
  tokenSummary: (u, last, fmt, sessionTotal) => `tokens: in ${fmt(u.input_tokens)} (${u.input_tokens ? Math.round((u.cached_input_tokens / u.input_tokens) * 100) : 0}% cached), out ${fmt(u.output_tokens)}`
    + (sessionTotal ? ' (session total)' : '')
    + (last ? ` | last request ${fmt(last.tokens)} / window ${fmt(last.window)}` : ''),
  lastRequestNow: (last, fmt) => ` | last request ${fmt(last.tokens)} / window ${fmt(last.window)}`,
  rateLimit: (r) => `Codex quota: ${r.used_percent}% of the ${r.window_minutes >= 1440 ? `${Math.round(r.window_minutes / 1440)}-day` : `${Math.round(r.window_minutes / 60)}-hour`} window used`,

  // ---------- watch ----------
  watchFallback: 'No run in progress; showing the most recent one:',
  watchWaiting: 'Waiting for a Codex run to start…',
  watchHeader: (mode, title, model, effort, level, cwd, dir) =>
    `Codex ${mode} | ${title} | model ${model} | effort ${effort}${level ? ` (level ${level})` : ''}\nWorking dir ${cwd}\nRun dir ${dir}`,
  watchSession: (id) => `Session ${id}`,
  watchTurnFailed: (msg) => `Turn failed: ${msg}`,
  watchTokens: (u) => `tokens in ${u.input_tokens} (cached ${u.cached_input_tokens}), out ${u.output_tokens}`,
  watchOpinion: (text) => `Position: ${text}`,
  watchReport: (status, summary) => `Report: ${status} | ${summary}`,
  watchExit: (code, tail) => `exit code ${code}${tail ? ` → ${tail}` : ''}`,
  fileKinds: { add: 'added', update: 'changed', delete: 'deleted' },
  watchChanged: (n, unknown) => `${n} files changed${unknown ? `, plus ${unknown} of unknown origin` : ''}`,
  watchNotTracked: 'changes not tracked',
  watchFinished: (status, seconds, changed) => `Finished: ${status}, took ${seconds}s, ${changed}`,
  watchInterrupted: 'The dispatcher process has exited; the run may have been interrupted',
  watchEnded: (status) => `Finished: ${status}`,
  watchMoreLines: (n) => `(${n} more lines; add --verbose to see everything)`,
  watchPlan: 'Plan',
  watchFoldedCommands: (n) => `… ${n} more commands (add --verbose to see them)`,
  watchFoldedLive: (n, cmd) => `… ${n} more commands, latest: $ ${cmd}`,
  watchOpenIssues: 'Open issues',
};

export const MESSAGES = { zh, en };
