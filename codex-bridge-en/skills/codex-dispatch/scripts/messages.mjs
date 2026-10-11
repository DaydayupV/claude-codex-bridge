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
  usage: '用法：codex-run.mjs <run|discuss|resume|review|status|watch|config> [选项]，详见文件头部注释',
  badArg: (a) => `无法识别的参数：${a}`,
  missingValue: (a) => `缺少参数值：${a}`,
  missingOpt: (key) => `缺少 --${key}`,
  levelAndEffort: '--level 和 --effort 只能给一个',
  effortChoices: (list) => `--effort 只能是 ${list}`,
  missingLevel: (levels, efforts) => `缺少 --level（${levels}）或 --effort（${efforts}）`,
  levelChoices: (list) => `--level 只能是 ${list}`,
  badLevelConfig: (key, value, list) => `配置 ${key} 的值 ${value} 无效，只能是 ${list}`,
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
  readonlyChanged: (kind, n) => `${kind === 'discuss' ? '讨论' : '审查'}本应只读，但检测到 ${n} 个文件被改动，请检查 diff.patch`,
  badReport: '最终报告不是合法 JSON，见 last_message',
  trackNote: '只追踪工作目录内的改动',

  // ---------- 发给 Codex 的约束 ----------
  footer: (cwd, addDirs) => `---
## 固定约束（调度方自动附加）
- 工作目录：${cwd}${addDirs.length ? `；另可改动：${addDirs.join('、')}` : ''}。只改任务说明列出的文件和范围；确实需要超出范围时先停下，写进报告，不要擅自扩大改动。
- 只写必要的测试，不要过度防御：不加多余的参数校验、try/catch、兜底分支和重复测试。
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
  watchChanged: (n) => `改动 ${n} 个文件`,
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
  usage: 'Usage: codex-run.mjs <run|discuss|resume|review|status|watch|config> [options]; see the comment at the top of the file',
  badArg: (a) => `Unknown argument: ${a}`,
  missingValue: (a) => `Missing value for ${a}`,
  missingOpt: (key) => `Missing --${key}`,
  levelAndEffort: 'Give either --level or --effort, not both',
  effortChoices: (list) => `--effort must be one of ${list}`,
  missingLevel: (levels, efforts) => `Missing --level (${levels}) or --effort (${efforts})`,
  levelChoices: (list) => `--level must be one of ${list}`,
  badLevelConfig: (key, value, list) => `Config ${key} is ${value}, which is not valid; must be one of ${list}`,
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
  readonlyChanged: (kind, n) => `The ${kind === 'discuss' ? 'discussion' : 'review'} should be read-only, but ${n} files were changed; check diff.patch`,
  badReport: 'The final report is not valid JSON; see last_message',
  trackNote: 'Only changes inside the working directory are tracked',

  // ---------- constraints sent to Codex ----------
  footer: (cwd, addDirs) => `---
## Standing rules (added by the dispatcher)
- Working directory: ${cwd}${addDirs.length ? `; you may also change: ${addDirs.join(', ')}` : ''}. Only change the files and areas listed in the brief. If you really need to go beyond them, stop and say so in the report instead of widening the change yourself.
- Write only the tests that are needed, and don't code defensively: no extra argument checks, try/catch, fallback branches or duplicate tests.
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
  watchChanged: (n) => `${n} files changed`,
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
