// 配置路径、改名迁移、合并校验和任务等级选择；类型字段校验由调用方传入。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HERE, M, notice, isObject, readJson, die, pidAlive, replaceFile } from './util.mjs';

const ENTRY = path.join(HERE, 'cli.mjs');
const SCHEMA = path.join(HERE, '..', 'schemas', 'report.schema.json');
const DISCUSS_SCHEMA = path.join(HERE, '..', 'schemas', 'discuss.schema.json');

// 改名前（codex-bridge）用的位置，只用于迁移和兼容。
const LEGACY_CONFIG = process.env.CODEX_BRIDGE_CONFIG || path.join(os.homedir(), '.claude', 'codex-bridge.json');
const LEGACY_PREFS = path.join(path.dirname(LEGACY_CONFIG), 'codex-bridge.md');
const LEGACY_RUNS = path.join(os.homedir(), '.claude', 'codex-runs');
const LEGACY_PROJECT_CONFIG = path.join('.claude', 'codex-bridge.json');
const LEGACY_PROJECT_PREFS = path.join('.claude', 'codex-bridge.md');

// 环境变量改了名，旧名字还认，用到时提示一句（同一个进程只提示一次）。
const legacyEnvNoticed = new Set();
function envOf(name, legacy) {
  if (process.env[name]) return process.env[name];
  if (!process.env[legacy]) return undefined;
  if (!legacyEnvNoticed.has(legacy)) { legacyEnvNoticed.add(legacy); notice(M.legacyEnv(legacy, name)); }
  return process.env[legacy];
}

const HOME_DIR = path.join(os.homedir(), '.claude', 'foreman');
const CUSTOM_CONFIG = envOf('FOREMAN_CONFIG', 'CODEX_BRIDGE_CONFIG');
const USER_CONFIG = CUSTOM_CONFIG || path.join(HOME_DIR, 'config.json');
const USER_PREFS = path.join(path.dirname(USER_CONFIG), 'preferences.md');
const PROJECT_CONFIG = path.join('.claude', 'foreman.json');
const PROJECT_PREFS = path.join('.claude', 'foreman.md');

// 改名迁移：第一次运行时把旧配置和旧偏好复制到新位置，旧文件保留。用户用环境变量指定了配置路径时不动。
function migrateLegacyFiles() {
  if (CUSTOM_CONFIG) return;
  for (const [from, to, msg] of [[LEGACY_CONFIG, USER_CONFIG, M.legacyConfigCopied], [LEGACY_PREFS, USER_PREFS, M.legacyPrefsCopied]]) {
    if (fs.existsSync(to) || !fs.existsSync(from)) continue;
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      notice(msg(from, to));
    } catch (e) { if (e.code !== 'EEXIST') notice(M.legacyCopyFailed(from, e.message)); } // 并发启动时别的进程先复制了
  }
}
migrateLegacyFiles();

// 项目里的文件还是旧名字时照常读取，提示改名，不改动项目里的文件。
function projectFile(cwd, current, legacy) {
  const file = path.join(cwd, current);
  const old = path.join(cwd, legacy);
  if (fs.existsSync(file) || !fs.existsSync(old)) return file;
  notice(M.projectLegacyName(old, file));
  return old;
}

// 每个协作方同时最多运行几个任务，配置里没写时用它。
const DEFAULT_AGENT_PARALLEL = 4;

const DEFAULT_CONFIG = {
  dispatch: { auto: true, watch: 'auto', discuss_max_rounds: 2, timeout_min: 480, stall_min: 40, busy_ask_min: 2, runs_dir: null },
  agents: {
    codex: { type: 'codex', bin: null, model: null, max_parallel: DEFAULT_AGENT_PARALLEL, sandbox: { run: null, review: null, discuss: null }, approval: null },
  },
  levels: {
    run: { simple: 'claude', normal: 'claude', complex: { agent: 'codex', effort: 'max' } },
    review: { simple: { agent: 'codex', effort: 'medium' }, normal: { agent: 'codex', effort: 'high' }, complex: { agent: 'codex', effort: 'max' } },
    discuss: { simple: [{ agent: 'codex', effort: 'medium' }], normal: [{ agent: 'codex', effort: 'high' }], complex: [{ agent: 'codex', effort: 'max' }] },
  },
};

