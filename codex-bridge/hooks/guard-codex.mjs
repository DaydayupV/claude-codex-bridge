#!/usr/bin/env node
// PreToolUse 钩子：拦下 Claude 直接调用 codex exec / codex review 的 Bash 和 PowerShell 命令，
// 要求改走 codex-run.mjs。退出码 2 会阻止这次调用，并把 stderr 的内容反馈给 Claude。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'skills', 'codex-dispatch', 'scripts', 'codex-run.mjs');

const MESSAGES = {
  zh: `已拦截：不要直接调用 codex exec / codex review，所有 Codex 调用都必须通过 codex-bridge 插件的脚本：
  node "${SCRIPT}" <run|discuss|resume|review> ...
用法见 codex-bridge:codex-dispatch skill。测试、验收和一次性问答也一样，只读问答用 discuss。
如果是脚本本身满足不了的需求（比如沙箱导致 Codex 无法运行），停下来把情况告诉用户，由用户决定，不要设法绕过。`,
  en: `Blocked: don't call codex exec / codex review directly. Every Codex call must go through the codex-bridge-en plugin's script:
  node "${SCRIPT}" <run|discuss|resume|review> ...
See the codex-bridge-en:codex-dispatch skill. This applies to tests, checks and one-off questions too; use discuss for read-only questions.
If the script can't do what's needed (for example the sandbox stops Codex from running), stop and tell the user so they can decide. Don't look for a way around it.`,
};

const CODEX_SUBCOMMANDS = new Set(['exec', 'e', 'review']);

const base = (p) => p.replace(/^["']|["']$/g, '').split(/[\\/]/).pop().toLowerCase();

// 按 ; | && || 和换行把命令拆成几段，引号里的分隔符不算。
function splitSegments(command) {
  const segments = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      current += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      current += c;
    } else if (c === ';' || c === '|' || c === '\n' || (c === '&' && command[i + 1] === '&')) {
      segments.push(current);
      current = '';
      if ((c === '&' || c === '|') && command[i + 1] === c) i++;
    } else {
      current += c;
    }
  }
  segments.push(current);
  return segments;
}

// 只看每段命令开头真正被执行的程序，文字里提到 "codex exec" 不算。
function callsCodexDirectly(command) {
  for (const segment of splitSegments(command)) {
    const tokens = segment.replace(/^[\s(`$&.]+/, '').match(/"[^"]*"|'[^']*'|\S+/g) || [];
    let i = 0;
    while (i < tokens.length && /^\w+=/.test(tokens[i])) i++; // 跳过 VAR=value 前缀
    const first = base(tokens[i] || '');
    let rest;
    if (/^codex(\.exe|\.cmd|\.ps1)?$/.test(first)) rest = tokens.slice(i + 1);
    else if (/^node(\.exe)?$/.test(first) && base(tokens[i + 1] || '') === 'codex.js') rest = tokens.slice(i + 2);
    else if (/^npx(\.cmd)?$/.test(first) && /^(@openai\/codex|codex)(@.*)?$/.test((tokens[i + 1] || '').replace(/["']/g, ''))) rest = tokens.slice(i + 2);
    else continue;
    const words = rest.map((t) => t.replace(/^["']|["']$/g, ''));
    if (words.some((w) => w === '--help' || w === '-h')) continue;
    if (words.some((w) => CODEX_SUBCOMMANDS.has(w))) return true;
  }
  return false;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let command;
  try { command = JSON.parse(input).tool_input?.command; } catch { process.exit(0); }
  if (typeof command !== 'string' || !callsCodexDirectly(command)) process.exit(0);
  let language = 'zh';
  try { language = JSON.parse(fs.readFileSync(path.join(path.dirname(SCRIPT), 'language.json'), 'utf8')).language; } catch { /* 用默认 */ }
  process.stderr.write((MESSAGES[language] || MESSAGES.zh) + '\n');
  process.exit(2);
});
