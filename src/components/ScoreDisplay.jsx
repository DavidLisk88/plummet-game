import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { useGameStore } from '../hooks/useGameStore.js';

/**
 * ScoreDisplay — replaces the #score-bar during gameplay.
 *
 * Shows: current score (with bump animation), timer (if timed), high score,
 * and the NEW score multiplier badge when active.
 */
export function ScoreDisplay() {
  const score = useGameStore(s => s.score);
  const highScore = useGameStore(s => s.highScore);
  const isTimed = useGameStore(s => s.isTimed);
  const timeRemaining = useGameStore(s => s.timeRemaining);
  const scoreMultiplier = useGameStore(s => s.scoreMultiplier);
  const comboMultiplier = useGameStore(s => s.comboMultiplier);
  const gameState = useGameStore(s => s.gameState);

  const scoreRef = useRef(null);
  const prevScore = useRef(score);

  // Bump animation on score change
  useEffect(() => {
    if (score !== prevScore.current && scoreRef.current) {
      scoreRef.current.classList.remove('score-bump');
      void scoreRef.current.offsetWidth;
      scoreRef.current.classList.add('score-bump');
      prevScore.current = score;
    }
  }, [score]);

  // Don't render unless playing
  if (gameState < 1 || gameState > 3) return null;

  const effectiveMultiplier = Math.max(scoreMultiplier, comboMultiplier);
  const formatTime = (seconds) => {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return h('div', { id: 'score-bar', class: 'score-bar-preact' },
    h('div', { class: 'score-item' },
      h('span', { class: 'score-label' }, 'Score'),
      h('span', { id: 'current-score', class: 'score-value', ref: scoreRef }, score),
    ),
    isTimed && h('div', { class: 'score-item' },
      h('span', { class: 'score-label' }, 'Time'),
      h('span', { class: 'score-value' }, formatTime(timeRemaining)),
    ),
    h('div', { class: 'score-item' },
      h('span', { class: 'score-label' }, 'High'),
      h('span', { class: 'score-value' }, highScore),
    ),
    effectiveMultiplier > 1 && h('div', { class: 'score-multiplier-badge' },
      `${effectiveMultiplier}×`,
    ),
  );
}