// 写成 'claude' 的等级被 --agent 或 --model 点名派给 Codex，或者被只写了部分字段的配置覆盖时，用这里的推理强度。
const CODEX_LEVEL_FALLBACK = {
  simple: { agent: 'codex', effort: 'medium' },
  normal: { agent: 'codex', effort: 'high' },
  complex: { agent: 'codex', effort: 'max' },
};

const LEVELS = ['simple', 'normal', 'complex'];
const CLAUDE = 'claude'; // levels.run 里某一级整项写成它，表示这一级由 Claude 自己做
const CODEX_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const codexAgentName = (cfg) => Object.keys(cfg.agents).find((name) => cfg.agents[name]?.type === 'codex');
const migratedConfigs = new Map();

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
function migrateConfig(config, file, base, project, validateAgent) {
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
  if (project) process.stderr.write(`foreman: ${M.projectOldFormat(file)}\n`);
  else {
    // 转换结果不合格就停在这里，原文件不动。
    validateConfig(mergeConfig(base, result), validateAgent);
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
      replaceFile(tmp, file);
      process.stderr.write(`foreman: ${M.configMigrated(file, bak)}\n`);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      process.stderr.write(`foreman: ${M.configMigrateFailed(file, e.message)}\n`);
    }
  }
  return result;
}

function validateConfig(cfg, validateAgent) {
  const why = M.invalid;
  const check = (ok, key, reason) => { if (!ok) die(M.configInvalid(key, reason)); };
  const text = (v) => typeof v === 'string' && !!v.trim();
  for (const key of ['dispatch', 'agents', 'levels']) check(isObject(cfg[key]), key, why.object);
  check(typeof cfg.dispatch.auto === 'boolean', 'dispatch.auto', why.boolean);
  check(['auto', 'off'].includes(cfg.dispatch.watch), 'dispatch.watch', why.watch);
  check(Number.isInteger(cfg.dispatch.discuss_max_rounds) && cfg.dispatch.discuss_max_rounds >= 1, 'dispatch.discuss_max_rounds', why.positiveInt);
  for (const key of ['timeout_min', 'stall_min', 'busy_ask_min']) check(Number.isFinite(cfg.dispatch[key]) && (key === 'timeout_min' ? cfg.dispatch[key] > 0 : cfg.dispatch[key] >= 0), `dispatch.${key}`, why.minutes);
  check(cfg.dispatch.runs_dir === null || text(cfg.dispatch.runs_dir), 'dispatch.runs_dir', why.pathOrNull);
  let codexCount = 0;
  for (const [name, agent] of Object.entries(cfg.agents)) {
    const key = `agents.${name}`;
    check(/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name) && name !== CLAUDE, key, why.agentName);
    check(isObject(agent), key, why.object);
    check(['codex', 'openai-compatible', 'opencode'].includes(agent.type), `${key}.type`, why.agentType);
    check(agent.model == null || (text(agent.model) && agent.model !== CLAUDE), `${key}.model`, why.modelName);
    check(agent.max_parallel === undefined || (Number.isInteger(agent.max_parallel) && agent.max_parallel >= 1), `${key}.max_parallel`, why.positiveInt);
    if (agent.type === 'codex') codexCount++;
    validateAgent(agent, key, check, text);
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
        check(mode === 'discuss' || agent.type === 'codex', `${at}.agent`, M.discussOnly(item.agent));
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
        if (['timeout_min', 'stall_min', 'busy_ask_min'].includes(field)) allowed.dispatch[field] = val;
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
          const drop = cfg.agents[item?.agent] && cfg.agents[item.agent].type !== 'codex' && !cfg.levels.discuss[lv]?.some((v) => v.agent === item.agent);
          if (drop) process.stderr.write(`foreman: ${M.projectApiDropped(item.agent, key)}\n`);
          return !drop;
        });
        if (entries.length && !allowed.levels.discuss[lv].length) die(M.projectLevelEmpty(key));
      }
    } else ignored.push(key);
  }
  if (ignored.length) process.stderr.write(`foreman: ${M.projectIgnored(M.list(ignored))}\n`);
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

