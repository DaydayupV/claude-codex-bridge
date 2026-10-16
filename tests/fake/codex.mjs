import path from 'node:path';
import { setup, replay, write, finish } from './common.mjs';
import { report } from '../fixtures/reports.mjs';

const args = process.argv.slice(2);
const operation = args[0] === '--version' ? 'version' : args[0] === 'login' ? 'login' : 'exec';
const { scenario: s } = await setup('codex', operation, args);
if (operation === 'version') {
  console.log(s.version || 'codex-cli synthetic-1.0');
} else if (operation === 'login') {
  process.stderr.write(s.logged_in === false ? 'Not logged in\n' : 'Logged in using synthetic credentials\n');
  process.exitCode = s.logged_in === false ? 1 : 0;
} else {
  if (args[0] !== 'exec') throw new Error(`假 codex 不支持 ${args[0]}`);
  const cwd = args.includes('-C') ? args[args.indexOf('-C') + 1] : process.cwd();
  const session = s.session_id || 'synthetic-session';
  console.log(JSON.stringify({ type: 'thread.started', thread_id: session }));
  await replay(s.steps, cwd);
  for (const [name, content] of Object.entries(s.files || {})) write(path.resolve(cwd, name), content);
  if (s.stats) {
    const d = new Date();
    const dir = path.join(process.env.CODEX_HOME, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    write(path.join(dir, `rollout-${session}.jsonl`), JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', ...s.stats } }) + '\n');
  }
  for (const name of s.images || []) {
    write(path.join(process.env.CODEX_HOME, 'generated_images', session, name), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6iQAAAABJRU5ErkJggg==', 'base64'));
  }
  if (!s.hold) {
    const last = s.last_message ?? report;
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: typeof last === 'string' ? last : JSON.stringify(last) } }));
    if (args.includes('-o')) write(args[args.indexOf('-o') + 1], typeof last === 'string' ? last : JSON.stringify(last));
    if (s.usage) console.log(JSON.stringify({ type: 'turn.completed', usage: s.usage }));
  }
  await finish(s);
}
