import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { sandbox, ROOT } from './helpers.mjs';

test('中英文插件的共用文件、schema 结构和版本号一致', async (t) => {
  const h = sandbox(t);
  const r = await h.start(path.join(ROOT, 'tools/sync-shared.mjs'), ['--check']).done;
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.trim(), '两个插件的共用文件、schema 结构和版本号一致');
});
