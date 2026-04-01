import { h } from 'preact';
import { useGameStore } from '../hooks/useGameStore.js';

/**
 * DifficultyMeter — NEW gameplay feature.
 *
 * Shows the current difficulty level during gameplay.
 * Difficulty increases based on words found and time played.
 * Appears as a small indicator near the score bar.
 */
export function DifficultyMeter() {
  const difficultyLevel = useGameStore(s => s.difficultyLevel);
  const gameState = useGameStore(s => s.gameState);
  const fallSpeed = useGameStore(s => s.fallSpeed);

  if (gameState < 1 || gameState > 3) return null;
  if (difficultyLevel <= 1) return null;

  const tierLabel =
    difficultyLevel >= 8 ? 'INSANE' :
    difficultyLevel >= 6 ? 'HARD' :
    difficultyLevel >= 4 ? 'MEDIUM' :
    'EASY+';

  const tierClass =
    difficultyLevel >= 8 ? 'diff-insane' :
    difficultyLevel >= 6 ? 'diff-hard' :
    difficultyLevel >= 4 ? 'diff-medium' :
    'diff-easy';

  return h('div', { class: `difficulty-meter ${tierClass}` },
    h('span', { class: 'diff-label' }, tierLabel),
    h('span', { class: 'diff-level' }, `Lv.${difficultyLevel}`),
  );
}
