import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const forbidden = /^(?:\.env(?!\.example$)|\.claude\/|\.codex\/|\.publication\/|data\/raw\/|docs\/audit\/|docs\/SESSION_HANDOFF\.md$)|\.(?:pem|key|p12|pfx)$/i;
const patterns = [
  ['JWT', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['GitHub token', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['local user path', /[A-Z]:[\\/]+Users[\\/]+(?!Public[\\/])/i],
];
let paths;
try { paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean); }
catch { throw new Error('Run this check from the publication Git repository.'); }
const failures = [];
for (const path of paths) {
  if (forbidden.test(path)) failures.push(`${path}: excluded path`);
  const text = readFileSync(path, 'utf8');
  for (const [name, pattern] of patterns) if (pattern.test(text)) failures.push(`${path}: ${name}`);
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Publication policy passed: ${paths.length} tracked files; no excluded paths or matched secret patterns.`);
