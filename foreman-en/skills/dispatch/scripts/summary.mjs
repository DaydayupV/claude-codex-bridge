// 总配置情况：按等级、按协作方整理一遍，再列出值得注意的地方。config 和 check 共用；check 时带上检查结果。
import { CLAUDE_CODE, staleAliases } from './config.mjs';
import { M } from './util.mjs';

// checks 是 check 输出里的 agents；没有时（config）各项的 ok 为 null。
export function buildSummary(cfg, adapters, checks = null) {
  const agents = {}, levels = {}, warnings = [];
  for (const [name, agent] of Object.entries(cfg.agents)) {
    agents[name] = { type: agent.type, model: agent.model ?? adapters[agent.type].status(agent).model ?? null, used_at: [],
      ...(agent.run_access ? { run_access: agent.run_access } : {}), ok: checks?.[name] ? checks[name].ok : null };
  }
  // 某一格用到的"模型 + 推理强度"在检查里不通过时，带上原因。
  const tried = (name) => [...(checks?.[name]?.variants || []), ...(checks?.[name]?.efforts || [])];
  const effortProblem = (name, model, effort) => tried(name).find((v) => v.model === model && v.variant === effort && v.ok === false)?.error ?? null;
  // 推理强度只在基本检查通过后才核对，所以有档位不通过，就说明协作方本身能用，只是那几格的档位有问题。
  const usable = (name) => !!checks?.[name] && (checks[name].ok || tried(name).some((v) => v.ok === false));
  for (const [mode, byLevel] of Object.entries(cfg.levels)) {
    levels[mode] = {};
    for (const [level, entry] of Object.entries(byLevel)) {
      if (entry === CLAUDE_CODE) { levels[mode][level] = CLAUDE_CODE; continue; }
      const items = Array.isArray(entry) ? entry : [entry];
      levels[mode][level] = items.map((item, i) => {
        const at = `levels.${mode}.${level}${Array.isArray(entry) ? `[${i}]` : ''}`;
        const info = agents[item.agent], model = item.model || info.model, effort = item.effort ?? null;
        info.used_at.push(at);
        const problem = effort == null ? null : effortProblem(item.agent, model, effort);
        const ok = !checks?.[item.agent] ? null : usable(item.agent) && !problem;
        return { agent: item.agent, type: info.type, model, effort, ok, ...(problem ? { problem } : {}) };
      });
    }
  }
  for (const [name, info] of Object.entries(agents)) {
    if (!info.used_at.length) warnings.push({ kind: 'unused_agent', agent: name, message: M.warnUnusedAgent(name) });
    if (cfg.agents[name].api_key) warnings.push({ kind: 'plaintext_key', agent: name, message: M.warnPlaintextKey(name) });
    if (info.run_access === 'shell' && info.used_at.some((at) => at.startsWith('levels.run.'))) warnings.push({ kind: 'shell_access', agent: name, message: M.warnShellAccess(name) });
  }
  for (const { old, target, closest } of staleAliases(cfg)) {
    warnings.push({ kind: 'stale_alias', agent: old, message: M.warnStaleAlias(old, target, closest.length ? M.list(closest) : '') });
  }
  return { levels, agents, warnings };
}
