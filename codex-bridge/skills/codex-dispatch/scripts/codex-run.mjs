#!/usr/bin/env node
// codex-run.mjs — Claude Code 调度 Codex 的唯一入口。
//
//   node codex-run.mjs run    --cwd <目录> --brief <文件|-> (--level <等级> | --effort <强度>) [--agent <名字>] [--model <模型>] [--title <标题>]
//                             [--add-dir <目录>]... [--track <路径>]... [--group <组名>] [--scope <路径>]... [--timeout <分钟>] [--stall <分钟>] [--no-snapshot]
//   node codex-run.mjs resume --run <run_id|last> --brief <文件|-> (--level <等级> | --effort <强度>) [--agent <名字>] [--file <路径[:起始行-结束行]>]... [--model <模型>] [--timeout <分钟>] [--stall <分钟>]
//                             [--track <路径>]... [--group <组名>] [--scope <路径>]...
//   node codex-run.mjs discuss --cwd <目录> --brief <文件|-> (--level <等级> | --effort <强度>) [--agent <名字>] [--file <路径[:起始行-结束行]>]... [--model <模型>] [--title <标题>]
//                             [--track <路径>]... [--group <组名>] [--scope <路径>]...
//                             方案讨论，只读；后续轮次用 resume --run <讨论的 run_id> 续接
//   node codex-run.mjs review --cwd <目录> [--uncommitted | --base <分支> | --commit <sha>]
//                             [--brief <文件|->] (--level <等级> | --effort <强度>) [--agent <名字>] [--model <模型>] [--title <标题>]
//                             [--track <路径>]...
//   node codex-run.mjs status [--run <run_id|last>] [--limit <n>] [--group <组名>]
//   node codex-run.mjs watch  [--run <run_id|last>] [--verbose] [--group <组名>]
//   node codex-run.mjs config [--cwd <目录>]
//   node codex-run.mjs check  [--agent <名字>]
//                             检查 Node.js、Git、Codex（必需）和各个 API 协作方（可选，会发一个很小的请求）能不能用
//
// watch 把 events.jsonl 实时翻译成可读进度；不给 --run 时跟踪正在运行的任务（没有就等新任务出现）。
// 每次运行还会在记录目录下写一个 watch.mjs 启动器，方便在终端面板里直接运行（插件路径可能含非 ASCII 字符）。
//
// 每次运行在 <记录目录>/<run_id>/ 留档：brief.md、events.jsonl、stderr.log、
// last-message.txt、diff.patch、meta.json、result.json。最终结果以 JSON 打印到 stdout。
//
// --level 是任务复杂度（simple / normal / complex），按配置换算成模型和推理强度；--effort 直接指定推理强度。
// 两者必须给一个，没有隐式默认。--model 临时覆盖模型。
//
// 配置：用户级 ~/.claude/codex-bridge.json（可用环境变量 CODEX_BRIDGE_CONFIG 改路径），
// 项目级 <工作目录>/.claude/codex-bridge.json。字段见 DEFAULT_CONFIG；用户配置不存在时按 STARTER_CONFIG 自动生成。
// 偏好文件（给 Claude 读的文字偏好）：~/.claude/codex-bridge.md 和 <工作目录>/.claude/codex-bridge.md，
// 脚本不解析，只在 config 输出里报告路径和是否存在。

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MESSAGES } from './messages.mjs';
import { chatStream, validateSchema } from './api-chat.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.join(HERE, '..', 'schemas', 'report.schema.json');
const DISCUSS_SCHEMA = path.join(HERE, '..', 'schemas', 'discuss.schema.json');

// 输出语言由插件自带的 language.json 决定（中文插件 zh，英文插件 en），测试时可用环境变量 CODEX_BRIDGE_LANG 覆盖。
const LANGUAGE = process.env.CODEX_BRIDGE_LANG || (() => {
  try { return JSON.parse(fs.readFileSync(path.join(HERE, 'language.json'), 'utf8')).language; } catch { return 'zh'; }
})();
const M = MESSAGES[LANGUAGE] || MESSAGES.zh;

// ---------- 配置 ----------

const USER_CONFIG = process.env.CODEX_BRIDGE_CONFIG || path.join(os.homedir(), '.claude', 'codex-bridge.json');
const PROJECT_CONFIG = path.join('.claude', 'codex-bridge.json');
const USER_PREFS = path.join(path.dirname(USER_CONFIG), 'codex-bridge.md');
const PROJECT_PREFS = path.join('.claude', 'codex-bridge.md');

// 每个协作方同时最多运行几个任务，配置里没写时用它。
const DEFAULT_AGENT_PARALLEL = 4;

const DEFAULT_CONFIG = {
  dispatch: { auto: true, watch: 'auto', discuss_max_rounds: 2, timeout_min: 480, stall_min: 40, runs_dir: null },
  agents: {
    codex: { type: 'codex', bin: null, model: null, max_parallel: DEFAULT_AGENT_PARALLEL, sandbox: { run: null, review: null, discuss: null }, approval: null },
  },
  levels: {
    run: { simple: 'claude', normal: 'claude', complex: { agent: 'codex', effort: 'max' } },
    review: { simple: { agent: 'codex', effort: 'medium' }, normal: { agent: 'codex', effort: 'high' }, complex: { agent: 'codex', effort: 'max' } },
    discuss: { simple: [{ agent: 'codex', effort: 'medium' }], normal: [{ agent: 'codex', effort: 'high' }], complex: [{ agent: 'codex', effort: 'max' }] },
  },
};

// 写成 'claude' 的等级被 --model 点名派给 Codex，或者被只写了部分字段的配置覆盖时，用这里的推理强度。
const CODEX_LEVEL_FALLBACK = {
  simple: { agent: 'codex', effort: 'medium' },
  normal: { agent: 'codex', effort: 'high' },
  complex: { agent: 'codex', effort: 'max' },
};

const LEVELS = ['simple', 'normal', 'complex'];
const CLAUDE = 'claude'; // levels.run 里某一级整项写成它，表示这一级由 Claude 自己做
const CODEX_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const codexAgentName = (cfg) => Object.keys(cfg.agents).find((name) => cfg.agents[name]?.type === 'codex');
const migratedConfigs = new Map();

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
  catch (e) { die(M.configBadJson(file, e.message)); }
}

function mergeConfig(base, extra) {
  const out = { ...base };
  for (const k of ['dispatch', 'agents', 'levels']) {
    if (!extra || !(k in extra)) continue;
    const v = extra[k];
    if (k === 'agents' && isObject(v)) {
      out.agents = { ...base.agents, ...v };
      for (const [name, agent] of Object.entries(v)) {
        out.agents[name] = isObject(agent) ? { ...base.agents?.[name], ...agent } : agent;
        if (isObject(agent?.sandbox) && out.agents[name].type === 'codex') {
          out.agents[name].sandbox = { ...base.agents?.[name]?.sandbox, ...agent.sandbox };
        }
      }
    } else if (k === 'levels' && isObject(v)) {
      out.levels = { ...base.levels, ...v };
      for (const [mode, levels] of Object.entries(v)) {
        out.levels[mode] = isObject(levels) ? { ...base.levels?.[mode], ...levels } : levels;
        if (!isObject(levels)) continue;
        for (const [lv, entry] of Object.entries(levels)) {
          const prev = base.levels?.[mode]?.[lv];
          out.levels[mode][lv] = mode !== 'discuss' && isObject(entry)
            ? { ...(prev === CLAUDE ? CODEX_LEVEL_FALLBACK[lv] : prev), ...entry } : entry;
        }
      }
    } else {
      out[k] = isObject(v) ? { ...base[k], ...v } : v;
    }
  }
  return out;
}

