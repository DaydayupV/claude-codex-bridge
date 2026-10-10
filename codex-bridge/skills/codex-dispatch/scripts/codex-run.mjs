#!/usr/bin/env node
// codex-run.mjs — Claude Code 调度 Codex 的唯一入口。
//
//   node codex-run.mjs run    --cwd <目录> --brief <文件|-> [--effort medium|high|max] [--title <标题>]
//                             [--add-dir <目录>]... [--timeout <分钟>] [--stall <分钟>] [--no-snapshot]
//   node codex-run.mjs resume --run <run_id|last> --brief <文件|-> [--effort medium|high|max] [--timeout <分钟>] [--stall <分钟>]
//   node codex-run.mjs discuss --cwd <目录> --brief <文件|-> [--effort medium|high|max] [--title <标题>]
//                             方案讨论，只读；后续轮次用 resume --run <讨论的 run_id> 续接
//   node codex-run.mjs review --cwd <目录> [--uncommitted | --base <分支> | --commit <sha>]
//                             [--brief <文件|->] [--effort medium|high|max] [--title <标题>]
//   node codex-run.mjs status [--run <run_id|last>] [--limit <n>]
//   node codex-run.mjs watch  [--run <run_id|last>]
//
// watch 把 events.jsonl 实时翻译成可读进度；不给 --run 时跟踪正在运行的任务（没有就等新任务出现）。
// 每次运行还会写一个 ~/.claude/codex-runs/watch.mjs 启动器，路径不含中文，方便在终端面板里直接运行。
//
// 每次运行在 ~/.claude/codex-runs/<run_id>/ 留档：brief.md、events.jsonl、stderr.log、
// last-message.txt、diff.patch、meta.json、result.json。最终结果以 JSON 打印到 stdout。

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.join(HERE, '..', 'schemas', 'report.schema.json');
const DISCUSS_SCHEMA = path.join(HERE, '..', 'schemas', 'discuss.schema.json');
const RUNS_ROOT = process.env.CODEX_RUNS_DIR || path.join(os.homedir(), '.claude', 'codex-runs');

const MODEL = 'gpt-6-astra';
const EFFORTS = ['medium', 'high', 'max'];
const DEFAULT_EFFORT = 'high';
const DEFAULT_TIMEOUT_MIN = 240;
// 超过这么久没有任何事件、且没有命令在执行，判定为卡死。命令执行中不算（大计算本来就可能很久）。
const DEFAULT_STALL_MIN = 20;

// 改动追踪：用放在记录目录里的影子 git 仓库给工作目录拍快照，不碰项目自己的 .git。
const LARGE_FILE_BYTES = 5 * 1024 * 1024; // 超过的文件只比较大小和修改时间
const MAX_SNAPSHOT_FILES = 50000;
const SNAPSHOT_EXCLUDES = [
  '.git/', 'node_modules/', '.venv/', 'venv/', '__pycache__/', '.mypy_cache/', '.pytest_cache/',
  '.ruff_cache/', '.tox/', '.next/', '.nuxt/', '.gradle/', '.idea/', '.vs/', 'target/', '*.pyc',
];

const FOOTER = (cwd, addDirs) => `---
## 固定约束（调度方自动附加）
- 工作目录：${cwd}${addDirs.length ? `；另可改动：${addDirs.join('、')}` : ''}。只改任务说明列出的文件和范围；确实需要超出范围时先停下，写进报告，不要擅自扩大改动。
- 只写必要的测试，不要过度防御：不加多余的参数校验、try/catch、兜底分支和重复测试。
- 命名、注释和提示文字以任务说明为准，给了原文就照用。没有指定的：命名沿用项目现有风格，起直白、能看出用途的名字；注释只在不显而易见的地方用一句简短的话说明"为什么"，不要长篇解释，也不要逐行注释。
- 不执行 git commit / git push / git reset --hard 或任何改写历史的操作；不删除范围外的文件；不读取或修改密钥、凭据、.env 等敏感文件。
- 不安装全局依赖，不改系统配置；项目内确需新增依赖时在报告里说明。
- 完成后按给定的 JSON schema 输出最终报告，如实填写：没做到或没验证的写进 open_issues，不要粉饰。`;

