#!/usr/bin/env node
// SessionStart 钩子：会话开始（包括恢复和上下文压缩之后）时提醒 Claude 在动手前加载 codex-dispatch skill。
// skill 是否加载全靠 Claude 自己判断，项目里有更贴合的领域 skill 时容易漏掉，所以每个会话都提醒一次。
// 只读配置，不 import codex-run.mjs，避免触发它首次运行时生成配置文件。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(HERE, '..', 'skills', 'codex-dispatch', 'scripts');
const USER_CONFIG = process.env.CODEX_BRIDGE_CONFIG || path.join(os.homedir(), '.claude', 'codex-bridge.json');

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; } };

const language = readJson(path.join(SCRIPTS, 'language.json'))?.language || 'zh';
const autoDispatch = readJson(USER_CONFIG)?.auto_dispatch !== false;

const REMINDERS = {
  zh: (auto) => `codex-bridge 插件已启用。动手做执行类编码工作之前（实现功能、批量修改、写脚本、重构、修 bug、性能优化等，包括用户同意你开始改代码的那一刻），先加载 \`codex-bridge:codex-dispatch\` skill，按其中的门槛决定是否把工作派给 Codex：${auto ? '符合门槛的直接派（用户已开启 auto_dispatch）' : '符合门槛的先向用户提议，同意后再派（auto_dispatch 已关闭）'}。项目自带的领域 skill 照常使用，两者不冲突：领域 skill 管怎么做，codex-dispatch 管由谁来做、做完怎么验收和审查。调用 Codex 只能通过该 skill 的脚本。`,
  en: (auto) => `The codex-bridge-en plugin is enabled. Before starting hands-on coding work (implementing features, bulk changes, scripts, refactoring, bug fixes, performance work, and so on, including the moment the user agrees you can start changing code), load the \`codex-bridge-en:codex-dispatch\` skill and use its thresholds to decide whether to hand the work to Codex: ${auto ? 'hand off tasks that meet them directly (the user has auto_dispatch on)' : 'suggest it to the user first and hand off once they agree (auto_dispatch is off)'}. Keep using the project's own domain skills as usual; they don't conflict: domain skills say how to do the work, codex-dispatch decides who does it and how it gets checked and reviewed. Codex may only be called through that skill's script.`,
};

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: (REMINDERS[language] || REMINDERS.zh)(autoDispatch),
  },
}));