// base 是这份配置要叠加上去的那一层（用户配置叠在内置默认值上，项目配置叠在合并后的用户配置上）。
// 旧写法的等级按字段继承 base，转换时要先把继承来的值补齐。
function migrateConfig(config, file, base, project = false) {
  if (!isObject(config)) die(M.configInvalid(file, M.invalid.object));
  if (migratedConfigs.has(file)) return migratedConfigs.get(file);
  // 顺序决定改写后文件里字段的顺序。
  const oldKeys = ['auto_dispatch', 'watch', 'discuss_max_rounds', 'codex_bin', 'model', 'max_parallel', 'sandbox', 'approval', 'timeout_min', 'stall_min', 'runs_dir'];
  let old = oldKeys.some((key) => Object.hasOwn(config, key));
  const codexName = codexAgentName(base) || 'codex';
  const legacy = { dispatch: {}, agents: { [codexName]: project ? {} : { type: 'codex' } } };
  for (const key of oldKeys) {
    if (!Object.hasOwn(config, key)) continue;
    if (['model', 'max_parallel', 'sandbox', 'approval', 'codex_bin'].includes(key)) legacy.agents[codexName][key === 'codex_bin' ? 'bin' : key] = config[key];
    else legacy.dispatch[key === 'auto_dispatch' ? 'auto' : key] = config[key];
  }
  const converted = mergeConfig(legacy, config);
  const convert = (item) => {
    if (!isObject(item) || Object.hasOwn(item, 'agent')) return item;
    old = true;
    const result = { agent: codexName, ...item };
    // 用户配置里的 model: null 就是"用默认"，不必写出来；项目配置里的 null 表示清除用户配置设的模型，要保留。
    if (!project && result.model === null) delete result.model;
    return result;
  };
  for (const [mode, levels] of Object.entries(isObject(config.levels) ? config.levels : {})) {
    if (!isObject(levels)) continue;
    for (const [lv, entry] of Object.entries(levels)) {
      if (mode !== 'discuss') converted.levels[mode][lv] = convert(entry);
      else if (!isObject(entry)) converted.levels[mode][lv] = Array.isArray(entry) ? entry.map(convert) : entry; // 写错的值留给 validateConfig 报错
      else {
        // 旧写法只管 Codex 一方，按字段继承；新写法整级替换。所以把它并进 base 这一级的参与方数组，其他参与方保留。
        const list = Array.isArray(base.levels?.discuss?.[lv]) ? base.levels.discuss[lv] : [];
        const prev = list.find((e) => e?.agent === codexName);
        const { agent, ...inherited } = prev || CODEX_LEVEL_FALLBACK[lv];
        const merged = convert({ ...inherited, ...entry });
        converted.levels[mode][lv] = prev ? list.map((e) => (e === prev ? merged : e)) : [merged, ...list];
      }
    }
  }
  if (!old) return config;
  // 按 dispatch / agents / levels 的顺序写，旧配置里没有的块不写（写成 undefined 会盖掉默认值）；未识别的字段保留在文件里。
  const result = {};
  for (const key of ['dispatch', 'agents', 'levels']) if (converted[key] !== undefined) result[key] = converted[key];
  for (const [key, value] of Object.entries(config)) if (!oldKeys.includes(key) && !Object.hasOwn(result, key)) result[key] = value;
  migratedConfigs.set(file, result);
  if (project) process.stderr.write(`codex-run: ${M.projectOldFormat(file)}\n`);
  else {
    // 转换结果不合格就停在这里，原文件不动。
    validateConfig(mergeConfig(base, result));
    let bak = `${file}.bak`;
    if (fs.existsSync(bak)) {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      bak += `-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    }
    // 第一次升级后 Claude 可能同时启动几个讨论参与方，几个进程会同时迁移，临时文件不能共用。
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.copyFileSync(file, bak, fs.constants.COPYFILE_EXCL);
      fs.writeFileSync(tmp, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
      fs.renameSync(tmp, file);
      process.stderr.write(`codex-run: ${M.configMigrated(file, bak)}\n`);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      process.stderr.write(`codex-run: ${M.configMigrateFailed(file, e.message)}\n`);
    }
  }
  return result;
}

function validateConfig(cfg) {
  const why = M.invalid;
  const check = (ok, key, reason) => { if (!ok) die(M.configInvalid(key, reason)); };
  const text = (v) => typeof v === 'string' && !!v.trim();
  for (const key of ['dispatch', 'agents', 'levels']) check(isObject(cfg[key]), key, why.object);
  check(typeof cfg.dispatch.auto === 'boolean', 'dispatch.auto', why.boolean);
  check(['auto', 'off'].includes(cfg.dispatch.watch), 'dispatch.watch', why.watch);
  check(Number.isInteger(cfg.dispatch.discuss_max_rounds) && cfg.dispatch.discuss_max_rounds >= 1, 'dispatch.discuss_max_rounds', why.positiveInt);
  for (const key of ['timeout_min', 'stall_min']) check(Number.isFinite(cfg.dispatch[key]) && (key === 'stall_min' ? cfg.dispatch[key] >= 0 : cfg.dispatch[key] > 0), `dispatch.${key}`, why.minutes);
  check(cfg.dispatch.runs_dir === null || text(cfg.dispatch.runs_dir), 'dispatch.runs_dir', why.pathOrNull);
  let codexCount = 0;
  for (const [name, agent] of Object.entries(cfg.agents)) {
    const key = `agents.${name}`;
    check(/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name) && name !== CLAUDE, key, why.agentName);
    check(isObject(agent), key, why.object);
    check(['codex', 'openai-compatible'].includes(agent.type), `${key}.type`, why.agentType);
    check(agent.model == null || (text(agent.model) && agent.model !== CLAUDE), `${key}.model`, why.modelName);
    check(agent.max_parallel === undefined || (Number.isInteger(agent.max_parallel) && agent.max_parallel >= 1), `${key}.max_parallel`, why.positiveInt);
    if (agent.type === 'codex') {
      codexCount++;
      for (const field of ['bin', 'approval']) check(agent[field] == null || text(agent[field]), `${key}.${field}`, why.stringOrNull);
      check(agent.sandbox == null || isObject(agent.sandbox), `${key}.sandbox`, why.object);
      for (const [mode, value] of Object.entries(agent.sandbox || {})) check(['run', 'review', 'discuss'].includes(mode) && (value === null || ['read-only', 'workspace-write', 'danger-full-access'].includes(value)), `${key}.sandbox.${mode}`, why.sandbox);
    } else {
      for (const field of ['base_url', 'model']) check(text(agent[field]), `${key}.${field}`, why.nonEmpty);
      // api_key 写成空字符串表示还没填（首次生成的配置里的示例就是这样）；没有 key 的协作方被选去讨论时才报错。
      check(agent.api_key === undefined || typeof agent.api_key === 'string', `${key}.api_key`, why.apiKeyText);
      check(agent.api_key_env === undefined || text(agent.api_key_env), `${key}.api_key_env`, why.nonEmpty);
      check(agent.extra_body === undefined || isObject(agent.extra_body), `${key}.extra_body`, why.object);
    }
  }
  // Codex 是必需的：执行和审查只能交给它，check 也以它为准。
  check(codexCount === 1, 'agents', why.codexCount);
  for (const mode of Object.keys(cfg.levels)) check(['run', 'review', 'discuss'].includes(mode), `levels.${mode}`, why.mode);
  for (const mode of ['run', 'review', 'discuss']) {
    check(isObject(cfg.levels[mode]), `levels.${mode}`, why.object);
    for (const lv of Object.keys(cfg.levels[mode])) check(LEVELS.includes(lv), `levels.${mode}.${lv}`, why.level);
    for (const lv of LEVELS) {
      const key = `levels.${mode}.${lv}`;
      const entry = cfg.levels[mode][lv];
      if (entry === CLAUDE && mode === 'run') continue;
      if (mode === 'discuss') check(Array.isArray(entry) && entry.length > 0, key, why.participants);
      const seen = new Set();
      for (const [i, item] of (mode === 'discuss' ? entry : [entry]).entries()) {
        const at = mode === 'discuss' ? `${key}[${i}]` : key;
        check(isObject(item), at, M.levelEntryChoices);
        check(text(item.agent), `${at}.agent`, why.agentRef);
        if (!Object.hasOwn(cfg.agents, item.agent)) die(M.unknownAgent(at, item.agent));
        const agent = cfg.agents[item.agent];
        check(!seen.has(item.agent), at, why.duplicate);
        seen.add(item.agent);
        check(mode === 'discuss' || agent.type === 'codex', `${at}.agent`, M.apiOnlyDiscuss(item.agent));
        check(item.model == null || (text(item.model) && item.model !== CLAUDE), `${at}.model`, why.modelName);
        check(agent.type === 'codex' ? CODEX_EFFORTS.includes(item.effort) : item.effort === null || text(item.effort), `${at}.effort`, agent.type === 'codex' ? CODEX_EFFORTS.join(' / ') : why.apiEffort);
      }
    }
  }
}

function projectConfig(cfg, project) {
  const allowed = {};
  const ignored = [];
  for (const [key, value] of Object.entries(project)) {
    if (key === 'dispatch' && isObject(value)) {
      allowed.dispatch = {};
      for (const [field, val] of Object.entries(value)) {
        if (['timeout_min', 'stall_min'].includes(field)) allowed.dispatch[field] = val;
        else ignored.push(`dispatch.${field}`);
      }
    } else if (key === 'agents' && isObject(value)) {
      allowed.agents = {};
      for (const [name, agent] of Object.entries(value)) {
        if (cfg.agents[name]?.type !== 'codex' || !isObject(agent)) { ignored.push(`agents.${name}`); continue; }
        allowed.agents[name] = {};
        for (const [field, val] of Object.entries(agent)) {
          if (field === 'model') allowed.agents[name].model = val;
          else ignored.push(`agents.${name}.${field}`);
        }
      }
    } else if (key === 'levels') {
      allowed.levels = structuredClone(value);
      for (const [lv, entries] of Object.entries(value?.discuss || {})) {
        if (!Array.isArray(entries)) continue;
        const key = `levels.discuss.${lv}`;
        allowed.levels.discuss[lv] = entries.filter((item) => {
          const drop = cfg.agents[item?.agent]?.type === 'openai-compatible' && !cfg.levels.discuss[lv]?.some((v) => v.agent === item.agent);
          if (drop) process.stderr.write(`codex-run: ${M.projectApiDropped(item.agent, key)}\n`);
          return !drop;
        });
        if (entries.length && !allowed.levels.discuss[lv].length) die(M.projectLevelEmpty(key));
      }
    } else ignored.push(key);
  }
  if (ignored.length) process.stderr.write(`codex-run: ${M.projectIgnored(M.list(ignored))}\n`);
  return allowed;
}

// 首次使用时生成的用户配置：在内置默认值上套用 README 里的示例搭配。
// 另外放两个 API 协作方的示例，api_key 留空提醒用户可以填；它们不在讨论等级里，填了 key 还要自己加进 levels.discuss。
const STARTER_CONFIG = mergeConfig(DEFAULT_CONFIG, {
  agents: {
    codex: { model: 'gpt-6.1-sol' },
    deepseek: { type: 'openai-compatible', base_url: 'https://api.deepseek.com', api_key: '', model: 'deepseek-v4-pro' },
    mimo: { type: 'openai-compatible', base_url: 'https://api.xiaomimimo.com/v1', api_key: '', model: 'mimo-v2.6-pro' },
  },
  levels: {
    review: { complex: { model: 'gpt-6-astra' } },
    discuss: { complex: [{ agent: 'codex', model: 'gpt-6-astra', effort: 'max' }] },
  },
});

function writeStarterConfig() {
  fs.mkdirSync(path.dirname(USER_CONFIG), { recursive: true });
  fs.writeFileSync(USER_CONFIG, JSON.stringify(STARTER_CONFIG, null, 2) + '\n');
}

function loadConfig(cwd) {
  const sources = [];
  let cfg = DEFAULT_CONFIG;
  if (!fs.existsSync(USER_CONFIG)) {
    try {
      writeStarterConfig();
      process.stderr.write(`codex-run: ${M.starterCreated(USER_CONFIG, STARTER_CONFIG.agents.codex.model, STARTER_CONFIG.levels.review.complex.model)}\n`);
    } catch (e) {
      process.stderr.write(`codex-run: ${M.starterFailed(USER_CONFIG, e.message)}\n`);
    }
  }
  const user = readJson(USER_CONFIG);
  if (user) { cfg = mergeConfig(cfg, migrateConfig(user, USER_CONFIG, cfg)); sources.push(USER_CONFIG); }
  if (cwd) {
    const file = path.join(cwd, PROJECT_CONFIG);
    const project = readJson(file);
    if (project) {
      cfg = mergeConfig(cfg, projectConfig(cfg, migrateConfig(project, file, cfg, true)));
      sources.push(file);
    }
  }
  const codexName = isObject(cfg.agents) && codexAgentName(cfg);
  if (process.env.CODEX_BIN && codexName) cfg = mergeConfig(cfg, { agents: { [codexName]: { bin: process.env.CODEX_BIN } } });
  if (process.env.CODEX_RUNS_DIR) cfg = mergeConfig(cfg, { dispatch: { runs_dir: process.env.CODEX_RUNS_DIR } });
  validateConfig(cfg);
  return { ...cfg, sources };
}

// 记录目录和可执行文件只认用户配置，status / watch 不知道工作目录时也能用。
const CONFIG = loadConfig(null);
const RUNS_ROOT = CONFIG.dispatch.runs_dir ? path.resolve(CONFIG.dispatch.runs_dir) : path.join(os.homedir(), '.claude', 'codex-runs');

// 改动追踪：用放在记录目录里的影子 git 仓库给工作目录拍快照，不碰项目自己的 .git。
const LARGE_FILE_BYTES = 5 * 1024 * 1024; // 超过的文件只比较大小和修改时间
const MAX_SNAPSHOT_FILES = 50000;
const SNAPSHOT_EXCLUDES = [
  '.git/', 'node_modules/', '.venv/', 'venv/', '__pycache__/', '.mypy_cache/', '.pytest_cache/',
  '.ruff_cache/', '.tox/', '.next/', '.nuxt/', '.gradle/', '.idea/', '.vs/', 'target/', '*.pyc',
];

// ---------- 通用 ----------

function die(msg) {
  process.stderr.write(`codex-run: ${msg}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = { 'add-dir': [], track: [], scope: [], file: [] };
  const flags = new Set(['uncommitted', 'no-snapshot', 'verbose']);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) die(M.badArg(a));
    const key = a.slice(2);
    if (flags.has(key)) { opts[key] = true; continue; }
    const val = rest[++i];
    if (val === undefined) die(M.missingValue(a));
    if (key === 'add-dir' || key === 'track' || key === 'scope' || key === 'file') opts[key].push(val);
    else opts[key] = val;
  }
  return { cmd, opts };
}

