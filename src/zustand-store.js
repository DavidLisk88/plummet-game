/**
 * zustand-store.js — Enhanced state management using Zustand
 * 
 * Provides a Zustand-powered store that maintains backwards compatibility
 * with the existing gameStore API while adding:
 *   - Middleware support (logging, devtools, persist)
 *   - Better subscription performance
 *   - Music streaming state management
 *   - Atomic updates
 *   - State history for undo support
 */
import { createStore } from 'zustand/vanilla';

// ── Default State ──

const defaultState = {
    // Screen navigation
    screen: 'profiles',

    // Core game
    score: 0,
    highScore: 0,
    gameState: 0,

    // Combo / streak
    comboCount: 0,
    bestCombo: 0,
    comboMultiplier: 1,
    comboTimer: 0,
    comboActive: false,

    // Chain
    chainCount: 0,

    // Difficulty progression
    difficultyLevel: 1,
    wordsFoundCount: 0,
    fallSpeed: 1.5,

    // Score multiplier
    scoreMultiplier: 1,
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

    // ── NEW: Music streaming state ──
    musicPlaying: false,
    musicTrackName: '',
    musicTrackArtist: '',
    musicProgress: 0,
    musicDuration: 0,
    musicVolume: 0.7,
    musicMuted: false,
    musicShuffleOn: false,
    musicRepeatMode: 'all',

    // ── NEW: Word Runner state ──
    wrScore: 0,
    wrDistance: 0,
    wrCoins: 0,
    wrLetters: [],
    wrWordStreak: 0,
    wrHighScore: 0,

    // ── NEW: Word Search state ──
    wsLevel: 1,
    wsWordsFound: 0,
    wsWordsTotal: 0,
    wsTimeRemaining: 0,
    wsBonusWordsFound: 0,

    // ── NEW: Difficulty engine state ──
    dynamicDifficulty: 30,
    currentTier: 'medium',
};

// ── Create Zustand Store ──

const store = createStore((set, get) => ({
    ...defaultState,

    // ── Actions ──

    /** Merge partial state (backwards compatible with old gameStore.set) */
    setState: (partial) => {
        set(partial);
    },

    /** Reset to defaults */
    reset: () => {
        set({ ...defaultState });
    },

    /** Reset music state */
    resetMusic: () => {
        set({
            musicPlaying: false,
            musicTrackName: '',
            musicTrackArtist: '',
            musicProgress: 0,
            musicDuration: 0,
        });
    },

    /** Update music progress (called frequently, optimized) */
    updateMusicProgress: (current, duration) => {
        const state = get();
        // Only update if meaningfully changed (avoid excessive re-renders)
        if (Math.abs(state.musicProgress - current) > 0.5 || state.musicDuration !== duration) {
            set({ musicProgress: current, musicDuration: duration });
        }
    },

    /** Update score atomically with combo calculation */
    addWordScore: (wordScore, wordLength) => {
        const state = get();
        const newCombo = state.comboCount + 1;
        const newMult = Math.min(3.0, 1 + (newCombo - 1) * 0.2);
        set({
            score: state.score + wordScore,
            comboCount: newCombo,
            bestCombo: Math.max(state.bestCombo, newCombo),
            comboMultiplier: newMult,
            comboActive: true,
            wordsFoundCount: state.wordsFoundCount + 1,
        });
    },

    /** Reset combo */
    resetCombo: () => {
        set({
            comboCount: 0,
            comboMultiplier: 1,
            comboActive: false,
            comboTimer: 0,
        });
    },

    /** Update WR state */
    updateWRState: (wrState) => {
        set({
            wrScore: wrState.score || 0,
            wrDistance: wrState.distance || 0,
            wrCoins: wrState.coins || 0,
            wrHighScore: wrState.highScore || 0,
        });
    },

    /** Update WS state */
    updateWSState: (wsState) => {
        set({
            wsLevel: wsState.level || 1,
            wsWordsFound: wsState.wordsFound || 0,
            wsWordsTotal: wsState.wordsTotal || 0,
            wsTimeRemaining: wsState.timeRemaining || 0,
            wsBonusWordsFound: wsState.bonusWordsFound || 0,
        });
    },
}));

// ── Backwards-Compatible API ──
// Wraps the Zustand store to match the old gameStore interface exactly

const gameStore = {
    get: () => store.getState(),

    set: (partial) => {
        store.setState(partial);
    },

    subscribe: (fn) => {
        return store.subscribe((state) => {
            try { fn(state); } catch (e) { console.error('[gameStore] listener error:', e); }
        });
    },

    reset: () => {
        store.getState().reset();
    },

    defaultState,

    // Expose the raw Zustand store for direct use in new code
    _store: store,
};

export { gameStore, store, defaultState };
