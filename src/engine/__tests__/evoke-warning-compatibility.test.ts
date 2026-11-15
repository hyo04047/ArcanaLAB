import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cardSupplyWarnings } from '../cards';
import { cardsFor } from '../presets';
import { simulate } from '../sim';
import type { SkillDef } from '../types';
import { readSettingInput, regenerateSettingInput } from '../../settingFiles';
import warnings from '../../../data/evoke_gauge_candidates.json';
import modelId from 'virtual:arcanalab-model';

const dir = 'tests/fixtures/audit/2026-10-31-evoke-manual-candidate/final/inputs';
const names = readdirSync(dir).filter(name => name.startsWith('evoke-') || /^manual-\d-0\.json$/.test(name));
const evoke = (skills: SkillDef[]) => skills.find(s => s.id === 'evoke')!;
const config = { durationSec: 10, iterations: 2, seed: 42, randomMode: 'partitioned-v1' as const };
const withoutGemNotice = (values: string[]) => values.filter(w => !w.startsWith('이보크 중독·피해 보석:'));

describe('Evoke notice revision preserves saved behavior', () => {
  it.each(names)('keeps %s unchanged until explicit regeneration, including numerical results', async name => {
    const text = readFileSync(`${dir}/${name}`, 'utf8'), old = JSON.parse(text);
    const loaded = await readSettingInput(text, name, modelId);
    expect(loaded.status).toBe('model-changed'); expect(loaded.text).toBe(text);
    expect(loaded.build).toEqual(old.build); expect(loaded.warnings).toEqual(old.warnings);
    const basic = evoke(loaded.build.skills).evokeGauge!.candidate === 'evoke-manual-basic';
    const oldWarning = basic ? warnings.manualWarning : warnings.warning;
    const newWarning = basic ? warnings.manualWarningV2 : warnings.warningV2;
    expect(cardSupplyWarnings(loaded.build)).toContain(oldWarning);
    expect(cardSupplyWarnings(loaded.build)).not.toContain(newWarning);
    const regenerated = await regenerateSettingInput(text, name, modelId), next = regenerated.input;
    expect(next.status).toBe('editable'); expect(evoke(next.build.skills).evokeGauge!.warningVersion).toBe(2);
    const withoutRevision = structuredClone(next.build); delete evoke(withoutRevision.skills).evokeGauge!.warningVersion;
    expect(withoutRevision).toEqual(loaded.build);
    expect(regenerated.warningsRemoved).toEqual([oldWarning]); expect(withoutGemNotice(regenerated.warningsAdded)).toEqual([newWarning]);
    expect(withoutGemNotice(next.warnings!)).toEqual(loaded.warnings!.map(w => w === oldWarning ? newWarning : w));
    for (const fragment of ['특화 1800', '전설 풍요', '영웅 풍요', '탐욕·체인', '비교 가정', '3.25–3.28배']) expect(newWarning).toContain(fragment);
    const before = simulate(loaded.build, cardsFor(loaded.build.variant, loaded.build.deckOverrides), config);
    const after = simulate(next.build, cardsFor(next.build.variant, next.build.deckOverrides), config);
    expect(after.cardSupplyWarnings).toEqual(before.cardSupplyWarnings.map(w => w === oldWarning ? newWarning : w));
    expect({ ...after, cardSupplyWarnings: before.cardSupplyWarnings }).toEqual(before);
    const reopened = await readSettingInput(next.text, name, modelId);
    expect(reopened.text).toBe(next.text); expect(reopened.build).toEqual(next.build); expect(reopened.warnings).toEqual(next.warnings);
    for (const tamper of [
      (saved: typeof old) => { delete evoke(saved.build.skills).evokeGauge!.warningVersion; },
      (saved: typeof old) => { saved.warnings = old.warnings; },
    ]) {
      const saved = JSON.parse(next.text); tamper(saved);
      await expect(readSettingInput(JSON.stringify(saved), name, modelId)).rejects.toThrow('일치');
    }
  });

  it.each([undefined, null, 0, 1, 3, '2', true, {}, []])('rejects an explicit unsupported notice revision %j', version => {
    const { build } = JSON.parse(readFileSync(`${dir}/manual-3-0.json`, 'utf8'));
    Object.assign(evoke(build.skills).evokeGauge!, { warningVersion: version });
    expect(() => simulate(build, cardsFor(build.variant), config)).toThrow('이보크');
  });

  it('does not add the notice revision to unsupported variants', async () => {
    const text = readFileSync(`${dir}/manual-3-1.json`, 'utf8'), old = JSON.parse(text);
    const next = (await regenerateSettingInput(text, 'unsupported', modelId)).input;
    expect(next.build).toEqual(old.build); expect(next.warnings).toEqual(old.warnings);
    expect(evoke(next.build.skills).evokeGauge).toBeUndefined();
  });
});
