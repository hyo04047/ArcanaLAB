// data/raw/<캐릭터명>/ 의 Open API 원본을 읽어 사람이 읽을 수 있는 요약 JSON(parsed.json)으로 정리한다.
// 사용: node scripts/parse_armory.mjs 캐릭터명
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const name = process.argv[2];
if (!name) { console.error('캐릭터명을 주세요'); process.exit(1); }
if (!/^[\p{L}\p{N}_-]{1,64}$/u.test(name)) { console.error('캐릭터명에 경로 문자나 지원하지 않는 문자가 있습니다.'); process.exit(1); }
const dir = resolve(root, 'data', 'raw', name);
const load = (f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function walkText(v, out = []) {
  if (v == null) return out;
  if (typeof v === 'string') { const t = strip(v); if (t) out.push(t); }
  else if (typeof v === 'object') for (const k of Object.keys(v)) { if (!['iconPath', 'imagePath', 'iconGrade', 'slotData'].includes(k)) walkText(v[k], out); }
  return out;
}
const tooltipText = (json) => { try { return walkText(JSON.parse(json)); } catch { return [strip(json)]; } };

const profile = load('profiles.json');
const stats = Object.fromEntries(profile.Stats.map((s) => [s.Type, { value: Number(s.Value.replace(/,/g, '')), tooltip: (s.Tooltip ?? []).map(strip).filter((t) => !/물약|카드 도감/.test(t)) }]));

const skills = load('combat-skills.json')
  .filter((s) => s.SkillType === 1 || s.Level > 1 || (s.Tripods ?? []).some((t) => t.IsSelected))
  .map((s) => {
    const tt = tooltipText(s.Tooltip);
    const kind = tt.find((t) => /^\[.*스킬\]$/.test(t)) ?? null;
    const cooldown = tt.find((t) => t.startsWith('재사용 대기시간'))
      ?.match(/^재사용 대기시간\s*(?:(\d+)분)?\s*(?:(\d+(?:\.\d+)?)초)?$/);
    const mana = tt.find((t) => /마나 \d+ 소모/.test(t))?.match(/마나 (\d+)/)?.[1];
    return {
      name: s.Name, level: s.Level, kind, type: s.Type, skillType: s.SkillType,
      cooldown: cooldown && (cooldown[1] || cooldown[2]) ? Number(cooldown[1] ?? 0) * 60 + Number(cooldown[2] ?? 0) : null,
      mana: mana ? Number(mana) : null,
      rune: s.Rune ? `${s.Rune.Name}(${s.Rune.Grade})` : null,
      tripods: (s.Tripods ?? []).filter((t) => t.IsSelected).map((t) => ({ tier: t.Tier, slot: t.Slot, name: t.Name, desc: strip(t.Tooltip) })),
    };
  });

const ark = load('arkpassive.json');
const arkpassive = ark === null ? null : {
  points: Object.fromEntries(ark.Points.map((p) => [p.Name, p.Value])),
  nodes: ark.Effects.map((e) => {
    const d = strip(e.Description);
    const m = d.match(/^(진화|깨달음|도약) (\d)티어 (.+) Lv\.(\d+)$/);
    const text = tooltipText(e.ToolTip).filter((t) => !/^(NameTagBox|CommonSkillTitle|MultiTextBox|진화|깨달음|도약)$/.test(t) && t !== (m?.[3] ?? ''));
    return { kind: m?.[1], tier: Number(m?.[2]), name: m?.[3] ?? d, level: Number(m?.[4]), desc: text.join(' ').replace(/\|\|$/, '') };
  }),
};

const grid = load('arkgrid.json');
const arkgrid = grid === null ? null : {
  slots: grid.Slots.map((s) => {
    const tt = tooltipText(s.Tooltip);
    const opts = tt.find((t) => /^\[10P\]/.test(t)) ?? '';
    return {
      index: s.Index, name: s.Name, point: s.Point,
      options: [...opts.matchAll(/\[(\d+P)\]\s*([^\[]+)/g)].map((m) => ({ p: m[1], text: m[2].trim() })),
      gems: (s.Gems ?? []).map((g) => {
        const gt = tooltipText(g.Tooltip);
        const eff = gt.find((t) => /필요 의지력/.test(t)) ?? '';
        return { grade: g.Grade, name: gt[1], effect: eff };
      }),
    };
  }),
  effects: (grid.Effects ?? []).map((e) => ({ name: e.Name, desc: tooltipText(e.Tooltip).join(' ') })),
};

const eng = load('engravings.json');
const engravings = eng === null ? null : (eng.ArkPassiveEffects ?? []).map((e) => ({ name: e.Name, grade: e.Grade, level: e.Level, stone: e.AbilityStoneLevel, desc: strip(e.Description) }));

const gemsRaw = load('gems.json');
const gems = gemsRaw?.Gems ? gemsRaw.Gems.map((g) => ({ slot: g.Slot, level: g.Level, grade: g.Grade, name: strip(g.Name), text: tooltipText(g.Tooltip).join(' | ').slice(0, 300) })) : null;

const out = {
  character: { name: profile.CharacterName, class: profile.CharacterClassName, itemLevel: profile.ItemAvgLevel, level: profile.CharacterLevel, combatPower: profile.CombatPower, skillPoints: `${profile.UsingSkillPoint}/${profile.TotalSkillPoint}` },
  stats, skills, arkpassive, arkgrid, engravings, gems,
  skillSelectionNote: '레벨 투자·선택 트라이포드가 있는 스킬과 API의 T 스킬 목록을 보존합니다. T 스킬의 장착 여부를 이 목록만으로 확정하지 않습니다.',
};
writeFileSync(resolve(dir, 'parsed.json'), JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out.character));
console.log('stats:', Object.entries(stats).filter(([k]) => ['치명', '특화', '신속'].includes(k)).map(([k, v]) => `${k} ${v.value}`).join(', '));
console.log('skills:', skills.map((s) => `${s.name}${s.level}`).join(', '));
console.log('arkgrid:', arkgrid ? arkgrid.slots.map((s) => `${s.name}(${s.point})`).join(' | ') : 'null');
console.log('gems:', gems ? gems.length : 'null');
console.log(`saved ${resolve(dir, 'parsed.json')}`);
