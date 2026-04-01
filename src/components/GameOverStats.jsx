import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { useGameStore } from '../hooks/useGameStore.js';

/**
 * GameOverStats — Enhanced game over statistics panel.
 *
 * Renders inside the existing game-over screen as an additional
 * stats section showing combo stats, difficulty reached, and
 * performance breakdown. Does NOT replace the existing game-over
 * screen — it augments it.
 */
export function GameOverStats() {
  const screen = useGameStore(s => s.screen);
  const bestCombo = useGameStore(s => s.bestCombo);
  const wordsFoundCount = useGameStore(s => s.wordsFoundCount);
  const finalScore = useGameStore(s => s.finalScore);
  const isNewHighScore = useGameStore(s => s.isNewHighScore);

  const [visible, setVisible] = useState(false);

  // Animate in after a delay
  useEffect(() => {
    if (screen === 'gameover') {
      const timer = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(timer);
    }
    setVisible(false);
  }, [screen]);

  if (screen !== 'gameover') return null;

  return h('div', { class: `gameover-stats ${visible ? 'visible' : ''}` },
    h('div', { class: 'gameover-stats-grid' },
      bestCombo >= 2 && h('div', { class: 'stat-card' },
        h('span', { class: 'stat-card-value' }, `${bestCombo}×`),
        h('span', { class: 'stat-card-label' }, 'Best Combo'),
      ),
      h('div', { class: 'stat-card' },
        h('span', { class: 'stat-card-value' }, wordsFoundCount),
        h('span', { class: 'stat-card-label' }, 'Words Found'),
      ),

    ),
  );
}
