// foreman 注入 pi 的守卫扩展（pi 本身没有权限系统）：只放行这次任务需要的工具，读写的路径不能出项目目录。
// 策略由适配器通过环境变量 FOREMAN_PI_GUARD 传入：{ root: 项目目录, access: none | read | edit | shell }。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const READ = ['read', 'grep', 'find', 'ls'];
const ALLOWED = { none: [], read: READ, edit: [...READ, 'edit', 'write'], shell: [...READ, 'edit', 'write', 'bash'] };
const PATH_KEYS = ['path', 'file_path', 'filePath'];
const UNICODE_SPACES = /[  -   　]/g;

// 和 pi 1.3 解析工具路径的规则一致：特殊空格、开头的 @、Windows 上 /c/… 这类 shell 写法、~、file:// 地址，最后相对项目目录解析。
function piPath(value, root) {
  let p = value.replace(UNICODE_SPACES, ' ');
  if (p.startsWith('@')) p = p.slice(1);
  if (process.platform === 'win32' && p.startsWith('/') && !p.startsWith('//') && !p.includes('\\')) {
    const m = /^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i.exec(p);
    if (m) p = `${m[1].toUpperCase()}:\\${m[2]?.replaceAll('/', '\\') ?? ''}`;
  }
  if (p === '~') p = os.homedir();
  else if (p.startsWith('~/') || (process.platform === 'win32' && p.startsWith('~\\'))) p = path.join(os.homedir(), p.slice(2));
  else if (/^file:\/\//.test(p)) p = fileURLToPath(p);
  return path.isAbsolute(p) ? path.resolve(p) : path.resolve(root, p);
}

// 真实路径：符号链接和 Windows 的 junction 都展开。还不存在的文件按最近一层存在的父目录展开，再接上后面的部分。
function realPath(p) {
  const rest = [];
  for (let current = p; ; current = path.dirname(current)) {
    try { return path.join(fs.realpathSync.native(current), ...rest.reverse()); } catch {
      if (path.dirname(current) === current) return p;
      rest.push(path.basename(current));
    }
  }
}

const inside = (root, target) => {
  const rel = path.relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
};

export default function foremanGuard(pi) {
  let policy = null;
  try { policy = JSON.parse(process.env.FOREMAN_PI_GUARD || ''); } catch { /* 没有策略时全部拒绝 */ }
  pi.on('tool_call', async (event) => {
    if (!policy?.root) return { block: true, reason: 'foreman guard: no policy for this run, so every tool is blocked' };
    if (!(ALLOWED[policy.access] || []).includes(event.toolName)) {
      return { block: true, reason: `foreman guard: ${event.toolName} is not allowed in this run` };
    }
    // shell 档的命令没有系统沙箱，只靠任务说明约束；守卫只管文件工具的路径。
    if (event.toolName === 'bash') return undefined;
    const root = realPath(path.resolve(policy.root));
    for (const key of PATH_KEYS) {
      const value = event.input?.[key];
      if (value == null || value === '') continue;
      if (typeof value !== 'string') return { block: true, reason: `foreman guard: ${key} must be a path string` };
      let target;
      try { target = realPath(piPath(value, root)); } catch { return { block: true, reason: `foreman guard: can't resolve ${value}` }; }
      if (!inside(root, target)) return { block: true, reason: `foreman guard: ${value} is outside the project directory` };
    }
    return undefined;
  });
}
