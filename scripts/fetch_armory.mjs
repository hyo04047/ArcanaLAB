// 로스트아크 Open API 에서 캐릭터 armory 데이터를 받아 data/raw/<캐릭터명>/ 에 저장한다.
// 사용: node scripts/fetch_armory.mjs 캐릭터명 [캐릭터명2 ...]
// 캐릭터명을 안 주면 .env 의 ARCANA_CHARACTERS(쉼표 구분)를 쓴다.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function loadEnv() {
  const env = {};
  for (const line of readFileSync(resolve(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = loadEnv();
const key = env.LOSTARK_API_KEY;
if (!key || key.includes('붙여넣기')) {
  console.error('.env 의 LOSTARK_API_KEY 가 비어 있습니다.');
  process.exit(1);
}

const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : (env.ARCANA_CHARACTERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (!names.length) {
  console.error('캐릭터명을 인자로 주거나 .env 의 ARCANA_CHARACTERS 를 채우세요.');
  process.exit(1);
}

const ENDPOINTS = ['profiles', 'equipment', 'combat-skills', 'engravings', 'gems', 'arkpassive', 'arkgrid', 'cards'];
const BASE = 'https://developer-lostark.game.onstove.com';

async function get(path) {
  const res = await fetch(BASE + path, {
    redirect: 'error',
    headers: { accept: 'application/json', authorization: `bearer ${key}` },
  });
  const remaining = res.headers.get('x-ratelimit-remaining');
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  const body = await res.json();
  return { body, remaining };
}

for (const name of names) {
  if (!/^[\p{L}\p{N}_-]{1,64}$/u.test(name)) {
    console.error('캐릭터명에 경로 문자나 지원하지 않는 문자가 있습니다.');
    process.exitCode = 1;
    continue;
  }
  const dir = resolve(root, 'data', 'raw', name);
  console.log(`== ${name}`);
  try {
    const responses = [];
    for (const ep of ENDPOINTS) {
      const path = `/armories/characters/${encodeURIComponent(name)}/${ep}`;
      const { body, remaining } = await get(path);
      if (ep === 'profiles' && !body) throw new Error('캐릭터를 찾을 수 없습니다');
      responses.push({ ep, body, remaining });
    }
    // 요청 하나라도 실패하면 기존 파일을 유지합니다. 모두 받은 뒤에만 저장합니다.
    mkdirSync(dir, { recursive: true });
    for (const { ep, body, remaining } of responses) {
      writeFileSync(resolve(dir, `${ep}.json`), JSON.stringify(body, null, 2), 'utf8');
      const shape = body === null ? 'null' : Array.isArray(body) ? `array[${body.length}]` : `object{${Object.keys(body).join(',')}}`;
      console.log(`  ${ep.padEnd(14)} ${shape}  (remaining ${remaining})`);
    }
  } catch (e) {
    console.error(`  ERROR ${e.message}`);
    process.exitCode = 1;
  }
}
