/**
 * gameStore.js — Reactive bridge between the vanilla Game class and Preact components.
 *
 * The Game class calls gameStore.set({ key: value }) whenever state changes.
 * Preact components subscribe via the useGameStore() hook and re-render
 * only when their selected slice of state changes.
 *
 * This keeps the Game class in control of all logic while letting
 * Preact own the rendering of specific UI pieces.
 */

// ── Default state shape ──
const defaultState = {
  // Screen navigation
  screen: 'profiles',        // profiles | menu | play | gameover | music | wordsfound | challenges | challengesetup

  // Core game
  score: 0,
  highScore: 0,
  gameState: 0,              // State enum: MENU=0, PLAYING=1, PAUSED=2, CLEARING=3, GAMEOVER=4

  // Combo / streak (NEW)
  comboCount: 0,             // consecutive words found in current game (resets on block land with no words)
  bestCombo: 0,              // best combo this game
  comboMultiplier: 1,        // 1x base, grows with combo
  comboTimer: 0,             // visual countdown before combo resets
  comboActive: false,        // is a combo chain currently active

  // Chain (existing in-drop chain)
  chainCount: 0,             // totalWordsInChain from Game class

  // Difficulty progression (NEW)
  difficultyLevel: 1,        // increases over time during a game
  wordsFoundCount: 0,        // total words found this game
  fallSpeed: 1.5,            // current fall interval

  // Score multiplier
  scoreMultiplier: 1,        // current active multiplier (from bonuses)
  freezeActive: false,
  freezeTimeRemaining: 0,

  // Timer
  timeRemaining: 0,
  timeLimit: 0,
  isTimed: false,

  // Level / XP
  level: 1,
  xp: 0,
  xpRequired: 100,

  // Game over
  finalScore: 0,
  isNewHighScore: false,
  xpEarned: 0,
  wordsFound: [],

  // Profile
  profileName: '',
  gamesPlayed: 0,
  totalUniqueWords: 0,

  // Challenge
  activeChallenge: null,
  targetWord: null,
  targetWordsCompleted: 0,
};

let state = { ...defaultState };
let listeners = new Set();

/**
 * Get current state snapshot (read-only copy not needed; store is simple object).
 */
function get() {
  return state;
}

/**
 * Merge partial state and notify subscribers.
 */
function set(partial) {
  let changed = false;
  for (const key in partial) {
    if (state[key] !== partial[key]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;

  state = { ...state, ...partial };
  for (const fn of listeners) {
    try { fn(state); } catch (e) { console.error('[gameStore] listener error:', e); }
  }
}

/**
 * Subscribe to state changes. Returns unsubscribe function.
 */
function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Reset to defaults (called on new game).
 */
function reset() {
  set({ ...defaultState });
}

export const gameStore = { get, set, subscribe, reset, defaultState };