const RESUME_FOOTER = `---
（调度方提示：前面的固定约束仍然有效。完成后同样按 JSON schema 输出最终报告。）`;

const DISCUSS_FOOTER = (cwd) => `---
## 讨论规则（调度方自动附加）
- 这是方案讨论，不是执行任务。可以阅读 ${cwd} 下的代码和数据、运行只读命令来支撑观点，但不要修改、创建或删除任何文件。
- 独立思考，不要迎合。不同意就直说，并给出理由；同意也要说清楚为什么。
- 结论先行，用短句和直白的话，像跟同事当面讲清楚一样。不要堆砌术语，不要套话。
- 每个观点都要有依据：代码位置、数据或清楚的推理。拿不准的明确标出来。
- 最后按给定的 JSON schema 输出。`;

const DISCUSS_RESUME_FOOTER = `---
（调度方提示：前面的讨论规则仍然有效：只读、不迎合、说人话、有依据。最后同样按 JSON schema 输出。）`;

const REVIEW_FOOTER = `---
## 审查要求（调度方自动附加）
- 只审查，不要修改任何文件，不要执行会改动文件的命令。
- 只报告真实存在的问题：正确性 bug、逻辑漏洞、边界条件、并发与数据一致性、安全问题、明显的性能问题。不报告纯风格偏好。
- 每个问题写清：文件:行号、问题、触发场景（什么输入或状态会出错）、修复建议，按严重程度从高到低排列。
- 没发现问题就明确说"未发现问题"，不要凑数。`;

// ---------- 通用 ----------

