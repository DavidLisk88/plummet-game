import { useState, useEffect, useRef } from 'preact/hooks';
import { gameStore } from '../gameStore.js';

/**
 * useGameStore(selector) — subscribe to a slice of game state.
 *
 * @param {function} selector - (state) => derivedValue
 * @returns The selected value, re-renders only when it changes.
 *
 * Usage:
 *   const score = useGameStore(s => s.score);
 *   const { score, highScore } = useGameStore(s => ({ score: s.score, highScore: s.highScore }));
 */
export function useGameStore(selector) {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const [value, setValue] = useState(() => selector(gameStore.get()));

  useEffect(() => {
    const unsubscribe = gameStore.subscribe((state) => {
      const next = selectorRef.current(state);
      setValue((prev) => {
        // Shallow compare for objects
        if (typeof next === 'object' && next !== null && typeof prev === 'object' && prev !== null) {
          for (const key in next) {
            if (next[key] !== prev[key]) return next;
          }
          for (const key in prev) {
            if (!(key in next)) return next;
          }
          return prev;
        }
        return next === prev ? prev : next;
      });
    });
    return unsubscribe;
  }, []);

  return value;
}