function need(o, key) {
  if (!o[key]) die(M.missingOpt(key));
  return o[key];
}

function pickProfile(cfg, o, mode, fallbackModel = null, parentAgent = null) {
  if (o.level && o.effort) die(M.levelAndEffort);
  if (parentAgent && o.agent && o.agent !== parentAgent) die(M.resumeAgentMismatch(o.agent, parentAgent));
  const selected = parentAgent || o.agent;
  const codexName = codexAgentName(cfg);
  let level = null;
  let entry = {};
  if (o.effort) {
    entry = { agent: selected || codexName, effort: o.effort };
  } else {
    if (!o.level) die(M.missingLevel(LEVELS.join(' / '), CODEX_EFFORTS.join(' / ')));
    if (!LEVELS.includes(o.level)) die(M.levelChoices(LEVELS.join(' / ')));
    level = o.level;
    const key = `levels.${mode}.${level}`;
    entry = cfg.levels[mode][level];
    if (mode === 'discuss') {
      const names = M.list(entry.map((v) => v.agent));
      if (!selected && entry.length > 1) die(M.agentRequired(key, names));
      const found = selected ? entry.find((v) => v.agent === selected) : entry[0];
      if (!found) die(M.agentNotInLevel(selected, key, names));
      entry = found;
    }
    if (entry === CLAUDE) {
      if (!o.model) die(M.levelForClaude(level));
      entry = { ...CODEX_LEVEL_FALLBACK[level], agent: codexName };
    }
    if (selected && selected !== entry.agent) die(M.agentMismatch(selected, key, entry.agent));
  }
  if (!Object.hasOwn(cfg.agents, entry.agent)) die(M.unknownAgent('--agent', entry.agent));
  const agent = cfg.agents[entry.agent];
  if (agent.type !== 'codex' && mode !== 'discuss') die(M.apiOnlyDiscuss(entry.agent));
  if (agent.type === 'codex' && !CODEX_EFFORTS.includes(entry.effort)) die(M.effortChoices(CODEX_EFFORTS.join(' / ')));
  return { level, agentName: entry.agent, agent, model: o.model || entry.model || agent.model || fallbackModel, effort: entry.effort };
}

