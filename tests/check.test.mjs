import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { sandbox, output, baseConfig, apiAgent, opencodeAgent, MESSAGES } from './helpers.mjs';
import { apiServer } from './fake/api-server.mjs';
const M = MESSAGES.zh;

for (const lang of ['zh', 'en']) {
  test(`check opencode 检查两个档位并报告拒绝项 (${lang})`, async (t) => {
    const h = sandbox(t), c = baseConfig(), messages = MESSAGES[lang];
    c.agents.oc = opencodeAgent();
    c.agents.oc.run_access = 'edit';
    c.levels.run.complex = { agent: 'oc', effort: 'low' };
    c.levels.review.normal = { agent: 'oc', effort: 'medium', model: 'fake/override' };
    h.config(c);
    const s = h.scenario({ reject_variants: ['medium'], last_message: 'OK' });
    const r = output(await h.bridge(['check', '--agent', 'oc'], { env: { ...s.env, FOREMAN_LANG: lang } }), 1);
    const error = 'Variant unavailable for fake/override: medium';
    assert.equal(r.ok, false);
    assert.equal(r.agents.oc.ok, false);
    assert.equal(r.agents.oc.error, error);
    assert.deepEqual(r.agents.oc.variants, [
      { model: 'fake/model', variant: 'low', used_at: ['levels.run.complex'], ok: true, error: null },
      { model: 'fake/override', variant: 'medium', used_at: ['levels.review.normal'], ok: false, error },
    ]);
    assert.equal(r.agents.oc.fix, messages.fixOpencodeVariant('oc', lang === 'en'
      ? 'medium (levels.review.normal)' : 'medium（levels.review.normal）'));
    const calls = s.calls().filter((c) => c.operation === 'run');
    assert.deepEqual(calls.map((c) => c.args[c.args.indexOf('-m') + 1]), ['fake/model', 'fake/model#low', 'fake/override#medium']);
    assert.ok(calls.every((c) => c.stdin === 'Reply with the single word OK.'));
  });
}

test('check opencode 按模型和档位去重并保留所有等级位置', async (t) => {
  const h = sandbox(t), c = baseConfig(), usedAt = [];
  c.agents.oc = opencodeAgent();
  c.agents.oc.run_access = 'edit';
  for (const mode of ['run', 'review', 'discuss']) {
    for (const level of ['simple', 'normal', 'complex']) {
      const entry = { agent: 'oc', effort: 'high' };
      c.levels[mode][level] = mode === 'discuss' ? [{ agent: 'codex' }, entry] : entry;
      usedAt.push(`levels.${mode}.${level}${mode === 'discuss' ? '[1]' : ''}`);
    }
  }
  c.levels.discuss.complex[1].model = 'fake/other';
  const overrideAt = usedAt.pop();
  h.config(c);
  const r = output(await h.bridge(['check', '--agent', 'oc']));
  assert.equal(r.agents.oc.ok, true);
  assert.deepEqual(r.agents.oc.variants, [
    { model: 'fake/model', variant: 'high', used_at: usedAt, ok: true, error: null },
    { model: 'fake/other', variant: 'high', used_at: [overrideAt], ok: true, error: null },
  ]);
  assert.deepEqual(h.calls().filter((c) => c.operation === 'run').map((c) => c.args[c.args.indexOf('-m') + 1]),
    ['fake/model', 'fake/model#high', 'fake/other#high']);
});

test('check opencode 没有配置档位时只发默认请求', async (t) => {
  const h = sandbox(t), c = baseConfig();
  c.agents.oc = opencodeAgent();
  c.levels.review.simple = { agent: 'oc', effort: null };
  c.levels.discuss.normal = [{ agent: 'oc' }];
  h.config(c);
  const r = output(await h.bridge(['check', '--agent', 'oc']));
  assert.deepEqual(r.agents.oc.variants, []);
  assert.equal(h.calls().filter((c) => c.operation === 'run').length, 1);
});