function loadConfig(cwd, validateAgent) {
  const sources = [];
  let cfg = DEFAULT_CONFIG;
  if (!fs.existsSync(USER_CONFIG)) {
    try {
      writeStarterConfig();
      process.stderr.write(`foreman: ${M.starterCreated(USER_CONFIG, STARTER_CONFIG.agents.codex.model, STARTER_CONFIG.levels.review.complex.model)}\n`);
    } catch (e) {
      process.stderr.write(`foreman: ${M.starterFailed(USER_CONFIG, e.message)}\n`);
    }
  }
  const user = readJson(USER_CONFIG);
  if (user) { cfg = mergeConfig(cfg, migrateConfig(user, USER_CONFIG, cfg, false, validateAgent)); sources.push(USER_CONFIG); }
  if (cwd) {
    const file = projectFile(cwd, PROJECT_CONFIG, LEGACY_PROJECT_CONFIG);
    const project = readJson(file);
    if (project) {
      cfg = mergeConfig(cfg, projectConfig(cfg, migrateConfig(project, file, cfg, true, validateAgent)));
      sources.push(file);
    }
  }
  const codexName = isObject(cfg.agents) && codexAgentName(cfg);
  if (process.env.CODEX_BIN && codexName) cfg = mergeConfig(cfg, { agents: { [codexName]: { bin: process.env.CODEX_BIN } } });
  const runsDir = envOf('FOREMAN_RUNS_DIR', 'CODEX_RUNS_DIR');
  if (runsDir) cfg = mergeConfig(cfg, { dispatch: { runs_dir: runsDir } });
  validateConfig(cfg, validateAgent);
  return { ...cfg, sources };
}

// 默认的记录目录。改名前的记录在 ~/.claude/codex-runs，第一次运行时整个搬过来。
// 几个进程可能同时启动（比如同时发起讨论），用锁保证只搬一次；旧目录里还有任务在跑就先不搬，这次继续用旧目录。
let runsMovedNow = false;
function defaultRunsRoot() {
  const target = path.join(HOME_DIR, 'runs');
  if (fs.existsSync(target) || !fs.existsSync(LEGACY_RUNS)) return target;
  const lock = path.join(HOME_DIR, '.migrate.lock');
  const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  try {
    fs.mkdirSync(HOME_DIR, { recursive: true });
    for (let waited = 0; ; waited += 50) {
      try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); break; }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        if (waited > 15000) fs.rmSync(lock, { force: true }); // 持有者被强杀留下的锁
        wait(50);
        if (fs.existsSync(target)) return target; // 别的进程已经搬完
      }
    }
  } catch (e) { notice(M.runsMoveFailed(LEGACY_RUNS, e.message)); return LEGACY_RUNS; }
  try {
    if (fs.existsSync(target)) return target;
    const running = fs.readdirSync(LEGACY_RUNS).some((id) => {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(LEGACY_RUNS, id, 'meta.json'), 'utf8'));
        return m.status === 'running' && pidAlive(m.pid);
      } catch { return false; }
    });
    if (running) { notice(M.runsMoveDeferred(LEGACY_RUNS)); return LEGACY_RUNS; }
    fs.renameSync(LEGACY_RUNS, target);
    runsMovedNow = true;
    notice(M.runsMoved(LEGACY_RUNS, target));
    return target;
  } catch (e) {
    notice(M.runsMoveFailed(LEGACY_RUNS, e.message));
    return fs.existsSync(target) ? target : LEGACY_RUNS;
  } finally { fs.rmSync(lock, { force: true }); }
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
      // 用户点名要派给 Codex：--agent 指定协作方（模型用它的默认模型），或者 --model 直接指定模型
      if (!o.model && !o.agent) die(M.levelForClaude(level, codexName));
      entry = { ...CODEX_LEVEL_FALLBACK[level], agent: selected || codexName };
    }
    if (selected && selected !== entry.agent) die(M.agentMismatch(selected, key, entry.agent));
  }
  if (!Object.hasOwn(cfg.agents, entry.agent)) die(M.unknownAgent('--agent', entry.agent));
  const agent = cfg.agents[entry.agent];
  if (agent.type !== 'codex' && mode !== 'discuss') die(M.discussOnly(entry.agent));
  if (agent.type === 'codex' && !CODEX_EFFORTS.includes(entry.effort)) die(M.effortChoices(CODEX_EFFORTS.join(' / ')));
  return { level, agentName: entry.agent, agent, model: o.model || entry.model || agent.model || fallbackModel, effort: entry.effort };
}

export { ENTRY, SCHEMA, DISCUSS_SCHEMA, USER_CONFIG, USER_PREFS, PROJECT_PREFS, LEGACY_PROJECT_PREFS, DEFAULT_AGENT_PARALLEL, DEFAULT_CONFIG, STARTER_CONFIG, CLAUDE, codexAgentName, projectFile, loadConfig, pickProfile, defaultRunsRoot, runsMovedNow };
