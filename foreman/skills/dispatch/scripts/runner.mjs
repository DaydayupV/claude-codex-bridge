// 三种执行路径共用的登记、事件、取消、报告修复和结果落盘；快照执行使用适配器回调。
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_SESSION, checkAdmission, isCancelled } from './records.mjs';
import { makeTracker } from './tracker.mjs';
import { M, die, relativePath, pathKey, whoOf, modelOf, replaceFile } from './util.mjs';

function startRun(ctx, { started = Date.now(), track = [], modelShown = ctx.model, modelName = modelShown, sandbox = null, atomic = true } = {}) {
  const { id, dir, cwd, model, mode, kind, level, effort, agentName, agent, opts } = ctx;
  const meta = {
    id, mode, kind, title: ctx.title || null, cwd, model, model_shown: modelShown, model_name: modelName, level, effort,
    agent: agentName, agent_type: agent.type, sandbox, parent: ctx.parent || null,
    track, group: opts.group ?? null, scope: opts.scope, round: ctx.round ?? null,
    started_at: new Date(started).toISOString(), status: 'running', pid: process.pid, session_id: ctx.sessionId || null,
    claude_session: CLAUDE_SESSION,
  };
  const writeMeta = () => {
    const file = path.join(dir, 'meta.json');
    // 同组任务会并发读取元数据，替换完整文件，避免把半份 JSON 当成没有记录。
    const target = atomic || meta.group != null ? `${file}.tmp` : file;
    fs.writeFileSync(target, JSON.stringify(meta, null, 2));
    if (target !== file) replaceFile(target, file);
  };
  let rejection;
  try {
    writeMeta();
    rejection = checkAdmission(meta, ctx.cfg);
    if (rejection) fs.rmSync(dir, { recursive: true });
  } finally { ctx.release(); }
  if (rejection) die(rejection);
  return { ctx, started, meta, writeMeta };
}

function finishRun(run, result, code = result.exit_code) {
  fs.writeFileSync(path.join(run.ctx.dir, 'result.json'), JSON.stringify(result, null, 2));
  run.writeMeta(); // 在 result.json 之后写，watch 看到状态变化时结果已经就绪
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = code;
  return result;
}

function finishDiscussion(run, { usage, cost, commands = 0, errors, notes, warnings, report, last, files, changesNote }) {
  const { ctx, meta, started } = run;
  const { id, dir, mode, cwd, agentName, agent, model, level, effort } = ctx;
  meta.ended_at = new Date().toISOString();
  return finishRun(run, {
    run_id: id, mode, kind: 'discuss', status: meta.status, title: meta.title, cwd, track: [], group: meta.group, round: meta.round, scope: meta.scope,
    agent: agentName, agent_type: agent.type, model, model_shown: meta.model_shown, level, effort, sandbox: null, parent: meta.parent, session_id: meta.session_id,
    exit_code: meta.status === 'done' ? 0 : 1, duration_s: Math.round((Date.now() - started) / 1000), usage, usage_scope: 'this_run',
    ...(cost !== undefined ? { cost_usd: cost } : {}),
    last_request: null, rate_limit: null, quota_resets_at: null, commands_executed: commands, errors, notes, warnings, report,
    last_message: report ? undefined : last, changes: { available: false, note: changesNote },
    files: files.map(({ path, range, chars }) => ({ path, range, chars })), run_dir: dir,
  });
}

function eventWriter(dir, stream) {
  return (ev) => {
    const line = JSON.stringify({ ...ev, ts: new Date().toISOString() }) + '\n';
    if (stream) stream.write(line);
    else fs.appendFileSync(path.join(dir, 'events.jsonl'), line);
  };
}

function runLimits(ctx, started) {
  const timeoutMin = Number(ctx.opts.timeout) || ctx.cfg.dispatch.timeout_min;
  return { timeoutMin, deadline: started + timeoutMin * 60000, stallMin: Number(ctx.opts.stall ?? ctx.cfg.dispatch.stall_min) };
}

