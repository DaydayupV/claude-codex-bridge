// opencode CLI：只读代理与环境、事件翻译、会话导出和检查项。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DISCUSS_SCHEMA } from '../config.mjs';
import { newRunDir, isCancelled } from '../records.mjs';
import { startRun, finishDiscussion, eventWriter, runLimits, reportWithRepair, spawnCli, validateSchema } from '../runner.mjs';
import { M, die, isObject, binCommand, pathCommand, npmEntry, killTree, readAttachments, focusFiles, relativePath, whoOf } from '../util.mjs';

function opencodeCommand(agent) {
  if (agent.bin) return binCommand(agent.bin);
  if (process.platform !== 'win32') return pathCommand('opencode', [path.join(os.homedir(), '.opencode', 'bin')]);
  return binCommand(npmEntry('@opencode', 'cli', 'bin', 'opencode.exe') || 'opencode.exe');
}

const OPENCODE_AGENT = 'foreman-discuss';

function opencodeEnv() {
  let config;
  try { config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || '{}'); } catch { /* 无效配置由本次注入替代 */ }
  if (!isObject(config)) config = {};
  const agent = { mode: 'primary', description: 'Read-only code discussion for foreman',
    permission: { '*': 'deny', read: 'allow', grep: 'allow', glob: 'allow', list: 'allow' } };
  return { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...config, agent: { ...(isObject(config.agent) ? config.agent : {}), [OPENCODE_AGENT]: agent } }) };
}