function die(msg) {
  process.stderr.write(`codex-run: ${msg}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = { 'add-dir': [] };
  const flags = new Set(['uncommitted', 'no-snapshot']);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) die(`无法识别的参数：${a}`);
    const key = a.slice(2);
    if (flags.has(key)) { opts[key] = true; continue; }
    const val = rest[++i];
    if (val === undefined) die(`缺少参数值：${a}`);
    if (key === 'add-dir') opts[key].push(val);
    else opts[key] = val;
  }
  return { cmd, opts };
}

function need(o, key) {
  if (!o[key]) die(`缺少 --${key}`);
  return o[key];
}

function pickEffort(o, fallback = DEFAULT_EFFORT) {
  const e = o.effort || fallback;
  if (!EFFORTS.includes(e)) die(`--effort 只能是 ${EFFORTS.join(' / ')}`);
  return e;
}

function resolveDir(p) {
  const dir = path.resolve(p);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) die(`目录不存在：${dir}`);
  return dir;
}

function readBrief(o, required = true) {
  if (!o.brief) {
    if (required) die('缺少 --brief');
    return '';
  }
  const text = o.brief === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(o.brief), 'utf8');
  if (required && !text.trim()) die('任务说明为空');
  return text.replace(/^﻿/, '').trim();
}

function codexCommand() {
  const bin = process.env.CODEX_BIN;
  if (bin) return /\.[cm]?js$/i.test(bin) ? { file: process.execPath, pre: [bin] } : { file: bin, pre: [] };
  // npm 全局安装的 codex 在 Windows 上是 .ps1/.cmd 包装，直接用 node 跑入口脚本，避开 shell 引号问题。
  const js = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  if (fs.existsSync(js)) return { file: process.execPath, pre: [js] };
  return { file: 'codex', pre: [] };
}

function writeWatchLauncher() {
  const launcher = `// 自动生成：转调 codex-run.mjs watch。\nprocess.argv.splice(2, 0, 'watch');\nawait import(${JSON.stringify(pathToFileURL(fileURLToPath(import.meta.url)).href)});\n`;
  try { fs.writeFileSync(path.join(RUNS_ROOT, 'watch.mjs'), launcher); } catch { /* 不影响主流程 */ }
}

function newRunDir() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const id = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`;
  const dir = path.join(RUNS_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  writeWatchLauncher();
  return { id, dir };
}

function listRuns() {
  if (!fs.existsSync(RUNS_ROOT)) return [];
  return fs.readdirSync(RUNS_ROOT)
    .filter((n) => fs.existsSync(path.join(RUNS_ROOT, n, 'meta.json')))
    .sort()
    .reverse();
}

function findRun(ref) {
  const id = ref === 'last' ? listRuns()[0] : ref;
  if (!id) die('还没有任何运行记录');
  const dir = path.join(RUNS_ROOT, id);
  if (!fs.existsSync(path.join(dir, 'meta.json'))) die(`找不到运行记录：${ref}`);
  return { id, dir, meta: JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) };
}

function isGitRepo(cwd) {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf8', windowsHide: true });
  return r.status === 0 && r.stdout.trim() === 'true';
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function killTree(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
  else try { process.kill(pid, 'SIGTERM'); } catch { /* 已退出 */ }
}

// ---------- 改动追踪 ----------

function makeTracker(runDir, cwd) {
  const gitDir = path.join(runDir, '.shadow');
  const base = [
    '--git-dir', gitDir, '--work-tree', cwd, '--literal-pathspecs',
    '-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', '-c', 'core.quotepath=false',
    '-c', 'safe.directory=*', '-c', 'core.longpaths=true',
  ];
  const git = (args, { input, index } = {}) => {
    const r = spawnSync('git', [...base, ...args], {
      cwd, input, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 180000, windowsHide: true,
      env: index ? { ...process.env, GIT_INDEX_FILE: index } : process.env,
    });
    if (r.error || r.status !== 0) throw new Error(`git ${args[0]} 失败：${r.error?.message || r.stderr.trim()}`);
    return r.stdout;
  };

  git(['init', '--quiet']);
  fs.mkdirSync(path.join(gitDir, 'info'), { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'info', 'exclude'), SNAPSHOT_EXCLUDES.join('\n') + '\n');

  function snap(label) {
    const index = path.join(gitDir, `index-${label}`);
    const files = git(['ls-files', '-z', '-o', '--exclude-standard']).split('\0').filter(Boolean);
    if (files.length > MAX_SNAPSHOT_FILES) throw new Error(`文件数 ${files.length} 超过 ${MAX_SNAPSHOT_FILES}，跳过快照`);
    const small = [];
    const large = {};
    for (const f of files) {
      let st;
      try { st = fs.statSync(path.join(cwd, f)); } catch { continue; }
      if (st.isDirectory()) continue; // 嵌套仓库
      if (st.size > LARGE_FILE_BYTES) large[f] = `${st.size}:${Math.round(st.mtimeMs)}`;
      else small.push(f);
    }
    if (small.length) git(['add', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: small.join('\0'), index });
    return { tree: git(['write-tree'], { index }).trim(), large };
  }

  function diff(a, b, patchFile) {
    const tokens = git(['diff', '-z', '--name-status', '--no-renames', a.tree, b.tree]).split('\0').filter(Boolean);
    const files = [];
    for (let i = 0; i + 1 < tokens.length; i += 2) files.push({ status: tokens[i], path: tokens[i + 1] });
    const largeChanged = [];
    for (const f of new Set([...Object.keys(a.large), ...Object.keys(b.large)])) {
      if (a.large[f] === b.large[f]) continue;
      largeChanged.push({ status: !a.large[f] ? 'A' : !b.large[f] ? 'D' : 'M', path: f });
    }
    const patch = git(['diff', '--no-renames', a.tree, b.tree]);
    fs.writeFileSync(patchFile, patch);
    const stat = files.length ? git(['diff', '--shortstat', a.tree, b.tree]).trim() : '';
    return { files, large_files_changed: largeChanged, shortstat: stat, patch_bytes: Buffer.byteLength(patch) };
  }

  const cleanup = () => { try { fs.rmSync(gitDir, { recursive: true, force: true }); } catch { /* 留着也无害 */ } };
  return { snap, diff, cleanup };
}

// ---------- 执行 ----------

function runCodex({ args, cwd, prompt, runDir, timeoutMin, stallMin, onSession }) {
  return new Promise((resolve) => {
    const { file, pre } = codexCommand();
    const events = fs.createWriteStream(path.join(runDir, 'events.jsonl'));
    const errLog = fs.createWriteStream(path.join(runDir, 'stderr.log'));
    const out = { code: null, sessionId: null, usage: null, errors: [], warnings: [], timedOut: false, stalled: false, commands: 0 };
    const runningCommands = new Set();
    let lastEventAt = Date.now();
    const child = spawn(file, [...pre, ...args], { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

    const onSignal = () => { killTree(child.pid); process.exit(130); };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);

    let buf = '';
    const handle = (line) => {
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      lastEventAt = Date.now();
      if (ev.item?.type === 'command_execution') {
        if (ev.type === 'item.started') runningCommands.add(ev.item.id);
        else if (ev.type === 'item.completed') runningCommands.delete(ev.item.id);
      }
      if (ev.type === 'thread.started') { out.sessionId = ev.thread_id; onSession?.(ev.thread_id); }
      else if (ev.type === 'turn.completed') out.usage = ev.usage;
      else if (ev.type === 'turn.failed') out.errors.push(ev.error?.message || JSON.stringify(ev));
      else if (ev.type === 'error') out.errors.push(ev.message || JSON.stringify(ev));
      else if (ev.type === 'item.completed' && ev.item?.type === 'error') out.warnings.push(ev.item.message);
      else if (ev.type === 'item.completed' && ev.item?.type === 'command_execution') out.commands++;
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      events.write(chunk);
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    child.stderr.pipe(errLog);
    child.stderr.on('data', (c) => { out.stderrTail = ((out.stderrTail || '') + c).slice(-4000); });

    const timer = setTimeout(() => { out.timedOut = true; killTree(child.pid); }, timeoutMin * 60000);
    const stallCheck = setInterval(() => {
      if (!stallMin || runningCommands.size || Date.now() - lastEventAt < stallMin * 60000) return;
      out.stalled = true;
      out.errors.push(`超过 ${stallMin} 分钟没有任何活动，且没有命令在执行，判定为卡死并已终止`);
      clearInterval(stallCheck);
      killTree(child.pid);
    }, 30000);
    const finish = (code) => {
      clearTimeout(timer);
      clearInterval(stallCheck);
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      if (buf.trim()) handle(buf);
      events.end();
      errLog.end();
      out.code = code;
      resolve(out);
    };
    child.on('error', (e) => { out.errors.push(`启动 codex 失败：${e.message}`); finish(-1); });
    child.on('close', (code) => finish(code));
    child.stdin.on('error', () => { /* codex 提前退出时忽略 EPIPE */ });
    child.stdin.end(prompt, 'utf8');
  });
}

async function execute(ctx) {
  const { mode, kind, id, dir, cwd, effort, args, prompt, title, parent, opts, expectReport } = ctx;
  const started = Date.now();
  const meta = {
    id, mode, kind, title: title || null, cwd, model: MODEL, effort, parent: parent || null,
    started_at: new Date(started).toISOString(), status: 'running', pid: process.pid, session_id: ctx.sessionId || null,
  };
  const writeMeta = () => fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  writeMeta();
  fs.writeFileSync(path.join(dir, 'brief.md'), prompt);
  process.stderr.write(`codex-run: ${mode} 开始（${MODEL} / ${effort}），记录目录 ${dir}\n`);

  const warnings = [];
  let tracker = null;
  let before = null;
  if (!opts['no-snapshot']) {
    try { tracker = makeTracker(dir, cwd); before = tracker.snap('before'); }
    catch (e) { warnings.push(`改动追踪不可用：${e.message}`); tracker?.cleanup(); tracker = null; }
  }

  const r = await runCodex({
    args, cwd, prompt, runDir: dir,
    timeoutMin: Number(opts.timeout) || DEFAULT_TIMEOUT_MIN,
    stallMin: opts.stall === undefined ? DEFAULT_STALL_MIN : Number(opts.stall),
    onSession: (sid) => { meta.session_id = sid; writeMeta(); },
  });

  let changes = { available: false };
  if (tracker) {
    try { changes = { available: true, ...tracker.diff(before, tracker.snap('after'), path.join(dir, 'diff.patch')) }; }
    catch (e) { warnings.push(`改动追踪失败：${e.message}`); }
    finally { tracker.cleanup(); }
  }
  if (kind !== 'exec' && changes.files?.length) warnings.push(`${kind === 'discuss' ? '讨论' : '审查'}本应只读，但检测到 ${changes.files.length} 个文件被改动，请检查 diff.patch`);

  const lastFile = path.join(dir, 'last-message.txt');
  const last = fs.existsSync(lastFile) ? fs.readFileSync(lastFile, 'utf8').trim() : '';
  let report = null;
  if (expectReport && last) { try { report = JSON.parse(last); } catch { warnings.push('最终报告不是合法 JSON，见 last_message'); } }

  // 重连之类的 error 事件不一定致命，成败以退出码为准，errors 照常汇报。
  const ok = r.code === 0 && !r.timedOut && !r.stalled;
  if (!ok && !r.errors.length) {
    // 参数错误等情况 codex 不产生事件，只在 stderr 留信息，把末尾几行带出来。
    const tail = String(r.stderrTail || '').trim().split('\n').slice(-5).join('\n');
    if (tail) r.errors.push(`codex 退出码 ${r.code}：${tail}`);
  }
  meta.status = ok ? 'done' : r.stalled ? 'stalled' : r.timedOut ? 'timeout' : 'failed';
  meta.session_id = r.sessionId || meta.session_id;
  meta.ended_at = new Date().toISOString();

  const result = {
    run_id: id,
    mode,
    kind,
    status: meta.status,
    title: meta.title,
    cwd,
    model: MODEL,
    effort,
    parent: meta.parent,
    session_id: meta.session_id,
    exit_code: r.code,
    duration_s: Math.round((Date.now() - started) / 1000),
    usage: r.usage,
    commands_executed: r.commands,
    errors: r.errors,
    warnings: [...warnings, ...r.warnings.filter((w) => !/^Under-development features enabled/.test(w))],
    report,
    last_message: report ? undefined : last.slice(0, 8000),
    changes: changes.available
      ? { ...changes, files: changes.files.slice(0, 300), files_total: changes.files.length, note: '只追踪工作目录内的改动' }
      : changes,
    run_dir: dir,
  };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  writeMeta(); // 在 result.json 之后写，watch 看到状态变化时结果已经就绪
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = ok ? 0 : 1;
}

// ---------- 子命令 ----------

async function cmdRun(o) {
  const cwd = resolveDir(need(o, 'cwd'));
  const addDirs = o['add-dir'].map(resolveDir);
  const brief = readBrief(o);
  const effort = pickEffort(o);
  const { id, dir } = newRunDir();
  const args = [
    'exec', '--json', '--skip-git-repo-check', '-m', MODEL, '-c', `model_reasoning_effort="${effort}"`,
    '-C', cwd, '--output-schema', SCHEMA, '-o', path.join(dir, 'last-message.txt'),
  ];
  for (const d of addDirs) args.push('--add-dir', d);
  args.push('-');
  await execute({ mode: 'run', kind: 'exec', id, dir, cwd, effort, args, prompt: `${brief}\n\n${FOOTER(cwd, addDirs)}\n`, title: o.title, opts: o, expectReport: true });
}

async function cmdDiscuss(o) {
  const cwd = resolveDir(need(o, 'cwd'));
  const brief = readBrief(o);
  // 讨论只在复杂、不确定的议题上发起，默认给足推理强度。
  const effort = pickEffort(o, 'max');
  const { id, dir } = newRunDir();
  const args = [
    'exec', '--json', '--skip-git-repo-check', '-m', MODEL, '-c', `model_reasoning_effort="${effort}"`,
    '-C', cwd, '--output-schema', DISCUSS_SCHEMA, '-o', path.join(dir, 'last-message.txt'), '-',
  ];
  await execute({ mode: 'discuss', kind: 'discuss', id, dir, cwd, effort, args, prompt: `${brief}\n\n${DISCUSS_FOOTER(cwd)}\n`, title: o.title, opts: o, expectReport: true });
}

async function cmdResume(o) {
  const parent = findRun(need(o, 'run'));
  if (!parent.meta.session_id) die(`运行 ${parent.id} 没有 session id，无法续接`);
  const kind = parent.meta.kind || (parent.meta.mode === 'review' ? 'review' : 'exec');
  if (kind === 'review') die('审查会话不支持续接，请用 run 发起修复任务');
  const discuss = kind === 'discuss';
  const brief = readBrief(o);
  const effort = pickEffort(o, discuss ? parent.meta.effort : DEFAULT_EFFORT);
  const { id, dir } = newRunDir();
  const args = [
    'exec', 'resume', '--json', '--skip-git-repo-check', '-m', MODEL, '-c', `model_reasoning_effort="${effort}"`,
    '--output-schema', discuss ? DISCUSS_SCHEMA : SCHEMA, '-o', path.join(dir, 'last-message.txt'), parent.meta.session_id, '-',
  ];
  await execute({
    mode: 'resume', kind, id, dir, cwd: parent.meta.cwd, effort, args,
    prompt: `${brief}\n\n${discuss ? DISCUSS_RESUME_FOOTER : RESUME_FOOTER}\n`,
    title: o.title || parent.meta.title, parent: parent.id, sessionId: parent.meta.session_id, opts: o, expectReport: true,
  });
}

async function cmdReview(o) {
  const cwd = resolveDir(need(o, 'cwd'));
  const effort = pickEffort(o);
  const git = isGitRepo(cwd);
  const brief = readBrief(o, !git);
  const { id, dir } = newRunDir();
  const last = path.join(dir, 'last-message.txt');
  let args;
  let prompt;
  if (git && !brief) {
    // codex exec review 的 --uncommitted/--base/--commit 不能和自定义提示同时用，没有审查重点时走原生审查。
    args = ['exec', 'review', '--json', '-m', MODEL, '-c', `model_reasoning_effort="${effort}"`, '-o', last];
    if (o.base) args.push('--base', o.base);
    else if (o.commit) args.push('--commit', o.commit);
    else args.push('--uncommitted');
    if (o.title) args.push('--title', o.title);
    prompt = '';
  } else if (git) {
    // 有审查重点时改用普通 exec，让 Codex 自己用 git 查看审查范围。
    const scope = o.base ? `当前分支相对 ${o.base} 的改动（git diff ${o.base}...HEAD）`
      : o.commit ? `提交 ${o.commit} 引入的改动（git show ${o.commit}）`
      : '所有未提交的改动，包括已暂存、未暂存和未跟踪的文件（git status、git diff HEAD）';
    args = ['exec', '--json', '--skip-git-repo-check', '-m', MODEL, '-c', `model_reasoning_effort="${effort}"`, '-C', cwd, '-o', last, '-'];
    prompt = `请审查 ${cwd} 中${scope}。\n\n${brief}\n\n${REVIEW_FOOTER}\n`;
  } else {
    // 非 git 目录没有"改动"可言，审查范围由任务说明指定。
    args = ['exec', '--json', '--skip-git-repo-check', '-m', MODEL, '-c', `model_reasoning_effort="${effort}"`, '-C', cwd, '-o', last, '-'];
    prompt = `请审查以下内容（工作目录：${cwd}）：\n\n${brief}\n\n${REVIEW_FOOTER}\n`;
  }
  await execute({ mode: 'review', kind: 'review', id, dir, cwd, effort, args, prompt, title: o.title, opts: o, expectReport: false });
}

// 读 events.jsonl 末尾，给出最后活动时间和当前步骤，用来判断运行中的任务是活着还是卡住。
function describeActivity(dir) {
  const file = path.join(dir, 'events.jsonl');
  if (!fs.existsSync(file)) return { idle_min: null, step: '尚未产生事件' };
  const st = fs.statSync(file);
  const len = Math.min(st.size, 256 * 1024);
  const chunk = Buffer.alloc(len);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, chunk, 0, len, st.size - len); } finally { fs.closeSync(fd); }
  const lines = chunk.toString('utf8').split('\n').slice(len < st.size ? 1 : 0).filter((l) => l.trim());
  const running = new Map();
  let last = null;
  for (const l of lines) {
    let ev;
    try { ev = JSON.parse(l); } catch { continue; }
    last = ev;
    if (ev.item?.type !== 'command_execution') continue;
    if (ev.type === 'item.started') running.set(ev.item.id, ev.item.command);
    else if (ev.type === 'item.completed') running.delete(ev.item.id);
  }
  let step;
  if (running.size) step = `执行命令：${clip(oneLine(plainCommand([...running.values()].pop())), 160)}`;
  else if (last?.item?.type === 'agent_message') step = `刚说：${clip(oneLine(last.item.text), 160)}`;
  else if (last?.item?.type === 'file_change') step = '刚改完文件，思考下一步';
  else if (last?.type === 'item.completed' && last.item?.type === 'command_execution') step = '命令刚结束，思考下一步';
  else step = last ? `上一个事件：${last.type}${last.item?.type ? `/${last.item.type}` : ''}` : '尚未产生事件';
  return { idle_min: Number(((Date.now() - st.mtimeMs) / 60000).toFixed(1)), step };
}

function cmdStatus(o) {
  if (o.run) {
    const run = findRun(o.run);
    const file = path.join(run.dir, 'result.json');
    if (fs.existsSync(file)) process.stdout.write(fs.readFileSync(file, 'utf8') + '\n');
    else {
      if (run.meta.status === 'running' && !pidAlive(run.meta.pid)) run.meta.status = 'interrupted';
      process.stdout.write(JSON.stringify({ ...run.meta, activity: describeActivity(run.dir) }, null, 2) + '\n');
    }
    return;
  }
  const rows = listRuns().slice(0, Number(o.limit) || 10).map((rid) => {
    const dir = path.join(RUNS_ROOT, rid);
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    if (m.status === 'running' && !pidAlive(m.pid)) m.status = 'interrupted';
    const end = m.ended_at ? new Date(m.ended_at) : new Date();
    const mins = ((end - new Date(m.started_at)) / 60000).toFixed(1);
    let row = `${rid}  ${m.mode.padEnd(6)}  ${m.status.padEnd(11)}  ${m.effort.padEnd(5)}  ${mins.padStart(6)}min  ${m.title || ''}  @ ${m.cwd}`;
    if (m.status === 'running') {
      const a = describeActivity(dir);
      row += `\n    └ 最后活动 ${a.idle_min ?? '-'} 分钟前｜${a.step}`;
    }
    return row;
  });
  process.stdout.write(rows.length ? rows.join('\n') + '\n' : '还没有任何运行记录\n');
}

// ---------- watch ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readMeta = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch { return null; } };
const isRunning = (m) => m?.status === 'running' && pidAlive(m.pid);
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const oneLine = (s) => String(s ?? '').replace(/\r/g, '').split('\n').map((x) => x.trim()).filter(Boolean).join(' ⏎ ');

function plainCommand(cmd) {
  // Codex 在 Windows 上把命令包成 "...powershell.exe" -Command "<实际命令>"，去掉外壳便于阅读。
  const m = /^"?[^"]*?(?:powershell|pwsh|bash|cmd)(?:\.exe)?"?\s+(?:-Command|-c|\/c)\s+([\s\S]*)$/i.exec(cmd);
  let inner = m ? m[1] : cmd;
  if (/^(["'])[\s\S]*\1$/.test(inner)) inner = inner.slice(1, -1);
  return inner;
}

async function pickWatchRun(ref) {
  if (ref) return findRun(ref);
  // 刚派活时任务可能还没登记，等一会儿；仍没有就显示最近一次。
  for (let waited = 0; ; waited += 500) {
    const ids = listRuns();
    const running = ids.find((id) => isRunning(readMeta(path.join(RUNS_ROOT, id))));
    if (running) return findRun(running);
    if (waited >= 15000) {
      if (!ids[0]) die('还没有任何运行记录');
      process.stdout.write('没有正在运行的任务，显示最近一次：\n');
      return findRun(ids[0]);
    }
    if (waited === 0) process.stdout.write('等待 Codex 任务开始…\n');
    await sleep(500);
  }
}

async function cmdWatch(o) {
  const { id, dir, meta } = await pickWatchRun(o.run);
  const cwd = meta.cwd;
  const rel = (p) => { const r = path.relative(cwd, p); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : p; };
  let live = false;
  const out = (sym, text) => process.stdout.write(`${live ? new Date().toTimeString().slice(0, 8) : '        '} ${sym} ${text}\n`);
  process.stdout.write(`\nCodex ${meta.mode}｜${meta.title || id}｜${meta.model} / ${meta.effort}\n工作目录 ${cwd}\n记录目录 ${dir}\n\n`);

  const show = (line) => {
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    const it = ev.item || {};
    if (ev.type === 'thread.started') out('●', `会话 ${ev.thread_id}`);
    else if (ev.type === 'turn.failed') out('✗', `本轮失败：${ev.error?.message || ''}`);
    else if (ev.type === 'error') out('⚠', clip(oneLine(ev.message), 300));
    else if (ev.type === 'turn.completed' && ev.usage) {
      out('Σ', `tokens 输入 ${ev.usage.input_tokens}（缓存 ${ev.usage.cached_input_tokens}），输出 ${ev.usage.output_tokens}`);
    } else if (ev.type === 'item.started' && it.type === 'command_execution') {
      out('▶', clip(oneLine(plainCommand(it.command)), 240));
    } else if (ev.type === 'item.completed') {
      if (it.type === 'agent_message') {
        const t = it.text.trim();
        let report = null;
        if (t.startsWith('{')) try { report = JSON.parse(t); } catch { /* 普通消息 */ }
        if (report?.position) out('■', `观点：${clip(oneLine(report.position), 400)}`);
        else if (report?.status) out('■', `报告：${report.status}｜${clip(oneLine(report.summary), 300)}`);
        else out('💬', clip(oneLine(t), 600));
      } else if (it.type === 'reasoning') {
        out('…', clip(oneLine(it.text), 200));
      } else if (it.type === 'command_execution') {
        const lines = String(it.aggregated_output || '').replace(/\r/g, '').split('\n').map((x) => x.trimEnd()).filter(Boolean);
        out(it.exit_code === 0 ? '✓' : '✗', `退出码 ${it.exit_code}${lines.length ? ` → ${clip(lines.slice(-3).join(' ⏎ '), 240)}` : ''}`);
      } else if (it.type === 'file_change') {
        for (const c of it.changes || []) out('✏', `${{ add: '新增', update: '修改', delete: '删除' }[c.kind] || c.kind} ${rel(c.path)}`);
      } else if (it.type === 'error') {
        if (!/^Under-development features enabled/.test(it.message)) out('⚠', clip(oneLine(it.message), 300));
      } else if (it.type === 'web_search') {
        out('🔎', clip(oneLine(it.query), 200));
      } else if (it.type === 'todo_list') {
        out('☐', (it.items || []).map((x) => `${x.completed ? '✔' : '·'} ${x.text}`).join('   '));
      } else if (it.type) {
        out('•', it.type);
      }
    }
  };

  const file = path.join(dir, 'events.jsonl');
  const decoder = new TextDecoder('utf-8');
  let offset = 0;
  let buf = '';
  const drain = () => {
    if (!fs.existsSync(file)) return;
    const size = fs.statSync(file).size;
    if (size <= offset) return;
    const chunk = Buffer.alloc(size - offset);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, chunk, 0, chunk.length, offset); } finally { fs.closeSync(fd); }
    offset = size;
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { show(buf.slice(0, i)); buf = buf.slice(i + 1); }
  };

  drain();
  live = true;
  let m = readMeta(dir);
  while (isRunning(m)) {
    await sleep(500);
    drain();
    m = readMeta(dir);
  }
  drain();

  const resFile = path.join(dir, 'result.json');
  if (fs.existsSync(resFile)) {
    const r = JSON.parse(fs.readFileSync(resFile, 'utf8'));
    const changed = r.changes?.available ? `改动 ${r.changes.files_total} 个文件` : '改动未追踪';
    out('■', `结束：${r.status}，用时 ${r.duration_s}s，${changed}`);
  } else {
    out('■', m?.status === 'running' ? '调度进程已退出，任务可能被中断' : `结束：${m?.status}`);
  }
}

const { cmd, opts } = parseArgs(process.argv.slice(2));
const commands = { run: cmdRun, discuss: cmdDiscuss, resume: cmdResume, review: cmdReview, status: cmdStatus, watch: cmdWatch };
if (!commands[cmd]) die('用法：codex-run.mjs <run|discuss|resume|review|status|watch> [选项]，详见文件头部注释');
await commands[cmd](opts);
