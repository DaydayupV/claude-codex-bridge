#!/usr/bin/env node
// 把两个插件共用的文件从中文插件同步到英文插件，并检查两个插件的版本号一致。
//
//   node tools/sync-shared.mjs          同步
//   node tools/sync-shared.mjs --check  只检查，不一致时退出码为 1（适合提交前或 CI 里跑）
//
// 共用文件以 codex-bridge/ 为准，改脚本时只改那一份。各插件自己的 language.json、
// SKILL.md、命令说明和 schema 不同步。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'codex-bridge');
const TARGET = path.join(ROOT, 'codex-bridge-en');
const SHARED = [
  'skills/codex-dispatch/scripts/codex-run.mjs',
  'skills/codex-dispatch/scripts/messages.mjs',
];

const check = process.argv.includes('--check');
let problems = 0;

for (const rel of SHARED) {
  const src = fs.readFileSync(path.join(SOURCE, rel));
  const dest = path.join(TARGET, rel);
  const same = fs.existsSync(dest) && fs.readFileSync(dest).equals(src);
  if (same) continue;
  if (check) {
    console.log(`不一致：${rel}`);
    problems++;
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, src);
    console.log(`已同步：${rel}`);
  }
}

const version = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).version;
if (version(SOURCE) !== version(TARGET)) {
  console.log(`版本号不一致：codex-bridge ${version(SOURCE)}，codex-bridge-en ${version(TARGET)}`);
  problems++;
}

if (problems) process.exit(1);
console.log(check ? '两个插件的共用文件和版本号一致' : '同步完成');
