// 公共小工具、语言选择和显示用的模型信息。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MESSAGES } from './messages.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 输出语言由插件自带的 language.json 决定（中文插件 zh，英文插件 en），测试时可用环境变量 FOREMAN_LANG 覆盖。
const LANGUAGE = process.env.FOREMAN_LANG || process.env.CODEX_BRIDGE_LANG || (() => {
  try { return JSON.parse(fs.readFileSync(path.join(HERE, 'language.json'), 'utf8')).language; } catch { return 'zh'; }
})();
const M = MESSAGES[LANGUAGE] || MESSAGES.zh;
const notice = (msg) => process.stderr.write(`foreman: ${msg}\n`);
// 语言要在提示文字之前确定，所以旧变量名的提示放到这里补上。
if (!process.env.FOREMAN_LANG && process.env.CODEX_BRIDGE_LANG) notice(M.legacyEnv('CODEX_BRIDGE_LANG', 'FOREMAN_LANG'));

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
  catch (e) { die(M.configBadJson(file, e.message)); }
}

function die(msg) {
  process.stderr.write(`foreman: ${msg}\n`);
  process.exit(2);
}

function need(o, key) {
  if (!o[key]) die(M.missingOpt(key));
  return o[key];
}

function resolveDir(p) {
  const dir = path.resolve(p);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) die(M.dirMissing(dir));
  return dir;
}

function readBrief(o, required = true) {
  if (!o.brief) {
    if (required) die(M.missingOpt('brief'));
    return '';
  }
  const text = o.brief === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(o.brief), 'utf8');
  if (required && !text.trim()) die(M.emptyBrief);
  return text.replace(/^﻿/, '').trim();
}

const MAX_MATERIAL_CHARS = 300000;

function readAttachments(specs, cwd, api) {
  return specs.map((spec) => {
    const match = /:(\d+)-(\d+)$/.exec(spec);
    const range = match ? [Number(match[1]), Number(match[2])] : null;
    if (range && (!range.every(Number.isSafeInteger) || range[0] < 1 || range[1] < range[0])) die(M.badFileRange(spec));
    const file = path.resolve(cwd, match ? spec.slice(0, match.index) : spec);
    if (!fs.existsSync(file)) die(M.fileNotFound(file));
    if (!fs.statSync(file).isFile()) die(M.fileBinary(file));
    const bytes = fs.readFileSync(file);
    if (bytes.includes(0)) die(M.fileBinary(file));
    // 发出去的材料里写项目内的相对路径，不暴露本机目录结构，也省 token。
    const rel = relativePath(cwd, file);
    const attached = { path: file, shown: rel.startsWith('../') || rel === '..' || path.isAbsolute(rel) ? file : rel, range };
    if (!api) return attached;
    const lines = bytes.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();
    const first = range?.[0] || 1;
    const content = lines.slice(first - 1, range?.[1]).map((line, i) => `${first + i}\t${line}`).join('\n');
    const longest = (content.match(/`+/g) || []).reduce((n, s) => Math.max(n, s.length), 2);
    return { ...attached, content, chars: content.length, fence: '`'.repeat(longest + 1) };
  });
}

function focusFiles(files) {
  return files.length ? `\n\n${M.focusFiles(files.map((f) => `- ${f.shown}${f.range ? (LANGUAGE === 'en' ? ` (lines ${f.range[0]}–${f.range[1]})` : `（第 ${f.range[0]}–${f.range[1]} 行）`) : ''}`).join('\n'))}` : '';
}

const binCommand = (bin) => /\.[cm]?js$/i.test(bin) ? { file: process.execPath, pre: [bin] } : { file: bin, pre: [] };

function pathCommand(name, extraDirs = []) {
  // 图形界面的 PATH 可能不含常用安装目录；JS 入口用当前的 node，不依赖 PATH 里有 node。
  const home = os.homedir();
  const dirs = [...(process.env.PATH || '').split(path.delimiter), path.dirname(process.execPath),
    '/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local', 'bin'), path.join(home, '.npm-global', 'bin'), path.join(home, '.volta', 'bin'), ...extraDirs];
  for (const dir of dirs) {
    if (!dir) continue;
    const file = path.join(dir, name);
    try { fs.accessSync(file, fs.constants.X_OK); } catch { continue; }
    let real = file;
    try { real = fs.realpathSync(file); } catch { /* 用原路径 */ }
    return /\.[cm]?js$/i.test(real) ? binCommand(real) : binCommand(file);
  }
  return binCommand(name);
}

function npmEntry(...parts) {
  const entry = (root) => path.join(root, ...parts);
  let file = entry(path.join(process.env.APPDATA || '', 'npm', 'node_modules'));
  if (!fs.existsSync(file)) {
    // 改过 npm prefix 或用 nvm 时不在默认位置，问 npm 要全局目录。
    const npm = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', shell: true, windowsHide: true });
    file = npm.status === 0 && npm.stdout.trim() ? entry(npm.stdout.trim()) : '';
  }
  return file && fs.existsSync(file) ? file : null;
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
  // codex 以独立进程组启动，负 pid 连同它起的子进程一起结束。
  else try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* 已退出 */ } }
}

