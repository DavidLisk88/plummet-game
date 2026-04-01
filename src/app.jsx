import { h, render } from 'preact';
import { ScoreDisplay } from './components/ScoreDisplay.jsx';
import { ComboStreak } from './components/ComboStreak.jsx';
import { GameOverStats } from './components/GameOverStats.jsx';

/**
 * PreactOverlay — Root component that mounts Preact-managed UI
 * alongside the existing vanilla DOM.
 *
 * Strategy: Preact renders into dedicated mount points that sit
 * ON TOP of (or replace) specific DOM elements. The existing
 * Game class updates the gameStore, and these components react.
 */
function PreactOverlay() {
  return h('div', { id: 'preact-root', class: 'preact-overlay' },
    // In-game HUD components
    h(ComboStreak, null),
  );
}

/**
 * GameOverPanel — Mounted into the gameover screen's dedicated slot.
 */
function GameOverPanel() {
  return h(GameOverStats, null);
}

/**
 * Mount Preact into the game container.
 * Called after the Game class initializes.
 */
export function mountPreactUI() {
  // Main overlay (combo streak, difficulty meter)
  let mount = document.getElementById('preact-mount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'preact-mount';
    const container = document.getElementById('game-container');
    if (container) {
      container.appendChild(mount);
    } else {
      document.body.appendChild(mount);
    }
  }
  render(h(PreactOverlay, null), mount);

  // Game over stats (inline in the gameover screen)
  const statsMount = document.getElementById('gameover-stats-mount');
  if (statsMount) {
    render(h(GameOverPanel, null), statsMount);
  }
}