test('check opencode 默认请求失败时不发档位请求', async (t) => {
  const h = sandbox(t), c = baseConfig();
  c.agents.oc = opencodeAgent();
  c.levels.review.normal = { agent: 'oc', effort: 'high' };
  h.config(c);
  const s = h.scenario({ exit_code: 1, steps: [{ event: { type: 'error', error: { message: 'default failed' } } }] });
  const r = output(await h.bridge(['check', '--agent', 'oc'], { env: s.env }), 1);
  assert.equal(r.agents.oc.ok, false);
  assert.equal(r.agents.oc.error, 'default failed');
  assert.equal(r.agents.oc.fix, M.fixOpencodeRun('oc', 'default failed'));
  assert.deepEqual(r.agents.oc.variants, []);
  const calls = s.calls().filter((c) => c.operation === 'run');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[calls[0].args.indexOf('-m') + 1], 'fake/model');
});

for (const loggedIn of [true, false]) {
  test(`check 识别 Codex ${loggedIn ? '已登录' : '未登录'}状态`, async (t) => {
    const h = sandbox(t), s = h.scenario({ logged_in: loggedIn });
    const r = output(await h.bridge(['check'], { env: s.env }), loggedIn ? 0 : 1);
    assert.equal(r.ok, loggedIn);
    assert.equal(r.agents.codex.ok, loggedIn);
    assert.equal(r.node.ok, true);
    assert.equal(r.git.ok, true);
    assert.equal(r.agents.codex.version, 'codex-cli synthetic-1.0');
    assert.equal(r.agents.codex.fix, loggedIn ? null : M.fixCodexLogin);
    // 已登录时还会读一次模型清单，核对配置的推理强度
    assert.deepEqual(s.calls().map((c) => c.args), loggedIn ? [['--version'], ['login', 'status'], ['debug', 'models']] : [['--version'], ['login', 'status']]);
  });
}

test('check 找不到指定 Codex 时提示安装且不调用真实 CLI', async (t) => {
  const h = sandbox(t), c = baseConfig();
  c.agents.codex.bin = path.join(h.home, 'missing-codex.exe');
  h.config(c);
  const r = output(await h.bridge(['check']), 1);
  assert.equal(r.ok, false);
  assert.equal(r.agents.codex.version, null);
  assert.equal(r.agents.codex.login, null);
  assert.equal(r.agents.codex.fix, M.fixCodexMissing);
  assert.equal(h.calls().length, 0);
});

for (const status of [200, 401]) {
  test(`check 报告 API ${status === 200 ? '可连通' : '认证失败'}且未被等级引用时不改变总体结果`, async (t) => {
    const h = sandbox(t), api = await apiServer(t, [status === 200 ? { answer: 'OK' } : { status, message: 'synthetic auth' }]);
    const c = baseConfig();
    c.agents.api = apiAgent(api.url);
    h.config(c);
    const r = output(await h.bridge(['check', '--agent', 'api']));
    assert.equal(r.ok, true);
    assert.equal(r.agents.api.ok, status === 200);
    assert.equal(api.requests.length, 1);
    assert.equal(api.requests[0].body.messages[0].content, 'Reply with the single word OK.');
    if (status === 200) {
      assert.equal(r.agents.api.reply, 'OK');
      assert.equal(r.agents.api.usage.input_tokens, 100);
    }
    else {
      assert.equal(r.agents.api.error, 'auth 401: synthetic auth');
      assert.equal(r.agents.api.fix, M.fixApiAuth('api', 'config'));
    }
  });
}

for (const listed of [true, false]) {
  test(`check 检查 opencode 模型${listed ? '存在' : '不存在'}于 models`, async (t) => {
    const h = sandbox(t), c = baseConfig();
    c.agents.oc = opencodeAgent();
    h.config(c);
    const s = h.scenario({ models: listed ? ['fake/other', 'fake/model'] : ['fake/other'], last_message: 'OK' });
    const r = output(await h.bridge(['check', '--agent', 'oc'], { env: s.env }));
    assert.equal(r.ok, true);
    assert.equal(r.agents.oc.ok, listed);
    assert.equal(r.agents.oc.model_listed, listed);
    assert.equal(r.agents.oc.version, 'synthetic-opencode-1.0');
    const calls = s.calls().filter((c) => c.tool === 'opencode');
    assert.deepEqual(calls.slice(0, 2).map((c) => c.args), [['--version'], ['models']]);
    if (listed) {
      assert.equal(r.agents.oc.reply, 'OK');
      assert.equal(calls[2].stdin, 'Reply with the single word OK.');
    }
    else {
      assert.equal(r.agents.oc.fix, M.fixOpencodeModel('oc', 'fake/model'));
      assert.equal(calls.length, 2);
    }
  });
}
