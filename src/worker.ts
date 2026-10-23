// Web Worker: 빌드(JSON)를 받아 시뮬레이션을 메인 스레드 밖에서 돌린다.
import { cardsFor, simulate } from './engine';
import type { Build, SimConfig, SimSummary } from './engine';
import modelId from 'virtual:arcanalab-model';

export interface WorkerRequest {
  id: number;
  build: Build;
  config: SimConfig;
  inputWarnings?: string[];
}
export type WorkerResponse = { id: number; summary: SimSummary; modelId: string } | { id: number; error: string };

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const { id, build, config, inputWarnings } = ev.data;
  let res: WorkerResponse;
  try {
    const summary = simulate(build, cardsFor(build.variant, build.deckOverrides), config);
    if (inputWarnings?.length) summary.inputWarnings = [...inputWarnings];
    res = { id, summary, modelId };
  } catch (error) {
    res = { id, error: error instanceof Error ? error.message : String(error) };
  }
  (self as unknown as Worker).postMessage(res);
};