// ---------- 改动追踪 ----------

function relativePath(cwd, file) {
  return path.relative(cwd, path.resolve(cwd, file.replace(/\\/g, '/'))).replace(/\\/g, '/') || '.';
}

const pathKey = (file) => process.platform === 'win32' ? file.toLowerCase() : file;

// Codex 断线后自动重连时会发 error 事件（"Reconnecting... 1/5 …"），这只是临时状况，不算失败。
const RECONNECT = /^Reconnecting\.\.\.\s*(\d+)\/(\d+)/;
const isReconnect = (msg) => RECONNECT.test(String(msg ?? ''));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const oneLine = (s) => String(s ?? '').replace(/\r/g, '').split('\n').map((x) => x.trim()).filter(Boolean).join(' ⏎ ');

// 按 POSIX shell 规则拆分命令行；引号不配对时返回 null。
function shellSplit(s) {
  const args = [];
  let cur = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (/\s/.test(ch)) { if (cur !== null) args.push(cur); cur = null; continue; }
    cur ??= '';
    if (ch === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) return null;
      cur += s.slice(i + 1, j);
      i = j;
    } else if (ch === '"') {
      for (i++; i < s.length && s[i] !== '"'; i++) {
        if (s[i] === '\\' && '"\\$`'.includes(s[i + 1])) i++;
        cur += s[i];
      }
      if (i >= s.length) return null;
    } else if (ch === '\\' && i + 1 < s.length) {
      cur += s[++i];
    } else cur += ch;
  }
  if (cur !== null) args.push(cur);
  return args;
}

function plainCommand(cmd) {
  // Codex 记录的命令是按 shell 规则转义后的整行，比如 "...powershell.exe" -Command "<实际命令>"。
  // 先按规则还原，再去掉外壳，只留实际命令。
  const args = shellSplit(String(cmd ?? ''));
  if (args?.length >= 3 && /(?:^|[\\/])(?:powershell|pwsh|bash|sh|zsh|cmd)(?:\.exe)?$/i.test(args[0]) && /^(?:-Command|-l?c|\/c)$/i.test(args.at(-2))) return args.at(-1);
  const m = /^"?[^"]*?(?:powershell|pwsh|bash|cmd)(?:\.exe)?"?\s+(?:-Command|-l?c|\/c)\s+([\s\S]*)$/i.exec(cmd);
  let inner = m ? m[1] : cmd;
  if (/^(["'])[\s\S]*\1$/.test(inner)) inner = inner.slice(1, -1);
  return inner.replace(/\\(["\\])/g, '$1'); // 记录里的命令转义过反斜杠和引号
}

// 桌面版的终端面板只接受 ASCII 命令；记录目录路径里有非 ASCII 字符时，实时查看的命令发不出去
const isAscii = (s) => /^[ -~]*$/.test(s);
// 界面上以模型为主，接入方式作附注；旧记录没有 agent_type 和 model_name，都是 Codex CLI。
const modelOf = (m) => m?.model || m?.model_name || m?.model_shown || '?';
const whoOf = (m) => M.who(modelOf(m), m?.agent_type === 'openai-compatible' ? M.channel.api : m?.agent_type === 'opencode' ? M.channel.opencode : M.channel.codex, m?.effort, !m?.model && !!m?.model_name && !['openai-compatible', 'opencode'].includes(m?.agent_type));

// 用改名替换文件。Windows 上目标文件正被别的进程读取时（watch、status、并发登记都会读 meta.json），
// 改名会报 EPERM / EACCES / EBUSY，稍等再试；最多等约 2 秒。
function replaceFile(from, to) {
  for (let i = 0; ; i++) {
    try { return fs.renameSync(from, to); }
    catch (e) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code) || i >= 80) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

export { replaceFile, HERE, LANGUAGE, M, notice, isObject, readJson, die, need, resolveDir, readBrief, MAX_MATERIAL_CHARS, readAttachments, focusFiles, binCommand, pathCommand, npmEntry, isGitRepo, pidAlive, killTree, relativePath, pathKey, RECONNECT, isReconnect, sleep, clip, oneLine, plainCommand, isAscii, modelOf, whoOf };