// 模型、推理强度、沙箱、审批这几项 exec / resume / review 都接受 -m 和 -c。
function codexOptions(agent, { model, effort, mode }) {
  const args = [];
  if (model) args.push('-m', model);
  args.push('-c', `model_reasoning_effort="${effort}"`);
  if (agent.sandbox?.[mode]) args.push('-c', `sandbox_mode="${agent.sandbox[mode]}"`);
  if (agent.approval) args.push('-c', `approval_policy="${agent.approval}"`);
  return args;
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

function codexCommand(agent = CONFIG.agents[codexAgentName(CONFIG)]) {
  const bin = agent?.bin;
  if (bin) return /\.[cm]?js$/i.test(bin) ? { file: process.execPath, pre: [bin] } : { file: bin, pre: [] };
  if (process.platform !== 'win32') return { file: 'codex', pre: [] };
  // npm 全局安装的 codex 在 Windows 上是 .ps1/.cmd 包装，spawn 不经 shell 找不到它；
  // 直接用 node 跑入口脚本，也避开 shell 引号问题。
  const entry = (root) => path.join(root, '@openai', 'codex', 'bin', 'codex.js');
  let js = entry(path.join(process.env.APPDATA || '', 'npm', 'node_modules'));
  if (!fs.existsSync(js)) {
    // 改过 npm prefix 或用 nvm 时不在默认位置，问 npm 要全局目录。
    const npm = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', shell: true, windowsHide: true });
    js = npm.status === 0 && npm.stdout.trim() ? entry(npm.stdout.trim()) : '';
  }
  if (js && fs.existsSync(js)) return { file: process.execPath, pre: [js] };
  return { file: 'codex.exe', pre: [] };
}

// 没配置模型时从 Codex 的 config.toml 读出实际模型名，只用于显示，让用户知道用的是哪个模型。
function codexConfigModel() {
  const file = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const top = text.split(/^\s*\[/m)[0]; // 只看第一个 [表] 之前的顶层键
  return /^\s*model\s*=\s*["']([^"']+)["']/m.exec(top)?.[1] || null;
}

function writeWatchLauncher() {
  const launcher = `// 自动生成：转调 codex-run.mjs watch。\nprocess.argv.splice(2, 0, 'watch');\nawait import(${JSON.stringify(pathToFileURL(fileURLToPath(import.meta.url)).href)});\n`;
  try { fs.writeFileSync(path.join(RUNS_ROOT, 'watch.mjs'), launcher); } catch { /* 不影响主流程 */ }
}

// 并发上限按协作方算，任何任务（分不分组、哪个会话）都要在锁内登记并做准入检查，调用方用完 release。
async function newRunDir() {
  fs.mkdirSync(RUNS_ROOT, { recursive: true });
  // 登记和准入串行完成，避免随机后缀让后登记的任务排到前面。
  const lock = path.join(RUNS_ROOT, '.start.lock');
  for (;;) {
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let owner;
      let age = 0;
      try { owner = Number(fs.readFileSync(lock, 'utf8')); age = Date.now() - fs.statSync(lock).mtimeMs; } catch (e) { if (e.code !== 'ENOENT') throw e; }
      // 登记只需要几毫秒；持有者已退出，或者锁放了很久（持有者被强杀后 pid 又被复用），都当作残留锁清掉。
      if ((owner && !pidAlive(owner)) || age > 30000) fs.rmSync(lock, { force: true });
      await sleep(25);
    }
  }
  const cleanup = () => fs.rmSync(lock, { force: true });
  process.once('exit', cleanup);
  const release = () => { cleanup(); process.removeListener('exit', cleanup); };
  const previous = listRuns()[0] || '';
  let id;
  do {
    if (id) await sleep(10);
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    id = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`;
  } while (id <= previous);
  const dir = path.join(RUNS_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  writeWatchLauncher();
  return { id, dir, release };
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
  if (!id) die(M.noRuns);
  const dir = path.join(RUNS_ROOT, id);
  if (!fs.existsSync(path.join(dir, 'meta.json'))) die(M.runNotFound(ref));
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
  // codex 以独立进程组启动，负 pid 连同它起的子进程一起结束。
  else try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* 已退出 */ } }
}

// ---------- 改动追踪 ----------

function relativePath(cwd, file) {
  return path.relative(cwd, path.resolve(cwd, file.replace(/\\/g, '/'))).replace(/\\/g, '/') || '.';
}

const pathKey = (file) => process.platform === 'win32' ? file.toLowerCase() : file;

function makeTracker(runDir, cwd, track) {
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
    if (r.error || r.status !== 0) throw new Error(M.gitFailed(args[0], r.error?.message || r.stderr.trim()));
    return r.stdout;
  };

  git(['init', '--quiet']);
  fs.mkdirSync(path.join(gitDir, 'info'), { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'info', 'exclude'), SNAPSHOT_EXCLUDES.join('\n') + '\n');

  function snap(label) {
    const index = path.join(gitDir, `index-${label}`);
    const files = [...new Set([
      ...git(['ls-files', '-z', '-o', '--exclude-standard']).split('\0').filter(Boolean),
      ...(track.length ? git(['ls-files', '-z', '-o', '--', ...track]).split('\0').filter(Boolean) : []),
    ])];
    if (files.length > MAX_SNAPSHOT_FILES) throw new Error(M.tooManyFiles(files.length, MAX_SNAPSHOT_FILES));
    const small = [];
    const large = {};
    for (const f of files) {
      let st;
      try { st = fs.statSync(path.join(cwd, f)); } catch { continue; }
      if (st.isDirectory()) continue; // 嵌套仓库
      if (st.size > LARGE_FILE_BYTES) large[f] = `${st.size}:${Math.round(st.mtimeMs)}`;
      else small.push(f);
    }
    if (small.length) git(['add', '-f', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: small.join('\0'), index });
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

function runCodex({ agent, args, cwd, prompt, runDir, timeoutMin, stallMin, onSession }) {
  return new Promise((resolve) => {
    const { file, pre } = codexCommand(agent);
    const events = fs.createWriteStream(path.join(runDir, 'events.jsonl'));
    const errLog = fs.createWriteStream(path.join(runDir, 'stderr.log'));
    const out = { code: null, sessionId: null, usage: null, errors: [], warnings: [], fileChanges: new Set(), quotaExhausted: false, timedOut: false, stalled: false, commands: 0 };
    const runningCommands = new Set();
    let lastEventAt = Date.now();
    const child = spawn(file, [...pre, ...args], {
      cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    });

    const onSignal = () => { killTree(child.pid); process.exit(130); };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);

    let buf = '';
    const handle = (line) => {
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      lastEventAt = Date.now();
      if (ev.item?.type === 'file_change') {
        for (const change of ev.item.changes || []) out.fileChanges.add(change.path);
      }
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
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => {
      const text = (out.stderrTail || '') + c;
      if (/usage limit|quota/i.test(text)) out.quotaExhausted = true;
      out.stderrTail = text.slice(-4000);
    });

    const timer = setTimeout(() => { out.timedOut = true; killTree(child.pid); }, timeoutMin * 60000);
    const stallCheck = setInterval(() => {
      if (!stallMin || runningCommands.size || Date.now() - lastEventAt < stallMin * 60000) return;
      out.stalled = true;
      out.errors.push(M.stalled(stallMin));
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
    child.on('error', (e) => { out.errors.push(M.spawnFailed(e.message)); finish(-1); });
    child.on('close', (code) => finish(code));
    child.stdin.on('error', () => { /* codex 提前退出时忽略 EPIPE */ });
    child.stdin.end(prompt, 'utf8');
  });
}

// 从 Codex 自己的会话记录里读最后一次 token 统计：累计用量、最近一次请求、窗口和额度。
// exec --json 只在结尾给一次总用量，这些数只有会话记录里有。找不到就返回 null。
function codexSessionStats(sessionId, startedAt) {
  if (!sessionId) return null;
  const root = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
  let file = null;
  // 会话记录按开始日期放在 sessions/年/月/日 下；续接的会话还在最初那天的目录里，所以从开始日期往前找。
  const day = new Date(startedAt || Date.now());
  for (let i = -1; i <= 60 && !file; i++) {
    const d = new Date(day.getTime() - i * 86400000);
    const dir = path.join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    try { file = fs.readdirSync(dir).filter((f) => f.includes(sessionId)).map((f) => path.join(dir, f))[0] || null; } catch { /* 没有这天的目录 */ }
  }
  if (!file) return null;
  const st = fs.statSync(file);
  const len = Math.min(st.size, 1024 * 1024);
  const chunk = Buffer.alloc(len);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, chunk, 0, len, st.size - len); } finally { fs.closeSync(fd); }
  const lines = chunk.toString('utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"token_count"')) continue;
    let p;
    try { p = JSON.parse(lines[i]).payload; } catch { continue; }
    const last = p?.info?.last_token_usage;
    const rl = p?.rate_limits?.primary;
    return {
      total_token_usage: p?.info?.total_token_usage || null,
      last_request: last && p.info.model_context_window ? { tokens: last.total_tokens ?? last.input_tokens, window: p.info.model_context_window } : null,
      rate_limit: rl ? { used_percent: rl.used_percent, window_minutes: rl.window_minutes, resets_at: rl.resets_at } : null,
    };
  }
  return null;
}

async function execute(ctx) {
  const { cfg, agentName, agent, model, mode, kind, id, dir, cwd, level, effort, args, prompt, title, parent, opts, expectReport } = ctx;
  const started = Date.now();
  const track = [...new Map(opts.track.map((file) => {
    const rel = relativePath(cwd, file);
    if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) die(M.badArg(`--track ${file}`));
    return [pathKey(rel), rel];
  })).values()];
  const sandbox = agent.sandbox?.[kind === 'exec' ? 'run' : kind] || null;
  // model 为 null 时实际模型由 Codex 配置决定，model_shown 是给人看的实际模型名。
  const modelShown = model || M.modelFromCodex(codexConfigModel() || M.unknownModel);
  const meta = {
    agent: agentName, agent_type: agent.type,
    id, mode, kind, title: title || null, cwd, model, model_shown: modelShown, level, effort, sandbox,
    parent: parent || null, track, group: opts.group ?? null, scope: opts.scope, round: ctx.round ?? null,
    started_at: new Date(started).toISOString(), status: 'running', pid: process.pid, session_id: ctx.sessionId || null,
  };
  const writeMeta = () => {
    const file = path.join(dir, 'meta.json');
    // 同组任务会并发读取元数据，替换完整文件，避免把半份 JSON 当成没有记录。
    const target = meta.group != null ? `${file}.tmp` : file;
    fs.writeFileSync(target, JSON.stringify(meta, null, 2));
    if (target !== file) fs.renameSync(target, file);
  };
  let rejection;
  try {
    writeMeta();
    rejection = checkAdmission(meta, cfg);
    if (rejection) fs.rmSync(dir, { recursive: true });
  } finally { ctx.release(); }
  if (rejection) die(rejection);
  fs.writeFileSync(path.join(dir, 'brief.md'), prompt);
  process.stderr.write(`codex-run: ${M.started(mode, agentName, modelShown, effort, level, dir)}\n`);

  const warnings = [];
  const notes = [];
  let tracker = null;
  let before = null;
  if (!opts['no-snapshot']) {
    try { tracker = makeTracker(dir, cwd, track); before = tracker.snap('before'); }
    catch (e) { warnings.push(M.trackingUnavailable(e.message)); tracker?.cleanup(); tracker = null; }
  }

  const baseline = mode === 'resume' ? codexSessionStats(ctx.sessionId, meta.started_at)?.total_token_usage : {};
  const r = await runCodex({
    agent, args, cwd, prompt, runDir: dir,
    timeoutMin: Number(opts.timeout) || cfg.dispatch.timeout_min,
    stallMin: Number(opts.stall ?? cfg.dispatch.stall_min),
    onSession: (sid) => { meta.session_id = sid; writeMeta(); },
  });

  const lastFile = path.join(dir, 'last-message.txt');
  const last = fs.existsSync(lastFile) ? fs.readFileSync(lastFile, 'utf8').trim() : '';
  let report = null;
  if (expectReport && last) { try { report = JSON.parse(last); } catch { warnings.push(M.badReport); } }
  if (!report && last.length > 8000) notes.push(M.lastMessageTruncated(lastFile));

  const reported = (report?.files_changed || []).map((f) => relativePath(cwd, f.path));
  const codexPaths = new Set([...r.fileChanges].map((f) => pathKey(relativePath(cwd, f))));
  for (const file of reported) codexPaths.add(pathKey(file));
  let changes = { available: false, codex_total: 0, unknown_total: 0 };
  if (tracker) {
    try { changes = { available: true, ...tracker.diff(before, tracker.snap('after'), path.join(dir, 'diff.patch')) }; }
    catch (e) { warnings.push(M.trackingFailed(e.message)); }
    finally { tracker.cleanup(); }
  }
  const tracked = [...(changes.files || []), ...(changes.large_files_changed || [])];
  for (const file of tracked) file.by = codexPaths.has(pathKey(relativePath(cwd, file.path))) ? 'codex' : 'unknown';
  changes.codex_total = tracked.filter((f) => f.by === 'codex').length;
  changes.unknown_total = tracked.length - changes.codex_total;
  if (kind !== 'exec' && changes.codex_total) warnings.push(M.readonlyChanged(kind, changes.codex_total));
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
  meta.status = ok ? 'done' : quotaExhausted ? 'quota_exhausted' : r.stalled ? 'stalled' : r.timedOut ? 'timeout' : 'failed';
  meta.session_id = r.sessionId || meta.session_id;
  meta.ended_at = new Date().toISOString();
  const stats = codexSessionStats(meta.session_id, meta.started_at);
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
    run_dir: dir,
  };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  writeMeta(); // 在 result.json 之后写，watch 看到状态变化时结果已经就绪
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = ok ? 0 : 1;
}

// 兼容 OpenAI 的接口各家缓存字段名不同：DeepSeek 是 prompt_cache_hit_tokens，OpenAI 是 prompt_tokens_details.cached_tokens。
const apiUsage = (u) => ({
  input_tokens: u?.prompt_tokens || 0,
  cached_input_tokens: u?.prompt_cache_hit_tokens ?? u?.prompt_tokens_details?.cached_tokens ?? 0,
  output_tokens: u?.completion_tokens || 0,
  reasoning_output_tokens: u?.completion_tokens_details?.reasoning_tokens ?? 0,
});

// 配置里直接写的 api_key 优先（看得见，也不会被忘了删的旧环境变量顶替），没有再读 api_key_env 指向的环境变量。
const apiKeyOf = (agent) => (agent.api_key ? { key: agent.api_key, source: 'config' }
  : process.env[agent.api_key_env] ? { key: process.env[agent.api_key_env], source: 'env' } : { key: null, source: null });

async function executeApi(ctx) {
  const { cfg, agentName, agent, model, effort, level, cwd, brief, mode, opts } = ctx;
  const apiKey = apiKeyOf(agent).key;
  if (!apiKey) die(M.apiKeyMissing(agentName, agent.api_key_env));
  const modelShown = agent.extra_body?.model ?? model;
  const schemaText = fs.readFileSync(DISCUSS_SCHEMA, 'utf8');
  const schema = JSON.parse(schemaText);
  let history = [{ role: 'system', content: M.apiDiscussSystem(schemaText) }];
  if (ctx.parent) {
    const file = path.join(ctx.parentDir, 'messages.json');
    if (!fs.existsSync(file)) die(M.apiNoMessages(ctx.parent));
    history = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const files = readAttachments(opts.file, cwd, true);
  let prompt = brief;
  if (!ctx.parent || files.length) {
    const git = spawnSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    const list = git.status === 0 ? git.stdout.split('\0').filter(Boolean) : [];
    if (list.length || files.length) prompt += `\n\n${M.apiMaterials(list.slice(0, 300).join('\n'), list.length, files)}`;
  }
  if (prompt.length > MAX_MATERIAL_CHARS) die(M.materialsTooLarge(prompt.length, MAX_MATERIAL_CHARS, M.list(files.map((f) => `${f.shown}: ${f.chars}`))));
  if (ctx.parent) prompt += `\n\n${M.apiResumeFooter}`;
  history = [...history, { role: 'user', content: prompt }];
  const { id, dir, release } = await newRunDir();
  const started = Date.now();
  const deadline = started + (Number(opts.timeout) || cfg.dispatch.timeout_min) * 60000;
  const meta = {
    id, mode, kind: 'discuss', title: ctx.title || null, cwd, model, model_shown: modelShown, level, effort,
    agent: agentName, agent_type: agent.type, sandbox: null, parent: ctx.parent || null,
    track: [], group: opts.group ?? null, scope: opts.scope, round: ctx.round,
    started_at: new Date(started).toISOString(), status: 'running', pid: process.pid, session_id: null,
  };
  const writeMeta = () => {
    const file = path.join(dir, 'meta.json');
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(meta, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  };
  let rejection;
  try {
    writeMeta();
    rejection = checkAdmission(meta, cfg);
    if (rejection) fs.rmSync(dir, { recursive: true });
  } finally { release(); }
  if (rejection) die(rejection);
  const redact = (s) => s.replaceAll(apiKey, '[REDACTED]');
  const event = (ev) => fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify({ ...ev, ts: new Date().toISOString() }) + '\n');
  fs.writeFileSync(path.join(dir, 'brief.md'), prompt);
  fs.writeFileSync(path.join(dir, 'messages.json'), JSON.stringify(history, null, 2));
  process.stderr.write(`codex-run: ${M.started(mode, agentName, modelShown, effort, level, dir)}\n`);
  const usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 };
  const notes = [];
  const warnings = [];
  const errors = [];
  let attempt = 0;
  let retried = false;
  let formatRemoved = false;
  let last = '';
  let report = null;
  const request = async (messages) => {
    for (;;) {
      if (Date.now() >= deadline) {
        event({ type: 'api.error', kind: 'timeout', status: null, message: 'Run timed out' });
        throw Object.assign(new Error('Run timed out'), { kind: 'timeout' });
      }
      const body = { model, messages, stream: true, stream_options: { include_usage: true },
        ...(effort != null ? { reasoning_effort: effort } : {}), response_format: { type: 'json_object' }, ...agent.extra_body };
      if (formatRemoved) delete body.response_format;
      event({ type: 'api.request', attempt: ++attempt, model: body.model, effort: body.reasoning_effort ?? null });
      try {
        const reply = await chatStream({ url: agent.base_url, apiKey, body, timeoutMs: deadline - Date.now(), stallMs: Number(opts.stall ?? cfg.dispatch.stall_min) * 60000,
          onEvent: (ev) => {
            if (ev.type === 'api.usage') {
              ev.usage = apiUsage(ev.usage);
              for (const key of Object.keys(usage)) usage[key] += ev.usage[key];
            }
            if (ev.text) ev.text = redact(ev.text);
            event(ev);
          },
        });
        // 去掉 response_format 后成功了，才说明 400 是它引起的；模型名写错之类的 400 不该归到它头上。
        if (formatRemoved && !notes.includes(M.apiNoResponseFormat)) notes.push(M.apiNoResponseFormat);
        return reply;
      } catch (e) {
        event({ type: 'api.error', kind: e.kind, status: e.status ?? null, message: redact(e.message) });
        if (e.kind === 'bad_request' && body.response_format && !formatRemoved) {
          formatRemoved = true;
          event({ type: 'api.retry', reason: 'response_format', wait_s: 0 });
          continue;
        }
        if (!retried && ['network', 'rate_limit', 'server', 'stall'].includes(e.kind)) {
          retried = true;
          event({ type: 'api.retry', reason: e.kind, wait_s: 5 });
          await sleep(Math.min(5000, Math.max(0, deadline - Date.now())));
          continue;
        }
        throw e;
      }
    }
  };
  try {
    let messages = history;
    for (let repair = 0; repair <= 1; repair++) {
      const reply = await request(messages);
      last = redact(reply.content);
      if (reply.finishReason === 'length') {
        event({ type: 'api.error', kind: 'length', status: null, message: M.apiTruncated(agentName) });
        throw Object.assign(new Error(M.apiTruncated(agentName)), { kind: 'length' });
      }
      let invalid;
      try {
        let value;
        try { value = JSON.parse(last); }
        catch {
          const stripped = last.trim().replace(/^```[^\n]*\n/, '').replace(/\n```$/, '');
          value = JSON.parse(stripped.slice(stripped.indexOf('{'), stripped.lastIndexOf('}') + 1));
        }
        invalid = validateSchema(schema, value);
        if (!invalid.length) { report = value; break; }
      } catch { invalid = [last.trim() ? 'Reply is not valid JSON' : 'Reply is empty']; }
      if (repair === 1) { warnings.push(M.apiReportInvalid(agentName, path.join(dir, 'last-message.txt'))); break; }
      event({ type: 'api.repair', errors: invalid });
      messages = [...history, { role: 'assistant', content: last }, { role: 'user', content: M.apiRepairPrompt(invalid.join('\n')) }];
    }
    meta.status = 'done';
  } catch (e) {
    meta.status = { balance: 'quota_exhausted', stall: 'stalled', timeout: 'timeout' }[e.kind] || 'failed';
    const message = redact(e.message);
    errors.push(e.kind === 'balance' ? M.apiBalance(agentName, message) : e.kind === 'length' ? message : M.apiError(agentName, e.kind, e.status, message));
  }
  fs.writeFileSync(path.join(dir, 'last-message.txt'), last);
  fs.writeFileSync(path.join(dir, 'messages.json'), JSON.stringify(last || meta.status === 'done' ? [...history, { role: 'assistant', content: last }] : history, null, 2));
  meta.ended_at = new Date().toISOString();
  const result = {
    run_id: id, mode, kind: 'discuss', status: meta.status, title: meta.title, cwd, track: [], group: meta.group, round: meta.round, scope: meta.scope,
    agent: agentName, agent_type: agent.type, model, model_shown: modelShown, level, effort, sandbox: null, parent: meta.parent, session_id: null,
    exit_code: meta.status === 'done' ? 0 : 1, duration_s: Math.round((Date.now() - started) / 1000), usage, usage_scope: 'this_run',
    last_request: null, rate_limit: null, quota_resets_at: null, commands_executed: 0, errors, notes, warnings, report,
    last_message: report ? undefined : last, changes: { available: false, note: M.apiNoChanges },
    files: files.map(({ path, range, chars }) => ({ path, range, chars })), run_dir: dir,
  };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  writeMeta();
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.exit_code;
}

// ---------- 子命令 ----------

async function cmdRun(o) {
  if (o.group != null && !o.scope.length) die(M.groupNeedsScope);
  const cwd = resolveDir(need(o, 'cwd'));
  const cfg = loadConfig(cwd);
  const addDirs = o['add-dir'].map(resolveDir);
  const brief = readBrief(o);
  const profile = pickProfile(cfg, o, 'run');
  const { agent, model, effort } = profile;
  const { id, dir, release } = await newRunDir();
  const args = [
    'exec', '--json', '--skip-git-repo-check', ...codexOptions(agent, { model, effort, mode: 'run' }),
    '-C', cwd, '--output-schema', SCHEMA, '-o', path.join(dir, 'last-message.txt'),
  ];
  for (const d of addDirs) args.push('--add-dir', d);
  args.push('-');
  await execute({ cfg, ...profile, mode: 'run', kind: 'exec', id, dir, release, cwd, args, prompt: `${brief}\n\n${M.footer(cwd, addDirs)}\n`, title: o.title, opts: o, expectReport: true });
}

async function cmdDiscuss(o) {
  const cwd = resolveDir(need(o, 'cwd'));
  const cfg = loadConfig(cwd);
  const brief = readBrief(o);
  const profile = pickProfile(cfg, o, 'discuss');
  const { agent, model, effort } = profile;
  if (agent.type === 'openai-compatible') return executeApi({ cfg, ...profile, mode: 'discuss', cwd, brief, title: o.title, round: 1, opts: o });
  const files = readAttachments(o.file, cwd, false);
  const { id, dir, release } = await newRunDir();
  const args = [
    'exec', '--json', '--skip-git-repo-check', ...codexOptions(agent, { model, effort, mode: 'discuss' }),
    '-C', cwd, '--output-schema', DISCUSS_SCHEMA, '-o', path.join(dir, 'last-message.txt'), '-',
  ];
  await execute({ cfg, ...profile, mode: 'discuss', kind: 'discuss', id, dir, release, cwd, args, prompt: `${brief}${focusFiles(files)}\n\n${M.discussFooter(cwd)}\n`, title: o.title, round: 1, opts: o, expectReport: true });
}

async function cmdResume(o) {
  const parent = findRun(need(o, 'run'));
  o.track = [...(parent.meta.track || []), ...o.track];
  o.group ??= parent.meta.group ?? null;
  if (!o.scope.length) o.scope = parent.meta.scope || [];
  if (parent.meta.agent_type !== 'openai-compatible' && !parent.meta.session_id) die(M.noSession(parent.id));
  const kind = parent.meta.kind || (parent.meta.mode === 'review' ? 'review' : 'exec');
  if (kind === 'review') die(M.reviewNoResume);
  const discuss = kind === 'discuss';
  if (o.group != null && !discuss && !o.scope.length) die(M.groupNeedsScope);
  let round = null;
  if (discuss) {
    const max = CONFIG.dispatch.discuss_max_rounds;
    if (!Number.isInteger(max) || max < 1) die(M.badDiscussMaxRounds);
    // 沿续接链往回数已经完成的轮次；卡死或失败后的续接仍算同一轮。
    let done = 0;
    let rootId = parent.id;
    for (let rid = parent.id, m = parent.meta; m; rid = m.parent, m = m.parent ? readMeta(path.join(RUNS_ROOT, m.parent)) : null) {
      if (m.status === 'done') done++;
      rootId = rid;
    }
    round = done + 1;
    if (round > max) die(M.discussRoundsExceeded(rootId, done, max));
  }
  const cfg = loadConfig(parent.meta.cwd);
  const brief = readBrief(o);
  // 什么模型都没配置时沿用上一轮记录的模型，同一会话不中途换模型。
  const profile = pickProfile(cfg, o, discuss ? 'discuss' : 'run', parent.meta.model, parent.meta.agent || codexAgentName(cfg));
  const { agent, model, effort } = profile;
  if (agent.type === 'openai-compatible') return executeApi({ cfg, ...profile, mode: 'resume', cwd: parent.meta.cwd, brief,
    title: o.title || parent.meta.title, parent: parent.id, parentDir: parent.dir, round, opts: o });
  const files = readAttachments(o.file, parent.meta.cwd, false);
  const { id, dir, release } = await newRunDir();
  const args = [
    'exec', 'resume', '--json', '--skip-git-repo-check', ...codexOptions(agent, { model, effort, mode: discuss ? 'discuss' : 'run' }),
    '--output-schema', discuss ? DISCUSS_SCHEMA : SCHEMA, '-o', path.join(dir, 'last-message.txt'), parent.meta.session_id, '-',
  ];
  await execute({
    cfg, ...profile, mode: 'resume', kind, id, dir, release, cwd: parent.meta.cwd, args,
    prompt: `${brief}${focusFiles(files)}\n\n${discuss ? M.discussResumeFooter : M.resumeFooter}\n`,
    title: o.title || parent.meta.title, parent: parent.id, sessionId: parent.meta.session_id, round, opts: o, expectReport: true,
  });
}

async function cmdReview(o) {
  const cwd = resolveDir(need(o, 'cwd'));
  const cfg = loadConfig(cwd);
  const profile = pickProfile(cfg, o, 'review');
  const { agent, model, effort } = profile;
  const codexOpts = codexOptions(agent, { model, effort, mode: 'review' });
  const git = isGitRepo(cwd);
  const brief = readBrief(o, !git);
  const { id, dir, release } = await newRunDir();
  const last = path.join(dir, 'last-message.txt');
  let args;
  let prompt;
  if (git && !brief) {
    // codex exec review 的 --uncommitted/--base/--commit 不能和自定义提示同时用，没有审查重点时走原生审查。
    args = ['exec', 'review', '--json', ...codexOpts, '-o', last];
    if (o.base) args.push('--base', o.base);
    else if (o.commit) args.push('--commit', o.commit);
    else args.push('--uncommitted');
    if (o.title) args.push('--title', o.title);
    prompt = '';
  } else if (git) {
    // 有审查重点时改用普通 exec，让 Codex 自己用 git 查看审查范围。
    const scope = o.base ? M.reviewScopeBase(o.base) : o.commit ? M.reviewScopeCommit(o.commit) : M.reviewScopeUncommitted;
    args = ['exec', '--json', '--skip-git-repo-check', ...codexOpts, '-C', cwd, '-o', last, '-'];
    prompt = `${M.reviewPromptGit(cwd, scope)}\n\n${brief}\n\n${M.reviewFooter}\n`;
  } else {
    // 非 git 目录没有"改动"可言，审查范围由任务说明指定。
    args = ['exec', '--json', '--skip-git-repo-check', ...codexOpts, '-C', cwd, '-o', last, '-'];
    prompt = `${M.reviewPromptPlain(cwd)}\n\n${brief}\n\n${M.reviewFooter}\n`;
  }
  await execute({ cfg, ...profile, mode: 'review', kind: 'review', id, dir, release, cwd, args, prompt, title: o.title, opts: o, expectReport: false });
}

function cmdConfig(o) {
  const { sources, ...effective } = loadConfig(o.cwd ? resolveDir(o.cwd) : null);
  const agents_status = Object.fromEntries(Object.entries(effective.agents).map(([name, agent]) => [name, {
    type: agent.type, model: agent.model || (agent.type === 'codex' ? codexConfigModel() : null), max_parallel: agent.max_parallel ?? DEFAULT_AGENT_PARALLEL,
    ...(agent.type === 'openai-compatible' ? { api_key_env: agent.api_key_env ?? null, key_set: !!apiKeyOf(agent).key, key_source: apiKeyOf(agent).source } : {}),
  }]));
  const resolved = (entry) => ({ agent: entry.agent, model: entry.model || agents_status[entry.agent].model, effort: entry.effort });
  const resolved_levels = Object.fromEntries(Object.entries(effective.levels).map(([mode, levels]) => [mode,
    Object.fromEntries(Object.entries(levels).map(([lv, entry]) => [lv, entry === CLAUDE ? entry : Array.isArray(entry) ? entry.map(resolved) : resolved(entry)])),
  ]));
  // 配置里写的 key 不打印出来。
  const shown = structuredClone(effective);
  for (const agent of Object.values(shown.agents)) if (agent.api_key) agent.api_key = M.keyHidden;
  process.stdout.write(JSON.stringify({
    user_config: USER_CONFIG,
    loaded_from: sources,
    effective: shown,
    agents_status,
    resolved_levels,
    runs_dir: RUNS_ROOT,
    watch_launcher: path.join(RUNS_ROOT, 'watch.mjs'),
    preferences: [USER_PREFS, ...(o.cwd ? [path.join(resolveDir(o.cwd), PROJECT_PREFS)] : [])]
      .map((file) => ({ file, exists: fs.existsSync(file) })),
    codex: codexCommand(),
  }, null, 2) + '\n');
}

// 检查环境。Codex 是必需的，决定退出码；Git 缺了只是没有改动追踪；API 协作方是可选的，各自发一个很小的请求确认能连通。
async function cmdCheck(o) {
  const cfg = loadConfig(null);
  if (o.agent && !Object.hasOwn(cfg.agents, o.agent)) die(M.unknownAgent('--agent', o.agent));
  const nodeOk = Number(process.versions.node.split('.')[0]) >= 18;
  const git = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true });
  const gitVersion = git.status === 0 ? git.stdout.trim() : null;
  const [major, minor] = (/(\d+)\.(\d+)/.exec(gitVersion || '') || []).slice(1).map(Number);
  const gitOk = major > 2 || (major === 2 && minor >= 25);
  const codexAgent = cfg.agents[codexAgentName(cfg)];
  const { file, pre } = codexCommand(codexAgent);
  const codex = (args) => spawnSync(file, [...pre, ...args], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const version = codex(['--version']);
  const installed = !version.error && version.status === 0;
  const login = installed ? codex(['login', 'status']) : null;
  const loginText = login ? `${login.stdout}${login.stderr}`.trim() : null;
  const loggedIn = !!login && login.status === 0 && !/not logged in/i.test(loginText);
  const result = {
    ok: nodeOk && installed && loggedIn,
    node: { ok: nodeOk, version: process.version, fix: nodeOk ? null : M.fixNode(process.version) },
    git: { ok: gitOk, version: gitVersion, fix: gitOk ? null : M.fixGit(gitVersion) },
    codex: {
      ok: installed && loggedIn, version: installed ? version.stdout.trim() : null, login: loginText,
      model: codexAgent.model || codexConfigModel(),
      fix: !installed ? M.fixCodexMissing : loggedIn ? null : M.fixCodexLogin,
    },
    agents: {},
  };
  for (const [name, agent] of Object.entries(cfg.agents)) {
    if (agent.type === 'openai-compatible' && (!o.agent || o.agent === name)) result.agents[name] = await checkApiAgent(name, agent);
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.ok ? 0 : 1;
}

async function checkApiAgent(name, agent) {
  const { key: apiKey, source } = apiKeyOf(agent);
  const out = { ok: false, model: agent.model, base_url: agent.base_url, api_key_env: agent.api_key_env ?? null, key_set: !!apiKey, key_source: source };
  if (!apiKey) return { ...out, fix: M.fixApiKey(name, agent.api_key_env) };
  const started = Date.now();
  try {
    const reply = await chatStream({
      url: agent.base_url, apiKey, timeoutMs: 120000, stallMs: 60000,
      body: { model: agent.model, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], stream: true, stream_options: { include_usage: true }, ...agent.extra_body },
    });
    return { ...out, ok: true, seconds: Number(((Date.now() - started) / 1000).toFixed(1)), reply: reply.content.replaceAll(apiKey, '[REDACTED]').trim().slice(0, 40), usage: apiUsage(reply.usage), fix: null };
  } catch (e) {
    const fix = { auth: M.fixApiAuth(name, source, agent.api_key_env), balance: M.fixApiBalance, bad_request: M.fixApiRequest(name), network: M.fixApiNetwork(agent.base_url) }[e.kind] || M.fixApiRetry;
    return { ...out, error: `${e.kind}${e.status ? ` ${e.status}` : ''}: ${e.message.replaceAll(apiKey, '[REDACTED]')}`, fix };
  }
}

// 读 events.jsonl 末尾，给出最后活动时间和当前步骤，用来判断运行中的任务是活着还是卡住。
function describeActivity(dir) {
  const file = path.join(dir, 'events.jsonl');
  if (!fs.existsSync(file)) return { idle_min: null, step: M.noEvents };
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
  if (last?.type.startsWith('api.')) {
    step = last.type === 'api.request' ? M.stepApiWaiting
      : last.type === 'api.reasoning' ? M.stepApiThinking(last.total_chars)
      : last.type === 'api.content' ? M.stepApiAnswering(last.total_chars)
      : last.type === 'api.retry' ? M.stepApiRetry(last.reason)
      : last.type === 'api.repair' ? M.stepApiRepair
      : last.type === 'api.error' ? last.message
      : last.type === 'api.usage' ? M.watchTokens(last.usage) : M.watchEnded('done');
  } else if (running.size) step = M.stepCommand(clip(oneLine(plainCommand([...running.values()].pop())), 160));
  else if (last?.item?.type === 'agent_message') step = M.stepSaid(clip(oneLine(last.item.text), 160));
  else if (last?.item?.type === 'file_change') step = M.stepFileChanged;
  else if (last?.type === 'item.completed' && last.item?.type === 'command_execution') step = M.stepCommandDone;
  else step = last ? M.stepLastEvent(`${last.type}${last.item?.type ? `/${last.item.type}` : ''}`) : M.noEvents;
  return { idle_min: Number(((Date.now() - st.mtimeMs) / 60000).toFixed(1)), step };
}

function groupRuns(group, since = 0) {
  return listRuns().map((id) => {
    const dir = path.join(RUNS_ROOT, id);
    return { id, dir, meta: readMeta(dir) };
  }).filter(({ meta }) => meta?.group === group && Date.parse(meta.started_at) >= since);
}

// 准入检查（在登记锁内）：同一协作方正在运行的任务不超过它的 max_parallel，所有组和会话都算，
// 因为服务商的限流和额度是按账号的；同组的执行任务写入范围不能重叠。
function checkAdmission(meta, cfg) {
  const codexName = codexAgentName(cfg);
  const running = listRuns().filter((id) => id !== meta.id)
    .map((id) => { const dir = path.join(RUNS_ROOT, id); return { id, dir, meta: readMeta(dir) }; })
    .filter((r) => isRunning(r.meta));
  const limit = cfg.agents[meta.agent].max_parallel ?? DEFAULT_AGENT_PARALLEL;
  const same = running.filter((r) => (r.meta.agent || codexName) === meta.agent); // 旧记录没有 agent 字段，都是 Codex
  if (same.length >= limit) return M.agentFull(meta.agent, same.length, limit, M.list(same.map((r) => r.id)));
  if (meta.group == null || meta.kind === 'discuss') return null;
  const absolute = (cwd, file) => pathKey(path.resolve(cwd, file.replace(/\\/g, '/')).replace(/\\/g, '/')).replace(/\/$/, '');
  for (const other of running) {
    if (other.meta.group !== meta.group || other.meta.kind === 'discuss') continue;
    // 比较用归一化的绝对路径，报错里显示派活时写的原样路径。
    const paths = meta.scope.filter((mine) => (other.meta.scope || []).some((file) => {
      const a = absolute(meta.cwd, mine);
      const b = absolute(other.meta.cwd, file);
      return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
    }));
    if (paths.length) return M.scopeOverlap(meta.group, other.id, paths);
  }
  return null;
}

function runOutcome(run) {
  const m = run.meta;
  const running = isRunning(m);
  const status = m.status === 'running' && !running ? 'interrupted' : m.status;
  const file = path.join(run.dir, 'result.json');
  const result = !running && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const ok = status === 'done' && (!result?.report?.status || result.report.status === 'completed');
  return { running, status, result, ok };
}

function groupSummary(runs) {
  const outcomes = runs.map(runOutcome);
  const running = outcomes.filter((r) => r.running).length;
  const ok = outcomes.filter((r) => r.ok).length;
  return M.groupSummary(runs.length, running, ok, runs.length - running - ok);
}

function cmdStatus(o) {
  if (o.run && o.group == null) {
    const run = findRun(o.run);
    const file = path.join(run.dir, 'result.json');
    if (fs.existsSync(file)) process.stdout.write(fs.readFileSync(file, 'utf8') + '\n');
    else {
      if (run.meta.status === 'running' && !pidAlive(run.meta.pid)) run.meta.status = 'interrupted';
      process.stdout.write(JSON.stringify({ ...run.meta, activity: describeActivity(run.dir) }, null, 2) + '\n');
    }
    return;
  }
  const grouped = o.group != null ? groupRuns(o.group) : null;
  const runs = grouped ? grouped.map((r) => r.id) : listRuns().slice(0, Number(o.limit) || 10);
  const rows = runs.map((rid) => {
    const dir = path.join(RUNS_ROOT, rid);
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    if (m.status === 'running' && !pidAlive(m.pid)) m.status = 'interrupted';
    const end = m.ended_at ? new Date(m.ended_at) : new Date();
    const mins = ((end - new Date(m.started_at)) / 60000).toFixed(1);
    let row = `${rid}  ${m.mode.padEnd(6)}  ${m.status.padEnd(11)}  ${m.agent_type === 'openai-compatible' ? `${m.agent}:` : ''}${m.model_shown || m.model || '-'}  ${(m.level ? `${m.level}/${m.effort ?? '-'}` : m.effort ?? '-').padEnd(14)}  ${mins.padStart(6)}min  ${m.group != null ? M.statusGroup(m.group) : ''}${m.round ? M.statusRound(m.round) : ''}${m.title || ''}  @ ${m.cwd}`;
    if (m.status === 'running') {
      const a = describeActivity(dir);
      const last = codexSessionStats(m.session_id, m.started_at)?.last_request;
      row += `\n    └ ${M.statusActivity(a.idle_min ?? '-', a.step)}${last ? M.lastRequestNow(last, M.tokenCount) : ''}`;
    } else {
      let r = null;
      try { r = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8')); } catch { /* 没有结果 */ }
      if (r?.usage) row += `\n    └ ${M.tokenSummary(r.usage, r.last_request ?? r.context, M.tokenCount, (r.usage_scope ?? (m?.mode === 'resume' ? 'session_total' : 'this_run')) === 'session_total')}`;
    }
    return row;
  });
  // 额度是账号级的，取最近一次有记录的任务显示一行
  let quota = null;
  for (const rid of runs) {
    const m = readMeta(path.join(RUNS_ROOT, rid));
    quota = codexSessionStats(m?.session_id, m?.started_at)?.rate_limit;
    if (quota) break;
  }
  process.stdout.write(rows.length ? rows.join('\n') + '\n' + (quota ? `\n${M.rateLimit(quota)}\n` : '') : `${M.noRuns}\n`);
  if (grouped) process.stdout.write(`${groupSummary(grouped)}\n`);
}

// ---------- watch ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readMeta = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch { return null; } };
const isRunning = (m) => m?.status === 'running' && pidAlive(m.pid);
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

// 终端里中日韩字符和全角符号占两格，按显示宽度截断和换行，避免折行错位。
const charWidth = (ch) => (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1);
const textWidth = (s) => [...s].reduce((w, ch) => w + charWidth(ch), 0);

function fitWidth(s, width) {
  if (textWidth(s) <= width) return s;
  let out = '';
  let w = 0;
  for (const ch of s) {
    if (w + charWidth(ch) > width - 1) break;
    out += ch;
    w += charWidth(ch);
  }
  return `${out}…`;
}

const NO_LINE_START = /[、，。．！？：；）】』」》〉’”…—,.!?:;)\]}%]/;

function wrapWidth(s, width) {
  const lines = [];
  for (const para of String(s).replace(/\r/g, '').split('\n')) {
    let line = '';
    let w = 0;
    for (const ch of para) {
      if (w + charWidth(ch) > width) {
        // 逗号、句号这类标点不放在行首：把上一行末尾的字（连同它后面的标点）一起带到下一行。
        const chars = [...line];
        let carry = '';
        if (NO_LINE_START.test(ch)) {
          let k = chars.length;
          while (k > 0 && NO_LINE_START.test(chars[k - 1])) k--;
          if (k > 1) carry = chars.splice(k - 1).join('');
        }
        lines.push(chars.join(''));
        line = carry;
        w = textWidth(carry);
      }
      line += ch;
      w += charWidth(ch);
    }
    lines.push(line);
  }
  return lines;
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
// 结果里的改动数只算有证据是 Codex 改的；旧记录没有归属信息，按全部改动算。
const changedText = (c) => (c?.available ? M.watchChanged(c.codex_total ?? c.files_total, c.codex_total == null ? 0 : c.unknown_total) : M.watchNotTracked);
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const C = { dim: paint('2'), bold: paint('1'), red: paint('31'), green: paint('32'), yellow: paint('33'), cyan: paint('36') };

async function pickWatchRun(ref) {
  if (ref) return findRun(ref);
  // 刚派活时任务可能还没登记，等一会儿；仍没有就显示最近一次。
  for (let waited = 0; ; waited += 500) {
    const ids = listRuns();
    const running = ids.find((id) => isRunning(readMeta(path.join(RUNS_ROOT, id))));
    if (running) return findRun(running);
    if (waited >= 15000) {
      if (!ids[0]) die(M.noRuns);
      process.stdout.write(`${M.watchFallback}\n`);
      return findRun(ids[0]);
    }
    if (waited === 0) process.stdout.write(`${M.watchWaiting}\n`);
    await sleep(500);
  }
}

// 详细模式（--verbose）：每个事件一行，带时间戳，包括思考过程、命令输出和 token 用量。
function verboseRenderer(cwd, rel) {
  let live = false;
  const out = (sym, text) => process.stdout.write(`${live ? new Date().toTimeString().slice(0, 8) : '        '} ${sym} ${text}\n`);
  const show = (ev) => {
    const it = ev.item || {};
    if (ev.type === 'thread.started') out('●', M.watchSession(ev.thread_id));
    else if (ev.type === 'turn.failed') out('✗', M.watchTurnFailed(ev.error?.message || ''));
    else if (ev.type === 'error') out('⚠', clip(oneLine(ev.message), 300));
    else if (ev.type === 'turn.completed' && ev.usage) {
      out('Σ', M.watchTokens(ev.usage));
    } else if (ev.type === 'item.started' && it.type === 'command_execution') {
      out('▶', clip(oneLine(plainCommand(it.command)), 240));
    } else if (ev.type === 'item.completed') {
      if (it.type === 'agent_message') {
        const t = it.text.trim();
        let report = null;
        if (t.startsWith('{')) try { report = JSON.parse(t); } catch { /* 普通消息 */ }
        if (report?.position) out('■', M.watchOpinion(clip(oneLine(report.position), 400)));
        else if (report?.status) out('■', M.watchReport(report.status, clip(oneLine(report.summary), 300)));
        else out('💬', clip(oneLine(t), 600));
      } else if (it.type === 'reasoning') {
        out('…', clip(oneLine(it.text), 200));
      } else if (it.type === 'command_execution') {
        const lines = String(it.aggregated_output || '').replace(/\r/g, '').split('\n').map((x) => x.trimEnd()).filter(Boolean);
        out(it.exit_code === 0 ? '✓' : '✗', M.watchExit(it.exit_code, lines.length ? clip(lines.slice(-3).join(' ⏎ '), 240) : ''));
      } else if (it.type === 'file_change') {
        for (const c of it.changes || []) out('✏', `${M.fileKinds[c.kind] || c.kind} ${rel(c.path)}`);
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
  const finish = (r, m) => {
    if (r) out('■', M.watchFinished(r.status, r.duration_s, changedText(r.changes)));
    else out('■', m?.status === 'running' ? M.watchInterrupted : M.watchEnded(m?.status));
    if (r?.usage) out('Σ', M.tokenSummary(r.usage, r.last_request ?? r.context, M.tokenCount, (r.usage_scope ?? (m?.mode === 'resume' ? 'session_total' : 'this_run')) === 'session_total'));
  };
  return { show, finish, goLive: () => { live = true; } };
}

// 简洁模式（默认）：只显示 Codex 说的话、执行的命令、改动的文件、计划和最终结果，失败的命令才显示输出。
function conciseRenderer(cwd, rel) {
  const width = () => Math.max(40, (process.stdout.columns || 100) - 1);
  // 实时跟踪时，折叠行留在最后一行原地刷新（不换行），写别的内容前先擦掉。
  let foldLineShown = false;
  const clearFoldLine = () => {
    if (foldLineShown) process.stdout.write('\r\x1b[2K');
    foldLineShown = false;
  };
  const write = (s = '') => { clearFoldLine(); process.stdout.write(`${s}\n`); };
  let lastKind = null; // 连续的命令或文件改动挤在一起，换类型时空一行
  // 连续的命令只显示前几条，其余折叠成一行；折叠里的命令失败了照样显示。
  const MAX_COMMANDS = 3;
  let shownCommands = 0;
  const foldedCommands = new Map(); // item id → 命令文字
  let latestFolded = '';
  const drawFoldLine = () => {
    if (!live || !process.stdout.isTTY || !foldedCommands.size) return;
    clearFoldLine();
    process.stdout.write(C.dim(`  ${fitWidth(M.watchFoldedLive(foldedCommands.size, latestFolded), width() - 3)}`));
    foldLineShown = true;
  };
  const flushFolded = () => {
    if (foldedCommands.size) write(C.dim(`  ${M.watchFoldedCommands(foldedCommands.size)}`));
    foldedCommands.clear();
  };
  const block = (kind) => {
    if (lastKind === 'command' && kind !== 'command') flushFolded();
    if (lastKind !== 'command' && kind === 'command') shownCommands = 0;
    if (lastKind && (kind !== lastKind || kind === 'message')) write();
    lastKind = kind;
  };
  const commandLine = (text) => C.dim(`  $ ${fitWidth(text, width() - 4)}`);
  let live = false; // 回放已有事件时没有真实时间，只在实时跟踪时显示
  const time = () => (live ? ` ${C.dim(new Date().toTimeString().slice(0, 5))}` : '');
  const paragraph = (text, indent = '  ', maxLines = 20) => {
    const lines = wrapWidth(text.trim(), width() - textWidth(indent));
    for (const l of lines.slice(0, maxLines)) write(indent + l);
    if (lines.length > maxLines) write(indent + C.dim(M.watchMoreLines(lines.length - maxLines)));
  };
  let lastPlan = '';
  let lastFile = '';

  const show = (ev) => {
    const it = ev.item || {};
    if (ev.type === 'turn.failed' || ev.type === 'error') {
      block('error');
      write(C.red(`✗ ${fitWidth(oneLine(ev.error?.message || ev.message || ''), width() - 2)}`));
    } else if (ev.type === 'item.started' && it.type === 'command_execution') {
      block('command');
      const text = oneLine(plainCommand(it.command));
      if (shownCommands < MAX_COMMANDS) { write(commandLine(text)); shownCommands++; }
      else { foldedCommands.set(it.id, text); latestFolded = text; drawFoldLine(); }
    } else if (ev.type === 'item.completed') {
      if (it.type === 'agent_message') {
        const t = it.text.trim();
        if (t.startsWith('{')) { try { JSON.parse(t); return; } catch { /* 普通消息 */ } } // 最终报告在结束时单独显示
        block('message');
        write(`${C.cyan(C.bold('Codex'))}${time()}`);
        paragraph(t);
      } else if (it.type === 'command_execution' && it.exit_code !== 0) {
        const lines = String(it.aggregated_output || '').replace(/\r/g, '').split('\n').map((x) => x.trim()).filter(Boolean);
        if (foldedCommands.has(it.id)) { write(commandLine(foldedCommands.get(it.id))); foldedCommands.delete(it.id); }
        write(C.red(`    ${fitWidth(M.watchExit(it.exit_code, lines.length ? lines.slice(-2).join(' ⏎ ') : ''), width() - 4)}`));
        drawFoldLine();
      } else if (it.type === 'file_change') {
        for (const c of it.changes || []) {
          const line = `  ✎ ${M.fileKinds[c.kind] || c.kind} ${fitWidth(rel(c.path), width() - 10)}`;
          if (lastKind === 'file' && line === lastFile) continue; // 同一个文件连着改几次只显示一行
          block('file');
          write(C.green(line));
          lastFile = line;
        }
      } else if (it.type === 'todo_list') {
        const plan = (it.items || []).map((x) => `${x.completed ? '✔' : '○'} ${x.text}`);
        if (plan.join('\n') === lastPlan) return;
        lastPlan = plan.join('\n');
        block('plan');
        write(C.yellow(M.watchPlan));
        for (const p of plan) write(`  ${fitWidth(p, width() - 2)}`);
      } else if (it.type === 'web_search') {
        block('command');
        write(C.dim(`  🔎 ${fitWidth(oneLine(it.query), width() - 5)}`));
      } else if (it.type === 'error' && !/^Under-development features enabled/.test(it.message)) {
        block('error');
        write(C.yellow(`⚠ ${fitWidth(oneLine(it.message), width() - 2)}`));
      }
    }
  };

  const finish = (r, m) => {
    flushFolded();
    write();
    write(C.dim('─'.repeat(Math.min(width(), 60))));
    if (!r) {
      write(m?.status === 'running' ? C.red(M.watchInterrupted) : M.watchEnded(m?.status));
      return;
    }
    const ok = r.status === 'done' && (!r.report?.status || r.report.status === 'completed');
    const changed = changedText(r.changes);
    write((ok ? C.green : C.red)(C.bold(M.watchFinished(r.status === 'done' ? r.report?.status || r.status : r.status, r.duration_s, changed))));
    if (r.usage) write(C.dim(M.tokenSummary(r.usage, r.last_request ?? r.context, M.tokenCount, (r.usage_scope ?? (m?.mode === 'resume' ? 'session_total' : 'this_run')) === 'session_total')));
    const summary = r.report?.summary || r.report?.position;
    if (summary) { write(); paragraph(summary, '  ', 12); }
    const issues = r.report?.open_issues || r.report?.open_questions || [];
    if (issues.length) {
      write();
      write(C.yellow(M.watchOpenIssues));
      for (const x of issues) paragraph(`· ${x}`, '  ', 4);
    }
    for (const e of r.errors || []) write(C.red(`✗ ${fitWidth(oneLine(e), width() - 2)}`));
  };
  return { show, finish, goLive: () => { live = true; drawFoldLine(); } };
}

function apiRenderer(verbose, cwd, rel) {
  const base = conciseRenderer(cwd, rel);
  let lastThinking = -Infinity;
  let answering = false;
  const show = (ev) => {
    const out = (text) => process.stdout.write(`${ev.ts ? new Date(ev.ts).toTimeString().slice(0, 8) : '        '} ${text}\n`);
    if (ev.type === 'api.request') {
      lastThinking = -Infinity;
      answering = false;
      out(M.watchApiRequest(ev.model, ev.effort, ev.attempt));
    } else if (ev.type === 'api.reasoning') {
      if (verbose) out(ev.text);
      else if (Date.parse(ev.ts) - lastThinking >= 15000) {
        lastThinking = Date.parse(ev.ts);
        out(M.watchApiThinking(ev.total_chars));
      }
    } else if (ev.type === 'api.content') {
      if (!answering) { out(M.watchApiAnswering); answering = true; }
      if (verbose) out(ev.text);
    } else if (ev.type === 'api.retry') out(M.watchApiRetry(ev.reason, ev.wait_s));
    else if (ev.type === 'api.repair') out(M.watchApiRepair(M.list(ev.errors)));
    else if (ev.type === 'api.error') out(ev.message);
  };
  return { ...base, show };
}

async function watchGroup(group) {
  const recentRuns = () => groupRuns(group, Date.now() - 86400000).reverse();
  let runs;
  for (let waited = 0; ; waited += 500) {
    runs = recentRuns();
    if (runs.length) break;
    if (waited >= 15000) die(M.groupNotFound(group));
    if (waited === 0) process.stdout.write(`${M.watchWaiting}\n`);
    await sleep(500);
  }
  const known = new Map();
  const states = new Map();
  let lastAdded = Date.now();
  let drawn = 0;
  if (!process.stdout.isTTY) process.stdout.write(`${M.groupHeader(group, runs.length)}\n`);
  for (;;) {
    for (const run of runs) {
      if (!known.has(run.id)) lastAdded = Date.now();
      known.set(run.id, run);
    }
    const all = [...known.values()];
    const lines = [];
    for (const run of all) {
      const { running, status, result, ok } = runOutcome(run);
      const end = run.meta.ended_at ? Date.parse(run.meta.ended_at) : Date.now();
      const mins = ((end - Date.parse(run.meta.started_at)) / 60000).toFixed(1);
      const shown = status === 'done' ? result?.report?.status || status : status;
      const line = `${running ? '●' : ok ? '✔' : '✗'} ${run.id}  ${run.meta.agent_type === 'openai-compatible' ? `${run.meta.agent}:${run.meta.model_shown || run.meta.model}  ` : ''}${oneLine(run.meta.title || '')}  ${shown}  ${mins}min${running ? `  ${oneLine(describeActivity(run.dir).step)}` : ''}`;
      if (process.stdout.isTTY) {
        const color = running ? C.cyan : ok ? C.green : C.red;
        lines.push(color(fitWidth(line, Math.max(1, (process.stdout.columns || 100) - 1))));
      } else if (states.get(run.id) !== shown) process.stdout.write(`${line}\n`);
      states.set(run.id, shown);
    }
    if (process.stdout.isTTY) {
      const width = Math.max(1, (process.stdout.columns || 100) - 1);
      lines.unshift(C.bold(fitWidth(oneLine(M.groupHeader(group, all.length)), width)));
      lines.push(fitWidth(groupSummary(all), width));
      // 每行先截断再着色，光标上移的行数才和实际显示一致。
      process.stdout.write(`${drawn ? `\x1b[${drawn}A` : ''}\r${lines.map((line) => `\x1b[2K${line}\n`).join('')}`);
      drawn = lines.length;
    }
    if (all.every((run) => !isRunning(run.meta)) && Date.now() - lastAdded >= 5000) break;
    await sleep(2000);
    runs = recentRuns();
  }
  for (const run of known.values()) {
    const { status, result: r, ok } = runOutcome(run);
    const seconds = r?.duration_s ?? Math.round(((Date.parse(run.meta.ended_at) || Date.now()) - Date.parse(run.meta.started_at)) / 1000);
    const changed = changedText(r?.changes);
    process.stdout.write(`\n${C.bold(oneLine(run.meta.title || run.id))}\n`);
    process.stdout.write(`${(ok ? C.green : C.red)(M.watchFinished(status === 'done' ? r?.report?.status || status : status, seconds, changed))}\n`);
    if (r?.usage) process.stdout.write(`${C.dim(M.tokenSummary(r.usage, r.last_request ?? r.context, M.tokenCount, (r.usage_scope ?? (run.meta.mode === 'resume' ? 'session_total' : 'this_run')) === 'session_total'))}\n`);
    if (run.meta.agent_type === 'openai-compatible' && r?.report?.position) process.stdout.write(`${M.watchOpinion(r.report.position)}\n`);
  }
  process.stdout.write(`${groupSummary([...known.values()])}\n`);
}

async function cmdWatch(o) {
  if (o.group != null) return watchGroup(o.group);
  const { id, dir, meta } = await pickWatchRun(o.run);
  const cwd = meta.cwd;
  const rel = (p) => { const r = path.relative(cwd, p); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : p; };
  const view = meta.agent_type === 'openai-compatible' ? apiRenderer(o.verbose, cwd, rel) : (o.verbose ? verboseRenderer : conciseRenderer)(cwd, rel);
  const header = M.watchHeader(meta.agent || 'Codex', meta.mode, meta.title || id, meta.model_shown || meta.model, meta.effort, meta.level, cwd, dir).split('\n');
  process.stdout.write(`\n${C.bold(header[0])}\n${C.dim(header.slice(1).join('\n'))}\n\n`);

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
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let ev;
      try { ev = JSON.parse(line); } catch { continue; } // 非 JSON 的行
      view.show(ev);
    }
  };

  drain();
  view.goLive();
  let m = readMeta(dir);
  while (isRunning(m)) {
    await sleep(500);
    drain();
    m = readMeta(dir);
  }
  drain();

  const resFile = path.join(dir, 'result.json');
  view.finish(fs.existsSync(resFile) ? JSON.parse(fs.readFileSync(resFile, 'utf8')) : null, m);
}

const { cmd, opts } = parseArgs(process.argv.slice(2));
const commands = { run: cmdRun, discuss: cmdDiscuss, resume: cmdResume, review: cmdReview, status: cmdStatus, watch: cmdWatch, config: cmdConfig, check: cmdCheck };
if (!commands[cmd]) die(M.usage);
await commands[cmd](opts);
