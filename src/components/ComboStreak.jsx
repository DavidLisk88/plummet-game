import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { useGameStore } from '../hooks/useGameStore.js';

/**
 * ComboStreak — NEW gameplay feature.
 *
 * Shows a combo counter when the player finds words in rapid succession.
 * Each consecutive word within a time window increases the combo.
 * Higher combos = higher score multiplier displayed here.
 *
 * Visual: pops in from the right side of the screen during gameplay,
 * with escalating intensity as the combo grows.
 */
export function ComboStreak() {
  const comboCount = useGameStore(s => s.comboCount);
  const comboActive = useGameStore(s => s.comboActive);
  const bestCombo = useGameStore(s => s.bestCombo);
  const comboMultiplier = useGameStore(s => s.comboMultiplier);
  const gameState = useGameStore(s => s.gameState);

  const [animClass, setAnimClass] = useState('');
  const prevCombo = useRef(0);

  // Trigger pop animation when combo increases
  useEffect(() => {
    if (comboCount > prevCombo.current && comboCount >= 2) {
      setAnimClass('combo-pop');
      const timer = setTimeout(() => setAnimClass(''), 400);
      prevCombo.current = comboCount;
      return () => clearTimeout(timer);
    }
    if (comboCount === 0) {
      prevCombo.current = 0;
    }
  }, [comboCount]);

  // Don't render unless playing and combo is active
  if (gameState < 1 || gameState > 3) return null;
  if (!comboActive || comboCount < 2) return null;

  const intensity = Math.min(comboCount, 10); // cap visual intensity
  const tierClass =
    intensity >= 8 ? 'combo-legendary' :
    intensity >= 5 ? 'combo-epic' :
    intensity >= 3 ? 'combo-hot' :
    'combo-warm';

  return h('div', { class: `combo-streak ${tierClass} ${animClass}` },
    h('div', { class: 'combo-count' },
      h('span', { class: 'combo-number' }, comboCount),
      h('span', { class: 'combo-label' }, 'COMBO'),
    ),
    h('div', { class: 'combo-multiplier' },
      `${comboMultiplier.toFixed(1)}×`,
    ),
  );
}