// 保留各执行路径原有的终止策略，只共用一秒一次的标记检查。
const watchCancellation = (dir, cancel) => setInterval(() => { if (isCancelled(dir)) cancel(); }, 1000);

async function reportWithRepair({ request, schema, validate, repair, onInvalid }) {
  for (let attempt = 0; attempt <= 1; attempt++) {
    const reply = await request();
    if (!reply) return null;
    const parsed = parseReport(reply.last, schema, validate);
    if (!parsed.invalid.length) return parsed.report;
    if (attempt === 1 || reply.canRepair === false) { onInvalid(); return null; }
    repair(parsed.invalid);
  }
}

function parseReport(last, schema, validateSchema) {
  try {
    let value;
    try { value = JSON.parse(last); }
    catch {
      const stripped = last.trim().replace(/^```[^\n]*\n/, '').replace(/\n```$/, '');
      value = JSON.parse(stripped.slice(stripped.indexOf('{'), stripped.lastIndexOf('}') + 1));
    }
    const invalid = validateSchema(schema, value);
    return { report: invalid.length ? null : value, invalid };
  } catch { return { report: null, invalid: [last.trim() ? 'Reply is not valid JSON' : 'Reply is empty'] }; }
}

async function execute(ctx, { run: runAgent, stats: sessionStats, describe }) {
  const { agentName, agent, model, mode, kind, id, dir, cwd, level, effort, args, prompt, opts, expectReport } = ctx;
  const started = Date.now();
  const track = [...new Map(opts.track.map((file) => {
    const rel = relativePath(cwd, file);
    if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) die(M.badArg(`--track ${file}`));
    return [pathKey(rel), rel];
  })).values()];
  const { sandbox, modelShown, modelName } = describe(ctx);
  const run = startRun(ctx, { started, track, sandbox, modelShown, modelName, atomic: false });
  const { meta, writeMeta } = run;
  fs.writeFileSync(path.join(dir, 'brief.md'), prompt);
  process.stderr.write(`foreman: ${M.started(mode, whoOf(meta), level, dir)}\n`);

  const warnings = [];
  const notes = [];
  let tracker = null;
  let before = null;
  if (!opts['no-snapshot']) {
    try { tracker = makeTracker(dir, cwd, track); before = tracker.snap('before'); }
    catch (e) { warnings.push(M.trackingUnavailable(e.message)); tracker?.cleanup(); tracker = null; }
  }

  const baseline = mode === 'resume' ? sessionStats(ctx.sessionId, meta.started_at)?.total_token_usage : {};
  const r = await runAgent({
    agent, args, cwd, prompt, runDir: dir,
    ...runLimits(ctx, started),
    sessionId: ctx.sessionId,
    onSession: (sid) => { meta.session_id = sid; writeMeta(); },
  });

  const lastFile = path.join(dir, 'last-message.txt');
  const last = fs.existsSync(lastFile) ? fs.readFileSync(lastFile, 'utf8').trim() : '';
  let report = null;
  if (expectReport && last) { try { report = JSON.parse(last); } catch { warnings.push(M.badReport); } }
  if (!report && last.length > 8000) notes.push(M.lastMessageTruncated(lastFile));

  const reported = (report?.files_changed || []).map((f) => relativePath(cwd, f.path));
  const agentPaths = new Set([...r.fileChanges].map((f) => pathKey(relativePath(cwd, f))));
  for (const file of reported) agentPaths.add(pathKey(file));
  let changes = { available: false, agent_total: 0, unknown_total: 0 };
  if (tracker) {
    try { changes = { available: true, ...tracker.diff(before, tracker.snap('after'), path.join(dir, 'diff.patch')) }; }
    catch (e) { warnings.push(M.trackingFailed(e.message)); }
    finally { tracker.cleanup(); }
  }
  const tracked = [...(changes.files || []), ...(changes.large_files_changed || [])];
  for (const file of tracked) file.by = agentPaths.has(pathKey(relativePath(cwd, file.path))) ? 'agent' : 'unknown';
  changes.agent_total = tracked.filter((f) => f.by === 'agent').length;
  changes.unknown_total = tracked.length - changes.agent_total;
  if (kind !== 'exec' && changes.agent_total) warnings.push(M.readonlyChanged(kind, changes.agent_total));
  if (changes.unknown_total) notes.push(M.unattributedChanges(changes.unknown_total));
  const trackedPaths = new Set(tracked.map((f) => pathKey(relativePath(cwd, f.path))));
  const untracked = [...new Map(reported.filter((f) => !trackedPaths.has(pathKey(f))).map((f) => [pathKey(f), f])).values()];
  if (untracked.length) notes.push(M.reportedNotTracked(untracked));

  // 重连之类的 error 事件不一定致命，成败以退出码为准，errors 照常汇报。
  const ok = r.code === 0 && !r.timedOut && !r.stalled;
  if (!ok && !r.errors.length) {
    // 参数错误等情况 codex 不产生事件，只在 stderr 留信息，把末尾几行带出来。
    const tail = String(r.stderrTail || '').trim().split('\n').slice(-5).join('\n');
    if (tail) r.errors.push(M.exitCode(r.code, tail));
  }
  const quotaExhausted = !ok && (r.quotaExhausted || r.errors.some((e) => /usage limit|quota/i.test(e)));
  meta.status = ok ? 'done' : r.cancelled ? 'cancelled' : quotaExhausted ? 'quota_exhausted' : r.stalled ? 'stalled' : r.timedOut ? 'timeout' : 'failed';
  if (r.cancelled) r.errors = [M.runCancelled(modelOf(meta))];
  meta.session_id = r.sessionId || meta.session_id;
  meta.ended_at = new Date().toISOString();
  const stats = sessionStats(meta.session_id, meta.started_at);
  const total = stats?.total_token_usage || r.usage;
  const usage = total && (baseline ? Object.fromEntries(
    ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens']
      .map((key) => [key, (total[key] || 0) - (baseline[key] || 0)]),
  ) : total);
  const resetsAt = stats?.rate_limit?.resets_at;
  const quotaResetsAt = resetsAt == null ? null : new Date(resetsAt * 1000).toISOString();
  if (quotaExhausted) {
    const date = quotaResetsAt && new Date(quotaResetsAt);
    const pad = (n) => String(n).padStart(2, '0');
    const local = date && `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    r.errors.push(M.quotaExhausted(local));
  }

  const result = {
    agent: agentName, agent_type: agent.type,
    run_id: id,
    mode,
    kind,
    status: meta.status,
    title: meta.title,
    cwd,
    track,
    group: meta.group,
    round: meta.round,
    scope: meta.scope,
    model,
    model_shown: modelShown,
    level,
    effort,
    sandbox,
    parent: meta.parent,
    session_id: meta.session_id,
    exit_code: r.code,
    duration_s: Math.round((Date.now() - started) / 1000),
    usage,
    usage_scope: total ? (baseline ? 'this_run' : 'session_total') : null,
    last_request: stats?.last_request || null,
    rate_limit: stats?.rate_limit || null,
    quota_resets_at: quotaResetsAt,
    commands_executed: r.commands,
    errors: r.errors,
    notes,
    warnings: [...warnings, ...r.warnings.filter((w) => !/^Under-development features enabled/.test(w))],
    report,
    last_message: report ? undefined : last.slice(0, 8000),
    changes: changes.available
      ? { ...changes, files: changes.files.slice(0, 300), files_total: changes.files.length, note: M.trackNote }
      : changes,
    generated_images: r.images.length ? r.images : undefined, // 只列这一轮生成的
    run_dir: dir,
  };
  return finishRun(run, result, ok ? 0 : 1);
}

export { startRun, finishRun, finishDiscussion, eventWriter, runLimits, watchCancellation, parseReport, reportWithRepair, execute };
