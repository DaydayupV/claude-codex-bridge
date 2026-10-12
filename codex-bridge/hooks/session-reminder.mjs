#!/usr/bin/env node
// SessionStart 钩子：会话开始（包括恢复和上下文压缩之后）时提醒 Claude 何时加载 codex-dispatch skill，
// 并附上用户的偏好文件。skill 是否加载全靠 Claude 自己判断，项目里有更贴合的领域 skill 时容易漏掉；
// 偏好文件又只在 skill 加载后才会被读到，所以直接在会话开始时带上。
// 只读文件，不 import codex-run.mjs，避免触发它首次运行时生成配置文件。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(HERE, '..', 'skills', 'codex-dispatch', 'scripts');
const USER_CONFIG = process.env.CODEX_BRIDGE_CONFIG || path.join(os.homedir(), '.claude', 'codex-bridge.json');
const USER_PREFS = path.join(path.dirname(USER_CONFIG), 'codex-bridge.md');
const MAX_PREFS_CHARS = 4000; // 每个偏好文件最多带这么多字，防止文件太长挤占上下文

const readText = (file) => { try { return fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim(); } catch { return ''; } };
const readJson = (file) => { try { return JSON.parse(readText(file)); } catch { return null; } };

const REMINDERS = {
  zh: {
    intro: (auto) => `codex-bridge 插件已启用。下面两种情况，先加载 \`codex-bridge:codex-dispatch\` skill，再按其中的门槛判断：
1. 动手做执行类编码工作之前（实现功能、批量修改、写脚本、重构、修 bug、性能优化等，包括用户同意你开始改代码的那一刻）：判断是否把工作派给 Codex。${auto ? '符合门槛的直接派（用户已开启 auto_dispatch）。' : '符合门槛的先向用户提议，同意后再派（auto_dispatch 已关闭）。'}
2. 给出方案建议、研究方向、设计选型或计划之前，包括用户只是来要建议的时候：判断是否先和 Codex 讨论（discuss）。
项目自带的领域 skill 照常使用，两者不冲突：领域 skill 管怎么做，codex-dispatch 管由谁来做、要不要先讨论、做完怎么验收和审查。调用 Codex 只能通过该 skill 的脚本。`,
    prefs: (file, text) => `用户偏好文件 ${file}（与 skill 冲突时以偏好文件为准）：\n${text}`,
    truncated: '（内容过长，后面已截断，完整内容请读原文件）',
    unfinishedHeading: '当前项目里有执行没有正常结束的 Codex 任务，可能需要处理：',
    unfinishedRun: (m, status) => `- ${m.id}｜${m.mode}｜${m.title || '-'}｜${status}`,
    unfinishedStatuses: { interrupted: '调度进程已退出，没有结果', quota_exhausted: '额度用完', stalled: '卡死已终止', timeout: '超时已终止' },
    unfinishedFooter: '用 status --run <run_id> 查看详情，再决定续接、重来还是放弃。用户没提起时，在合适的时候简短告诉用户一句。',
  },
  en: {
    intro: (auto) => `The codex-bridge-en plugin is enabled. In these two cases, load the \`codex-bridge-en:codex-dispatch\` skill first and follow its thresholds:
1. Before starting hands-on coding work (implementing features, bulk changes, scripts, refactoring, bug fixes, performance work, and so on, including the moment the user agrees you can start changing code): decide whether to hand the work to Codex. ${auto ? 'Hand off tasks that meet the thresholds directly (the user has auto_dispatch on).' : 'Suggest it to the user first and hand off once they agree (auto_dispatch is off).'}
2. Before giving design suggestions, research directions, technology choices or plans, including when the user only asks for advice: decide whether to discuss it with Codex first (discuss).
Keep using the project's own domain skills as usual; they don't conflict: domain skills say how to do the work, codex-dispatch decides who does it, whether to discuss first, and how it gets checked and reviewed. Codex may only be called through that skill's script.`,
    prefs: (file, text) => `User preference file ${file} (wins over the skill where they conflict):\n${text}`,
    truncated: '(Truncated because it is long; read the file for the rest)',
    unfinishedHeading: 'Some Codex runs in this project did not finish normally and may need attention:',
    unfinishedRun: (m, status) => `- ${m.id} | ${m.mode} | ${m.title || '-'} | ${status}`,
    unfinishedStatuses: { interrupted: 'the dispatcher exited, no result', quota_exhausted: 'quota used up', stalled: 'stuck and stopped', timeout: 'timed out and stopped' },
    unfinishedFooter: "Use status --run <run_id> for details, then decide whether to resume, start over or drop it. If the user hasn't brought it up, mention it to them briefly at a suitable moment.",
  },
};

function unfinishedRuns(root, cwd) {
  if (!cwd || !fs.existsSync(root)) return [];
  const directoryKey = (dir) => {
    const resolved = path.resolve(dir);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const runs = fs.readdirSync(root).map((id) => readJson(path.join(root, id, 'meta.json'))).filter(Boolean);
  const resumed = new Set(runs.map((m) => m.parent).filter(Boolean));
  const now = Date.now();
  return runs.filter((m) => {
    if (!m.cwd || directoryKey(m.cwd) !== directoryKey(cwd) || resumed.has(m.id)) return false;
    const age = now - new Date(m.started_at).getTime();
    if (!(age >= 0 && age <= 7 * 86400000)) return false;
    if (m.status === 'running') {
      try { process.kill(m.pid, 0); } catch { m.status = 'interrupted'; }
    }
    return ['interrupted', 'quota_exhausted', 'stalled', 'timeout'].includes(m.status);
  }).sort((a, b) => new Date(b.started_at) - new Date(a.started_at)).slice(0, 5);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let cwd = null;
  try { cwd = JSON.parse(input).cwd || null; } catch { /* 没有输入时只带用户级偏好 */ }

  const language = readJson(path.join(SCRIPTS, 'language.json'))?.language || 'zh';
  const t = REMINDERS[language] || REMINDERS.zh;
  const config = readJson(USER_CONFIG);
  const autoDispatch = config?.auto_dispatch !== false;

  const parts = [t.intro(autoDispatch)];
  for (const file of [USER_PREFS, ...(cwd ? [path.join(cwd, '.claude', 'codex-bridge.md')] : [])]) {
    let text = readText(file);
    if (!text) continue;
    if (text.length > MAX_PREFS_CHARS) text = `${text.slice(0, MAX_PREFS_CHARS)}\n${t.truncated}`;
    parts.push(t.prefs(file, text));
  }

  const runsRoot = process.env.CODEX_RUNS_DIR || config?.runs_dir || path.join(os.homedir(), '.claude', 'codex-runs');
  const unfinished = unfinishedRuns(runsRoot, cwd);
  if (unfinished.length) parts.push([
    t.unfinishedHeading,
    ...unfinished.map((m) => t.unfinishedRun(m, t.unfinishedStatuses[m.status])),
    t.unfinishedFooter,
  ].join('\n'));

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: parts.join('\n\n') },
  }));
});