// 私有服务才会读取本次注入的代理配置，也能随 run 一起终止。
const opencodeArgs = (model, effort) => ['run', '--standalone', '--format', 'json', '--agent', OPENCODE_AGENT, '-m', `${model}${effort != null ? `#${effort}` : ''}`];

function permissionQuestions(actions, lines, cwd) {
  // 路径按工作目录解析：项目里的显示相对路径，项目外的显示绝对路径（模型常给出一长串 ../）。
  const relative = (value) => {
    if (typeof value !== 'string' || !value) return value;
    const abs = path.resolve(cwd, value), rel = relativePath(cwd, abs);
    return rel === '..' || rel.startsWith('../') || path.isAbsolute(rel) ? abs : rel;
  };
  const pathKeys = new Set(['path', 'filePath', 'file', 'directory']);
  const replacer = (key, value) => (pathKeys.has(key) ? relative(value) : value);
  const details = (tool, input) => JSON.stringify({ tool, input }, replacer);
  const questions = actions.map(({ tool, state }) => ({ source: 'permission_denied',
    question: `${tool} ${JSON.stringify(state.input || {}, replacer)}`,
    detail: details(tool, state.input || {}) }));
  for (const line of lines) {
    const operation = /permission requested:\s*(.+?);\s*auto-rejecting/i.exec(line)?.[1];
    if (!operation) continue;
    const match = /^(\S+)\s*\((.*)\)$/.exec(operation);
    const tool = match?.[1] || operation, target = relative(match?.[2] || '');
    // 同一次拒绝可能同时出现在 stderr 和工具结果里，优先保留带完整参数的工具结果。
    if (questions.some((q) => q.detail === details(tool, target ? { path: target } : {})
      || (target && (tool === 'external_directory' || JSON.parse(q.detail).tool === tool)
        && q.detail.includes(JSON.stringify(target).slice(1, -1).replace(/\*.*$/, ''))))) continue;
    questions.push({ source: 'permission_denied', question: target ? `${tool} (${target})` : tool,
      detail: details(tool, target ? { path: target } : {}) });
  }
  return [...new Map(questions.map((q) => [q.detail, q])).values()];
}

function runOpencode({ agent, args, cwd, prompt = '', timeoutMs, stallMin = 0, runDir, onEvent }) {
  return new Promise((resolve) => {
    const { file, pre } = opencodeCommand(agent);
    const out = { code: null, status: null, stdout: '', stderrTail: '', text: '', errors: [], events: 0, messages: [], questions: [] };
    const denied = [], stderrLines = [];
    // opencode 按环境变量 PWD 认工作目录，不看进程真实的 cwd；PWD 是从调用方的 shell 继承来的，可能指向别的目录。
    const child = spawnCli(file, [...pre, ...args], { cwd, env: { ...opencodeEnv(), PWD: cwd }, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' }, {
      onStderrLine: (line) => { if (/permission requested:/i.test(line)) stderrLines.push(line); },
      onInput: (line, min) => {
        out.status = 'needs_input';
        out.questions.push({ source: 'input_prompt', question: line });
        out.errors.push(M.inputWaitDetected(min, line));
      },
    });
    const stop = (status) => { if (out.status) return; out.status = status; if (child.pid) killTree(child.pid); };
    const onSignal = () => stop('cancelled');
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    let lastEventAt = Date.now();
    let buf = '';
    const record = (line) => {
      if (runDir) fs.appendFileSync(path.join(runDir, 'opencode.jsonl'), line + '\n');
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (!isObject(ev) || !ev.type) return;
      lastEventAt = Date.now();
      out.events++;
      if (ev.type === 'text') { out.text = ev.part?.text || ''; out.messages.push(out.text); }
      if (ev.type === 'tool_use' && ev.part?.state?.status === 'error'
        && /permission|rejected|not allowed/i.test(JSON.stringify(ev.part.state.error || ev.part.state.output || ''))) denied.push(ev.part);
      if (ev.type === 'error') out.errors.push(ev.error?.message || ev.error?.type || JSON.stringify(ev));
      onEvent?.(ev);
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (!onEvent) out.stdout += chunk;
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { record(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      out.stderrTail = (out.stderrTail + chunk).slice(-4000);
      if (runDir) fs.appendFileSync(path.join(runDir, 'stderr.log'), chunk);
    });
    const timer = setTimeout(() => stop('timeout'), Math.max(1, timeoutMs));
    const poll = setInterval(() => {
      if (runDir && isCancelled(runDir)) stop('cancelled');
      else if (stallMin && Date.now() - lastEventAt >= stallMin * 60000) stop('stalled');
    }, 1000);
    child.on('error', (e) => out.errors.push(e.message));
    child.on('close', (code) => {
      clearTimeout(timer);
      clearInterval(poll);
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      if (buf.trim()) record(buf);
      out.questions.push(...permissionQuestions(denied, stderrLines, cwd));
      out.code = code;
      if (runDir && isCancelled(runDir)) out.status = 'cancelled';
      out.status ||= out.errors.some((e) => /usage limit|quota|insufficient balance/i.test(e)) ? 'quota_exhausted'
        : code === 0 && !out.errors.length ? 'done' : 'failed';
      if (!out.events && out.status === 'failed') out.errors.push(M.exitCode(code, out.stderrTail.trim().split(/\r?\n/).slice(-6).join('\n'), 'opencode'));
      resolve(out);
    });
    child.stdin.on('error', () => { /* 提前退出时忽略 EPIPE */ });
    child.stdin.end(prompt, 'utf8');
  });
}

async function executeOpencode(ctx) {
  const { cfg, agentName, agent, model, effort, level, cwd, brief, mode, opts } = ctx;
  if (ctx.parent && !ctx.sessionId) die(M.noSession(ctx.parent));
  const schemaText = fs.readFileSync(DISCUSS_SCHEMA, 'utf8');
  const schema = JSON.parse(schemaText);
  const files = readAttachments(opts.file, cwd, false);
  const prompt = `${brief}${focusFiles(files)}\n\n${ctx.parent ? M.opencodeResumeFooter : M.opencodeDiscussFooter(cwd, schemaText)}\n`;
  const { id, dir, release } = await newRunDir();
  const run = startRun({ ...ctx, kind: 'discuss', id, dir, release });
  const { started, meta, writeMeta } = run;
  const { deadline, stallMin } = runLimits(ctx, started);
  const event = eventWriter(dir);
  for (const file of ['events.jsonl', 'opencode.jsonl', 'stderr.log']) fs.writeFileSync(path.join(dir, file), '');
  fs.writeFileSync(path.join(dir, 'brief.md'), prompt);
  process.stderr.write(`foreman: ${M.started(mode, whoOf(meta), level, dir)}\n`);
  const errors = [], warnings = [], notes = [];
  const observed = { messages: [], questions: [] };
  let repairing = false;
  let commands = 0, seenSession = false, last = '', report = null;
  // 翻译成 Codex 的事件形状，让 watch 和 status 共用现有的时间线、命令和报告显示。
  const translate = (ev) => {
    if (ev.sessionID && !seenSession) {
      seenSession = true;
      meta.session_id = ev.sessionID;
      writeMeta();
      event({ type: 'thread.started', thread_id: ev.sessionID });
    }
    if (ev.type === 'reasoning' || ev.type === 'text') {
      if (ev.type === 'text') last = ev.part?.text || '';
      event({ type: 'item.completed', item: { type: ev.type === 'reasoning' ? 'reasoning' : 'agent_message', text: ev.part?.text || '' } });
    } else if (ev.type === 'tool_use') {
      const { tool, state = {} } = ev.part || {};
      const input = state.input || {};
      const params = ['filePath', 'path', 'pattern', 'include'].filter((k) => input[k] != null).map((k) => {
        const value = String(input[k]);
        return (k === 'filePath' || k === 'path') && path.isAbsolute(value) ? relativePath(cwd, value) : value;
      });
      event({ type: 'item.completed', item: { id: `opencode-${++commands}`, type: 'command_execution', command: [tool, ...params].join(' '),
        exit_code: state.status === 'completed' ? 0 : 1, aggregated_output: String(state.output || state.error || '').slice(0, 2000) } });
    } else if (ev.type === 'error') event({ type: 'error', message: ev.error?.message || ev.error?.type || JSON.stringify(ev) });
  };
  let nextPrompt = prompt;
  report = await reportWithRepair({
    schema, validate: validateSchema,
    request: async () => {
      if (isCancelled(dir)) { meta.status = 'cancelled'; return null; }
      if (Date.now() >= deadline) { meta.status = 'timeout'; return null; }
      const args = opencodeArgs(model, effort);
      if (meta.session_id) args.push('--session', meta.session_id);
      if (meta.title) args.push('--title', meta.title);
      const out = await runOpencode({ agent, args, cwd, prompt: nextPrompt, runDir: dir, onEvent: translate,
        timeoutMs: deadline - Date.now(), stallMin });
      errors.push(...out.errors);
      observed.questions.push(...out.questions);
      if (!repairing) observed.messages = out.messages;
      meta.status = out.status;
      return meta.status === 'done' ? { last, canRepair: !!meta.session_id } : null;
    },
    onInvalid: () => warnings.push(M.reportInvalid(agentName, path.join(dir, 'last-message.txt'))),
    repair: (invalid) => { repairing = true; nextPrompt = M.reportRepairPrompt(invalid.join('\n')); },
  });
  if (meta.status === 'cancelled') errors.push(M.runCancelled(model));
  if (meta.status === 'stalled') errors.push(M.stalled(stallMin));
  let usage = null, cost = null;
  if (meta.session_id) {
    // 最后一步没有 step_finish，用会话导出按开始时间过滤，包含同一轮的格式修复。
    const exported = await runOpencode({ agent, args: ['session', 'export', '--standalone', meta.session_id], cwd, timeoutMs: 60000 });
    try {
      if (exported.status !== 'done') throw new Error(exported.errors.join('; ') || exported.stderrTail || exported.status);
      const messages = JSON.parse(exported.stdout).messages.filter((m) => m.type === 'assistant' && m.time.created >= started);
      usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 };
      cost = 0;
      for (const m of messages) {
        const t = m.tokens;
        usage.input_tokens += (t.input || 0) + (t.cache?.read || 0) + (t.cache?.write || 0);
        usage.cached_input_tokens += t.cache?.read || 0;
        usage.output_tokens += t.output || 0;
        usage.reasoning_output_tokens += t.reasoning || 0;
        cost += m.cost || 0;
      }
    } catch (e) { usage = null; cost = null; notes.push(M.opencodeExportFailed(e.message)); }
  }
  fs.writeFileSync(path.join(dir, 'last-message.txt'), last);
  return finishDiscussion(run, { usage, cost, commands, errors, notes, warnings, report, last, files, changesNote: M.opencodeNoChanges, observed });
}

async function checkOpencodeAgent(name, agent) {
  const started = Date.now();
  const out = { ok: false, type: 'opencode cli', model: agent.model, version: null, model_listed: false, seconds: null, reply: null, error: null, fix: null };
  const call = (args, timeoutMs = 60000, prompt = '') => runOpencode({ agent, args, cwd: process.cwd(), timeoutMs, prompt });
  const failed = (result) => result.errors.join('; ') || result.stderrTail.trim() || result.status;
  const finish = () => ({ ...out, seconds: Number(((Date.now() - started) / 1000).toFixed(1)) });
  const version = await call(['--version']);
  if (version.status !== 'done') { out.error = failed(version); out.fix = M.fixOpencodeMissing(name); return finish(); }
  out.version = version.stdout.trim();
  const models = await call(['models']);
  out.model_listed = models.status === 'done' && models.stdout.split(/\s+/).includes(agent.model);
  if (!out.model_listed) { out.error = models.status === 'done' ? null : failed(models); out.fix = M.fixOpencodeModel(name, agent.model); return finish(); }
  const reply = await call(opencodeArgs(agent.model, null), 120000, 'Reply with the single word OK.');
  out.ok = reply.status === 'done';
  out.reply = reply.text.trim().slice(0, 40);
  if (!out.ok) { out.error = failed(reply); out.fix = M.fixOpencodeRun(name, out.error); }
  return finish();
}

function validate(agent, key, check, text) {
  const why = M.invalid;
  check(text(agent.model) && agent.model.includes('/'), `${key}.model`, why.opencodeModel);
  check(agent.bin == null || text(agent.bin), `${key}.bin`, why.stringOrNull);
}

export default {
  type: 'opencode cli', capabilities: { modes: ['discuss'], isolation: 'tools', reads_code: true, native_schema: false, native_review: false, images: false, resume: true, command_start_events: false }, channel: M.channel.opencode,
  validate,
  status: (agent) => ({ bin: agent.bin || opencodeCommand(agent).file }),
  check: checkOpencodeAgent,
  locate: opencodeCommand,
  execute: executeOpencode,
  validateResume: (parent) => { if (!parent.meta.session_id) die(M.noSession(parent.id)); },
};
