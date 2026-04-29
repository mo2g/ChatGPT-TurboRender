import type { Settings } from '../../shared/types';

export interface ActivationInput {
  finalizedTurns: number;
  descendantCount: number;
  spikeCount: number;
  settings: Settings;
}

export function shouldAutoActivate(input: ActivationInput): boolean {
  return (
    input.finalizedTurns >= input.settings.minFinalizedBlocks ||
    input.descendantCount >= input.settings.minDescendants ||
    input.spikeCount >= input.settings.frameSpikeCount
  );
}

