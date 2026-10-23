// Open API 툴팁(JSON 문자열 + HTML 태그) → 텍스트 유틸
export const strip = (s: unknown): string =>
  String(s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const SKIP_KEYS = new Set(['iconPath', 'imagePath', 'iconGrade', 'slotData', 'type']);

export function walkText(v: unknown, out: string[] = []): string[] {
  if (v == null) return out;
  if (typeof v === 'string') {
    const t = strip(v);
    if (t) out.push(t);
  } else if (typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (!SKIP_KEYS.has(k)) walkText(val, out);
  }
  return out;
}

export function tooltipLines(json: string | undefined | null): string[] {
  if (!json) return [];
  try {
    return walkText(JSON.parse(json));
  } catch {
    return [strip(json)];
  }
}

/** "26.25%" → 0.2625 */
export const pct = (s: string): number => Number(s) / 100;

/** "9초" | "1분" | "1분 30초" → 초 */
export function parseSeconds(s: string): number | null {
  const m = s.trim().match(/(?:(\d+)분)?\s*(?:([\d.]+)초)?/);
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}
