import { readFileSync } from 'node:fs';

/** 잘못된 바이트를 대체 문자로 바꾸어 다른 입력을 실행하지 않습니다. */
export function readSavedText(path: string): string {
  const bytes = readFileSync(path);
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error(`UTF-8 파일 인코딩을 확인하세요: ${path}`); }
}
