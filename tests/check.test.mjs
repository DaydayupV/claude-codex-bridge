import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { sandbox, output, baseConfig, apiAgent, opencodeAgent, MESSAGES } from './helpers.mjs';
import { apiServer } from './fake/api-server.mjs';
const M = MESSAGES.zh;

for (const loggedIn of [true, false]) {
  test(`check 识别 Codex ${loggedIn ? '已登录' : '未登录'}状态`, async (t) => {
    const h = sandbox(t), s = h.scenario({ logged_in: loggedIn });
    const r = output(await h.bridge(['check'], { env: s.env }), loggedIn ? 0 : 1);
    assert.equal(r.ok, loggedIn);
    assert.equal(r.codex.ok, loggedIn);
    assert.equal(r.node.ok, true);
    assert.equal(r.git.ok, true);
    assert.equal(r.codex.version, 'codex-cli synthetic-1.0');
    assert.equal(r.codex.fix, loggedIn ? null : M.fixCodexLogin);
    assert.deepEqual(s.calls().map((c) => c.args), [['--version'], ['login', 'status']]);
  });
}

test('check 找不到指定 Codex 时提示安装且不调用真实 CLI', async (t) => {
  const h = sandbox(t), c = baseConfig();
  c.agents.codex.bin = path.join(h.home, 'missing-codex.exe');
  h.config(c);
  const r = output(await h.bridge(['check']), 1);
  assert.equal(r.ok, false);
  assert.equal(r.codex.version, null);
  assert.equal(r.codex.login, null);
  assert.equal(r.codex.fix, M.fixCodexMissing);
  assert.equal(h.calls().length, 0);
});

for (const status of [200, 401]) {
  test(`check 报告 API ${status === 200 ? '可连通' : '认证失败'}且不改变 Codex 总体结果`, async (t) => {
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
