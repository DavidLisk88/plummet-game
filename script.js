/* ========================================
   PLUMMET - Game Logic
   Vanilla JS core + Preact UI layer.
   Enhanced with: Chance.js, Howler.js, Weighted, Math.js,
   OpenSkill, Trie-Search, Zustand, Loot-Table, Juice effects
   ======================================== */
import { gameStore } from './src/gameStore.js';
import { mountPreactUI } from './src/app.jsx';
import './src/preact.css';
import { WordRunnerGame } from './src/word-runner-game.js';

// ── Enhanced library imports ──
import {
    randomLetter as chanceRandomLetter,
    weightedPick, shuffle as chanceShuffle,
    randInt, randFloat, randBool, pickOne, pickN,
    createGameEngine, destroyGameEngine, getLetterTracker, destroyLetterTracker,
    LETTER_FREQ as CHANCE_LETTER_FREQ, FREQ_TOTAL as CHANCE_FREQ_TOTAL,
} from './src/lib/chance-engine.js';
import { HowlerAudioManager, HowlerMusicPlayer } from './src/lib/howler-audio.js';
import {
    getDifficultyTier, DynamicDifficulty, LootTable,
    createBonusLootTable, createTerrainLootTable,
    getTerrainWeights, DIFFICULTY_TIERS,
} from './src/lib/difficulty-engine.js';
import {
    buildTrie, checkPrefix, getCompletions, getSwipeHint,
    selectWords as wsSelectWords, generateGrid as wsGenerateGrid,
    validateSelection as wsValidateSelection, wordDifficulty as wsWordDifficulty,
} from './src/lib/wordsearch-engine.js';
import {
    calculateWordScore, calculateWSWordScore, calculateXP, calculateCoins,
    computeEnhancedSkillRating, processGameResults, createRating,
    math as mathjs,
} from './src/lib/scoring-engine.js';
import {
    ScreenShake, scorePop, flashEffect, wordCelebration, failureEffect,
} from './src/lib/juice-effects.js';
import {
    screenTransition, scorePopup as gsapScorePopup, chainBannerEntrance, chainBannerExit,
    letterAssemble, wordPopupExit, bonusUnlockSequence,
    particleBurst, wordCelebrationGSAP, failureFlash, levelUpCelebration,
    addButtonJuice, juiceAllButtons, challengeGridEntrance, gsapShake,
    confettiRain, numberRoll, gameoverStatsReveal, freezeIndicatorPulse,
    challengePreviewOverlay, killAnimations as gsapKillAnimations, gsap,
} from './src/lib/gsap-engine.js';
import {
    createProceduralSkeleton, buildHumanoidAnimations,
    createSkeleton as spineCreateSkeleton, createAnimationState as spineCreateAnimState,
    createChallengePreviewCharacter, createTutorialAnimation,
    SpineCanvasRenderer, spine as spineCore,
} from './src/lib/spine-engine.js';
import {
    initPhysicsWorld, updatePhysics, spawnDebris, spawnExplosion,
    spawnConfettiPhysics, spawnDustImplosion, spawnFallingLetter,
    spawnImpactRing, clearAllBodies, destroyPhysicsWorld,
} from './src/lib/matter-physics.js';
import {
    initPixiOverlay, isPixiReady, resizePixiOverlay,
    pixiConfettiBurst, pixiDustBurst, pixiSparkleBurst,
    pixiFloatingLetters, pixiStarBurst, clearPixiParticles, destroyPixiOverlay,
} from './src/lib/pixi-particles.js';
import {
    KaboomEase, scheduleTimer, scheduleLoop, cancelAllTimers,
    screenShakeOffset, rectOverlap, circleRectOverlap,
    lerp as kLerp, mapRange, wave, rand, clamp, dist as kDist,
    lerpColor, randomColor, on as kOn, emit as kEmit, destroyKaboomUtils,
} from './src/lib/kaboom-utils.js';
import {
    generateQuickPuzzle, crossValidateGrid, generateThemedPuzzle,
} from './src/lib/wordsearch-gen-adapter.js';
import {
    loadSpineCanvas, loadSpineWebgl, loadSpinePhaser,
    createCanvasRenderer as spineCanvasRenderer2, createWebGLRenderer as spineWebGLRenderer,
    createBestRenderer as spineBestRenderer, getSpinePhaserPlugin,
} from './src/lib/spine-renderers.js';
import { store as zustandStore } from './src/zustand-store.js';

// ────────────────────────────────────────
// DICTIONARY
// Loaded at startup from words.json (bundled, uppercase, 3+ letters).
// ────────────────────────────────────────
let DICTIONARY = new Set();
// Sets used for hint detection: sequences one letter away from a complete word
let HINT_PREFIXES = new Set(); // word.slice(0,-1): add one letter at the END to complete
let HINT_SUFFIXES = new Set(); // word.slice(1):    add one letter at the START to complete

function _buildHintSets() {
    HINT_PREFIXES = new Set();
    HINT_SUFFIXES = new Set();
    for (const word of DICTIONARY) {
        if (word.length >= 4) {
            HINT_PREFIXES.add(word.slice(0, -1));
            HINT_SUFFIXES.add(word.slice(1));
        }
    }
}

// ── Load dictionary from the bundled words.json ──
let WORD_CATEGORIES = {};   // { food: { label, icon, words: Set }, ... }
let ENRICHED_DICT = null;   // { word: { word, definitions, synonyms, partsOfSpeech } }

async function loadDictionary() {
    try {
        const resp = await fetch("./words.json");
        if (!resp.ok) throw new Error(`words.json fetch failed: ${resp.status}`);
        const data = await resp.json();
        // Support both old flat array and new {words, categories} format
        const words = Array.isArray(data) ? data : data.words;

        // Filter out contraction words (words with apostrophes removed, e.g. HES, HED, ITLL, SHES)
        // These are informal contractions that shouldn't appear in word search puzzles
        const CONTRACTION_WORDS = new Set([
            "HES", "HED", "HELL", "SHES", "SHED", "SHELL",
            "THEYD", "THEYLL", "THEYRE", "THEYVE",
            "YOULL", "YOUD", "YOURE", "YOUVE",
            "WEVE", "WERE", "WELL", "WONT",
            "ITLL", "ITS", "ITS", "ITLL",
            "DONT", "DIDNT", "DOESNT", "ISNT", "ARENT", "WASNT", "WERENT",
            "HASNT", "HAVENT", "HADNT", "CANT", "COULDNT", "SHOULDNT", "WOULDNT",
            "MUSTNT", "NEEDNT", "SHANT", "AINT",
            "ILL", "IM", "IVE", "ID",
            "LETS", "HOWS", "WHATS", "WHERES", "WHOS", "WHENS",
            "THATS", "THERES", "HERES",
            "MAAM", "OCLOCK", "OER",
        ]);
        // Only filter words that are SOLELY contraction artifacts (not real standalone words)
        // Keep words like "WELL" (noun/adverb), "WERE" (past tense), "CANT" (verb), "ILL" (adjective), "ITS" (possessive)
        const KEEP_DESPITE_CONTRACTION = new Set([
            "WELL", "WERE", "CANT", "ILL", "ITS", "SHELL", "SHED", "HELL", "WONT", "ID",
        ]);
        const filteredWords = words.filter(w => !CONTRACTION_WORDS.has(w) || KEEP_DESPITE_CONTRACTION.has(w));
        const removedCount = words.length - filteredWords.length;
        DICTIONARY = new Set(filteredWords);
        console.log(`Dictionary ready: ${DICTIONARY.size} valid words (${removedCount} contractions removed)`);
        // Load categories if present
        if (data.categories) {
            for (const [key, cat] of Object.entries(data.categories)) {
                WORD_CATEGORIES[key] = { label: cat.label, icon: cat.icon, words: new Set(cat.words) };
            }
            console.log(`Categories loaded: ${Object.keys(WORD_CATEGORIES).length}`);
        }
    } catch (err) {
        console.error("Failed to load words.json; no words will be valid.", err);
        DICTIONARY = new Set();
    }
    _buildHintSets();
    _buildTargetWordPools();
    // Build trie index for prefix-based word validation and swipe hints
    buildTrie(DICTIONARY);
    console.log(`[Enhanced] Trie index built for word search hints`);
}

async function loadEnrichedDict() {
    try {
        const resp = await fetch("./words-enriched.json");
        if (!resp.ok) throw new Error(`words-enriched.json fetch failed: ${resp.status}`);
        ENRICHED_DICT = await resp.json();
        console.log(`Enriched dictionary loaded: ${Object.keys(ENRICHED_DICT).length} entries`);
    } catch (err) {
        console.warn("Enriched dictionary not available:", err.message);
        ENRICHED_DICT = {};
    }
}

// ────────────────────────────────────────
// LETTER FREQUENCY WEIGHTS
// Tuned for playability: vowels very common, common consonants
// frequent, rare letters (Q, X, Z, J) almost never appear.
// Uses a cooldown system so no letter repeats too soon,
// and a deficit tracker to ensure every letter eventually appears.
// ────────────────────────────────────────
const LETTER_FREQ = {
    A:12, B:3, C:4, D:4, E:14, F:3, G:3, H:3, I:10, J:1,
    K:2,  L:6, M:4, N:7, O:10, P:4, Q:1, R:8, S:8, T:8,
    U:6,  V:2, W:3, X:1, Y:3, Z:1
};
const _FREQ_TOTAL = Object.values(LETTER_FREQ).reduce((a, b) => a + b, 0);
const _letterHistory = [];       // last N letters picked
const _HISTORY_MAX = 14;         // track last 14 letters for cooldown
const _letterCounts = {};        // how many times each letter has been picked
let _totalPicks = 0;

for (const ch of Object.keys(LETTER_FREQ)) _letterCounts[ch] = 0;

// ── Grid-aware helper: find letters that would complete a word ──
// Walks every line on the grid (rows, columns, diagonals) INCLUDING
// empty cells, so it can find words with gaps.  e.g. F-O-_-U-S → "C"
// would complete FOCUS.  Breaks lines at obstacles (bombs, etc.).
// For each sub-segment of length 3-7, if there are 1-2 empty gaps,
// it brute-forces A-Z into those gaps and checks the dictionary
// (both forward and reversed, since the game reads words both ways).
function _findHelpfulLetters(grid) {
    if (!grid) return [];
    const { rows, cols } = grid;
    const dirs = [[0,1],[1,0],[1,1],[1,-1]];
    const counts = {}; // letter → number of word-completions it enables

    // Collect every unique line on the grid for each direction
    const visited = new Set();
    for (const [dr, dc] of dirs) {
        visited.clear();
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                // Walk backward to the start of this line
                let sr = r, sc = c;
                while (grid.inBounds(sr - dr, sc - dc)) { sr -= dr; sc -= dc; }
                const lineKey = `${dr},${dc},${sr},${sc}`;
                if (visited.has(lineKey)) continue;
                visited.add(lineKey);

                // Walk the full line, collecting letters and empty cells.
                // Obstacles (bombs, etc.) split the line into separate segments.
                const segments = [[]];
                let cr = sr, cc = sc;
                while (grid.inBounds(cr, cc)) {
                    const val = grid.get(cr, cc);
                    if (val === null) {
                        // Empty cell — a fillable gap
                        segments[segments.length - 1].push(null);
                    } else if (isWordLetter(val)) {
                        segments[segments.length - 1].push(val);
                    } else {
                        // Obstacle — start a new segment
                        if (segments[segments.length - 1].length > 0) segments.push([]);
                    }
                    cr += dr; cc += dc;
                }

                // Scan each segment for sub-sequences with fillable gaps
                for (const seg of segments) {
                    if (seg.length < 3) continue;
                    for (let start = 0; start < seg.length; start++) {
                        for (let end = start + 3; end <= Math.min(start + 8, seg.length); end++) {
                            const sub = seg.slice(start, end);
                            const gaps = [];
                            let letterCount = 0;
                            for (let i = 0; i < sub.length; i++) {
                                if (sub[i] === null) gaps.push(i);
                                else letterCount++;
                            }
                            // Need at least 2 real letters and 1-2 gaps
                            if (gaps.length === 0 || gaps.length > 2 || letterCount < 2) continue;

                            _fillGapsAndScore(sub, gaps, counts);
                        }
                    }
                }
            }
        }
    }

    // Convert to array sorted by count (most useful letters first)
    const result = [];
    for (const [letter, count] of Object.entries(counts)) {
        result.push({ letter, count });
    }
    result.sort((a, b) => b.count - a.count);
    return result;
}

// Try every A-Z combination in the gap positions, check both forward
// and reversed against the dictionary, and credit the gap-filling letters.
function _fillGapsAndScore(sub, gaps, counts) {
    const arr = [...sub];
    const len = arr.length;
    // For 2-gap segments, limit to length 5 to stay fast (676 combos × dict checks)
    if (gaps.length === 2 && len > 5) return;

    const check = () => {
        let fwd = "";
        for (let k = 0; k < len; k++) fwd += arr[k];
        if (DICTIONARY.has(fwd)) {
            for (const gi of gaps) counts[arr[gi]] = (counts[arr[gi]] || 0) + 1;
        }
        let rev = "";
        for (let k = len - 1; k >= 0; k--) rev += arr[k];
        if (rev !== fwd && DICTIONARY.has(rev)) {
            for (const gi of gaps) {
                const ch = arr[len - 1 - gi];
                counts[ch] = (counts[ch] || 0) + 1;
            }
        }
    };

    if (gaps.length === 1) {
        const gi = gaps[0];
        for (let i = 0; i < 26; i++) {
            arr[gi] = String.fromCharCode(65 + i);
            check();
        }
    } else {
        const [g1, g2] = gaps;
        for (let i = 0; i < 26; i++) {
            arr[g1] = String.fromCharCode(65 + i);
            for (let j = 0; j < 26; j++) {
                arr[g2] = String.fromCharCode(65 + j);
                check();
            }
        }
    }
}

function randomLetter(grid, targetWord) {
    // Delegates to Chance.js-powered engine (same algorithm, better entropy + seeded support).
    // Passes _findHelpfulLetters so the engine can do grid-aware letter selection.
    return chanceRandomLetter({
        grid: grid || undefined,
        targetWord: targetWord || undefined,
        findHelpfulLetters: _findHelpfulLetters,
    });
}

const WILDCARD_SYMBOL = "★";

// Letter difficulty values — harder letters earn bonus points per letter in a word
// Based on inverse frequency / Scrabble-style difficulty
const LETTER_VALUES = {
    A:1, B:3, C:3, D:2, E:1, F:4, G:2, H:4, I:1, J:8,
    K:5, L:1, M:3, N:1, O:1, P:3, Q:10, R:1, S:1, T:1,
    U:1, V:4, W:4, X:8, Y:4, Z:10
};

function isWordLetter(value) {
    return typeof value === "string" && (/^[A-Z]$/.test(value) || value === WILDCARD_SYMBOL);
}

// Resolve wildcard characters (★) in a word string.
// If no wildcards, returns [word]. If wildcards, tries all 26 replacements.
// Only handles up to 2 wildcards to keep performance reasonable.
function _resolveWildcards(word) {
    const idx = word.indexOf(WILDCARD_SYMBOL);
    if (idx === -1) return [word];
    const results = [];
    for (let i = 0; i < 26; i++) {
        const letter = String.fromCharCode(65 + i);
        const replaced = word.substring(0, idx) + letter + word.substring(idx + 1);
        const sub = _resolveWildcards(replaced);
        for (const s of sub) results.push(s);
    }
    return results;
}

const BONUS_TYPES = Object.freeze({
    LETTER_PICK: "letter-pick",
    BOMB: "bomb",
    WILDCARD: "wildcard",
    ROW_CLEAR: "row-clear",
    FREEZE: "freeze",
    SHUFFLE: "shuffle",
    SCORE_2X: "score-2x",
});

const GAME_MODES = Object.freeze({
    SANDBOX: "sandbox",
    TIMED: "timed",
});

const SANDBOX_SCORE_MULT = 0.25; // Sandbox earns 25% of normal points
const SANDBOX_XP_MULT   = 0.75; // Sandbox XP is moderated (score already reduced)

const CHALLENGE_TYPES = Object.freeze({
    TARGET_WORD: "target-word",
    SPEED_ROUND: "speed-round",
    WORD_CATEGORY: "word-category",
    WORD_SEARCH: "word-search",
    WORD_RUNNER: "word-runner",
});

// ─── Username validation ───────────────────────────────────────────
const MAX_PROFILES_PER_ACCOUNT = 3;
const USERNAME_MAX_LENGTH = 20;
const USERNAME_REGEX = /^[A-Za-z0-9_]+$/;
const BANNED_USERNAMES = new Set([
    'FAGGOT','VAGINA','RETARD','RETARDED','BITCH','FUCK','FUCKER','HITLER','NAZI',
    'NIGGER','NIGGA','MIDGET','WHORE','CUM','PENIS','BITCHES','HOES','HOE','JIZZ',
    'WEEWEE','DICK','DICKS','PENISES','WHORES','SLUTTY','PUSSY','PUSSIES','KIKE',
    'SHIT','SHITTER','SHITTY','SLUT','CUNT','CUNTS','ARSE','ARSES','WANKER','TWAT',
    'BOLLOCKS','COCKSUCKER','MOTHERFUCKER','ASSHOLE','ASS','DAMN','BASTARD','PISS',
    'CRAP','TITS','BOOBS','HOOKER','PIMP','DILDO','ORGASM','ANAL','RAPE','RAPED',
    'RAPING','RAPIST','MOLEST','PEDOPHILE','INCEST','FAG','FAGS','DYKE','HOMO',
    'QUEER','LESBO','PERVERT','PEDO','NEGRO','SPIC','CHINK','GOOK','WETBACK',
    'BEANER','COON','DARKIE','HONKY','GRINGO','JAP','TRANNY','HEIL','SLITS',
    'FUCKED','FUCKING','FUCKS','SHITS','SHITTING','BITCHING','CUNTING','RAPES',
    'PISSED','PISSING','ASSES','SLUTS','WHORED','WHORING','SEX','SEXY','PORN',
    'PORNHUB','XXX','EROTIC','FETISH','HENTAI','NUDE','NAKED',
]);

/**
 * Validate a username. Returns null if valid, or an error message string.
 */
function validateUsername(name) {
    if (!name || name.length === 0) return 'Username cannot be empty';
    if (name.length > USERNAME_MAX_LENGTH) return `Max ${USERNAME_MAX_LENGTH} characters`;
    if (!USERNAME_REGEX.test(name)) return 'Letters, numbers, and underscores only';
    // Check if the name contains any banned word as a substring
    const upper = name.toUpperCase();
    for (const bad of BANNED_USERNAMES) {
        if (upper.includes(bad)) return 'That name is not allowed';
    }
    return null;
}

const CHALLENGE_META = Object.freeze({
    [CHALLENGE_TYPES.TARGET_WORD]: {
        title: "Target Word",
        description: "Spell target words to level up! Words get harder as you progress through hundreds of levels.",
        icon: "◎",
    },
    [CHALLENGE_TYPES.SPEED_ROUND]: {
        title: "Speed Round",
        description: "Blocks fall faster and faster as your score climbs. How long can you survive?",
        icon: "▲",
    },
    [CHALLENGE_TYPES.WORD_CATEGORY]: {
        title: "Word Category",
        description: "Choose a category and find matching words for bonus points! Harder categories earn more.",
        icon: "▦",
    },
    [CHALLENGE_TYPES.WORD_SEARCH]: {
        title: "Word Search",
        description: "Find hidden words in the grid! No word list — discover them yourself. Levels get harder and harder!",
        icon: "🔍",
    },
    [CHALLENGE_TYPES.WORD_RUNNER]: {
        title: "Word Runner",
        description: "Run, jump & collect letters to build words! Dodge rocks, leap across platforms, and form words to score.",
        icon: "🏃",
    },
});

// ── Target Word Level Progression System ──
// Letter difficulty scores (higher = rarer/harder)
const LETTER_DIFFICULTY = {
    E:1,A:1,I:1,O:1,N:1,R:1,T:1,S:1,L:2,C:2,U:2,D:2,P:2,M:2,H:2,
    G:3,B:3,F:3,Y:3,W:3,K:4,V:4,X:5,Z:5,J:5,Q:6
};

function _wordDifficulty(word) {
    let score = 0;
    for (const ch of word) score += (LETTER_DIFFICULTY[ch] || 3);
    // Normalize by length to get per-letter difficulty, then weight by length
    return (score / word.length) + (word.length - 3) * 0.6;
}

// Pre-sorted word pools built after dictionary loads
let _targetWordPools = null;

function _buildTargetWordPools() {
    if (_targetWordPools) return;
    const candidates = [];
    for (const word of DICTIONARY) {
        if (word.length >= 3 && word.length <= 7) {
            candidates.push({ word, diff: _wordDifficulty(word), len: word.length });
        }
    }
    candidates.sort((a, b) => a.diff - b.diff || a.len - b.len);
    _targetWordPools = candidates;
}

// Given a level (1-based), return the range of the sorted pool to pick from
function _targetLevelBand(level) {
    if (!_targetWordPools || _targetWordPools.length === 0) return { start: 0, end: 0 };
    const total = _targetWordPools.length;

    // Very slow ramp: each level advances the difficulty window by a small fraction
    // Levels 1-20: easiest 5% of words (short common words)
    // Levels 21-60: 5-15%
    // Levels 61-120: 15-35%
    // Levels 121-200: 35-55%
    // Levels 201-350: 55-80%
    // Levels 351-500: 80-100%
    // Beyond 500: top 20% (hardest)

    let startPct, endPct;
    if (level <= 20) {
        const t = (level - 1) / 19;
        startPct = 0; endPct = 0.03 + t * 0.04; // 3% to 7%
    } else if (level <= 60) {
        const t = (level - 21) / 39;
        startPct = 0.02 + t * 0.05; endPct = 0.07 + t * 0.10; // window slides up
    } else if (level <= 120) {
        const t = (level - 61) / 59;
        startPct = 0.10 + t * 0.10; endPct = 0.20 + t * 0.18;
    } else if (level <= 200) {
        const t = (level - 121) / 79;
        startPct = 0.22 + t * 0.15; endPct = 0.38 + t * 0.20;
    } else if (level <= 350) {
        const t = (level - 201) / 149;
        startPct = 0.40 + t * 0.18; endPct = 0.60 + t * 0.22;
    } else if (level <= 500) {
        const t = (level - 351) / 149;
        startPct = 0.60 + t * 0.15; endPct = 0.80 + t * 0.20;
    } else {
        startPct = 0.80; endPct = 1.0;
    }

    return {
        start: Math.floor(total * Math.min(startPct, 0.95)),
        end: Math.max(Math.floor(total * Math.min(endPct, 1.0)), Math.floor(total * Math.min(startPct, 0.95)) + 5)
    };
}

// ────────────────────────────────────────
// WORD SEARCH ENGINE
// ────────────────────────────────────────
const WORD_SEARCH_TIME_LIMIT = 7 * 60; // 7 minutes per level

// Directions: right, down, down-right, down-left, left, up, up-left, up-right
const WS_DIRECTIONS = [
    [0, 1], [1, 0], [1, 1], [1, -1],
    [0, -1], [-1, 0], [-1, -1], [-1, 1],
];

/**
 * Get Word Search level parameters based on level number.
 * Very slow difficulty progression over thousands of levels.
 */
function _wsLevelParams(level) {
    let gridSize, minWords, maxWords, minWordLen, maxWordLen, allowedDirs;

    // Word count always stays between 2-6
    if (level <= 10) {
        // Beginner: tiny grid, 3-4 letter words, all 8 directions
        gridSize = 8;
        minWords = 3; maxWords = 4;
        minWordLen = 3; maxWordLen = 4;
        allowedDirs = WS_DIRECTIONS;
    } else if (level <= 25) {
        // Easing in: still small, introduce 4-letter words
        gridSize = 8;
        minWords = 3; maxWords = 5;
        minWordLen = 3; maxWordLen = 4;
        allowedDirs = WS_DIRECTIONS;
    } else if (level <= 50) {
        // Comfortable: more words
        gridSize = 8;
        minWords = 4; maxWords = 5;
        minWordLen = 3; maxWordLen = 4;
        allowedDirs = WS_DIRECTIONS;
    } else if (level <= 80) {
        // Slightly bigger grid, still easy words
        gridSize = 9;
        minWords = 4; maxWords = 6;
        minWordLen = 3; maxWordLen = 4;
        allowedDirs = WS_DIRECTIONS;
    } else if (level <= 120) {
        // Introduce 5-letter words
        gridSize = 9;
        minWords = 4; maxWords = 6;
        minWordLen = 3; maxWordLen = 5;
        allowedDirs = WS_DIRECTIONS;
    } else if (level <= 180) {
        gridSize = 10;
        minWords = 5; maxWords = 6;
        minWordLen = 3; maxWordLen = 5;
        allowedDirs = WS_DIRECTIONS;
    } else if (level <= 260) {
        gridSize = 10;
        minWords = 5; maxWords = 6;
        minWordLen = 3; maxWordLen = 5;
        allowedDirs = WS_DIRECTIONS;
    } else if (level <= 380) {
        // Introduce 6-letter words
        gridSize = 11;
        minWords = 5; maxWords = 6;
        minWordLen = 4; maxWordLen = 6;
        allowedDirs = WS_DIRECTIONS;
    } else if (level <= 550) {
        gridSize = 12;
        minWords = 5; maxWords = 6;
        minWordLen = 4; maxWordLen = 6;
        allowedDirs = WS_DIRECTIONS;
    } else if (level <= 800) {
        // Introduce 7-letter words
        gridSize = 13;
        minWords = 5; maxWords = 6;
        minWordLen = 4; maxWordLen = 7;
        allowedDirs = WS_DIRECTIONS;
    } else {
        // Level 801+: gradual scaling (grid only, words stay at 6 max)
        gridSize = Math.min(16, 13 + Math.floor((level - 800) / 500));
        minWords = 5; maxWords = 6;
        minWordLen = 5; maxWordLen = 7;
        allowedDirs = WS_DIRECTIONS;
    }

    // Ultra-slow difficulty ramp for word selection within each tier
    // Level 1 → 0%, Level 100 → ~6%, Level 500 → ~22%, Level 2000 → ~63%
    const difficultyPct = Math.min(1.0, Math.sqrt(level / 5000));

    return { gridSize, minWords, maxWords, minWordLen, maxWordLen, allowedDirs, difficultyPct };
}

/**
 * Rolling word history to prevent word repetition across word search levels.
 * Stores last N words per profile in localStorage.
 */
const WS_WORD_HISTORY_KEY = 'plummet_ws_word_history';
const WS_WORD_HISTORY_MAX = 2000; // ~200 levels at ~10 words/level

function _wsGetWordHistory() {
    try {
        const raw = localStorage.getItem(WS_WORD_HISTORY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

function _wsAddToWordHistory(words) {
    try {
        let history = _wsGetWordHistory();
        history.push(...words);
        // Keep only last N entries
        if (history.length > WS_WORD_HISTORY_MAX) {
            history = history.slice(history.length - WS_WORD_HISTORY_MAX);
        }
        localStorage.setItem(WS_WORD_HISTORY_KEY, JSON.stringify(history));
    } catch { /* localStorage full or unavailable */ }
}

/**
 * Select words for a word search level from the dictionary.
 * Returns array of uppercase words, sorted by length (shortest first).
 * Avoids words used in the last 200 levels via rolling history.
 */
function _wsSelectWords(params) {
    const { minWords, maxWords, minWordLen, maxWordLen, difficultyPct } = params;
    const count = minWords + Math.floor(Math.random() * (maxWords - minWords + 1));

    // Load recently used words to penalize/avoid them
    const recentWords = new Set(_wsGetWordHistory());

    // Build candidate pool from dictionary filtered by length
    const candidates = [];
    for (const word of DICTIONARY) {
        if (word.length >= minWordLen && word.length <= maxWordLen) {
            candidates.push(word);
        }
    }
    if (candidates.length === 0) return [];

    // Sort by difficulty, then pick from appropriate difficulty window
    candidates.sort((a, b) => _wordDifficulty(a) - _wordDifficulty(b));
    const total = candidates.length;
    // Tight window at low difficulty, gradually widens
    // At difficultyPct=0: window 0-10%  (easiest words only)
    // At difficultyPct=0.2: window 5-30%
    // At difficultyPct=0.5: window 25-65%
    // At difficultyPct=1.0: window 70-100%
    const halfWidth = 0.1 + difficultyPct * 0.2; // 0.1 → 0.3
    const center = difficultyPct * 0.85 + 0.05; // 0.05 → 0.9
    const windowStart = Math.floor(total * Math.max(0, center - halfWidth));
    const windowEnd = Math.min(total, Math.floor(total * Math.min(1, center + halfWidth)));
    const pool = candidates.slice(windowStart, Math.max(windowEnd, windowStart + 20));

    // Helper: check if two words are related (substring, plural, etc.)
    // Returns true if they should NOT appear together in the same puzzle
    const areWordsRelated = (w1, w2) => {
        if (w1 === w2) return true;
        // Substring check (covers most S/ES plurals)
        if (w1.includes(w2) || w2.includes(w1)) return true;
        // Check for Y→IES plural (PARTY→PARTIES)
        if (w1.endsWith('IES') && w2.endsWith('Y') && w1.slice(0, -3) === w2.slice(0, -1)) return true;
        if (w2.endsWith('IES') && w1.endsWith('Y') && w2.slice(0, -3) === w1.slice(0, -1)) return true;
        // Check for common verb forms (RUN→RUNS, RUNNING)
        const shorter = w1.length < w2.length ? w1 : w2;
        const longer = w1.length < w2.length ? w2 : w1;
        // ING forms: RUN→RUNNING, MAKE→MAKING
        if (longer.endsWith('ING') && (longer.startsWith(shorter) || longer.slice(0, -3) === shorter || longer.slice(0, -4) === shorter)) return true;
        // ED forms: WALK→WALKED, MOVE→MOVED
        if (longer.endsWith('ED') && (longer.startsWith(shorter) || longer.slice(0, -2) === shorter || longer.slice(0, -3) === shorter)) return true;
        // ER/EST comparatives: FAST→FASTER→FASTEST
        if ((longer.endsWith('ER') || longer.endsWith('EST')) && longer.startsWith(shorter)) return true;
        return false;
    };

    // Pick random unique words, strongly avoiding recently used words and related forms
    const selected = new Set();
    const result = [];
    let attempts = 0;
    // First pass: try to pick words NOT in recent history and not related to selected words
    while (result.length < count && attempts < count * 50) {
        const word = pool[Math.floor(Math.random() * pool.length)];
        attempts++;
        if (selected.has(word)) continue;
        if (recentWords.has(word)) continue; // Skip recently used
        // Check if this word is related to any already-selected word
        const hasRelated = result.some(existing => areWordsRelated(word, existing));
        if (hasRelated) continue;
        selected.add(word);
        result.push(word);
    }
    // Fallback: if we couldn't fill from non-recent pool, allow recent words (but still avoid related)
    // Shuffle the pool first to avoid always picking the same recent words
    if (result.length < count) {
        const remaining = pool.filter(w => !selected.has(w));
        for (let i = remaining.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
        }
        for (const word of remaining) {
            if (result.length >= count) break;
            const hasRelated = result.some(existing => areWordsRelated(word, existing));
            if (hasRelated) continue;
            selected.add(word);
            result.push(word);
        }
    }

    // Eagerly add selected words to history BEFORE grid generation
    // so the next level won't re-select the same words
    _wsAddToWordHistory(result);

    // Filter overlapping same-line words (e.g. TOE and TOER on same cells)
    // Remove shorter words that are strict prefixes/suffixes of longer words in the list
    const filtered = [];
    const sortedByLen = [...result].sort((a, b) => b.length - a.length);
    for (const word of sortedByLen) {
        const isSubsetOfExisting = filtered.some(longer =>
            longer.includes(word) && longer !== word
        );
        if (!isSubsetOfExisting) {
            filtered.push(word);
        }
    }

    filtered.sort((a, b) => a.length - b.length);
    return filtered;
}

/**
 * Generate a word search grid with smart fill that avoids accidental words.
 * 1. Place all requested words on the grid
 * 2. Fill empty cells with letters that DON'T form new dictionary words
 * 3. If a cell can't avoid all words, pick the least-conflicting letter
 * Returns { grid: string[][], placedWords: [{word, cells: [{r,c}], dir}] }
 */
function _wsGenerateGrid(size, words, allowedDirs) {
    const grid = Array.from({ length: size }, () => Array(size).fill(null));
    const placedWords = [];

    // Sort words longest first for best placement chance
    const sorted = [...words].sort((a, b) => b.length - a.length);

    for (const word of sorted) {
        let placed = false;
        // Try up to 300 random placements
        for (let attempt = 0; attempt < 300 && !placed; attempt++) {
            const dir = allowedDirs[Math.floor(Math.random() * allowedDirs.length)];
            const [dr, dc] = dir;

            // Calculate valid start range
            let startR, startC, endR, endC;
            if (dr > 0) { startR = 0; endR = size - word.length; }
            else if (dr < 0) { startR = word.length - 1; endR = size - 1; }
            else { startR = 0; endR = size - 1; }

            if (dc > 0) { startC = 0; endC = size - word.length; }
            else if (dc < 0) { startC = word.length - 1; endC = size - 1; }
            else { startC = 0; endC = size - 1; }

            if (startR > endR || startC > endC) continue;

            const r = startR + Math.floor(Math.random() * (endR - startR + 1));
            const c = startC + Math.floor(Math.random() * (endC - startC + 1));

            // Check if word fits without conflicts
            let fits = true;
            const cells = [];
            for (let i = 0; i < word.length; i++) {
                const nr = r + dr * i;
                const nc = c + dc * i;
                if (nr < 0 || nr >= size || nc < 0 || nc >= size) { fits = false; break; }
                const existing = grid[nr][nc];
                if (existing !== null && existing !== word[i]) { fits = false; break; }
                cells.push({ r: nr, c: nc });
            }
            if (!fits) continue;

            // Place word
            for (let i = 0; i < word.length; i++) {
                grid[cells[i].r][cells[i].c] = word[i];
            }
            placedWords.push({ word, cells, dir });
            placed = true;
        }
        if (!placed) {
            console.warn(`[WS] Failed to place word "${word}" after 300 attempts`);
        }
    }

    // ── Smart fill: avoid creating accidental dictionary words ──

    // Verify all placed words are actually readable on the grid
    for (const pw of placedWords) {
        let readBack = "";
        for (const { r, c } of pw.cells) readBack += grid[r][c];
        if (readBack !== pw.word) {
            console.error(`[WS] PLACEMENT ERROR: "${pw.word}" reads as "${readBack}"!`);
        }
    }
    console.log(`[WS] Placed ${placedWords.length} words:`, placedWords.map(pw => pw.word).join(", "));

    // Collect empty cells and shuffle for random fill order
    const emptyCells = [];
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (grid[r][c] === null) emptyCells.push({ r, c });
        }
    }
    // Shuffle
    for (let i = emptyCells.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [emptyCells[i], emptyCells[j]] = [emptyCells[j], emptyCells[i]];
    }

    // All 8 directions for checking (we check all, not just allowedDirs,
    // to prevent accidental words in ANY direction)
    const allDirs = WS_DIRECTIONS;

    for (const { r, c } of emptyCells) {
        // Try 26 letters in random order, pick the one that creates fewest new words
        const letters = [];
        for (let i = 0; i < 26; i++) letters.push(String.fromCharCode(65 + i));
        // Shuffle letters
        for (let i = 25; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [letters[i], letters[j]] = [letters[j], letters[i]];
        }

        let bestLetter = letters[0];
        let bestConflicts = Infinity;

        for (const letter of letters) {
            grid[r][c] = letter;
            let conflicts = 0;

            // Check every direction from this cell — does placing this letter
            // complete any 3-7 letter word that passes through (r,c)?
            for (const [dr, dc] of allDirs) {
                // Check strings of length 3-7 that include cell (r,c)
                for (let len = 3; len <= 7; len++) {
                    // The word could start at offset 0..(len-1) before (r,c)
                    for (let offset = 0; offset < len; offset++) {
                        const sr = r - dr * offset;
                        const sc = c - dc * offset;
                        const er = sr + dr * (len - 1);
                        const ec = sc + dc * (len - 1);
                        if (sr < 0 || sr >= size || sc < 0 || sc >= size) continue;
                        if (er < 0 || er >= size || ec < 0 || ec >= size) continue;
                        // Build the word
                        let w = "";
                        let hasNull = false;
                        for (let i = 0; i < len; i++) {
                            const ch = grid[sr + dr * i][sc + dc * i];
                            if (ch === null) { hasNull = true; break; }
                            w += ch;
                        }
                        if (hasNull) continue;
                        // Check if this is a placed word (don't count those as conflicts)
                        if (DICTIONARY.has(w)) {
                            const isPlaced = placedWords.some(pw => pw.word === w);
                            if (!isPlaced) conflicts++;
                        }
                    }
                }
            }

            if (conflicts === 0) {
                bestLetter = letter;
                bestConflicts = 0;
                break; // Perfect — no accidental words
            }
            if (conflicts < bestConflicts) {
                bestConflicts = conflicts;
                bestLetter = letter;
            }
        }

        grid[r][c] = bestLetter;
    }

    return { grid, placedWords };
}

/**
 * Validate that a sequence of cells forms a valid dictionary word in the word search.
 * Cells must be in a straight line (any of 8 directions).
 */
function _wsValidateSelection(grid, cells, allValidWords, minWordLength) {
    if (!cells || cells.length < (minWordLength || 3)) return null;

    // Check cells form a straight line
    if (cells.length > 1) {
        const dr = Math.sign(cells[1].r - cells[0].r);
        const dc = Math.sign(cells[1].c - cells[0].c);
        for (let i = 2; i < cells.length; i++) {
            const eDr = Math.sign(cells[i].r - cells[i - 1].r);
            const eDc = Math.sign(cells[i].c - cells[i - 1].c);
            if (eDr !== dr || eDc !== dc) return null; // Not a straight line
        }
        // Check cells are consecutive steps
        for (let i = 1; i < cells.length; i++) {
            if (Math.abs(cells[i].r - cells[i - 1].r) > 1 ||
                Math.abs(cells[i].c - cells[i - 1].c) > 1) return null;
        }
    }

    // Build word from cells
    let word = "";
    for (const { r, c } of cells) {
        word += grid[r][c];
    }

    // Only accept words that are on the board's valid word list (placed + scanned accidentals)
    if (allValidWords && allValidWords.has(word)) return word;
    return null;
}

/**
 * Word Search scoring for individual words found.
 * Longer words and rarer letters earn more points.
 */
function _wsScoreWord(word, level) {
    // Use same scoring formula as the main game
    let pts = word.length * 10 * word.length;

    // Word complexity bonus: longer words get progressively more
    // 3-letter base, 4→+15%, 5→+35%, 6→+60%, 7→+90%, 8+→+125%
    const len = word.length;
    if (len >= 4) {
        const complexityMult = 1 + 0.15 * Math.pow(len - 3, 1.4);
        pts = Math.floor(pts * complexityMult);
    }

    // Tough letter bonus: sum letter difficulty values for all letters
    // Only letters worth >1 contribute bonus (common letters don't add extra)
    let letterBonus = 0;
    for (const ch of word) {
        const val = LETTER_VALUES[ch] || 1;
        if (val > 1) letterBonus += val * 3;
    }
    pts += letterBonus;

    // Gentle level scaling
    const levelMult = 1 + Math.log10(Math.max(1, level)) * 0.15;
    return Math.floor(pts * levelMult);
}

/**
 * Coins earned per word found in word search.
 * WS has no combos, multipliers, or bonuses — so per-word coin rate
 * is significantly boosted to keep earnings comparable to the main game.
 */
function _wsWordCoins(word) {
    const len = word.length;
    // Generous base: scales steeply with word length
    // 3→5, 4→10, 5→18, 6→28, 7→40
    const base = Math.floor(len * len - len + 2);
    // Tough letter bonus: rare letters earn extra coins
    let letterBonus = 0;
    for (const ch of word) {
        const val = LETTER_VALUES[ch] || 1;
        if (val >= 4) letterBonus += 2;   // H,F,W,V,Y = +2 each
        if (val >= 8) letterBonus += 3;   // J,X = +5 total each
        if (val >= 10) letterBonus += 5;  // Q,Z = +10 total each
    }
    return base + letterBonus;
}

const CHALLENGE_GRID_SIZES = [6, 7, 8];
const CHALLENGE_TIME_LIMIT = 7 * 60; // 7 minutes

// Category difficulty tiers — higher tier = harder words = more reward
// ptsMult applies to bonus-match scoring, xpMult applies to section 7 XP bonus
const CATEGORY_TIERS = Object.freeze({
    adjectives: { tier: 1, ptsMult: 1.0,  xpMult: 1.0,  label: "" },
    animals:    { tier: 1, ptsMult: 1.0,  xpMult: 1.0,  label: "" },
    sports:     { tier: 1, ptsMult: 1.0,  xpMult: 1.0,  label: "" },
    home:       { tier: 1, ptsMult: 1.0,  xpMult: 1.0,  label: "" },
    clothing:   { tier: 1, ptsMult: 1.0,  xpMult: 1.0,  label: "" },
    food:       { tier: 2, ptsMult: 1.35, xpMult: 1.3,  label: "" },
    body:       { tier: 2, ptsMult: 1.35, xpMult: 1.3,  label: "" },
    music:      { tier: 2, ptsMult: 1.35, xpMult: 1.3,  label: "" },
    nature:     { tier: 3, ptsMult: 1.7,  xpMult: 1.6,  label: "" },
    technology: { tier: 3, ptsMult: 1.7,  xpMult: 1.6,  label: "" },
    science:    { tier: 3, ptsMult: 1.7,  xpMult: 1.6,  label: "" },
});

const TIMED_MODE_OPTIONS_MINUTES = [1, 3, 5, 10];

const BONUS_TYPE_POOL = [
    BONUS_TYPES.LETTER_PICK,
    BONUS_TYPES.BOMB,
    BONUS_TYPES.WILDCARD,
    BONUS_TYPES.ROW_CLEAR,
    BONUS_TYPES.FREEZE,
    BONUS_TYPES.SHUFFLE,
    BONUS_TYPES.SCORE_2X,
];

const BOMB_SYMBOL = "💣";
const BONUS_UNLOCK_SCORE_INTERVAL = 1000;
const FREEZE_DURATION = 10; // seconds
const STANDARD_CLEAR_FLASH_DURATION = 1.2;
const BOMB_CLEAR_FLASH_DURATION = 1.8;

// ── Combo / Streak constants (Preact-driven) ──
const COMBO_WINDOW_SECONDS = 8;       // time window to keep combo alive between words
const COMBO_MULTIPLIER_STEP = 0.2;    // each combo step adds 0.2× multiplier
const COMBO_MAX_MULTIPLIER = 3.0;     // cap at 3×

// ── Difficulty Progression constants ──
const DIFFICULTY_WORDS_PER_LEVEL = 5;  // words found to increase difficulty
const DIFFICULTY_SPEED_STEP = 0.08;    // fall speed decrease per difficulty level
const DIFFICULTY_MAX_LEVEL = 10;

// ────────────────────────────────────────
// COIN / CURRENCY SYSTEM
// ────────────────────────────────────────

// ── Coin earning rates (rebalanced — lower payouts for sustainable economy) ──
const COIN_PER_WORD_LENGTH = { 3: 0, 4: 1, 5: 2, 6: 3, 7: 4 }; // 7+ = 4 (was: 3:1, 4:2, 5:4, 6:5, 7:7)
const COIN_COMBO_BONUS = 1;             // +1 per combo tier active (was 2)
const COIN_GAME_COMPLETE_BASE = 8;      // minimum per game (was 15)
const COIN_GAME_COMPLETE_PER_500 = 5;   // +5 per 500 pts (was 10, up to 25 max)
const COIN_HIGH_SCORE_BEATEN = 15;      // personal best in any mode (was 30)
const COIN_LEVEL_UP_BASE = 12;          // base coins per level-up (was 25)
const COIN_LEVEL_UP_PER_LEVEL = 2;      // + level × 2 (was 3)
const COIN_DAILY_FIRST_GAME = 10;       // first game of the day (was 20)
const COIN_CHALLENGE_COMPLETE_BASE = 15; // base challenge reward (was 30)
const COIN_CHALLENGE_TIER_MULT = 8;     // +8 per tier above 1 (was 15)
const COIN_STREAK_PER_DAY = 3;          // 3 × consecutive days (was 5)
const COIN_STREAK_MAX = 30;             // cap on streak bonus (was 50)

// ── Milestone achievements (one-time coin payouts) ──
// Categories: words, totalWords, games, level, score, streak, xp, coins,
//             shop, challenges, targetWord, speedRound, wordCategory,
//             wordSearch, wordRunner, grid, meta
const MILESTONES = [
    // ─── UNIQUE WORDS (12) ───
    { id: "words_10",       cat: "words",    label: "First Finds",         desc: "Find 10 unique words",           check: p => (p.uniqueWordsFound || []).length >= 10,     coins: 5 },
    { id: "words_25",       cat: "words",    label: "Word Curious",        desc: "Find 25 unique words",           check: p => (p.uniqueWordsFound || []).length >= 25,     coins: 8 },
    { id: "words_50",       cat: "words",    label: "Wordsmith",           desc: "Find 50 unique words",           check: p => (p.uniqueWordsFound || []).length >= 50,     coins: 15 },
    { id: "words_100",      cat: "words",    label: "Century Club",        desc: "Find 100 unique words",          check: p => (p.uniqueWordsFound || []).length >= 100,    coins: 25 },
    { id: "words_200",      cat: "words",    label: "Lexicon Builder",     desc: "Find 200 unique words",          check: p => (p.uniqueWordsFound || []).length >= 200,    coins: 40 },
    { id: "words_300",      cat: "words",    label: "Word Collector",      desc: "Find 300 unique words",          check: p => (p.uniqueWordsFound || []).length >= 300,    coins: 50 },
    { id: "words_500",      cat: "words",    label: "Dictionary Diver",    desc: "Find 500 unique words",          check: p => (p.uniqueWordsFound || []).length >= 500,    coins: 60 },
    { id: "words_750",      cat: "words",    label: "Vocabulary Vault",    desc: "Find 750 unique words",          check: p => (p.uniqueWordsFound || []).length >= 750,    coins: 75 },
    { id: "words_1000",     cat: "words",    label: "Word Hoarder",        desc: "Find 1,000 unique words",        check: p => (p.uniqueWordsFound || []).length >= 1000,   coins: 100 },
    { id: "words_2000",     cat: "words",    label: "Lexicographer",       desc: "Find 2,000 unique words",        check: p => (p.uniqueWordsFound || []).length >= 2000,   coins: 150 },
    { id: "words_5000",     cat: "words",    label: "Walking Dictionary",  desc: "Find 5,000 unique words",        check: p => (p.uniqueWordsFound || []).length >= 5000,   coins: 250 },
    { id: "words_10000",    cat: "words",    label: "Word Sovereign",      desc: "Find 10,000 unique words",       check: p => (p.uniqueWordsFound || []).length >= 10000,  coins: 500 },

    // ─── TOTAL WORDS FOUND (10) ───
    { id: "tw_50",          cat: "totalWords", label: "Getting Wordy",      desc: "Find 50 total words",           check: p => p.totalWords >= 50,       coins: 5 },
    { id: "tw_100",         cat: "totalWords", label: "Word Tally",         desc: "Find 100 total words",          check: p => p.totalWords >= 100,      coins: 8 },
    { id: "tw_250",         cat: "totalWords", label: "Word Counter",       desc: "Find 250 total words",          check: p => p.totalWords >= 250,      coins: 15 },
    { id: "tw_500",         cat: "totalWords", label: "Half Grand",         desc: "Find 500 total words",          check: p => p.totalWords >= 500,      coins: 25 },
    { id: "tw_1000",        cat: "totalWords", label: "Word Thousand",      desc: "Find 1,000 total words",        check: p => p.totalWords >= 1000,     coins: 40 },
    { id: "tw_2500",        cat: "totalWords", label: "Word Machine",       desc: "Find 2,500 total words",        check: p => p.totalWords >= 2500,     coins: 60 },
    { id: "tw_5000",        cat: "totalWords", label: "Word Factory",       desc: "Find 5,000 total words",        check: p => p.totalWords >= 5000,     coins: 80 },
    { id: "tw_10000",       cat: "totalWords", label: "Ten Thousand",       desc: "Find 10,000 total words",       check: p => p.totalWords >= 10000,    coins: 120 },
    { id: "tw_25000",       cat: "totalWords", label: "Word Titan",         desc: "Find 25,000 total words",       check: p => p.totalWords >= 25000,    coins: 200 },
    { id: "tw_50000",       cat: "totalWords", label: "Word Legend",         desc: "Find 50,000 total words",       check: p => p.totalWords >= 50000,    coins: 400 },

    // ─── GAMES PLAYED (12) ───
    { id: "games_1",        cat: "games",    label: "First Game",           desc: "Play your first game",           check: p => p.gamesPlayed >= 1,      coins: 3 },
    { id: "games_5",        cat: "games",    label: "Warming Up",           desc: "Play 5 games",                   check: p => p.gamesPlayed >= 5,      coins: 5 },
    { id: "games_10",       cat: "games",    label: "Getting Started",      desc: "Play 10 games",                  check: p => p.gamesPlayed >= 10,     coins: 12 },
    { id: "games_25",       cat: "games",    label: "Quarter Century",      desc: "Play 25 games",                  check: p => p.gamesPlayed >= 25,     coins: 20 },
    { id: "games_50",       cat: "games",    label: "Dedicated",            desc: "Play 50 games",                  check: p => p.gamesPlayed >= 50,     coins: 40 },
    { id: "games_100",      cat: "games",    label: "Committed",            desc: "Play 100 games",                 check: p => p.gamesPlayed >= 100,    coins: 75 },
    { id: "games_200",      cat: "games",    label: "Persistent",           desc: "Play 200 games",                 check: p => p.gamesPlayed >= 200,    coins: 100 },
    { id: "games_300",      cat: "games",    label: "Relentless",           desc: "Play 300 games",                 check: p => p.gamesPlayed >= 300,    coins: 125 },
    { id: "games_500",      cat: "games",    label: "Marathon Runner",      desc: "Play 500 games",                 check: p => p.gamesPlayed >= 500,    coins: 175 },
    { id: "games_750",      cat: "games",    label: "Tenacious",            desc: "Play 750 games",                 check: p => p.gamesPlayed >= 750,    coins: 225 },
    { id: "games_1000",     cat: "games",    label: "Thousand Games",       desc: "Play 1,000 games",               check: p => p.gamesPlayed >= 1000,   coins: 300 },
    { id: "games_2000",     cat: "games",    label: "Eternal Player",       desc: "Play 2,000 games",               check: p => p.gamesPlayed >= 2000,   coins: 500 },

    // ─── LEVEL (14) ───
    { id: "level_2",        cat: "level",    label: "Level Up!",            desc: "Reach Level 2",                  check: p => p.level >= 2,            coins: 3 },
    { id: "level_5",        cat: "level",    label: "Rising Star",          desc: "Reach Level 5",                  check: p => p.level >= 5,            coins: 15 },
    { id: "level_10",       cat: "level",    label: "Seasoned",             desc: "Reach Level 10",                 check: p => p.level >= 10,           coins: 30 },
    { id: "level_15",       cat: "level",    label: "Experienced",          desc: "Reach Level 15",                 check: p => p.level >= 15,           coins: 40 },
    { id: "level_20",       cat: "level",    label: "Skilled",              desc: "Reach Level 20",                 check: p => p.level >= 20,           coins: 50 },
    { id: "level_25",       cat: "level",    label: "Veteran",              desc: "Reach Level 25",                 check: p => p.level >= 25,           coins: 60 },
    { id: "level_30",       cat: "level",    label: "Expert",               desc: "Reach Level 30",                 check: p => p.level >= 30,           coins: 70 },
    { id: "level_40",       cat: "level",    label: "Elite",                desc: "Reach Level 40",                 check: p => p.level >= 40,           coins: 85 },
    { id: "level_50",       cat: "level",    label: "Master",               desc: "Reach Level 50",                 check: p => p.level >= 50,           coins: 100 },
    { id: "level_75",       cat: "level",    label: "Grandmaster",          desc: "Reach Level 75",                 check: p => p.level >= 75,           coins: 150 },
    { id: "level_100",      cat: "level",    label: "Centurion",            desc: "Reach Level 100",                check: p => p.level >= 100,          coins: 200 },
    { id: "level_150",      cat: "level",    label: "Legend",               desc: "Reach Level 150",                check: p => p.level >= 150,          coins: 300 },
    { id: "level_200",      cat: "level",    label: "Mythic",               desc: "Reach Level 200",                check: p => p.level >= 200,          coins: 400 },
    { id: "level_500",      cat: "level",    label: "Max Prestige",         desc: "Reach Level 500",                check: p => p.level >= 500,          coins: 1000 },

    // ─── HIGH SCORES (12) ───
    { id: "score_100",      cat: "score",    label: "Triple Digits",        desc: "Score 100+ in a game",           check: p => p.highScore >= 100,      coins: 3 },
    { id: "score_250",      cat: "score",    label: "Getting Somewhere",    desc: "Score 250+ in a game",           check: p => p.highScore >= 250,      coins: 5 },
    { id: "score_500",      cat: "score",    label: "Half a Grand",         desc: "Score 500+ in a game",           check: p => p.highScore >= 500,      coins: 8 },
    { id: "score_1000",     cat: "score",    label: "Four Digits",          desc: "Score 1,000+ in a game",         check: p => p.highScore >= 1000,     coins: 12 },
    { id: "score_2000",     cat: "score",    label: "Double Up",            desc: "Score 2,000+ in a game",         check: p => p.highScore >= 2000,     coins: 20 },
    { id: "score_3000",     cat: "score",    label: "Three Grand",          desc: "Score 3,000+ in a game",         check: p => p.highScore >= 3000,     coins: 30 },
    { id: "score_5000",     cat: "score",    label: "High Roller",          desc: "Score 5,000+ in a game",         check: p => p.highScore >= 5000,     coins: 40 },
    { id: "score_7500",     cat: "score",    label: "Monster Score",        desc: "Score 7,500+ in a game",         check: p => p.highScore >= 7500,     coins: 55 },
    { id: "score_10000",    cat: "score",    label: "Ten Grand",            desc: "Score 10,000+ in a game",        check: p => p.highScore >= 10000,    coins: 75 },
    { id: "score_15000",    cat: "score",    label: "Fifteen K",            desc: "Score 15,000+ in a game",        check: p => p.highScore >= 15000,    coins: 100 },
    { id: "score_25000",    cat: "score",    label: "Twenty-Five K",        desc: "Score 25,000+ in a game",        check: p => p.highScore >= 25000,    coins: 175 },
    { id: "score_50000",    cat: "score",    label: "Fifty Grand",          desc: "Score 50,000+ in a game",        check: p => p.highScore >= 50000,    coins: 350 },

    // ─── PLAY STREAKS (10) ───
    { id: "streak_2",       cat: "streak",   label: "Back Again",           desc: "2-day play streak",              check: p => (p.playStreak || 0) >= 2,  coins: 5 },
    { id: "streak_3",       cat: "streak",   label: "On a Roll",            desc: "3-day play streak",              check: p => (p.playStreak || 0) >= 3,  coins: 15 },
    { id: "streak_5",       cat: "streak",   label: "Five Alive",           desc: "5-day play streak",              check: p => (p.playStreak || 0) >= 5,  coins: 25 },
    { id: "streak_7",       cat: "streak",   label: "Weekly Warrior",       desc: "7-day play streak",              check: p => (p.playStreak || 0) >= 7,  coins: 40 },
    { id: "streak_10",      cat: "streak",   label: "Ten-Day Titan",        desc: "10-day play streak",             check: p => (p.playStreak || 0) >= 10, coins: 55 },
    { id: "streak_14",      cat: "streak",   label: "Fortnight Force",      desc: "14-day play streak",             check: p => (p.playStreak || 0) >= 14, coins: 75 },
    { id: "streak_21",      cat: "streak",   label: "Three Weeks",          desc: "21-day play streak",             check: p => (p.playStreak || 0) >= 21, coins: 100 },
    { id: "streak_30",      cat: "streak",   label: "Monthly Master",       desc: "30-day play streak",             check: p => (p.playStreak || 0) >= 30, coins: 150 },
    { id: "streak_60",      cat: "streak",   label: "Two-Month Streak",     desc: "60-day play streak",             check: p => (p.playStreak || 0) >= 60, coins: 250 },
    { id: "streak_100",     cat: "streak",   label: "Hundred Days",         desc: "100-day play streak",            check: p => (p.playStreak || 0) >= 100, coins: 500 },

    // ─── TOTAL XP (10) ───
    { id: "xp_100",         cat: "xp",       label: "XP Starter",           desc: "Earn 100 total XP",             check: p => (p.totalXp || 0) >= 100,      coins: 3 },
    { id: "xp_500",         cat: "xp",       label: "XP Collector",         desc: "Earn 500 total XP",             check: p => (p.totalXp || 0) >= 500,      coins: 8 },
    { id: "xp_1000",        cat: "xp",       label: "XP Enthusiast",        desc: "Earn 1,000 total XP",           check: p => (p.totalXp || 0) >= 1000,     coins: 15 },
    { id: "xp_2500",        cat: "xp",       label: "XP Hunter",            desc: "Earn 2,500 total XP",           check: p => (p.totalXp || 0) >= 2500,     coins: 25 },
    { id: "xp_5000",        cat: "xp",       label: "XP Grinder",           desc: "Earn 5,000 total XP",           check: p => (p.totalXp || 0) >= 5000,     coins: 40 },
    { id: "xp_10000",       cat: "xp",       label: "XP Machine",           desc: "Earn 10,000 total XP",          check: p => (p.totalXp || 0) >= 10000,    coins: 60 },
    { id: "xp_25000",       cat: "xp",       label: "XP Juggernaut",        desc: "Earn 25,000 total XP",          check: p => (p.totalXp || 0) >= 25000,    coins: 100 },
    { id: "xp_50000",       cat: "xp",       label: "XP Baron",             desc: "Earn 50,000 total XP",          check: p => (p.totalXp || 0) >= 50000,    coins: 175 },
    { id: "xp_100000",      cat: "xp",       label: "XP Overlord",          desc: "Earn 100,000 total XP",         check: p => (p.totalXp || 0) >= 100000,   coins: 300 },
    { id: "xp_500000",      cat: "xp",       label: "XP Ascended",          desc: "Earn 500,000 total XP",         check: p => (p.totalXp || 0) >= 500000,   coins: 750 },

    // ─── COINS EARNED (10) ───
    { id: "ce_50",          cat: "coins",    label: "Pocket Change",         desc: "Earn 50 lifetime coins",        check: p => (p.totalCoinsEarned || 0) >= 50,     coins: 3 },
    { id: "ce_100",         cat: "coins",    label: "Coin Starter",          desc: "Earn 100 lifetime coins",       check: p => (p.totalCoinsEarned || 0) >= 100,    coins: 5 },
    { id: "ce_250",         cat: "coins",    label: "Coin Collector",        desc: "Earn 250 lifetime coins",       check: p => (p.totalCoinsEarned || 0) >= 250,    coins: 10 },
    { id: "ce_500",         cat: "coins",    label: "Coin Hoarder",          desc: "Earn 500 lifetime coins",       check: p => (p.totalCoinsEarned || 0) >= 500,    coins: 20 },
    { id: "ce_1000",        cat: "coins",    label: "Thousand Coins",        desc: "Earn 1,000 lifetime coins",     check: p => (p.totalCoinsEarned || 0) >= 1000,   coins: 40 },
    { id: "ce_2500",        cat: "coins",    label: "Coin Mogul",            desc: "Earn 2,500 lifetime coins",     check: p => (p.totalCoinsEarned || 0) >= 2500,   coins: 60 },
    { id: "ce_5000",        cat: "coins",    label: "Coin Baron",            desc: "Earn 5,000 lifetime coins",     check: p => (p.totalCoinsEarned || 0) >= 5000,   coins: 100 },
    { id: "ce_10000",       cat: "coins",    label: "Coin Tycoon",           desc: "Earn 10,000 lifetime coins",    check: p => (p.totalCoinsEarned || 0) >= 10000,  coins: 150 },
    { id: "ce_25000",       cat: "coins",    label: "Coin Empire",           desc: "Earn 25,000 lifetime coins",    check: p => (p.totalCoinsEarned || 0) >= 25000,  coins: 250 },
    { id: "ce_50000",       cat: "coins",    label: "Coin Sovereign",        desc: "Earn 50,000 lifetime coins",    check: p => (p.totalCoinsEarned || 0) >= 50000,  coins: 500 },

    // ─── SHOP & INVENTORY (12) ───
    { id: "shop_first",     cat: "shop",     label: "First Purchase",        desc: "Buy your first shop item",      check: p => (p.inventory || []).length >= 1,            coins: 10 },
    { id: "shop_3",         cat: "shop",     label: "Shopper",               desc: "Own 3 shop items",              check: p => (p.inventory || []).length >= 3,            coins: 20 },
    { id: "shop_5",         cat: "shop",     label: "Big Spender",           desc: "Own 5 shop items",              check: p => (p.inventory || []).length >= 5,            coins: 40 },
    { id: "shop_10",        cat: "shop",     label: "Collector",             desc: "Own 10 shop items",             check: p => (p.inventory || []).length >= 10,           coins: 75 },
    { id: "shop_all",       cat: "shop",     label: "Completionist",         desc: "Own all 15 permanent items",    check: p => (p.inventory || []).length >= 15,           coins: 200 },
    { id: "theme_any",      cat: "shop",     label: "New Look",              desc: "Equip a non-default theme",     check: p => p.equipped && p.equipped.gridTheme && p.equipped.gridTheme !== "theme_default", coins: 10 },
    { id: "block_any",      cat: "shop",     label: "Style Points",          desc: "Equip a non-default block style", check: p => p.equipped && p.equipped.blockStyle && p.equipped.blockStyle !== "block_default", coins: 10 },
    { id: "slot_1",         cat: "shop",     label: "Bonus Slot I",          desc: "Unlock your first bonus slot",  check: p => (p.inventory || []).includes("bonus_slot_1"), coins: 25 },
    { id: "slot_2",         cat: "shop",     label: "Bonus Slot II",         desc: "Unlock your second bonus slot", check: p => (p.inventory || []).includes("bonus_slot_2"), coins: 50 },
    { id: "slot_3",         cat: "shop",     label: "Bonus Slot III",        desc: "Unlock all three bonus slots",  check: p => (p.inventory || []).includes("bonus_slot_3"), coins: 100 },
    { id: "grid_unlock_1",  cat: "shop",     label: "Grid Explorer",         desc: "Unlock a new grid size",        check: p => Object.keys(p.unlockedGrids || {}).length >= 1, coins: 10 },
    { id: "grid_unlock_all",cat: "shop",     label: "Grid Master",           desc: "Unlock all grid sizes",         check: p => Object.keys(p.unlockedGrids || {}).length >= 6, coins: 75 },

    // ─── CHALLENGES — GENERAL (8) ───
    { id: "ch_first",       cat: "challenges", label: "Challenger",          desc: "Play your first challenge",     check: p => { const cs = p.challengeStats || {}; return Object.values(cs).some(s => s.gamesPlayed > 0); }, coins: 10 },
    { id: "ch_types_2",     cat: "challenges", label: "Variety Pack",        desc: "Try 2 different challenge types", check: p => { const cs = p.challengeStats || {}; return Object.values(cs).filter(s => s.gamesPlayed > 0).length >= 2; }, coins: 15 },
    { id: "ch_types_3",     cat: "challenges", label: "Triple Threat",       desc: "Try 3 different challenge types", check: p => { const cs = p.challengeStats || {}; return Object.values(cs).filter(s => s.gamesPlayed > 0).length >= 3; }, coins: 25 },
    { id: "ch_types_5",     cat: "challenges", label: "All Rounder",         desc: "Try all 5 challenge types",     check: p => { const cs = p.challengeStats || {}; return Object.values(cs).filter(s => s.gamesPlayed > 0).length >= 5; }, coins: 60 },
    { id: "ch_games_10",    cat: "challenges", label: "Challenge Fan",       desc: "Play 10 total challenges",      check: p => { const cs = p.challengeStats || {}; return Object.values(cs).reduce((a, s) => a + (s.gamesPlayed || 0), 0) >= 10; }, coins: 20 },
    { id: "ch_games_25",    cat: "challenges", label: "Challenge Addict",    desc: "Play 25 total challenges",      check: p => { const cs = p.challengeStats || {}; return Object.values(cs).reduce((a, s) => a + (s.gamesPlayed || 0), 0) >= 25; }, coins: 40 },
    { id: "ch_games_50",    cat: "challenges", label: "Challenge Veteran",   desc: "Play 50 total challenges",      check: p => { const cs = p.challengeStats || {}; return Object.values(cs).reduce((a, s) => a + (s.gamesPlayed || 0), 0) >= 50; }, coins: 75 },
    { id: "ch_games_100",   cat: "challenges", label: "Challenge Legend",    desc: "Play 100 total challenges",     check: p => { const cs = p.challengeStats || {}; return Object.values(cs).reduce((a, s) => a + (s.gamesPlayed || 0), 0) >= 100; }, coins: 150 },

    // ─── TARGET WORD CHALLENGE (10) ───
    { id: "tw_play_1",      cat: "targetWord", label: "Target Acquired",    desc: "Play 1 Target Word challenge",  check: p => (p.challengeStats?.["target-word"]?.gamesPlayed || 0) >= 1,  coins: 5 },
    { id: "tw_play_5",      cat: "targetWord", label: "Target Practice",    desc: "Play 5 Target Word challenges", check: p => (p.challengeStats?.["target-word"]?.gamesPlayed || 0) >= 5,  coins: 15 },
    { id: "tw_play_10",     cat: "targetWord", label: "Target Veteran",     desc: "Play 10 Target Word challenges", check: p => (p.challengeStats?.["target-word"]?.gamesPlayed || 0) >= 10, coins: 25 },
    { id: "tw_play_25",     cat: "targetWord", label: "Target Master",      desc: "Play 25 Target Word challenges", check: p => (p.challengeStats?.["target-word"]?.gamesPlayed || 0) >= 25, coins: 50 },
    { id: "tw_play_50",     cat: "targetWord", label: "Target Legend",      desc: "Play 50 Target Word challenges", check: p => (p.challengeStats?.["target-word"]?.gamesPlayed || 0) >= 50, coins: 100 },
    { id: "tw_level_3",     cat: "targetWord", label: "Target Tier 3",     desc: "Reach Target Word level 3",     check: p => (p.challengeStats?.["target-word"]?.targetWordLevel || 1) >= 3,  coins: 10 },
    { id: "tw_level_5",     cat: "targetWord", label: "Target Tier 5",     desc: "Reach Target Word level 5",     check: p => (p.challengeStats?.["target-word"]?.targetWordLevel || 1) >= 5,  coins: 25 },
    { id: "tw_level_10",    cat: "targetWord", label: "Target Tier 10",    desc: "Reach Target Word level 10",    check: p => (p.challengeStats?.["target-word"]?.targetWordLevel || 1) >= 10, coins: 50 },
    { id: "tw_level_20",    cat: "targetWord", label: "Target Tier 20",    desc: "Reach Target Word level 20",    check: p => (p.challengeStats?.["target-word"]?.targetWordLevel || 1) >= 20, coins: 100 },
    { id: "tw_level_50",    cat: "targetWord", label: "Target Tier 50",    desc: "Reach Target Word level 50",    check: p => (p.challengeStats?.["target-word"]?.targetWordLevel || 1) >= 50, coins: 250 },

    // ─── SPEED ROUND CHALLENGE (8) ───
    { id: "sr_play_1",      cat: "speedRound", label: "Speed Demon",        desc: "Play 1 Speed Round",            check: p => (p.challengeStats?.["speed-round"]?.gamesPlayed || 0) >= 1,  coins: 5 },
    { id: "sr_play_5",      cat: "speedRound", label: "Speed Freak",        desc: "Play 5 Speed Rounds",           check: p => (p.challengeStats?.["speed-round"]?.gamesPlayed || 0) >= 5,  coins: 15 },
    { id: "sr_play_10",     cat: "speedRound", label: "Speed Junkie",       desc: "Play 10 Speed Rounds",          check: p => (p.challengeStats?.["speed-round"]?.gamesPlayed || 0) >= 10, coins: 25 },
    { id: "sr_play_25",     cat: "speedRound", label: "Speed Master",       desc: "Play 25 Speed Rounds",          check: p => (p.challengeStats?.["speed-round"]?.gamesPlayed || 0) >= 25, coins: 50 },
    { id: "sr_play_50",     cat: "speedRound", label: "Speed Legend",       desc: "Play 50 Speed Rounds",          check: p => (p.challengeStats?.["speed-round"]?.gamesPlayed || 0) >= 50, coins: 100 },
    { id: "sr_score_500",   cat: "speedRound", label: "Speed Score 500",   desc: "Score 500+ in Speed Round",     check: p => (p.challengeStats?.["speed-round"]?.highScore || 0) >= 500,  coins: 15 },
    { id: "sr_score_1000",  cat: "speedRound", label: "Speed Score 1K",    desc: "Score 1,000+ in Speed Round",   check: p => (p.challengeStats?.["speed-round"]?.highScore || 0) >= 1000, coins: 40 },
    { id: "sr_score_2500",  cat: "speedRound", label: "Speed Score 2.5K",  desc: "Score 2,500+ in Speed Round",   check: p => (p.challengeStats?.["speed-round"]?.highScore || 0) >= 2500, coins: 100 },

    // ─── WORD CATEGORY CHALLENGE (8) ───
    { id: "wc_play_1",      cat: "wordCat",  label: "Category Curious",     desc: "Play 1 Word Category challenge", check: p => (p.challengeStats?.["word-category"]?.gamesPlayed || 0) >= 1,  coins: 5 },
    { id: "wc_play_5",      cat: "wordCat",  label: "Category Fan",         desc: "Play 5 Word Category challenges", check: p => (p.challengeStats?.["word-category"]?.gamesPlayed || 0) >= 5, coins: 15 },
    { id: "wc_play_10",     cat: "wordCat",  label: "Category Buff",        desc: "Play 10 Word Category challenges", check: p => (p.challengeStats?.["word-category"]?.gamesPlayed || 0) >= 10, coins: 25 },
    { id: "wc_play_25",     cat: "wordCat",  label: "Category Expert",      desc: "Play 25 Word Category challenges", check: p => (p.challengeStats?.["word-category"]?.gamesPlayed || 0) >= 25, coins: 50 },
    { id: "wc_play_50",     cat: "wordCat",  label: "Category Legend",      desc: "Play 50 Word Category challenges", check: p => (p.challengeStats?.["word-category"]?.gamesPlayed || 0) >= 50, coins: 100 },
    { id: "wc_score_500",   cat: "wordCat",  label: "Cat. Score 500",      desc: "Score 500+ in Word Category",   check: p => (p.challengeStats?.["word-category"]?.highScore || 0) >= 500,  coins: 15 },
    { id: "wc_score_1000",  cat: "wordCat",  label: "Cat. Score 1K",       desc: "Score 1,000+ in Word Category", check: p => (p.challengeStats?.["word-category"]?.highScore || 0) >= 1000, coins: 40 },
    { id: "wc_score_2500",  cat: "wordCat",  label: "Cat. Score 2.5K",     desc: "Score 2,500+ in Word Category", check: p => (p.challengeStats?.["word-category"]?.highScore || 0) >= 2500, coins: 100 },

    // ─── WORD SEARCH CHALLENGE (12) ───
    { id: "ws_play_1",      cat: "wordSearch", label: "Word Seeker",        desc: "Play 1 Word Search",            check: p => (p.challengeStats?.["word-search"]?.gamesPlayed || 0) >= 1,  coins: 5 },
    { id: "ws_play_5",      cat: "wordSearch", label: "Word Scout",         desc: "Play 5 Word Searches",          check: p => (p.challengeStats?.["word-search"]?.gamesPlayed || 0) >= 5,  coins: 15 },
    { id: "ws_play_10",     cat: "wordSearch", label: "Word Detective",     desc: "Play 10 Word Searches",         check: p => (p.challengeStats?.["word-search"]?.gamesPlayed || 0) >= 10, coins: 25 },
    { id: "ws_play_25",     cat: "wordSearch", label: "Word Investigator",  desc: "Play 25 Word Searches",         check: p => (p.challengeStats?.["word-search"]?.gamesPlayed || 0) >= 25, coins: 50 },
    { id: "ws_play_50",     cat: "wordSearch", label: "Word Search Legend", desc: "Play 50 Word Searches",         check: p => (p.challengeStats?.["word-search"]?.gamesPlayed || 0) >= 50, coins: 100 },
    { id: "ws_level_3",     cat: "wordSearch", label: "Search Tier 3",     desc: "Reach Word Search level 3",     check: p => (p.challengeStats?.["word-search"]?.wordSearchLevel || 1) >= 3,  coins: 10 },
    { id: "ws_level_5",     cat: "wordSearch", label: "Search Tier 5",     desc: "Reach Word Search level 5",     check: p => (p.challengeStats?.["word-search"]?.wordSearchLevel || 1) >= 5,  coins: 25 },
    { id: "ws_level_10",    cat: "wordSearch", label: "Search Tier 10",    desc: "Reach Word Search level 10",    check: p => (p.challengeStats?.["word-search"]?.wordSearchLevel || 1) >= 10, coins: 50 },
    { id: "ws_level_20",    cat: "wordSearch", label: "Search Tier 20",    desc: "Reach Word Search level 20",    check: p => (p.challengeStats?.["word-search"]?.wordSearchLevel || 1) >= 20, coins: 100 },
    { id: "ws_level_50",    cat: "wordSearch", label: "Search Tier 50",    desc: "Reach Word Search level 50",    check: p => (p.challengeStats?.["word-search"]?.wordSearchLevel || 1) >= 50, coins: 250 },
    { id: "ws_score_500",   cat: "wordSearch", label: "Search Score 500",  desc: "Score 500+ in Word Search",     check: p => (p.challengeStats?.["word-search"]?.highScore || 0) >= 500,  coins: 15 },
    { id: "ws_score_2000",  cat: "wordSearch", label: "Search Score 2K",   desc: "Score 2,000+ in Word Search",   check: p => (p.challengeStats?.["word-search"]?.highScore || 0) >= 2000, coins: 75 },

    // ─── WORD RUNNER CHALLENGE (10) ───
    { id: "wr_play_1",      cat: "wordRunner", label: "Runner Rookie",      desc: "Play 1 Word Runner",            check: p => (p.challengeStats?.["word-runner"]?.gamesPlayed || 0) >= 1,  coins: 5 },
    { id: "wr_play_5",      cat: "wordRunner", label: "Runner Regular",     desc: "Play 5 Word Runners",           check: p => (p.challengeStats?.["word-runner"]?.gamesPlayed || 0) >= 5,  coins: 15 },
    { id: "wr_play_10",     cat: "wordRunner", label: "Runner Enthusiast",  desc: "Play 10 Word Runners",          check: p => (p.challengeStats?.["word-runner"]?.gamesPlayed || 0) >= 10, coins: 25 },
    { id: "wr_play_25",     cat: "wordRunner", label: "Runner Pro",         desc: "Play 25 Word Runners",          check: p => (p.challengeStats?.["word-runner"]?.gamesPlayed || 0) >= 25, coins: 50 },
    { id: "wr_play_50",     cat: "wordRunner", label: "Runner Legend",      desc: "Play 50 Word Runners",          check: p => (p.challengeStats?.["word-runner"]?.gamesPlayed || 0) >= 50, coins: 100 },
    { id: "wr_score_200",   cat: "wordRunner", label: "Runner Score 200",  desc: "Score 200+ in Word Runner",     check: p => (p.challengeStats?.["word-runner"]?.highScore || 0) >= 200,  coins: 10 },
    { id: "wr_score_500",   cat: "wordRunner", label: "Runner Score 500",  desc: "Score 500+ in Word Runner",     check: p => (p.challengeStats?.["word-runner"]?.highScore || 0) >= 500,  coins: 25 },
    { id: "wr_score_1000",  cat: "wordRunner", label: "Runner Score 1K",   desc: "Score 1,000+ in Word Runner",   check: p => (p.challengeStats?.["word-runner"]?.highScore || 0) >= 1000, coins: 60 },
    { id: "wr_score_2500",  cat: "wordRunner", label: "Runner Score 2.5K", desc: "Score 2,500+ in Word Runner",   check: p => (p.challengeStats?.["word-runner"]?.highScore || 0) >= 2500, coins: 125 },
    { id: "wr_score_5000",  cat: "wordRunner", label: "Runner Score 5K",   desc: "Score 5,000+ in Word Runner",   check: p => (p.challengeStats?.["word-runner"]?.highScore || 0) >= 5000, coins: 250 },

    // ─── GRID MASTERY (12) ───
    { id: "grid_3",         cat: "grid",     label: "Tiny Grid",             desc: "Play a game on 3×3",            check: p => (p.bestScores?.["3-casual-sandbox"] > 0 || p.bestScores?.["3-hard-sandbox"] > 0 || p.bestScores?.["3-casual-timed"] > 0 || p.bestScores?.["3-hard-timed"] > 0), coins: 10 },
    { id: "grid_4",         cat: "grid",     label: "Compact Grid",          desc: "Play a game on 4×4",            check: p => (p.bestScores?.["4-casual-sandbox"] > 0 || p.bestScores?.["4-hard-sandbox"] > 0 || p.bestScores?.["4-casual-timed"] > 0 || p.bestScores?.["4-hard-timed"] > 0), coins: 8 },
    { id: "grid_5",         cat: "grid",     label: "Standard Grid",         desc: "Play a game on 5×5",            check: p => (p.bestScores?.["5-casual-sandbox"] > 0 || p.bestScores?.["5-hard-sandbox"] > 0 || p.bestScores?.["5-casual-timed"] > 0 || p.bestScores?.["5-hard-timed"] > 0), coins: 5 },
    { id: "grid_6",         cat: "grid",     label: "Big Grid",              desc: "Play a game on 6×6",            check: p => (p.bestScores?.["6-casual-sandbox"] > 0 || p.bestScores?.["6-hard-sandbox"] > 0 || p.bestScores?.["6-casual-timed"] > 0 || p.bestScores?.["6-hard-timed"] > 0), coins: 5 },
    { id: "grid_7",         cat: "grid",     label: "Wide Grid",             desc: "Play a game on 7×7",            check: p => (p.bestScores?.["7-casual-sandbox"] > 0 || p.bestScores?.["7-hard-sandbox"] > 0 || p.bestScores?.["7-casual-timed"] > 0 || p.bestScores?.["7-hard-timed"] > 0), coins: 8 },
    { id: "grid_8",         cat: "grid",     label: "Grand Grid",            desc: "Play a game on 8×8",            check: p => (p.bestScores?.["8-casual-sandbox"] > 0 || p.bestScores?.["8-hard-sandbox"] > 0 || p.bestScores?.["8-casual-timed"] > 0 || p.bestScores?.["8-hard-timed"] > 0), coins: 10 },
    { id: "grid_all",       cat: "grid",     label: "All Grids",             desc: "Play on all 6 grid sizes",      check: p => { const bs = p.bestScores || {}; return [3,4,5,6,7,8].every(s => Object.keys(bs).some(k => k.startsWith(s + "-") && bs[k] > 0)); }, coins: 50 },
    { id: "hard_first",     cat: "grid",     label: "Hard Mode",             desc: "Play a game on Hard difficulty", check: p => { const bs = p.bestScores || {}; return Object.keys(bs).some(k => k.includes("-hard-") && bs[k] > 0); }, coins: 10 },
    { id: "hard_1k",        cat: "grid",     label: "Hard Hitter",           desc: "Score 1,000+ on Hard",          check: p => { const bs = p.bestScores || {}; return Object.entries(bs).some(([k,v]) => k.includes("-hard-") && v >= 1000); }, coins: 30 },
    { id: "hard_5k",        cat: "grid",     label: "Hard Crusher",          desc: "Score 5,000+ on Hard",          check: p => { const bs = p.bestScores || {}; return Object.entries(bs).some(([k,v]) => k.includes("-hard-") && v >= 5000); }, coins: 75 },
    { id: "timed_first",    cat: "grid",     label: "Against the Clock",     desc: "Play a Timed game",             check: p => { const bs = p.bestScores || {}; return Object.keys(bs).some(k => k.endsWith("-timed") && bs[k] > 0); }, coins: 10 },
    { id: "timed_1k",       cat: "grid",     label: "Time Crunch",           desc: "Score 1,000+ in Timed mode",    check: p => { const bs = p.bestScores || {}; return Object.entries(bs).some(([k,v]) => k.endsWith("-timed") && v >= 1000); }, coins: 30 },

    // ─── META — MILESTONES ABOUT MILESTONES (10) ───
    { id: "meta_1",         cat: "meta",     label: "First Achievement",     desc: "Earn your first milestone",     check: p => (p.claimedMilestones || []).length >= 1,  coins: 5 },
    { id: "meta_5",         cat: "meta",     label: "Achievement Hunter",    desc: "Earn 5 milestones",             check: p => (p.claimedMilestones || []).length >= 5,  coins: 10 },
    { id: "meta_10",        cat: "meta",     label: "Trophy Case",           desc: "Earn 10 milestones",            check: p => (p.claimedMilestones || []).length >= 10, coins: 15 },
    { id: "meta_25",        cat: "meta",     label: "Quarter Century",       desc: "Earn 25 milestones",            check: p => (p.claimedMilestones || []).length >= 25, coins: 30 },
    { id: "meta_50",        cat: "meta",     label: "Halfway There",         desc: "Earn 50 milestones",            check: p => (p.claimedMilestones || []).length >= 50, coins: 60 },
    { id: "meta_75",        cat: "meta",     label: "Dedicated Achiever",    desc: "Earn 75 milestones",            check: p => (p.claimedMilestones || []).length >= 75, coins: 100 },
    { id: "meta_100",       cat: "meta",     label: "Triple Digits",         desc: "Earn 100 milestones",           check: p => (p.claimedMilestones || []).length >= 100, coins: 150 },
    { id: "meta_125",       cat: "meta",     label: "Overachiever",          desc: "Earn 125 milestones",           check: p => (p.claimedMilestones || []).length >= 125, coins: 200 },
    { id: "meta_150",       cat: "meta",     label: "Milestone Collector",   desc: "Earn 150 milestones",           check: p => (p.claimedMilestones || []).length >= 150, coins: 300 },
    { id: "meta_all",       cat: "meta",     label: "100% Complete",         desc: "Earn every single milestone",   check: p => (p.claimedMilestones || []).length >= MILESTONES.length - 1, coins: 1000 },

    // ─── CHALLENGE HIGH SCORES COMBINED (8) ───
    { id: "ch_hs_500",      cat: "challengeScore", label: "Challenge Scorer",    desc: "500+ in any challenge",     check: p => { const cs = p.challengeStats || {}; return Object.values(cs).some(s => (s.highScore || 0) >= 500); }, coins: 10 },
    { id: "ch_hs_1000",     cat: "challengeScore", label: "Challenge Kilo",      desc: "1,000+ in any challenge",   check: p => { const cs = p.challengeStats || {}; return Object.values(cs).some(s => (s.highScore || 0) >= 1000); }, coins: 25 },
    { id: "ch_hs_2500",     cat: "challengeScore", label: "Challenge Elite",     desc: "2,500+ in any challenge",   check: p => { const cs = p.challengeStats || {}; return Object.values(cs).some(s => (s.highScore || 0) >= 2500); }, coins: 50 },
    { id: "ch_hs_5000",     cat: "challengeScore", label: "Challenge Supreme",   desc: "5,000+ in any challenge",   check: p => { const cs = p.challengeStats || {}; return Object.values(cs).some(s => (s.highScore || 0) >= 5000); }, coins: 100 },
    { id: "ch_words_50",    cat: "challengeScore", label: "Challenge Wordsmith",  desc: "50 words in any challenge type", check: p => { const cs = p.challengeStats || {}; return Object.values(cs).some(s => (s.totalWords || 0) >= 50); }, coins: 15 },
    { id: "ch_words_200",   cat: "challengeScore", label: "Challenge Lexicon",   desc: "200 words in any challenge type", check: p => { const cs = p.challengeStats || {}; return Object.values(cs).some(s => (s.totalWords || 0) >= 200); }, coins: 40 },
    { id: "ch_words_500",   cat: "challengeScore", label: "Challenge Scholar",   desc: "500 words in any challenge type", check: p => { const cs = p.challengeStats || {}; return Object.values(cs).some(s => (s.totalWords || 0) >= 500); }, coins: 75 },
    { id: "ch_words_1000",  cat: "challengeScore", label: "Challenge Sage",      desc: "1,000 words in any challenge type", check: p => { const cs = p.challengeStats || {}; return Object.values(cs).some(s => (s.totalWords || 0) >= 1000); }, coins: 150 },

    // ─── EARLY JOURNEY (10) ───
    { id: "ej_first_word",  cat: "journey",  label: "First Word",            desc: "Find your very first word",     check: p => p.totalWords >= 1,        coins: 2 },
    { id: "ej_5_words",     cat: "journey",  label: "Getting the Hang",      desc: "Find 5 total words",            check: p => p.totalWords >= 5,        coins: 3 },
    { id: "ej_10_words",    cat: "journey",  label: "Double Digits",         desc: "Find 10 total words",           check: p => p.totalWords >= 10,       coins: 5 },
    { id: "ej_first_score", cat: "journey",  label: "On the Board",          desc: "Score at least 50 points",      check: p => p.highScore >= 50,        coins: 3 },
    { id: "ej_level_up",    cat: "journey",  label: "Level Up!",             desc: "Reach Level 2",                 check: p => p.level >= 2,             coins: 3 },
    { id: "ej_5_games",     cat: "journey",  label: "Getting Hooked",        desc: "Play 5 games",                  check: p => p.gamesPlayed >= 5,       coins: 5 },
    { id: "ej_first_coin",  cat: "journey",  label: "First Earnings",        desc: "Earn your first coins",         check: p => (p.totalCoinsEarned || 0) >= 1, coins: 2 },
    { id: "ej_xp_50",       cat: "journey",  label: "XP Beginner",           desc: "Earn 50 XP",                    check: p => (p.totalXp || 0) >= 50,   coins: 3 },
    { id: "ej_streak_start",cat: "journey",  label: "Come Back",             desc: "Start a 2-day play streak",     check: p => (p.playStreak || 0) >= 2, coins: 5 },
    { id: "ej_unique_10",   cat: "journey",  label: "Vocab Started",         desc: "Find 10 unique words",          check: p => (p.uniqueWordsFound || []).length >= 10, coins: 3 },

    // ─── COIN BALANCE (8) ───
    { id: "bal_100",        cat: "balance",  label: "Saved Up",              desc: "Have 100 coins at once",        check: p => (p.coins || 0) >= 100,    coins: 5 },
    { id: "bal_250",        cat: "balance",  label: "Nest Egg",              desc: "Have 250 coins at once",        check: p => (p.coins || 0) >= 250,    coins: 10 },
    { id: "bal_500",        cat: "balance",  label: "Half Grand Saved",      desc: "Have 500 coins at once",        check: p => (p.coins || 0) >= 500,    coins: 15 },
    { id: "bal_1000",       cat: "balance",  label: "Coin Stash",            desc: "Have 1,000 coins at once",      check: p => (p.coins || 0) >= 1000,   coins: 25 },
    { id: "bal_2500",       cat: "balance",  label: "Money Bags",            desc: "Have 2,500 coins at once",      check: p => (p.coins || 0) >= 2500,   coins: 40 },
    { id: "bal_5000",       cat: "balance",  label: "Wealthy",               desc: "Have 5,000 coins at once",      check: p => (p.coins || 0) >= 5000,   coins: 60 },
    { id: "bal_10000",      cat: "balance",  label: "Rich",                  desc: "Have 10,000 coins at once",     check: p => (p.coins || 0) >= 10000,  coins: 100 },
    { id: "bal_25000",      cat: "balance",  label: "Coin Dragon",           desc: "Have 25,000 coins at once",     check: p => (p.coins || 0) >= 25000,  coins: 200 },

    // ─── BEST SCORES PER MODE (14) ───
    { id: "bs_casual_500",  cat: "bestScores", label: "Casual 500",         desc: "Score 500+ on Casual Sandbox",  check: p => (p.bestScores?.["5-casual-sandbox"] || 0) >= 500, coins: 5 },
    { id: "bs_casual_1k",   cat: "bestScores", label: "Casual 1K",          desc: "Score 1,000+ on Casual Sandbox", check: p => { const bs = p.bestScores || {}; return Object.entries(bs).some(([k,v]) => k.includes("-casual-sandbox") && v >= 1000); }, coins: 15 },
    { id: "bs_casual_3k",   cat: "bestScores", label: "Casual 3K",          desc: "Score 3,000+ on Casual Sandbox", check: p => { const bs = p.bestScores || {}; return Object.entries(bs).some(([k,v]) => k.includes("-casual-sandbox") && v >= 3000); }, coins: 40 },
    { id: "bs_casual_5k",   cat: "bestScores", label: "Casual 5K",          desc: "Score 5,000+ on Casual Sandbox", check: p => { const bs = p.bestScores || {}; return Object.entries(bs).some(([k,v]) => k.includes("-casual-sandbox") && v >= 5000); }, coins: 75 },
    { id: "bs_casual_10k",  cat: "bestScores", label: "Casual 10K",         desc: "Score 10,000+ on Casual Sandbox", check: p => { const bs = p.bestScores || {}; return Object.entries(bs).some(([k,v]) => k.includes("-casual-sandbox") && v >= 10000); }, coins: 150 },
    { id: "bs_hard_500",    cat: "bestScores", label: "Hard 500",           desc: "Score 500+ on Hard Sandbox",    check: p => { const bs = p.bestScores || {}; return Object.entries(bs).some(([k,v]) => k.includes("-hard-sandbox") && v >= 500); }, coins: 10 },
    { id: "bs_hard_1k",     cat: "bestScores", label: "Hard 1K",            desc: "Score 1,000+ on Hard Sandbox",  check: p => { const bs = p.bestScores || {}; return Object.entries(bs).some(([k,v]) => k.includes("-hard-sandbox") && v >= 1000); }, coins: 25 },
    { id: "bs_hard_3k",     cat: "bestScores", label: "Hard 3K",            desc: "Score 3,000+ on Hard Sandbox",  check: p => { const bs = p.bestScores || {}; return Object.entries(bs).some(([k,v]) => k.includes("-hard-sandbox") && v >= 3000); }, coins: 60 },
    { id: "bs_hard_5k",     cat: "bestScores", label: "Hard 5K",            desc: "Score 5,000+ on Hard Sandbox",  check: p => { const bs = p.bestScores || {}; return Object.entries(bs).some(([k,v]) => k.includes("-hard-sandbox") && v >= 5000); }, coins: 125 },
    { id: "bs_timed_500",   cat: "bestScores", label: "Timed 500",          desc: "Score 500+ on Timed mode",      check: p => { const bs = p.bestScores || {}; return Object.entries(bs).some(([k,v]) => k.endsWith("-timed") && v >= 500); }, coins: 10 },
    { id: "bs_timed_1k",    cat: "bestScores", label: "Timed 1K",           desc: "Score 1,000+ on Timed mode",    check: p => { const bs = p.bestScores || {}; return Object.entries(bs).some(([k,v]) => k.endsWith("-timed") && v >= 1000); }, coins: 25 },
    { id: "bs_timed_3k",    cat: "bestScores", label: "Timed 3K",           desc: "Score 3,000+ on Timed mode",    check: p => { const bs = p.bestScores || {}; return Object.entries(bs).some(([k,v]) => k.endsWith("-timed") && v >= 3000); }, coins: 60 },
    { id: "bs_timed_5k",    cat: "bestScores", label: "Timed 5K",           desc: "Score 5,000+ on Timed mode",    check: p => { const bs = p.bestScores || {}; return Object.entries(bs).some(([k,v]) => k.endsWith("-timed") && v >= 5000); }, coins: 125 },
    { id: "bs_timed_10k",   cat: "bestScores", label: "Timed 10K",          desc: "Score 10,000+ on Timed mode",   check: p => { const bs = p.bestScores || {}; return Object.entries(bs).some(([k,v]) => k.endsWith("-timed") && v >= 10000); }, coins: 250 },

    // ─── LONG WORDS (15) ───
    { id: "lw_4",           cat: "longWords", label: "Four Letter",         desc: "Find a 4-letter word",          check: p => (p.longestWord || 0) >= 4, coins: 2 },
    { id: "lw_5",           cat: "longWords", label: "Five Letter",         desc: "Find a 5-letter word",          check: p => (p.longestWord || 0) >= 5, coins: 5 },
    { id: "lw_6",           cat: "longWords", label: "Six Letter",          desc: "Find a 6-letter word",          check: p => (p.longestWord || 0) >= 6, coins: 10 },
    { id: "lw_7",           cat: "longWords", label: "Seven Letter",        desc: "Find a 7-letter word",          check: p => (p.longestWord || 0) >= 7, coins: 20 },
    { id: "lw_8",           cat: "longWords", label: "Eight Letter",        desc: "Find an 8-letter word",         check: p => (p.longestWord || 0) >= 8, coins: 35 },
    { id: "lw_9",           cat: "longWords", label: "Nine Letter",         desc: "Find a 9-letter word",          check: p => (p.longestWord || 0) >= 9, coins: 50 },
    { id: "lw_10",          cat: "longWords", label: "Ten Letter",          desc: "Find a 10-letter word",         check: p => (p.longestWord || 0) >= 10, coins: 75 },
    { id: "lw_11",          cat: "longWords", label: "Eleven Letter",       desc: "Find an 11-letter word",        check: p => (p.longestWord || 0) >= 11, coins: 100 },
    { id: "lw_12",          cat: "longWords", label: "Twelve Letter",       desc: "Find a 12-letter word",         check: p => (p.longestWord || 0) >= 12, coins: 150 },
    { id: "lw_13",          cat: "longWords", label: "Thirteen Letter",     desc: "Find a 13-letter word",         check: p => (p.longestWord || 0) >= 13, coins: 200 },
    { id: "lw_14",          cat: "longWords", label: "Fourteen Letter",     desc: "Find a 14-letter word",         check: p => (p.longestWord || 0) >= 14, coins: 300 },
    { id: "lw_15",          cat: "longWords", label: "Fifteen Letter",      desc: "Find a 15-letter word",         check: p => (p.longestWord || 0) >= 15, coins: 500 },
    { id: "lw_long_10",     cat: "longWords", label: "Long Word Hunter",    desc: "Find 10 words of 6+ letters",   check: p => (p.longWordsFound || 0) >= 10, coins: 15 },
    { id: "lw_long_50",     cat: "longWords", label: "Long Word Seeker",    desc: "Find 50 words of 6+ letters",   check: p => (p.longWordsFound || 0) >= 50, coins: 40 },
    { id: "lw_long_200",    cat: "longWords", label: "Long Word Master",    desc: "Find 200 words of 6+ letters",  check: p => (p.longWordsFound || 0) >= 200, coins: 100 },

    // ─── COMBOS & STREAKS IN-GAME (12) ───
    { id: "combo_3",        cat: "combo",    label: "Triple Combo",          desc: "Get a 3x combo in a game",      check: p => (p.bestCombo || 0) >= 3, coins: 5 },
    { id: "combo_5",        cat: "combo",    label: "Combo Starter",         desc: "Get a 5x combo in a game",      check: p => (p.bestCombo || 0) >= 5, coins: 10 },
    { id: "combo_7",        cat: "combo",    label: "Combo Builder",         desc: "Get a 7x combo in a game",      check: p => (p.bestCombo || 0) >= 7, coins: 20 },
    { id: "combo_10",       cat: "combo",    label: "Combo King",            desc: "Get a 10x combo in a game",     check: p => (p.bestCombo || 0) >= 10, coins: 35 },
    { id: "combo_15",       cat: "combo",    label: "Combo Lord",            desc: "Get a 15x combo in a game",     check: p => (p.bestCombo || 0) >= 15, coins: 60 },
    { id: "combo_20",       cat: "combo",    label: "Combo Master",          desc: "Get a 20x combo in a game",     check: p => (p.bestCombo || 0) >= 20, coins: 100 },
    { id: "combo_25",       cat: "combo",    label: "Combo Legend",          desc: "Get a 25x combo in a game",     check: p => (p.bestCombo || 0) >= 25, coins: 150 },
    { id: "combo_30",       cat: "combo",    label: "Combo God",             desc: "Get a 30x combo in a game",     check: p => (p.bestCombo || 0) >= 30, coins: 250 },
    { id: "combo_total_50", cat: "combo",    label: "Combo Counter",         desc: "Achieve 50 total combos",       check: p => (p.totalCombos || 0) >= 50, coins: 15 },
    { id: "combo_total_200",cat: "combo",    label: "Combo Addict",          desc: "Achieve 200 total combos",      check: p => (p.totalCombos || 0) >= 200, coins: 40 },
    { id: "combo_total_500",cat: "combo",    label: "Combo Maniac",          desc: "Achieve 500 total combos",      check: p => (p.totalCombos || 0) >= 500, coins: 75 },
    { id: "combo_total_1k", cat: "combo",    label: "Combo Overlord",        desc: "Achieve 1,000 total combos",    check: p => (p.totalCombos || 0) >= 1000, coins: 150 },

    // ─── WORDS PER GAME (10) ───
    { id: "wpg_5",          cat: "wordsPerGame", label: "Five Words",        desc: "Find 5 words in one game",      check: p => (p.bestWordsInGame || 0) >= 5, coins: 3 },
    { id: "wpg_10",         cat: "wordsPerGame", label: "Ten Words",         desc: "Find 10 words in one game",     check: p => (p.bestWordsInGame || 0) >= 10, coins: 8 },
    { id: "wpg_15",         cat: "wordsPerGame", label: "Fifteen Words",     desc: "Find 15 words in one game",     check: p => (p.bestWordsInGame || 0) >= 15, coins: 15 },
    { id: "wpg_20",         cat: "wordsPerGame", label: "Twenty Words",      desc: "Find 20 words in one game",     check: p => (p.bestWordsInGame || 0) >= 20, coins: 25 },
    { id: "wpg_30",         cat: "wordsPerGame", label: "Thirty Words",      desc: "Find 30 words in one game",     check: p => (p.bestWordsInGame || 0) >= 30, coins: 40 },
    { id: "wpg_40",         cat: "wordsPerGame", label: "Forty Words",       desc: "Find 40 words in one game",     check: p => (p.bestWordsInGame || 0) >= 40, coins: 60 },
    { id: "wpg_50",         cat: "wordsPerGame", label: "Fifty Words",       desc: "Find 50 words in one game",     check: p => (p.bestWordsInGame || 0) >= 50, coins: 85 },
    { id: "wpg_75",         cat: "wordsPerGame", label: "Seventy-Five Words",desc: "Find 75 words in one game",     check: p => (p.bestWordsInGame || 0) >= 75, coins: 125 },
    { id: "wpg_100",        cat: "wordsPerGame", label: "Century Game",      desc: "Find 100 words in one game",    check: p => (p.bestWordsInGame || 0) >= 100, coins: 200 },
    { id: "wpg_150",        cat: "wordsPerGame", label: "Word Flood",        desc: "Find 150 words in one game",    check: p => (p.bestWordsInGame || 0) >= 150, coins: 350 },

    // ─── PERFECT GAMES (8) ───
    { id: "perf_clear",     cat: "perfect",  label: "Grid Cleaner",          desc: "Clear an entire grid",          check: p => (p.perfectClears || 0) >= 1, coins: 25 },
    { id: "perf_clear_5",   cat: "perfect",  label: "Clean Sweep",           desc: "Clear 5 entire grids",          check: p => (p.perfectClears || 0) >= 5, coins: 50 },
    { id: "perf_clear_10",  cat: "perfect",  label: "Immaculate",            desc: "Clear 10 entire grids",         check: p => (p.perfectClears || 0) >= 10, coins: 100 },
    { id: "perf_clear_25",  cat: "perfect",  label: "Perfectionist",         desc: "Clear 25 entire grids",         check: p => (p.perfectClears || 0) >= 25, coins: 200 },
    { id: "perf_no_miss",   cat: "perfect",  label: "No Mistakes",           desc: "Complete a game with 0 invalid attempts", check: p => (p.perfectGames || 0) >= 1, coins: 20 },
    { id: "perf_no_miss_5", cat: "perfect",  label: "Flawless Five",         desc: "Complete 5 games with 0 invalid attempts", check: p => (p.perfectGames || 0) >= 5, coins: 50 },
    { id: "perf_no_miss_10",cat: "perfect",  label: "Flawless Ten",          desc: "Complete 10 games with 0 invalid attempts", check: p => (p.perfectGames || 0) >= 10, coins: 100 },
    { id: "perf_no_miss_25",cat: "perfect",  label: "Impeccable",            desc: "Complete 25 games with 0 invalid attempts", check: p => (p.perfectGames || 0) >= 25, coins: 200 },

    // ─── TIME PLAYED (10) ───
    { id: "time_10m",       cat: "timePlayed", label: "Ten Minutes",        desc: "Play for 10 minutes total",     check: p => (p.totalPlayTimeMinutes || 0) >= 10, coins: 5 },
    { id: "time_30m",       cat: "timePlayed", label: "Half Hour",          desc: "Play for 30 minutes total",     check: p => (p.totalPlayTimeMinutes || 0) >= 30, coins: 10 },
    { id: "time_1h",        cat: "timePlayed", label: "One Hour",           desc: "Play for 1 hour total",         check: p => (p.totalPlayTimeMinutes || 0) >= 60, coins: 20 },
    { id: "time_3h",        cat: "timePlayed", label: "Three Hours",        desc: "Play for 3 hours total",        check: p => (p.totalPlayTimeMinutes || 0) >= 180, coins: 35 },
    { id: "time_5h",        cat: "timePlayed", label: "Five Hours",         desc: "Play for 5 hours total",        check: p => (p.totalPlayTimeMinutes || 0) >= 300, coins: 50 },
    { id: "time_10h",       cat: "timePlayed", label: "Ten Hours",          desc: "Play for 10 hours total",       check: p => (p.totalPlayTimeMinutes || 0) >= 600, coins: 75 },
    { id: "time_24h",       cat: "timePlayed", label: "Full Day",           desc: "Play for 24 hours total",       check: p => (p.totalPlayTimeMinutes || 0) >= 1440, coins: 150 },
    { id: "time_50h",       cat: "timePlayed", label: "Fifty Hours",        desc: "Play for 50 hours total",       check: p => (p.totalPlayTimeMinutes || 0) >= 3000, coins: 250 },
    { id: "time_100h",      cat: "timePlayed", label: "Century Hours",      desc: "Play for 100 hours total",      check: p => (p.totalPlayTimeMinutes || 0) >= 6000, coins: 500 },
    { id: "time_250h",      cat: "timePlayed", label: "Dedicated",          desc: "Play for 250 hours total",      check: p => (p.totalPlayTimeMinutes || 0) >= 15000, coins: 1000 },

    // ─── LETTER MASTERY (15) ───
    { id: "letter_q",       cat: "letters",  label: "Q Without U",           desc: "Use Q in a word without U",     check: p => (p.qWithoutU || 0) >= 1, coins: 25 },
    { id: "letter_x",       cat: "letters",  label: "X Marks the Word",      desc: "Find 10 words with X",          check: p => (p.wordsWithX || 0) >= 10, coins: 20 },
    { id: "letter_z",       cat: "letters",  label: "Zesty",                 desc: "Find 10 words with Z",          check: p => (p.wordsWithZ || 0) >= 10, coins: 20 },
    { id: "letter_j",       cat: "letters",  label: "J is for Joy",          desc: "Find 10 words with J",          check: p => (p.wordsWithJ || 0) >= 10, coins: 15 },
    { id: "letter_k",       cat: "letters",  label: "K is Key",              desc: "Find 20 words with K",          check: p => (p.wordsWithK || 0) >= 20, coins: 15 },
    { id: "letter_v",       cat: "letters",  label: "V for Victory",         desc: "Find 20 words with V",          check: p => (p.wordsWithV || 0) >= 20, coins: 12 },
    { id: "letter_w",       cat: "letters",  label: "W Wrangler",            desc: "Find 25 words with W",          check: p => (p.wordsWithW || 0) >= 25, coins: 12 },
    { id: "letter_y",       cat: "letters",  label: "Y Seeker",              desc: "Find 25 words with Y",          check: p => (p.wordsWithY || 0) >= 25, coins: 10 },
    { id: "letter_double",  cat: "letters",  label: "Double Trouble",        desc: "Find 20 words with double letters", check: p => (p.doubleLetterWords || 0) >= 20, coins: 20 },
    { id: "letter_triple",  cat: "letters",  label: "Triple Threat",         desc: "Find a word with triple letters", check: p => (p.tripleLetterWords || 0) >= 1, coins: 50 },
    { id: "letter_vowel",   cat: "letters",  label: "Vowel Heavy",           desc: "Find a word with 4+ vowels",    check: p => (p.highVowelWords || 0) >= 1, coins: 15 },
    { id: "letter_cons",    cat: "letters",  label: "Consonant Cluster",     desc: "Find a word with 4+ consonants in a row", check: p => (p.consonantClusterWords || 0) >= 1, coins: 25 },
    { id: "letter_all_vowel",cat: "letters", label: "All Five Vowels",       desc: "Find a word with A, E, I, O, U", check: p => (p.allVowelWords || 0) >= 1, coins: 75 },
    { id: "letter_rare_100",cat: "letters",  label: "Rare Letter Hunter",    desc: "Use 100 rare letters (Q,X,Z,J)", check: p => (p.rareLettersUsed || 0) >= 100, coins: 40 },
    { id: "letter_rare_500",cat: "letters",  label: "Rare Letter Master",    desc: "Use 500 rare letters (Q,X,Z,J)", check: p => (p.rareLettersUsed || 0) >= 500, coins: 100 },

    // ─── SCORE MILESTONES EXTENDED (12) ───
    { id: "score_75k",      cat: "score",    label: "Seventy-Five K",        desc: "Score 75,000+ in a game",       check: p => p.highScore >= 75000,    coins: 500 },
    { id: "score_100k",     cat: "score",    label: "Hundred Grand",         desc: "Score 100,000+ in a game",      check: p => p.highScore >= 100000,   coins: 750 },
    { id: "score_150k",     cat: "score",    label: "150 Thousand",          desc: "Score 150,000+ in a game",      check: p => p.highScore >= 150000,   coins: 1000 },
    { id: "score_200k",     cat: "score",    label: "Two Hundred K",         desc: "Score 200,000+ in a game",      check: p => p.highScore >= 200000,   coins: 1500 },
    { id: "ts_100k",        cat: "totalScore", label: "100K Total",          desc: "Earn 100,000 total score",      check: p => (p.totalScore || 0) >= 100000, coins: 25 },
    { id: "ts_500k",        cat: "totalScore", label: "500K Total",          desc: "Earn 500,000 total score",      check: p => (p.totalScore || 0) >= 500000, coins: 60 },
    { id: "ts_1m",          cat: "totalScore", label: "Million Total",       desc: "Earn 1,000,000 total score",    check: p => (p.totalScore || 0) >= 1000000, coins: 125 },
    { id: "ts_5m",          cat: "totalScore", label: "5 Million Total",     desc: "Earn 5,000,000 total score",    check: p => (p.totalScore || 0) >= 5000000, coins: 250 },
    { id: "ts_10m",         cat: "totalScore", label: "10 Million Total",    desc: "Earn 10,000,000 total score",   check: p => (p.totalScore || 0) >= 10000000, coins: 500 },
    { id: "ts_50m",         cat: "totalScore", label: "50 Million Total",    desc: "Earn 50,000,000 total score",   check: p => (p.totalScore || 0) >= 50000000, coins: 1000 },
    { id: "ts_100m",        cat: "totalScore", label: "100 Million Total",   desc: "Earn 100,000,000 total score",  check: p => (p.totalScore || 0) >= 100000000, coins: 2000 },
    { id: "ts_1b",          cat: "totalScore", label: "Billion Club",        desc: "Earn 1 billion total score",    check: p => (p.totalScore || 0) >= 1000000000, coins: 5000 },

    // ─── DAILY ACTIVITIES (10) ───
    { id: "daily_wotd_1",   cat: "daily",    label: "Word Learner",          desc: "Check Word of the Day once",    check: p => (p.wotdViewed || 0) >= 1, coins: 5 },
    { id: "daily_wotd_7",   cat: "daily",    label: "Weekly Words",          desc: "Check Word of the Day 7 times", check: p => (p.wotdViewed || 0) >= 7, coins: 15 },
    { id: "daily_wotd_30",  cat: "daily",    label: "Monthly Vocab",         desc: "Check Word of the Day 30 times", check: p => (p.wotdViewed || 0) >= 30, coins: 40 },
    { id: "daily_wotd_100", cat: "daily",    label: "Word Scholar",          desc: "Check Word of the Day 100 times", check: p => (p.wotdViewed || 0) >= 100, coins: 100 },
    { id: "daily_dict_1",   cat: "daily",    label: "Dictionary User",       desc: "Look up a word in the dictionary", check: p => (p.dictLookups || 0) >= 1, coins: 3 },
    { id: "daily_dict_25",  cat: "daily",    label: "Dictionary Browser",    desc: "Look up 25 words in the dictionary", check: p => (p.dictLookups || 0) >= 25, coins: 15 },
    { id: "daily_dict_100", cat: "daily",    label: "Dictionary Devotee",    desc: "Look up 100 words in the dictionary", check: p => (p.dictLookups || 0) >= 100, coins: 40 },
    { id: "daily_dict_500", cat: "daily",    label: "Dictionary Master",     desc: "Look up 500 words in the dictionary", check: p => (p.dictLookups || 0) >= 500, coins: 100 },
    { id: "daily_login_7",  cat: "daily",    label: "Weekly Player",         desc: "Play on 7 different days",      check: p => (p.uniqueDaysPlayed || 0) >= 7, coins: 15 },
    { id: "daily_login_30", cat: "daily",    label: "Monthly Regular",       desc: "Play on 30 different days",     check: p => (p.uniqueDaysPlayed || 0) >= 30, coins: 50 },

    // ─── EXTENDED UNIQUEDAYS (8) ───
    { id: "daily_login_60", cat: "daily",    label: "Two Month Veteran",     desc: "Play on 60 different days",     check: p => (p.uniqueDaysPlayed || 0) >= 60, coins: 75 },
    { id: "daily_login_90", cat: "daily",    label: "Quarterly Champion",    desc: "Play on 90 different days",     check: p => (p.uniqueDaysPlayed || 0) >= 90, coins: 100 },
    { id: "daily_login_180",cat: "daily",    label: "Half Year Hero",        desc: "Play on 180 different days",    check: p => (p.uniqueDaysPlayed || 0) >= 180, coins: 200 },
    { id: "daily_login_365",cat: "daily",    label: "Year Long Player",      desc: "Play on 365 different days",    check: p => (p.uniqueDaysPlayed || 0) >= 365, coins: 500 },
    { id: "daily_login_500",cat: "daily",    label: "500 Days",              desc: "Play on 500 different days",    check: p => (p.uniqueDaysPlayed || 0) >= 500, coins: 750 },
    { id: "daily_login_730",cat: "daily",    label: "Two Year Player",       desc: "Play on 730 different days",    check: p => (p.uniqueDaysPlayed || 0) >= 730, coins: 1000 },
    { id: "daily_login_1000",cat: "daily",   label: "Thousand Days",         desc: "Play on 1000 different days",   check: p => (p.uniqueDaysPlayed || 0) >= 1000, coins: 1500 },
    { id: "daily_login_1500",cat: "daily",   label: "Legendary Dedication",  desc: "Play on 1500 different days",   check: p => (p.uniqueDaysPlayed || 0) >= 1500, coins: 2500 },

    // ─── ROW CLEARS (10) ───
    { id: "rows_10",        cat: "rows",     label: "Row Clearer",           desc: "Clear 10 rows",                 check: p => (p.totalRowsCleared || 0) >= 10, coins: 5 },
    { id: "rows_50",        cat: "rows",     label: "Row Sweeper",           desc: "Clear 50 rows",                 check: p => (p.totalRowsCleared || 0) >= 50, coins: 15 },
    { id: "rows_100",       cat: "rows",     label: "Row Enthusiast",        desc: "Clear 100 rows",                check: p => (p.totalRowsCleared || 0) >= 100, coins: 25 },
    { id: "rows_250",       cat: "rows",     label: "Row Hunter",            desc: "Clear 250 rows",                check: p => (p.totalRowsCleared || 0) >= 250, coins: 40 },
    { id: "rows_500",       cat: "rows",     label: "Row Master",            desc: "Clear 500 rows",                check: p => (p.totalRowsCleared || 0) >= 500, coins: 60 },
    { id: "rows_1000",      cat: "rows",     label: "Row Champion",          desc: "Clear 1,000 rows",              check: p => (p.totalRowsCleared || 0) >= 1000, coins: 100 },
    { id: "rows_2500",      cat: "rows",     label: "Row Legend",            desc: "Clear 2,500 rows",              check: p => (p.totalRowsCleared || 0) >= 2500, coins: 175 },
    { id: "rows_5000",      cat: "rows",     label: "Row Titan",             desc: "Clear 5,000 rows",              check: p => (p.totalRowsCleared || 0) >= 5000, coins: 300 },
    { id: "rows_10000",     cat: "rows",     label: "Row God",               desc: "Clear 10,000 rows",             check: p => (p.totalRowsCleared || 0) >= 10000, coins: 500 },
    { id: "rows_game_10",   cat: "rows",     label: "Ten Row Game",          desc: "Clear 10 rows in one game",     check: p => (p.bestRowsInGame || 0) >= 10, coins: 25 },

    // ─── BLOCKS DROPPED (10) ───
    { id: "blocks_100",     cat: "blocks",   label: "Block Dropper",         desc: "Drop 100 blocks",               check: p => (p.totalBlocksDropped || 0) >= 100, coins: 5 },
    { id: "blocks_500",     cat: "blocks",   label: "Block Stacker",         desc: "Drop 500 blocks",               check: p => (p.totalBlocksDropped || 0) >= 500, coins: 15 },
    { id: "blocks_1000",    cat: "blocks",   label: "Block Builder",         desc: "Drop 1,000 blocks",             check: p => (p.totalBlocksDropped || 0) >= 1000, coins: 25 },
    { id: "blocks_2500",    cat: "blocks",   label: "Block Architect",       desc: "Drop 2,500 blocks",             check: p => (p.totalBlocksDropped || 0) >= 2500, coins: 40 },
    { id: "blocks_5000",    cat: "blocks",   label: "Block Engineer",        desc: "Drop 5,000 blocks",             check: p => (p.totalBlocksDropped || 0) >= 5000, coins: 60 },
    { id: "blocks_10000",   cat: "blocks",   label: "Block Master",          desc: "Drop 10,000 blocks",            check: p => (p.totalBlocksDropped || 0) >= 10000, coins: 100 },
    { id: "blocks_25000",   cat: "blocks",   label: "Block Champion",        desc: "Drop 25,000 blocks",            check: p => (p.totalBlocksDropped || 0) >= 25000, coins: 175 },
    { id: "blocks_50000",   cat: "blocks",   label: "Block Legend",          desc: "Drop 50,000 blocks",            check: p => (p.totalBlocksDropped || 0) >= 50000, coins: 300 },
    { id: "blocks_100000",  cat: "blocks",   label: "Block Titan",           desc: "Drop 100,000 blocks",           check: p => (p.totalBlocksDropped || 0) >= 100000, coins: 500 },
    { id: "blocks_250000",  cat: "blocks",   label: "Block God",             desc: "Drop 250,000 blocks",           check: p => (p.totalBlocksDropped || 0) >= 250000, coins: 1000 },

    // ─── BONUS TILES (12) ───
    { id: "bonus_2x_10",    cat: "bonus",    label: "Double Collector",      desc: "Collect 10 2x bonus tiles",     check: p => (p.bonus2xCollected || 0) >= 10, coins: 10 },
    { id: "bonus_2x_50",    cat: "bonus",    label: "Double Hunter",         desc: "Collect 50 2x bonus tiles",     check: p => (p.bonus2xCollected || 0) >= 50, coins: 25 },
    { id: "bonus_2x_200",   cat: "bonus",    label: "Double Master",         desc: "Collect 200 2x bonus tiles",    check: p => (p.bonus2xCollected || 0) >= 200, coins: 60 },
    { id: "bonus_3x_10",    cat: "bonus",    label: "Triple Collector",      desc: "Collect 10 3x bonus tiles",     check: p => (p.bonus3xCollected || 0) >= 10, coins: 15 },
    { id: "bonus_3x_50",    cat: "bonus",    label: "Triple Hunter",         desc: "Collect 50 3x bonus tiles",     check: p => (p.bonus3xCollected || 0) >= 50, coins: 40 },
    { id: "bonus_3x_200",   cat: "bonus",    label: "Triple Master",         desc: "Collect 200 3x bonus tiles",    check: p => (p.bonus3xCollected || 0) >= 200, coins: 100 },
    { id: "bonus_wild_5",   cat: "bonus",    label: "Wild Card User",        desc: "Use 5 wild tiles",              check: p => (p.wildTilesUsed || 0) >= 5, coins: 15 },
    { id: "bonus_wild_25",  cat: "bonus",    label: "Wild Card Fan",         desc: "Use 25 wild tiles",             check: p => (p.wildTilesUsed || 0) >= 25, coins: 40 },
    { id: "bonus_wild_100", cat: "bonus",    label: "Wild Card Master",      desc: "Use 100 wild tiles",            check: p => (p.wildTilesUsed || 0) >= 100, coins: 100 },
    { id: "bonus_freeze_5", cat: "bonus",    label: "Freeze User",           desc: "Use 5 freeze power-ups",        check: p => (p.freezeUsed || 0) >= 5, coins: 15 },
    { id: "bonus_freeze_25",cat: "bonus",    label: "Freeze Fan",            desc: "Use 25 freeze power-ups",       check: p => (p.freezeUsed || 0) >= 25, coins: 40 },
    { id: "bonus_freeze_100",cat: "bonus",   label: "Freeze Master",         desc: "Use 100 freeze power-ups",      check: p => (p.freezeUsed || 0) >= 100, coins: 100 },

    // ─── WORD SEARCH EXTENDED (10) ───
    { id: "ws_level_75",    cat: "wordSearch", label: "Search Tier 75",     desc: "Reach Word Search level 75",    check: p => (p.challengeStats?.["word-search"]?.wordSearchLevel || 1) >= 75, coins: 400 },
    { id: "ws_level_100",   cat: "wordSearch", label: "Search Tier 100",    desc: "Reach Word Search level 100",   check: p => (p.challengeStats?.["word-search"]?.wordSearchLevel || 1) >= 100, coins: 600 },
    { id: "ws_play_100",    cat: "wordSearch", label: "Search Centurion",   desc: "Play 100 Word Searches",        check: p => (p.challengeStats?.["word-search"]?.gamesPlayed || 0) >= 100, coins: 175 },
    { id: "ws_play_250",    cat: "wordSearch", label: "Search Veteran",     desc: "Play 250 Word Searches",        check: p => (p.challengeStats?.["word-search"]?.gamesPlayed || 0) >= 250, coins: 300 },
    { id: "ws_play_500",    cat: "wordSearch", label: "Search Master",      desc: "Play 500 Word Searches",        check: p => (p.challengeStats?.["word-search"]?.gamesPlayed || 0) >= 500, coins: 500 },
    { id: "ws_score_5k",    cat: "wordSearch", label: "Search Score 5K",    desc: "Score 5,000+ in Word Search",   check: p => (p.challengeStats?.["word-search"]?.highScore || 0) >= 5000, coins: 150 },
    { id: "ws_score_10k",   cat: "wordSearch", label: "Search Score 10K",   desc: "Score 10,000+ in Word Search",  check: p => (p.challengeStats?.["word-search"]?.highScore || 0) >= 10000, coins: 300 },
    { id: "ws_words_100",   cat: "wordSearch", label: "Search Words 100",   desc: "Find 100 words in Word Search", check: p => (p.challengeStats?.["word-search"]?.totalWords || 0) >= 100, coins: 30 },
    { id: "ws_words_500",   cat: "wordSearch", label: "Search Words 500",   desc: "Find 500 words in Word Search", check: p => (p.challengeStats?.["word-search"]?.totalWords || 0) >= 500, coins: 75 },
    { id: "ws_words_1000",  cat: "wordSearch", label: "Search Words 1K",    desc: "Find 1,000 words in Word Search", check: p => (p.challengeStats?.["word-search"]?.totalWords || 0) >= 1000, coins: 150 },

    // ─── WORD RUNNER EXTENDED (10) ───
    { id: "wr_play_100",    cat: "wordRunner", label: "Runner Centurion",   desc: "Play 100 Word Runners",         check: p => (p.challengeStats?.["word-runner"]?.gamesPlayed || 0) >= 100, coins: 175 },
    { id: "wr_play_250",    cat: "wordRunner", label: "Runner Veteran",     desc: "Play 250 Word Runners",         check: p => (p.challengeStats?.["word-runner"]?.gamesPlayed || 0) >= 250, coins: 300 },
    { id: "wr_play_500",    cat: "wordRunner", label: "Runner Master",      desc: "Play 500 Word Runners",         check: p => (p.challengeStats?.["word-runner"]?.gamesPlayed || 0) >= 500, coins: 500 },
    { id: "wr_score_10k",   cat: "wordRunner", label: "Runner Score 10K",   desc: "Score 10,000+ in Word Runner",  check: p => (p.challengeStats?.["word-runner"]?.highScore || 0) >= 10000, coins: 400 },
    { id: "wr_score_25k",   cat: "wordRunner", label: "Runner Score 25K",   desc: "Score 25,000+ in Word Runner",  check: p => (p.challengeStats?.["word-runner"]?.highScore || 0) >= 25000, coins: 750 },
    { id: "wr_distance_1k", cat: "wordRunner", label: "Run 1,000m",         desc: "Run 1,000 meters total",        check: p => (p.challengeStats?.["word-runner"]?.totalDistance || 0) >= 1000, coins: 25 },
    { id: "wr_distance_10k",cat: "wordRunner", label: "Run 10,000m",        desc: "Run 10,000 meters total",       check: p => (p.challengeStats?.["word-runner"]?.totalDistance || 0) >= 10000, coins: 75 },
    { id: "wr_distance_50k",cat: "wordRunner", label: "Run 50,000m",        desc: "Run 50,000 meters total",       check: p => (p.challengeStats?.["word-runner"]?.totalDistance || 0) >= 50000, coins: 200 },
    { id: "wr_distance_100k",cat: "wordRunner", label: "Run 100km",         desc: "Run 100,000 meters total",      check: p => (p.challengeStats?.["word-runner"]?.totalDistance || 0) >= 100000, coins: 400 },
    { id: "wr_distance_1m", cat: "wordRunner", label: "Marathon Runner",    desc: "Run 1,000,000 meters total",    check: p => (p.challengeStats?.["word-runner"]?.totalDistance || 0) >= 1000000, coins: 1000 },

    // ─── TARGET WORD EXTENDED (8) ───
    { id: "tw_level_75",    cat: "targetWord", label: "Target Tier 75",     desc: "Reach Target Word level 75",    check: p => (p.challengeStats?.["target-word"]?.targetWordLevel || 1) >= 75, coins: 400 },
    { id: "tw_level_100",   cat: "targetWord", label: "Target Tier 100",    desc: "Reach Target Word level 100",   check: p => (p.challengeStats?.["target-word"]?.targetWordLevel || 1) >= 100, coins: 600 },
    { id: "tw_play_100",    cat: "targetWord", label: "Target Centurion",   desc: "Play 100 Target Word challenges", check: p => (p.challengeStats?.["target-word"]?.gamesPlayed || 0) >= 100, coins: 175 },
    { id: "tw_play_250",    cat: "targetWord", label: "Target Veteran",     desc: "Play 250 Target Word challenges", check: p => (p.challengeStats?.["target-word"]?.gamesPlayed || 0) >= 250, coins: 300 },
    { id: "tw_play_500",    cat: "targetWord", label: "Target Hero",        desc: "Play 500 Target Word challenges", check: p => (p.challengeStats?.["target-word"]?.gamesPlayed || 0) >= 500, coins: 500 },
    { id: "tw_perfect_1",   cat: "targetWord", label: "Perfect Target",     desc: "Complete Target Word without missing", check: p => (p.challengeStats?.["target-word"]?.perfectGames || 0) >= 1, coins: 50 },
    { id: "tw_perfect_10",  cat: "targetWord", label: "Perfect Ten Targets",desc: "Complete 10 perfect Target Words", check: p => (p.challengeStats?.["target-word"]?.perfectGames || 0) >= 10, coins: 150 },
    { id: "tw_perfect_50",  cat: "targetWord", label: "Target Perfectionist",desc: "Complete 50 perfect Target Words", check: p => (p.challengeStats?.["target-word"]?.perfectGames || 0) >= 50, coins: 400 },

    // ─── SPEED ROUND EXTENDED (8) ───
    { id: "sr_play_100",    cat: "speedRound", label: "Speed Centurion",    desc: "Play 100 Speed Rounds",         check: p => (p.challengeStats?.["speed-round"]?.gamesPlayed || 0) >= 100, coins: 175 },
    { id: "sr_play_250",    cat: "speedRound", label: "Speed Veteran",      desc: "Play 250 Speed Rounds",         check: p => (p.challengeStats?.["speed-round"]?.gamesPlayed || 0) >= 250, coins: 300 },
    { id: "sr_play_500",    cat: "speedRound", label: "Speed Hero",         desc: "Play 500 Speed Rounds",         check: p => (p.challengeStats?.["speed-round"]?.gamesPlayed || 0) >= 500, coins: 500 },
    { id: "sr_score_5000",  cat: "speedRound", label: "Speed Score 5K",     desc: "Score 5,000+ in Speed Round",   check: p => (p.challengeStats?.["speed-round"]?.highScore || 0) >= 5000, coins: 200 },
    { id: "sr_score_10000", cat: "speedRound", label: "Speed Score 10K",    desc: "Score 10,000+ in Speed Round",  check: p => (p.challengeStats?.["speed-round"]?.highScore || 0) >= 10000, coins: 400 },
    { id: "sr_words_100",   cat: "speedRound", label: "Speed Words 100",    desc: "Find 100 words in Speed Rounds", check: p => (p.challengeStats?.["speed-round"]?.totalWords || 0) >= 100, coins: 30 },
    { id: "sr_words_500",   cat: "speedRound", label: "Speed Words 500",    desc: "Find 500 words in Speed Rounds", check: p => (p.challengeStats?.["speed-round"]?.totalWords || 0) >= 500, coins: 75 },
    { id: "sr_words_1000",  cat: "speedRound", label: "Speed Words 1K",     desc: "Find 1,000 words in Speed Rounds", check: p => (p.challengeStats?.["speed-round"]?.totalWords || 0) >= 1000, coins: 150 },

    // ─── WORD CATEGORY EXTENDED (8) ───
    { id: "wc_play_100",    cat: "wordCat",  label: "Category Centurion",   desc: "Play 100 Word Category challenges", check: p => (p.challengeStats?.["word-category"]?.gamesPlayed || 0) >= 100, coins: 175 },
    { id: "wc_play_250",    cat: "wordCat",  label: "Category Veteran",     desc: "Play 250 Word Category challenges", check: p => (p.challengeStats?.["word-category"]?.gamesPlayed || 0) >= 250, coins: 300 },
    { id: "wc_play_500",    cat: "wordCat",  label: "Category Hero",        desc: "Play 500 Word Category challenges", check: p => (p.challengeStats?.["word-category"]?.gamesPlayed || 0) >= 500, coins: 500 },
    { id: "wc_score_5000",  cat: "wordCat",  label: "Cat. Score 5K",        desc: "Score 5,000+ in Word Category", check: p => (p.challengeStats?.["word-category"]?.highScore || 0) >= 5000, coins: 200 },
    { id: "wc_score_10000", cat: "wordCat",  label: "Cat. Score 10K",       desc: "Score 10,000+ in Word Category", check: p => (p.challengeStats?.["word-category"]?.highScore || 0) >= 10000, coins: 400 },
    { id: "wc_cats_5",      cat: "wordCat",  label: "Five Categories",      desc: "Complete 5 different categories", check: p => (p.challengeStats?.["word-category"]?.categoriesCompleted || 0) >= 5, coins: 30 },
    { id: "wc_cats_15",     cat: "wordCat",  label: "Fifteen Categories",   desc: "Complete 15 different categories", check: p => (p.challengeStats?.["word-category"]?.categoriesCompleted || 0) >= 15, coins: 75 },
    { id: "wc_cats_all",    cat: "wordCat",  label: "All Categories",       desc: "Complete all available categories", check: p => (p.challengeStats?.["word-category"]?.categoriesCompleted || 0) >= 30, coins: 200 },

    // ─── EXTENDED META MILESTONES (10) ───
    { id: "meta_175",       cat: "meta",     label: "175 Milestones",        desc: "Earn 175 milestones",           check: p => (p.claimedMilestones || []).length >= 175, coins: 400 },
    { id: "meta_200",       cat: "meta",     label: "200 Milestones",        desc: "Earn 200 milestones",           check: p => (p.claimedMilestones || []).length >= 200, coins: 500 },
    { id: "meta_225",       cat: "meta",     label: "225 Milestones",        desc: "Earn 225 milestones",           check: p => (p.claimedMilestones || []).length >= 225, coins: 600 },
    { id: "meta_250",       cat: "meta",     label: "250 Milestones",        desc: "Earn 250 milestones",           check: p => (p.claimedMilestones || []).length >= 250, coins: 750 },
    { id: "meta_275",       cat: "meta",     label: "275 Milestones",        desc: "Earn 275 milestones",           check: p => (p.claimedMilestones || []).length >= 275, coins: 900 },
    { id: "meta_300",       cat: "meta",     label: "300 Milestones",        desc: "Earn 300 milestones",           check: p => (p.claimedMilestones || []).length >= 300, coins: 1100 },
    { id: "meta_325",       cat: "meta",     label: "325 Milestones",        desc: "Earn 325 milestones",           check: p => (p.claimedMilestones || []).length >= 325, coins: 1300 },
    { id: "meta_350",       cat: "meta",     label: "350 Milestones",        desc: "Earn 350 milestones",           check: p => (p.claimedMilestones || []).length >= 350, coins: 1500 },
    { id: "meta_375",       cat: "meta",     label: "375 Milestones",        desc: "Earn 375 milestones",           check: p => (p.claimedMilestones || []).length >= 375, coins: 1750 },
    { id: "meta_400",       cat: "meta",     label: "400 Club",              desc: "Earn 400 milestones",           check: p => (p.claimedMilestones || []).length >= 400, coins: 2000 },

    // ─── SOCIAL & MISC (6) ───
    { id: "soc_share_1",    cat: "social",   label: "First Share",           desc: "Share your score once",         check: p => (p.timesShared || 0) >= 1, coins: 10 },
    { id: "soc_share_10",   cat: "social",   label: "Social Sharer",         desc: "Share your score 10 times",     check: p => (p.timesShared || 0) >= 10, coins: 30 },
    { id: "soc_share_50",   cat: "social",   label: "Social Star",           desc: "Share your score 50 times",     check: p => (p.timesShared || 0) >= 50, coins: 75 },
    { id: "soc_leaderboard",cat: "social",   label: "Competitive",           desc: "View the leaderboard",          check: p => (p.leaderboardViews || 0) >= 1, coins: 5 },
    { id: "soc_top_100",    cat: "social",   label: "Top 100",               desc: "Reach top 100 on leaderboard",  check: p => (p.bestLeaderboardRank || 999999) <= 100, coins: 100 },
    { id: "soc_top_10",     cat: "social",   label: "Top 10",                desc: "Reach top 10 on leaderboard",   check: p => (p.bestLeaderboardRank || 999999) <= 10, coins: 500 },

    // ─── VARIETY ACHIEVEMENTS (8) ───
    { id: "var_all_modes",  cat: "variety",  label: "Mode Explorer",         desc: "Play all 3 game modes",         check: p => (p.modesPlayed || 0) >= 3, coins: 25 },
    { id: "var_all_chal",   cat: "variety",  label: "Challenge Explorer",    desc: "Try all 5 challenge types",     check: p => (p.challengeTypesPlayed || 0) >= 5, coins: 50 },
    { id: "var_themes_3",   cat: "variety",  label: "Theme Collector",       desc: "Unlock 3 themes",               check: p => (p.themesUnlocked || 0) >= 3, coins: 30 },
    { id: "var_themes_all", cat: "variety",  label: "Theme Master",          desc: "Unlock all themes",             check: p => (p.themesUnlocked || 0) >= 10, coins: 150 },
    { id: "var_powerup_1",  cat: "variety",  label: "Power Up",              desc: "Use any power-up",              check: p => (p.powerupsUsed || 0) >= 1, coins: 5 },
    { id: "var_powerup_50", cat: "variety",  label: "Power User",            desc: "Use 50 power-ups",              check: p => (p.powerupsUsed || 0) >= 50, coins: 40 },
    { id: "var_powerup_200",cat: "variety",  label: "Power Master",          desc: "Use 200 power-ups",             check: p => (p.powerupsUsed || 0) >= 200, coins: 100 },
    { id: "var_first_win",  cat: "variety",  label: "First Victory",         desc: "Win your first game",           check: p => (p.gamesWon || 0) >= 1, coins: 10 },
];

// ── Shop catalog ──
const SHOP_CATEGORIES = {
    GRID_THEMES: "grid_themes",
    BLOCK_STYLES: "block_styles",
    BONUS_SLOTS: "bonus_slots",
    STARTING_PERKS: "starting_perks",
};

const SHOP_ITEMS = {
    // ── Grid Themes (cosmetic) ──
    theme_default:   { category: SHOP_CATEGORIES.GRID_THEMES,   name: "Classic",    price: 0,    preview: "Default olive tones",     owned: true },
    theme_obsidian:  { category: SHOP_CATEGORIES.GRID_THEMES,   name: "Obsidian",   price: 1050, preview: "Dark glass, subtle glow" },
    theme_charcoal:  { category: SHOP_CATEGORIES.GRID_THEMES,   name: "Charcoal",   price: 825,  preview: "Smoky graphite, amber ink" },
    theme_neon:      { category: SHOP_CATEGORIES.GRID_THEMES,   name: "Neon",       price: 1350, preview: "Bright outlines, dark bg" },
    theme_ocean:     { category: SHOP_CATEGORIES.GRID_THEMES,   name: "Ocean",      price: 1200, preview: "Blue tones, wave clears" },
    theme_ember:     { category: SHOP_CATEGORIES.GRID_THEMES,   name: "Ember",      price: 1350, preview: "Warm reds, fire particles" },
    theme_amethyst:  { category: SHOP_CATEGORIES.GRID_THEMES,   name: "Amethyst",   price: 1200, preview: "Deep crystal violet glow" },
    theme_darkoak:   { category: SHOP_CATEGORIES.GRID_THEMES,   name: "Dark Oak",   price: 1200, preview: "Rich dark wood grain" },

    // ── Letter Block Styles (cosmetic) ──
    block_default:   { category: SHOP_CATEGORIES.BLOCK_STYLES,  name: "Standard",   price: 0,    preview: "Default clean letters",    owned: true },
    block_scrabble:  { category: SHOP_CATEGORIES.BLOCK_STYLES,  name: "Scrabble",   price: 675,  preview: "Wooden tiles with points" },
    block_bubble:    { category: SHOP_CATEGORIES.BLOCK_STYLES,  name: "Bubble",     price: 525,  preview: "Rounded, bouncy feel" },
    block_typewriter:{ category: SHOP_CATEGORIES.BLOCK_STYLES,  name: "Typewriter",  price: 825,  preview: "Monospace, inked look" },
    block_pixel:     { category: SHOP_CATEGORIES.BLOCK_STYLES,  name: "Pixel",      price: 975,  preview: "Retro 8-bit blocks" },
    block_glass:     { category: SHOP_CATEGORIES.BLOCK_STYLES,  name: "Glass",      price: 1125, preview: "Translucent refractions" },

    // ── Bonus Slots (permanent, sequential unlock) ──
    bonus_slot_1:    { category: SHOP_CATEGORIES.BONUS_SLOTS,   name: "Slot 1",     price: 3000, preview: "First bonus slot",  unique: true },
    bonus_slot_2:    { category: SHOP_CATEGORIES.BONUS_SLOTS,   name: "Slot 2",     price: 6000, preview: "Second bonus slot", unique: true },
    bonus_slot_3:    { category: SHOP_CATEGORIES.BONUS_SLOTS,   name: "Slot 3",     price: 9000, preview: "Third bonus slot",  unique: true },

    // ── Starting Perks (consumable) ──
    perk_headstart:  { category: SHOP_CATEGORIES.STARTING_PERKS, name: "Head Start",     price: 675,  preview: "+200 bonus points at start",       stackSize: 1 },
    perk_slowstart:  { category: SHOP_CATEGORIES.STARTING_PERKS, name: "Slow Start",     price: 975,  preview: "0.5× fall speed for 30s",          stackSize: 1 },
    perk_bonusboost: { category: SHOP_CATEGORIES.STARTING_PERKS, name: "Bonus Boost",    price: 1125, preview: "First bonus at 500 pts",           stackSize: 1 },
    perk_comboext:   { category: SHOP_CATEGORIES.STARTING_PERKS, name: "Combo Extender", price: 975,  preview: "+4s combo window this game",       stackSize: 1 },
    perk_luckydraw:  { category: SHOP_CATEGORIES.STARTING_PERKS, name: "Lucky Draw",     price: 1275, preview: "First bonus = bomb/wild/2×",      stackSize: 1 },
};

// ── Grid size gating (level + coin cost to unlock) ──
const GRID_UNLOCK_REQUIREMENTS = {
    3: { level: 10, coins: 0, label: "3×3 Extreme" },
    4: { level: 5,  coins: 0, label: "4×4 Compact" },
    5: { level: 0,  coins: 0, label: "5×5 Standard" },
    6: { level: 0,  coins: 0, label: "6×6 Standard" },
    7: { level: 0,  coins: 0, label: "7×7 Wide" },
    8: { level: 3,  coins: 0, label: "8×8 Grand" },
};

// ── Theme color palettes for the renderer ──
const GRID_THEMES = {
    theme_default: {
        bg: "#2f3029", cell: "#3a3933", buffer: "#282822",
        gridLine: "#4a493e", text: "#fff", textFalling: "#e2d8a6",
        ghost: "rgba(226, 216, 166, 0.08)", ghostBorder: "rgba(226, 216, 166, 0.45)",
        border: "#e2d8a6", separator: "#e2d8a655",
    },
    theme_obsidian: {
        bg: "#121218", cell: "#1c1c26", buffer: "#0d0d14",
        gridLine: "#2a2a3a", text: "#d0d0e8", textFalling: "#a0a0d0",
        ghost: "rgba(160, 160, 208, 0.08)", ghostBorder: "rgba(160, 160, 208, 0.4)",
        border: "#8080c0", separator: "#404066",
        glow: "rgba(100, 100, 200, 0.15)",
    },
    theme_charcoal: {
        bg: "#1a1a1e", cell: "#252528", buffer: "#131315",
        gridLine: "#333338", text: "#d4c8a8", textFalling: "#e8b84c",
        ghost: "rgba(232, 184, 76, 0.08)", ghostBorder: "rgba(232, 184, 76, 0.35)",
        border: "#c8a44c", separator: "#44444855",
        glow: "rgba(232, 184, 76, 0.1)",
    },
    theme_neon: {
        bg: "#0a0a14", cell: "#0f0f1e", buffer: "#060610",
        gridLine: "#1a1a30", text: "#00ffaa", textFalling: "#ff00ff",
        ghost: "rgba(0, 255, 170, 0.08)", ghostBorder: "rgba(0, 255, 170, 0.4)",
        border: "#ff00ff", separator: "#00ffaa44",
        glow: "rgba(0, 255, 170, 0.2)",
    },
    theme_ocean: {
        bg: "#0a1a2e", cell: "#122640", buffer: "#081420",
        gridLine: "#1a3658", text: "#b0d8f0", textFalling: "#60b0e0",
        ghost: "rgba(96, 176, 224, 0.08)", ghostBorder: "rgba(96, 176, 224, 0.4)",
        border: "#60b0e0", separator: "#3060a055",
    },
    theme_ember: {
        bg: "#1a0a0a", cell: "#2a1210", buffer: "#120808",
        gridLine: "#3a1a18", text: "#f0c0a0", textFalling: "#ff6644",
        ghost: "rgba(255, 102, 68, 0.08)", ghostBorder: "rgba(255, 102, 68, 0.4)",
        border: "#ff6644", separator: "#ff442244",
        glow: "rgba(255, 80, 40, 0.15)",
    },
    theme_amethyst: {
        bg: "#120a1e", cell: "#1c1230", buffer: "#0c0616",
        gridLine: "#2a1c44", text: "#d4b8f0", textFalling: "#b070e8",
        ghost: "rgba(176, 112, 232, 0.08)", ghostBorder: "rgba(176, 112, 232, 0.4)",
        border: "#9050d0", separator: "#6030a055",
        glow: "rgba(144, 80, 208, 0.18)",
    },
    theme_darkoak: {
        bg: "#1e1408", cell: "#2a1c0e", buffer: "#160e04",
        gridLine: "#3a2a16", text: "#e8d8b8", textFalling: "#d4b87a",
        ghost: "rgba(212, 184, 122, 0.08)", ghostBorder: "rgba(212, 184, 122, 0.4)",
        border: "#a08040", separator: "#6a502855",
    },
};

// ── Block style definitions for the renderer ──
const BLOCK_STYLES = {
    block_default:    { type: "flat" },
    block_scrabble:   { type: "scrabble",   tileColor: "#d4b87a", tileBorder: "#a08848", showPoints: true },
    block_bubble:     { type: "bubble",     radius: 0.42 },
    block_typewriter: { type: "typewriter", fontFamily: "'Courier New', monospace", inkColor: "#222" },
    block_pixel:      { type: "pixel",      pixelScale: 0.12 },
    block_glass:      { type: "glass",      opacity: 0.7 },
};

// ── Clear effect definitions ──
const CLEAR_EFFECTS = {
    clear_default:   { type: "particles" },
    clear_confetti:  { type: "confetti",   colors: ["#ff6b6b","#ffd93d","#6bcb77","#4d96ff","#ff6bb5"] },
    clear_shatter:   { type: "shatter",    fragments: 8 },
    clear_dissolve:  { type: "dissolve",   fadeTime: 0.8 },
    clear_lightning: { type: "lightning",   boltWidth: 3 },
    clear_bloom:     { type: "bloom",      petalCount: 12 },
};

/** Calculate coins earned for a single word based on its length. */
function coinsForWord(wordLength) {
    if (wordLength >= 7) return 7;
    return COIN_PER_WORD_LENGTH[wordLength] || 1;
}

/** Word-runner coin rates — higher payouts since words are harder to form in real-time. */
const WR_COIN_PER_WORD_LENGTH = { 3: 33, 4: 67, 5: 117, 6: 167, 7: 233 };
function coinsForWordRunner(wordLength) {
    if (wordLength >= 7) return 14;
    return WR_COIN_PER_WORD_LENGTH[wordLength] || 2;
}

/** Calculate coins earned at game end. */
function calculateGameCoins({ score, wordsFound, isNewHighScore, isChallenge, challengeType,
                              comboMax, playerLevel, isFirstGameToday, playStreak }) {
    // If no words were found, no coins earned — you must find at least 1 word
    const wordCount = Array.isArray(wordsFound) ? wordsFound.length : (wordsFound || 0);
    if (wordCount === 0) return 0;
    // If score is 0, no coins earned (must actually score to earn)
    if (score <= 0) return 0;

    let coins = 0;
    // Per-word coins (already counted during gameplay for combo bonuses)
    // Game completion bonus (8 base + 5 per 500 pts, max 25)
    coins += COIN_GAME_COMPLETE_BASE + Math.min(25, Math.floor(score / 500) * COIN_GAME_COMPLETE_PER_500);
    // High score bonus
    if (isNewHighScore && score > 0) coins += COIN_HIGH_SCORE_BEATEN;
    // Challenge bonus
    if (isChallenge) {
        const tier = challengeType === "speed_round" ? 3 : challengeType === "word_category" ? 2 : 1;
        coins += COIN_CHALLENGE_COMPLETE_BASE + (tier - 1) * COIN_CHALLENGE_TIER_MULT;
    }
    // Daily first game
    if (isFirstGameToday) coins += COIN_DAILY_FIRST_GAME;
    // Play streak
    if (playStreak > 0) coins += Math.min(COIN_STREAK_MAX, playStreak * COIN_STREAK_PER_DAY);
    return coins;
}

// ────────────────────────────────────────
// LEVELING / XP SYSTEM
// ────────────────────────────────────────
const MAX_LEVEL = 500;

/** XP required to advance from `level` to `level + 1`. */
function xpRequiredForLevel(level) {
    return Math.floor(100 + 20 * Math.pow(Math.max(level - 1, 0), 1.3));
}

/**
 * Calculate XP earned from a single game using multi-factor analysis.
 *
 * Factors weighted:
 *   1. Base XP          – score^0.75 (diminishing returns via power curve)
 *   2. Grid difficulty   – 6/gridSize ratio (smaller grid = harder = more XP)
 *   3. Word quality      – average word length (sigmoid), longest word (log),
 *                          total words found (square root)
 *   4. Difficulty mode   – hard ×2.0
 *   5. Game mode         – timed ×1.3–1.6 (shorter timer = more),
 *                          challenge speed ×1.75, target ×1.5, category ×1.4
 *   6. Time pressure     – quadratic curve rewarding surviving longer in timed modes
 *   7. Target words      – logarithmic stacking bonus per target completed
 *   8. Performance vs PB – sigmoid curve (smooth bonus/penalty vs personal best)
 *   9. Level scaling     – log₁₀ progression to keep pace with rising thresholds
 *  10. Combo chain       – sustained combos add bonus XP (log₂ scaling)
 */
function calculateGameXP({ score, wordsFound, gridSize, difficulty, gameMode,
                            isChallenge, challengeType, previousBest, playerLevel,
                            timeLimitSeconds, timeRemainingSeconds, targetWordsCompleted,
                            bonusWordsCompleted, categoryKey, comboMax }) {
    if (score <= 0) return 1;

    // ═══ 1. BASE XP (power-curve diminishing returns) ═══
    // score^0.75 rewards all ranges while compressing extremes.
    // 100pts→16, 500pts→42, 1000pts→71, 2000pts→119, 5000pts→238
    let xp = Math.max(1, Math.floor(0.4 * Math.pow(score, 0.75)));

    // ═══ 2. GRID DIFFICULTY FACTOR ═══
    // Derived from cell-count ratio: fewer cells = harder placement.
    // 6×6 is the reference (1.0×). 3×3→2.0×, 4×4→1.5×, 5×5→1.2×,
    // 7×7→0.857×, 8×8→0.75×
    const gridFactor = 6 / gridSize;
    xp = Math.floor(xp * gridFactor);

    // ═══ 3. WORD QUALITY ANALYSIS ═══
    const wordEntries = Array.isArray(wordsFound) ? wordsFound : [];
    const wordLengths = wordEntries
        .map(w => (w.word || "").length)
        .filter(l => l > 0);
    const totalWords = wordLengths.length;

    if (totalWords > 0) {
        const avgLen = wordLengths.reduce((a, b) => a + b, 0) / totalWords;
        const longestLen = Math.max(...wordLengths);

        // a) Average word length bonus — sigmoid centered at 4.5 letters
        //    avgLen 3→+2%, 4→+10%, 5→+24%, 6+→+30%
        const avgBonus = 0.3 / (1 + Math.exp(-2 * (avgLen - 4.5)));

        // b) Longest word bonus — log scale, caps at +20%
        //    5-letter→+8%, 6→+13%, 7→+17%, 8+→+20%
        const longBonus = Math.min(0.2, Math.log2(Math.max(1, longestLen - 2)) * 0.07);

        // c) Word count bonus — sqrt diminishing returns (additive)
        //    5 words→+18xp, 10→+25, 20→+36, 50→+57
        const wordCountXP = Math.floor(8 * Math.sqrt(totalWords));

        xp = Math.floor(xp * (1 + avgBonus + longBonus)) + wordCountXP;
    }

    // ═══ 4. DIFFICULTY MULTIPLIER ═══
    // Hard mode is punishing — reward proportionally (Pokemon-style).
    // normal→1.0×, hard→2.0×
    if (difficulty === "hard") xp = Math.floor(xp * 2.0);

    // ═══ 5. GAME MODE MULTIPLIER ═══
    // Each mode has a distinct reward tier to encourage variety.
    if (isChallenge) {
        // Speed round = highest pressure, most rewarding.
        // Target word = focused skill test.
        // Word category = knowledge-based, tier bonus handled in §7 additive.
        if (challengeType === CHALLENGE_TYPES.SPEED_ROUND) {
            xp = Math.floor(xp * 1.75);
        } else if (challengeType === CHALLENGE_TYPES.TARGET_WORD) {
            xp = Math.floor(xp * 1.5);
        } else if (challengeType === CHALLENGE_TYPES.WORD_SEARCH) {
            xp = Math.floor(xp * 1.4);
        } else {
            // Word category base — tier differentiation via §7 additive
            xp = Math.floor(xp * 1.4);
        }
    } else if (gameMode === GAME_MODES.TIMED) {
        // Shorter timer = more pressure = more reward.
        // 1min→1.6×, 3min→1.42×, 5min→1.3×, 10min+→1.3×
        const timerBonus = (timeLimitSeconds > 0 && timeLimitSeconds < 300)
            ? 0.3 * Math.max(0, 1 - timeLimitSeconds / 300)
            : 0;
        xp = Math.floor(xp * (1.3 + timerBonus));
    } else if (gameMode === GAME_MODES.SANDBOX) {
        xp = Math.floor(xp * SANDBOX_XP_MULT);
    }

    // ═══ 6. TIME PRESSURE BONUS (timed modes only) ═══
    // Reward surviving longer — quadratic curve so the final stretch
    // of the timer is worth more than the opening seconds.
    // 0% used→1.0×, 50%→1.05×, 80%→1.13×, 100%→1.2×
    if (timeLimitSeconds > 0) {
        const timeUsed = Math.max(0, timeLimitSeconds - (timeRemainingSeconds || 0));
        const usageRatio = timeUsed / timeLimitSeconds;
        xp = Math.floor(xp * (1 + 0.2 * Math.pow(usageRatio, 2)));
    }

    // ═══ 7. TARGET / CATEGORY WORD BONUS ═══
    // Logarithmic stacking: each successive bonus word is worth more.
    // 1→+12xp, 3→+48, 5→+93, 10→+230
    // Category tier multiplies the bonus (tech/nature 1.6×, sports/animals 1.3×, food 1.0×)
    const isBonusChallenge = isChallenge && (
        challengeType === CHALLENGE_TYPES.TARGET_WORD
        || challengeType === CHALLENGE_TYPES.WORD_CATEGORY);
    const totalBonusWords = (targetWordsCompleted || 0) + (bonusWordsCompleted || 0);
    if (isBonusChallenge && totalBonusWords > 0) {
        const tierXpMult = (categoryKey && CATEGORY_TIERS[categoryKey])
            ? CATEGORY_TIERS[categoryKey].xpMult : 1.0;
        xp += Math.floor(totalBonusWords * 12
            * Math.log2(totalBonusWords + 1) * tierXpMult);
    }
    // Penalty: if no bonus words found in a bonus challenge, slash XP
    if (isBonusChallenge && totalBonusWords === 0) {
        xp = Math.floor(xp * 0.3);
    }

    // ═══ 8. PERFORMANCE VS PERSONAL BEST (sigmoid curve) ═══
    // Smooth continuous function instead of stepped brackets.
    if (previousBest > 0) {
        const ratio = score / previousBest;
        if (score > previousBest) {
            // New PB! Sigmoid bonus: smooth 1.0→1.7× as improvement grows.
            // 5% over PB→1.15×, 25% over→1.45×, 50%+ over→1.65×
            const improv = (score - previousBest) / previousBest;
            const pbBonus = 1 + 0.7 / (1 + Math.exp(-4 * (improv - 0.25)));
            xp = Math.floor(xp * pbBonus) + 50;
        } else {
            // Below PB: softened sigmoid centered at 50% of best.
            // ratio 0.9→0.96×, 0.7→0.82×, 0.5→0.71×, 0.3→0.66×
            const penaltyMult = 0.65 + 0.35 / (1 + Math.exp(-5 * (ratio - 0.5)));
            xp = Math.floor(xp * penaltyMult);
        }
    }

    // ═══ 9. LEVEL SCALING ═══
    // Gentle log₁₀ progression so XP keeps pace with rising thresholds.
    // Lv1→1.0×, Lv10→1.27×, Lv50→1.46×, Lv100→1.54×, Lv500→1.73×
    const lvl = Math.max(1, playerLevel || 1);
    xp = Math.floor(xp * (1 + Math.log10(lvl) * 0.27));

    // ═══ 10. COMBO CHAIN BONUS ═══
    // Sustained combos (claiming words back-to-back) show skill.
    // comboMax 2→+6xp, 3→+15, 5→+30, 8→+52, 10+→+66
    const combo = comboMax || 0;
    if (combo >= 2) {
        xp += Math.floor(combo * 3 * Math.log2(combo));
    }

    // Minimum XP floor: every word found guarantees some progression
    const minXP = totalWords > 0 ? totalWords * 2 : 1;
    return Math.max(minXP, xp);
}

const BONUS_METADATA = Object.freeze({
    [BONUS_TYPES.LETTER_PICK]: {
        buttonLabel: "Bonus: Letter",
        buttonTitle: "Choose the next falling letter",
        modalTitle: "Choose Your Letter",
        modalText: "Pick the next falling letter for this drop.",
        acceptLabel: "",
        previewSymbol: "",
    },
    [BONUS_TYPES.BOMB]: {
        buttonLabel: "Bonus: Bomb",
        buttonTitle: "Replace the current falling letter with a bomb",
        modalTitle: "Bomb Bonus",
        modalText: "Accept to swap the current falling letter for a bomb. When it lands, every occupied cell in its row, column, and both diagonals will explode and clear.",
        acceptLabel: "Accept",
        previewSymbol: BOMB_SYMBOL,
    },
    [BONUS_TYPES.WILDCARD]: {
        buttonLabel: "Bonus: Wild",
        buttonTitle: "Replace the current letter with a wildcard that matches any letter",
        modalTitle: "Wildcard Bonus",
        modalText: "Accept to turn the current falling block into a wildcard (★). It matches any letter when forming words!",
        acceptLabel: "Accept",
        previewSymbol: WILDCARD_SYMBOL,
    },
    [BONUS_TYPES.ROW_CLEAR]: {
        buttonLabel: "Bonus: Line",
        buttonTitle: "Tap letters in a line to clear them",
        modalTitle: "Line Clear Bonus",
        modalText: "Tap any letter to start, then tap another letter in the same line — horizontal, vertical, or diagonal. All letters between them will be selected. Press Clear to remove them, or Cancel to re-select!",
        acceptLabel: "Start Selecting",
        previewSymbol: "─",
    },
    [BONUS_TYPES.FREEZE]: {
        buttonLabel: "Bonus: Freeze",
        buttonTitle: "Pause block falling for 10 seconds",
        modalTitle: "Freeze Bonus",
        modalText: "Accept to freeze all block movement for 10 seconds. Take your time to plan your next move!",
        acceptLabel: "Freeze!",
        previewSymbol: "❄️",
    },
    [BONUS_TYPES.SHUFFLE]: {
        buttonLabel: "Bonus: Shuffle",
        buttonTitle: "Randomize all letters on the grid",
        modalTitle: "Shuffle Bonus",
        modalText: "Accept to randomly rearrange all the letters currently on the grid. Maybe you'll get luckier!",
        acceptLabel: "Shuffle!",
        previewSymbol: "⇄",
    },
    [BONUS_TYPES.SCORE_2X]: {
        buttonLabel: "Bonus: 2×",
        buttonTitle: "Double points for the next word you form",
        modalTitle: "Score Multiplier",
        modalText: "Accept to earn DOUBLE points on the next word you form!",
        acceptLabel: "Activate 2×",
        previewSymbol: "2×",
    },
});

function getMusicControlIcon(iconName) {
    const icons = {
        play: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l10-6.5z"/></svg>',
        pause: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>',
        prev: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4" y="5" width="2.2" height="14" rx="1"/><path d="M18.2 6v12l-8.1-6z"/><path d="M10.6 6v12l-8.1-6z"/></svg>',
        next: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="17.8" y="5" width="2.2" height="14" rx="1"/><path d="M5.8 6v12l8.1-6z"/><path d="M13.4 6v12l8.1-6z"/></svg>',
        shuffle: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>',
        repeatAll: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>',
        repeatOne: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/><text x="12" y="15.5" text-anchor="middle" font-size="7" font-weight="bold" fill="currentColor">1</text></svg>',
        volumeHigh: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/><path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
        volumeLow: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>',
        volumeMute: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3z"/></svg>',
        timer: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42C16.07 4.74 14.12 4 12 4c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/></svg>',
    };
    return icons[iconName] || "";
}

function shuffleList(items) {
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const swapIndex = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[i]];
    }
    return shuffled;
}

function drawRandomBonusType(bonusBag, lastBonusType = null, recentHistory = [], gameContext = {}) {
    // ── Base weights ──
    const baseWeights = {
        [BONUS_TYPES.LETTER_PICK]: 18,
        [BONUS_TYPES.SCORE_2X]:    16,
        [BONUS_TYPES.FREEZE]:      14,
        [BONUS_TYPES.ROW_CLEAR]:   12,
        [BONUS_TYPES.WILDCARD]:    10,
        [BONUS_TYPES.SHUFFLE]:      8,
        [BONUS_TYPES.BOMB]:         7,
    };

    // Categorize bonuses by role
    const CLEARING = [BONUS_TYPES.BOMB, BONUS_TYPES.ROW_CLEAR, BONUS_TYPES.SHUFFLE];
    const UTILITY = [BONUS_TYPES.FREEZE, BONUS_TYPES.LETTER_PICK, BONUS_TYPES.WILDCARD];
    const SCORING = [BONUS_TYPES.SCORE_2X];

    const weights = {};
    for (const type of BONUS_TYPE_POOL) {
        weights[type] = baseWeights[type] || 10;
    }

    // ── 1) Recency penalty (exponential decay) ──
    for (let i = 0; i < recentHistory.length; i++) {
        const recent = recentHistory[i];
        if (weights[recent] !== undefined) {
            const penalty = Math.pow(0.3, recentHistory.length - i); // most recent ≈ 0.008, older ≈ 0.3
            weights[recent] *= penalty;
        }
    }

    // ── 2) Never repeat immediately ──
    if (lastBonusType && weights[lastBonusType] !== undefined) {
        weights[lastBonusType] = 0;
    }

    // ── 3) Category streak prevention ──
    // If last 2 bonuses were same category (clearing/utility/scoring), dampen that category
    if (recentHistory.length >= 2) {
        const getCat = (t) => CLEARING.includes(t) ? "clear" : UTILITY.includes(t) ? "util" : "score";
        const lastCats = recentHistory.slice(0, 2).map(getCat);
        if (lastCats[0] === lastCats[1]) {
            const streakCat = lastCats[0];
            const catTypes = streakCat === "clear" ? CLEARING : streakCat === "util" ? UTILITY : SCORING;
            for (const type of catTypes) {
                weights[type] *= 0.35;
            }
        }
    }

    // ── 4) Board fullness pressure ──
    // When board is filling up, strongly favor clearing bonuses
    const { boardFillRatio = 0, freezeActive = false, score = 0 } = gameContext;
    if (boardFillRatio > 0.3) {
        const pressure = Math.pow(boardFillRatio, 2); // 0.5→0.25, 0.7→0.49, 0.9→0.81
        for (const type of CLEARING) {
            weights[type] *= 1 + pressure * 4; // up to 5× boost at full board
        }
    }

    // ── 5) Contextual adjustments ──
    // If freeze is already active, strongly reduce freeze weight
    if (freezeActive) {
        weights[BONUS_TYPES.FREEZE] *= 0.05;
    }

    // Very early game (score < 2000): favor utility to help players build
    if (score < 2000) {
        for (const type of UTILITY) weights[type] *= 1.4;
        weights[BONUS_TYPES.BOMB] *= 0.5; // bomb not as useful early
    }
    // Late game (score > 10000): favor powerful bonuses
    if (score > 10000) {
        weights[BONUS_TYPES.BOMB] *= 1.6;
        weights[BONUS_TYPES.ROW_CLEAR] *= 1.5;
        weights[BONUS_TYPES.SCORE_2X] *= 1.8;
    }

    // ── 6) Pity timer — guarantee rare bonuses after long absence ──
    // Track how many draws since each bonus was last seen
    const fullHistory = gameContext.fullBonusHistory || [];
    for (const type of BONUS_TYPE_POOL) {
        const lastSeen = fullHistory.lastIndexOf(type);
        const drawsSince = lastSeen === -1 ? fullHistory.length : (fullHistory.length - 1 - lastSeen);
        // After 5+ draws without seeing a bonus, boost it progressively
        if (drawsSince >= 5) {
            const pityBoost = 1 + (drawsSince - 4) * 0.5; // +50% per extra draw
            weights[type] *= Math.min(pityBoost, 4.0); // cap at 4×
        }
    }

    // ── 7) Usage fatigue — bonuses used many times this game get slightly less likely ──
    const usageCounts = gameContext.bonusUsageCounts || {};
    for (const type of BONUS_TYPE_POOL) {
        const uses = usageCounts[type] || 0;
        if (uses >= 3) {
            weights[type] *= Math.max(0.3, 1 - (uses - 2) * 0.12);
        }
    }

    // ── 8) Lucky upgrade: 8% chance to roll a "rare" bonus ──
    const rareTypes = [BONUS_TYPES.BOMB, BONUS_TYPES.ROW_CLEAR, BONUS_TYPES.WILDCARD];
    if (Math.random() < 0.08) {
        // Boost rare types significantly for this single draw
        for (const type of rareTypes) {
            weights[type] *= 3.0;
        }
    }

    // ── Weighted random selection ──
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    if (totalWeight <= 0) {
        // Fallback: pick purely random
        const idx = Math.floor(Math.random() * BONUS_TYPE_POOL.length);
        const bonusType = BONUS_TYPE_POOL[idx];
        return { bonusType, nextBag: bonusBag, nextHistory: [bonusType, ...recentHistory].slice(0, 5) };
    }

    let roll = Math.random() * totalWeight;
    let bonusType = BONUS_TYPE_POOL[0];
    for (const type of BONUS_TYPE_POOL) {
        roll -= weights[type];
        if (roll <= 0) { bonusType = type; break; }
    }

    // Update history (keep last 5 for deeper recency tracking)
    const nextHistory = [bonusType, ...recentHistory].slice(0, 5);

    return { bonusType, nextBag: bonusBag, nextHistory };
}

// Number of buffer rows above the grid where the block is visible but outside play area
const BUFFER_ROWS = 2;

// ────────────────────────────────────────
// GAME STATES
// ────────────────────────────────────────
const State = Object.freeze({ MENU: 0, PLAYING: 1, PAUSED: 2, CLEARING: 3, GAMEOVER: 4 });

// ────────────────────────────────────────
// AUDIO MANAGER  (Enhanced with Howler.js)
// Backwards-compatible: same API as before, but uses
// Howler.js under the hood for better cross-platform audio.
// ────────────────────────────────────────
class AudioManager extends HowlerAudioManager {
    constructor() {
        super();
    }
}

// ────────────────────────────────────────
// PARTICLE (simple clear effect)
// ────────────────────────────────────────
class Particle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        const angle = Math.random() * Math.PI * 2;
        const speed = 60 + Math.random() * 140;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed - 40; // bias upward
        this.gravity = 180 + Math.random() * 80;
        this.life = 0.4 + Math.random() * 0.5;
        this.maxLife = this.life;
        this.radius = 1.5 + Math.random() * 4;
        // Gold/amber palette
        const colors = ["#e2d8a6", "#c4b888", "#d4c890", "#fff", "#c4b888"];
        this.color = colors[Math.floor(Math.random() * colors.length)];
    }

    update(dt) {
        this.x += this.vx * dt;
        this.vy += this.gravity * dt;
        this.y += this.vy * dt;
        this.life -= dt;
    }

    draw(ctx) {
        const alpha = Math.max(0, this.life / this.maxLife);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius * (0.5 + 0.5 * alpha), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    get dead() { return this.life <= 0; }
}

// ────────────────────────────────────────
// FLOATING BACKGROUND LETTERS
// ────────────────────────────────────────
class FloatingLetter {
    constructor(w, h) {
        this.char = String.fromCharCode(65 + Math.floor(Math.random() * 26));
        this.x = Math.random() * w;
        this.y = h + 20;
        this.size = 14 + Math.random() * 22;
        this.alpha = 0.04 + Math.random() * 0.08;
        this.vy = -(8 + Math.random() * 18);
        this.vx = (Math.random() - 0.5) * 12;
        this.wobbleSpeed = 1 + Math.random() * 2;
        this.wobbleAmp = 8 + Math.random() * 15;
        this.rotation = (Math.random() - 0.5) * 0.6;
        this.rotSpeed = (Math.random() - 0.5) * 0.4;
        this.t = Math.random() * Math.PI * 2;
    }
    update(dt) {
        this.t += dt * this.wobbleSpeed;
        this.x += (this.vx + Math.sin(this.t) * this.wobbleAmp * 0.3) * dt;
        this.y += this.vy * dt;
        this.rotation += this.rotSpeed * dt;
    }
    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.alpha;
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        ctx.font = `bold ${this.size}px 'Segoe UI', sans-serif`;
        ctx.fillStyle = "#e2d8a6";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.char, 0, 0);
        ctx.restore();
    }
    get dead() { return this.y < -30; }
}

class BackgroundAnimation {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.letters = [];
        this.confetti = [];
        this.running = false;
        this._animId = null;
        this._lastTime = 0;
        this._spawnTimer = 0;
        this._resize();
    }
    _resize() {
        const r = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = r.width;
        this.canvas.height = r.height;
    }
    start() {
        if (this.running) return;
        this.running = true;
        this._resize();
        this._lastTime = performance.now();
        this._tick = this._tick.bind(this);
        this._animId = requestAnimationFrame(this._tick);
    }
    stop() {
        this.running = false;
        if (this._animId) cancelAnimationFrame(this._animId);
        this._animId = null;
        this.confetti = [];
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    addConfetti(particles) {
        this.confetti.push(...particles);
    }
    _tick(now) {
        if (!this.running) return;
        const dt = Math.min((now - this._lastTime) / 1000, 0.1);
        this._lastTime = now;
        const w = this.canvas.width, h = this.canvas.height;

        this._spawnTimer -= dt;
        if (this._spawnTimer <= 0) {
            this.letters.push(new FloatingLetter(w, h));
            this._spawnTimer = 0.4 + Math.random() * 0.6;

            // PixiJS: spawn floating letter particles periodically
            this._pixiSpawnCounter = (this._pixiSpawnCounter || 0) + 1;
            if (this._pixiSpawnCounter % 5 === 0 && isPixiReady()) {
                pixiFloatingLetters(3, { width: w, height: h });
            }
        }

        this.ctx.clearRect(0, 0, w, h);
        for (let i = this.letters.length - 1; i >= 0; i--) {
            this.letters[i].update(dt);
            this.letters[i].draw(this.ctx);
            if (this.letters[i].dead) this.letters.splice(i, 1);
        }
        // Draw confetti on top of floating letters
        for (let i = this.confetti.length - 1; i >= 0; i--) {
            this.confetti[i].update(dt);
            this.confetti[i].draw(this.ctx);
            if (this.confetti[i].dead) this.confetti.splice(i, 1);
        }
        this._animId = requestAnimationFrame(this._tick);
    }
}

// ────────────────────────────────────────
// CONFETTI PARTICLE (game over celebration)
// ────────────────────────────────────────
class ConfettiParticle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
        const speed = 200 + Math.random() * 350;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.gravity = 250 + Math.random() * 100;
        this.life = 1.5 + Math.random() * 1.0;
        this.maxLife = this.life;
        this.size = 4 + Math.random() * 6;
        this.rotation = Math.random() * Math.PI * 2;
        this.rotSpeed = (Math.random() - 0.5) * 10;
        const colors = ["#e2d8a6", "#c4a878", "#8cb860", "#7aa68e", "#d4c890", "#b0a878", "#9a9680", "#706c58"];
        this.color = colors[Math.floor(Math.random() * colors.length)];
    }
    update(dt) {
        this.x += this.vx * dt;
        this.vy += this.gravity * dt;
        this.y += this.vy * dt;
        this.life -= dt;
        this.rotation += this.rotSpeed * dt;
    }
    draw(ctx) {
        const alpha = Math.max(0, this.life / this.maxLife);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        ctx.fillStyle = this.color;
        ctx.fillRect(-this.size / 2, -this.size / 4, this.size, this.size / 2);
        ctx.restore();
    }
    get dead() { return this.life <= 0; }
}

// ────────────────────────────────────────
// GRID  (data model + word detection)
// ────────────────────────────────────────
class Grid {
    constructor(rows, cols) {
        this.rows = rows;
        this.cols = cols;
        this.cells = Array.from({ length: rows }, () => Array(cols).fill(null));
    }

    get(r, c) { return this.cells[r]?.[c] ?? null; }
    set(r, c, v) { if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) this.cells[r][c] = v; }
    inBounds(r, c) { return r >= 0 && r < this.rows && c >= 0 && c < this.cols; }
    isEmpty(r, c) { return this.inBounds(r, c) && this.cells[r][c] === null; }
    isGridFull() {
        for (let c = 0; c < this.cols; c++) {
            if (this.isEmpty(0, c)) return false;
        }
        return true;
    }

    // 8 direction vectors (we only need 4 unique lines through a cell)
    static DIRS = [
        [0, 1],   // horizontal →
        [1, 0],   // vertical ↓
        [1, 1],   // diagonal ↘
        [1, -1],  // diagonal ↙
    ];

    // Find all valid words passing through (row, col). Returns { words: [...], cells: Set }
    findWordsThrough(row, col, minWordLength = 3) {
        const foundWords = [];
        const cellsToRemove = new Set();
        const wordCellMap = []; // [{word, cells: Set}]

        for (const [dr, dc] of Grid.DIRS) {
            // Walk backward to find start of contiguous segment
            let sr = row, sc = col;
            while (this.inBounds(sr - dr, sc - dc) && isWordLetter(this.get(sr - dr, sc - dc))) {
                sr -= dr;
                sc -= dc;
            }

            // Collect the full contiguous segment
            const segment = [];
            let cr = sr, cc = sc;
            while (this.inBounds(cr, cc) && isWordLetter(this.get(cr, cc))) {
                segment.push({ r: cr, c: cc, letter: this.get(cr, cc) });
                cr += dr;
                cc += dc;
            }

            if (segment.length < minWordLength) continue;

            // Find the index of the trigger cell (row, col) within this segment
            const triggerIdx = segment.findIndex(s => s.r === row && s.c === col);

            // Check all substrings in forward AND reverse separately.
            // Only consider substrings that INCLUDE the trigger cell.
            // If both directions produce a valid word on overlapping cells,
            // both count — the primary gets full points, reverse gets half.
            const reversed = [...segment].reverse();
            const revTriggerIdx = segment.length - 1 - triggerIdx;
            let bestForward = null, bestForwardCells = null;
            let bestReverse = null, bestReverseCells = null;

            for (let start = 0; start < segment.length; start++) {
                for (let end = start + minWordLength; end <= segment.length; end++) {
                    // Only consider substrings containing the trigger cell
                    if (triggerIdx < start || triggerIdx >= end) continue;
                    const sub = segment.slice(start, end);
                    const raw = sub.map(s => s.letter).join("");
                    const matches = _resolveWildcards(raw);
                    if (raw.includes(WILDCARD_SYMBOL) && matches.length > 0) {
                        const dictMatches = matches.filter(w => DICTIONARY.has(w));
                        if (dictMatches.length > 0) console.log(`[WILDCARD-DETECT] Forward "${raw}" → found: ${dictMatches.join(", ")}`);
                    }
                    for (const word of matches) {
                        if (DICTIONARY.has(word)) {
                            if (!bestForward || word.length > bestForward.length) {
                                bestForward = word;
                                bestForwardCells = sub;
                            }
                            break;
                        }
                    }
                }
            }

            for (let start = 0; start < reversed.length; start++) {
                for (let end = start + minWordLength; end <= reversed.length; end++) {
                    // Only consider substrings containing the trigger cell
                    if (revTriggerIdx < start || revTriggerIdx >= end) continue;
                    const sub = reversed.slice(start, end);
                    const raw = sub.map(s => s.letter).join("");
                    const matches = _resolveWildcards(raw);
                    for (const word of matches) {
                        if (DICTIONARY.has(word)) {
                            if (!bestReverse || word.length > bestReverse.length) {
                                bestReverse = word;
                                bestReverseCells = sub;
                            }
                            break;
                        }
                    }
                }
            }

            // Pick the primary word (longer wins, forward wins ties)
            let primary, primaryCells, secondary, secondaryCells;
            if (bestForward && bestReverse && bestForward !== bestReverse) {
                if (bestForward.length >= bestReverse.length) {
                    primary = bestForward; primaryCells = bestForwardCells;
                    secondary = bestReverse; secondaryCells = bestReverseCells;
                } else {
                    primary = bestReverse; primaryCells = bestReverseCells;
                    secondary = bestForward; secondaryCells = bestForwardCells;
                }
            } else {
                primary = bestForward || bestReverse;
                primaryCells = bestForwardCells || bestReverseCells;
                secondary = null; secondaryCells = null;
            }

            if (primary) {
                console.log(`[WORD-VAL] findWordsThrough(${row},${col}) dir=[${dr},${dc}] → primary="${primary}" cells=[${primaryCells.map(s=>`(${s.r},${s.c})=${s.letter}`).join(",")}]`);
                foundWords.push(primary);
                const wordCells = new Set();
                for (const s of primaryCells) {
                    const key = `${s.r},${s.c}`;
                    cellsToRemove.add(key);
                    wordCells.add(key);
                }
                wordCellMap.push({ word: primary, cells: wordCells });
            }

            // If reverse produced a different valid word sharing cells, add as bonus
            if (secondary && primary) {
                console.log(`[WORD-VAL] findWordsThrough(${row},${col}) dir=[${dr},${dc}] → reverse="${secondary}" cells=[${secondaryCells.map(s=>`(${s.r},${s.c})=${s.letter}`).join(",")}]`);
                const secCells = new Set();
                for (const s of secondaryCells) {
                    const key = `${s.r},${s.c}`;
                    cellsToRemove.add(key);
                    secCells.add(key);
                }
                wordCellMap.push({ word: secondary, cells: secCells, isReverse: true });
                foundWords.push(secondary);
            }
        }

        return { words: foundWords, cells: cellsToRemove, wordCellMap };
    }

    // Full-board scan for any valid words (used during chain reactions)
    findAllWords(minWordLength = 3) {
        const foundWords = [];
        const cellsToRemove = new Set();
        const allWordCellMap = [];

        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (isWordLetter(this.cells[r][c])) {
                    const { words, cells, wordCellMap } = this.findWordsThrough(r, c, minWordLength);
                    for (const w of words) foundWords.push(w);
                    for (const cell of cells) cellsToRemove.add(cell);
                    for (const wc of wordCellMap) allWordCellMap.push(wc);
                }
            }
        }

        // Deduplicate: collapse identical word names, then remove any word
        // whose cells are a strict subset of a longer word on the same line.
        const seenKeys = new Set();
        let dedupedMap = [];
        for (const wc of allWordCellMap) {
            // Unique key = word + sorted cell keys (same word at same position)
            const cellKey = [...wc.cells].sort().join("|");
            const key = wc.word + "~" + cellKey;
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                dedupedMap.push(wc);
            }
        }
        // Sort longest-first so the subset filter is order-independent
        dedupedMap.sort((a, b) => b.word.length - a.word.length);
        dedupedMap = dedupedMap.filter((wc, i) => {
            // Never drop reverse bonus words via subset filter
            if (wc.isReverse) return true;
            // Drop this word if a strictly longer word covers all its cells
            for (let j = 0; j < i; j++) {
                const longer = dedupedMap[j];
                if (longer.word.length > wc.word.length
                    && !longer.isReverse
                    && [...wc.cells].every(k => longer.cells.has(k))) {
                    return false;
                }
            }
            return true;
        });
        return { words: dedupedMap.map(wc => wc.word), cells: cellsToRemove, wordCellMap: dedupedMap };
    }

    // Remove cells and apply gravity. Returns list of gravity animations [{r,c,fromR}]
    removeCells(cellSet) {
        for (const key of cellSet) {
            const [r, c] = key.split(",").map(Number);
            this.cells[r][c] = null;
        }
    }

    // Apply gravity, return animation descriptors
    applyGravity() {
        const moves = []; // {col, fromRow, toRow, letter}
        for (let c = 0; c < this.cols; c++) {
            let writeRow = this.rows - 1;
            for (let r = this.rows - 1; r >= 0; r--) {
                if (this.cells[r][c] !== null) {
                    if (r !== writeRow) {
                        moves.push({ col: c, fromRow: r, toRow: writeRow, letter: this.cells[r][c] });
                        this.cells[writeRow][c] = this.cells[r][c];
                        this.cells[r][c] = null;
                    }
                    writeRow--;
                }
            }
        }
        return moves;
    }
}

// ────────────────────────────────────────
// FALLING BLOCK
// ────────────────────────────────────────
class FallingBlock {
    constructor(letter, col, rows, kind = "letter") {
        this.letter = letter;
        this.kind = kind;
        this.col = col;
        this.row = -BUFFER_ROWS;  // spawn above the grid in the buffer zone
        this.maxRow = rows - 1;
        // Visual position for smooth interpolation (in cell units)
        this.visualRow = -BUFFER_ROWS;
        this.dropAnimating = false;
    }
}

// ────────────────────────────────────────
// RENDERER  (canvas drawing)
// ────────────────────────────────────────
class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.cellSize = 0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.particles = [];
        this.flashCells = new Set();   // cells flashing before removal
        this.flashTimer = 0;
        this.gravityAnims = [];        // {col, fromRow, toRow, letter, progress}
        this.shuffleAnims = [];        // {letter, fromRow, fromCol, toRow, toCol, progress}
        this.hintCells = new Set();    // cells glowing orange (hint mode)
        this.validatedCells = new Set(); // cells highlighted green (target word challenge)
        this.rowDragCells = new Set();   // cells highlighted green during row-drag bonus
        this.blastCells = new Set();
        this.blastCenterKey = null;
        this.blastProgress = 0;
        // Screen shake state
        this.shakeX = 0;
        this.shakeY = 0;
        this.shakeIntensity = 0;
        this.shakeDecay = 12; // how fast shake fades (per second)
        // Landing impact ring
        this.impactRings = []; // {x, y, progress, maxRadius}
        // Theme (loaded from equipped grid theme)
        this.theme = GRID_THEMES.theme_default;
        // Block style (loaded from equipped block style)
        this.blockStyle = BLOCK_STYLES.block_default;
    }

    setTheme(themeId) {
        this.theme = GRID_THEMES[themeId] || GRID_THEMES.theme_default;
    }

    setBlockStyle(styleId) {
        this.blockStyle = BLOCK_STYLES[styleId] || BLOCK_STYLES.block_default;
    }

    triggerShake(intensity) {
        this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
        // Haptic feedback on mobile
        if (navigator.vibrate) {
            navigator.vibrate(Math.min(Math.round(intensity * 8), 50));
        }
    }

    triggerImpact(row, col) {
        const { x, y } = this.cellCenter(row, col);
        this.impactRings.push({ x, y, progress: 0, maxRadius: this.cellSize * 0.9 });
        // Matter.js: physics-based impact ring
        spawnImpactRing(x, y, 1);
    }

    // Convert pixel coordinates (relative to canvas) to grid row/col, or null if outside
    pixelToCell(px, py) {
        const col = Math.floor((px - this.offsetX) / this.cellSize);
        const row = Math.floor((py - this.offsetY) / this.cellSize);
        return { row, col };
    }

    getGhostRow(grid, block) {
        if (!block) return null;
        if (block.row < 0 && !grid.isEmpty(0, block.col)) return null;

        let landingRow = Math.max(0, block.row);
        while (landingRow + 1 < grid.rows && grid.isEmpty(landingRow + 1, block.col)) {
            landingRow++;
        }

        return landingRow;
    }

    // Resize canvas to fit wrapper while keeping square grid + buffer rows on top
    resize(rows, cols) {
        const totalRows = rows + BUFFER_ROWS;
        const wrapper = this.canvas.parentElement;
        const maxW = wrapper.clientWidth;
        const maxH = wrapper.clientHeight;
        const maxCellW = Math.floor(maxW / cols);
        const maxCellH = Math.floor(maxH / totalRows);
        this.cellSize = Math.min(maxCellW, maxCellH);
        const w = this.cellSize * cols;
        const h = this.cellSize * totalRows;
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + "px";
        this.canvas.style.height = h + "px";
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.offsetX = 0;
        // Grid starts below the buffer zone
        this.offsetY = this.cellSize * BUFFER_ROWS;
        this.totalH = h;
    }

    // Convert grid (row, col) to pixel center
    cellCenter(row, col) {
        return {
            x: this.offsetX + col * this.cellSize + this.cellSize / 2,
            y: this.offsetY + row * this.cellSize + this.cellSize / 2
        };
    }

    _getTokenFont(value, size) {
        const family = (value === BOMB_SYMBOL || value === WILDCARD_SYMBOL)
            ? '"Segoe UI Emoji", "Apple Color Emoji", sans-serif'
            : "monospace";
        return `bold ${Math.floor(size)}px ${family}`;
    }

    _drawToken(value, x, y, cellSize, color, scale = 1, alpha = 1) {
        const ctx = this.ctx;
        const bs = this.blockStyle;
        ctx.save();
        ctx.globalAlpha = alpha;

        const half = cellSize * 0.45 * scale;

        if (bs.type === "scrabble") {
            // ── Scrabble: wooden tile with embossed edges + point value ──
            const tileMargin = cellSize * 0.08;
            const tileX = x - half + tileMargin;
            const tileY = y - half + tileMargin;
            const tileW = (half - tileMargin) * 2;
            const tileH = (half - tileMargin) * 2;
            const r = cellSize * 0.08;

            // Darken cell behind tile for contrast
            ctx.fillStyle = "rgba(30, 22, 10, 0.55)";
            ctx.fillRect(x - half, y - half, half * 2, half * 2);

            // Wood grain base
            ctx.fillStyle = bs.tileColor;
            ctx.beginPath();
            ctx.roundRect(tileX, tileY, tileW, tileH, r);
            ctx.fill();

            // Subtle wood grain lines
            ctx.strokeStyle = "rgba(120, 80, 30, 0.12)";
            ctx.lineWidth = 0.5;
            for (let i = 0; i < 4; i++) {
                const yy = tileY + tileH * (0.2 + i * 0.2);
                ctx.beginPath();
                ctx.moveTo(tileX + 2, yy + Math.sin(i * 1.7) * 1.5);
                ctx.quadraticCurveTo(tileX + tileW * 0.5, yy + Math.cos(i * 2.3) * 2, tileX + tileW - 2, yy + Math.sin(i * 0.9) * 1.5);
                ctx.stroke();
            }

            // Highlight (top-left emboss)
            ctx.strokeStyle = "rgba(255, 240, 200, 0.4)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(tileX + r, tileY);
            ctx.lineTo(tileX + tileW - r, tileY);
            ctx.moveTo(tileX, tileY + r);
            ctx.lineTo(tileX, tileY + tileH - r);
            ctx.stroke();

            // Shadow (bottom-right emboss)
            ctx.strokeStyle = bs.tileBorder;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(tileX + r, tileY + tileH);
            ctx.lineTo(tileX + tileW - r, tileY + tileH);
            ctx.moveTo(tileX + tileW, tileY + r);
            ctx.lineTo(tileX + tileW, tileY + tileH - r);
            ctx.stroke();

            // Letter (dark ink on wood)
            ctx.fillStyle = "#3a2a14";
            ctx.font = this._getTokenFont(value, cellSize * 0.48 * scale);
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(value, x, y);

            // Point value (bottom-right corner)
            if (bs.showPoints && value && value.length === 1 && value.match(/[A-Z]/)) {
                const pts = "EAIONRTLSU".includes(value) ? 1
                          : "DG".includes(value) ? 2
                          : "BCMP".includes(value) ? 3
                          : "FHVWY".includes(value) ? 4
                          : "K".includes(value) ? 5
                          : "JX".includes(value) ? 8
                          : "QZ".includes(value) ? 10 : 1;
                ctx.font = `bold ${Math.floor(cellSize * 0.18 * scale)}px sans-serif`;
                ctx.textAlign = "right";
                ctx.textBaseline = "bottom";
                ctx.fillStyle = "#5a4a2a";
                ctx.fillText(String(pts), tileX + tileW - 3, tileY + tileH - 2);
            }

        } else if (bs.type === "bubble") {
            // ── Bubble: rounded glossy circle ──
            const bubbleR = half * 0.92;
            // Shadow
            ctx.beginPath();
            ctx.arc(x + 1, y + 2, bubbleR, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(0,0,0,0.15)";
            ctx.fill();

            // Main bubble
            const grad = ctx.createRadialGradient(x - bubbleR * 0.3, y - bubbleR * 0.3, bubbleR * 0.1, x, y, bubbleR);
            grad.addColorStop(0, "rgba(255,255,255,0.35)");
            grad.addColorStop(0.5, "rgba(180,210,240,0.2)");
            grad.addColorStop(1, "rgba(100,150,200,0.15)");
            ctx.beginPath();
            ctx.arc(x, y, bubbleR, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(200,225,255,0.25)";
            ctx.fill();
            ctx.fillStyle = grad;
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.45)";
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Highlight dot
            ctx.beginPath();
            ctx.arc(x - bubbleR * 0.25, y - bubbleR * 0.3, bubbleR * 0.15, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255,255,255,0.55)";
            ctx.fill();

            // Letter — darken for readability on translucent bubbles
            ctx.fillStyle = "#1a1a2e";
            ctx.font = this._getTokenFont(value, cellSize * 0.48 * scale);
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(value, x, y + 1);

        } else if (bs.type === "typewriter") {
            // ── Typewriter: paper card with inked monospace letter ──
            const pad = cellSize * 0.06;
            const tw = half * 2 - pad * 2;
            const th = half * 2 - pad * 2;
            const tx = x - half + pad;
            const ty = y - half + pad;

            // Yellowed paper background
            ctx.fillStyle = "rgba(245, 235, 215, 0.85)";
            ctx.fillRect(tx, ty, tw, th);

            // Paper border
            ctx.strokeStyle = "rgba(160, 140, 110, 0.5)";
            ctx.lineWidth = 1;
            ctx.strokeRect(tx, ty, tw, th);

            // Typewriter ink letter
            ctx.fillStyle = bs.inkColor;
            ctx.font = `bold ${Math.floor(cellSize * 0.5 * scale)}px 'Courier New', monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            // Slight ink irregularity
            ctx.fillText(value, x + (Math.random() > 0.7 ? 0.5 : 0), y + 1);

        } else if (bs.type === "pixel") {
            // ── Pixel: chunky retro block ──
            const px = cellSize * bs.pixelScale;
            const blockX = x - half;
            const blockY = y - half;
            const blockW = half * 2;
            const blockH = half * 2;

            // Solid block
            ctx.fillStyle = "rgba(60, 80, 60, 0.6)";
            ctx.fillRect(blockX, blockY, blockW, blockH);

            // Pixel grid lines
            ctx.strokeStyle = "rgba(40, 60, 40, 0.3)";
            ctx.lineWidth = 0.5;
            for (let gx = blockX; gx <= blockX + blockW; gx += px) {
                ctx.beginPath(); ctx.moveTo(Math.round(gx), blockY); ctx.lineTo(Math.round(gx), blockY + blockH); ctx.stroke();
            }
            for (let gy = blockY; gy <= blockY + blockH; gy += px) {
                ctx.beginPath(); ctx.moveTo(blockX, Math.round(gy)); ctx.lineTo(blockX + blockW, Math.round(gy)); ctx.stroke();
            }

            // Highlight edge (top + left)
            ctx.fillStyle = "rgba(100, 200, 100, 0.25)";
            ctx.fillRect(blockX, blockY, blockW, px);
            ctx.fillRect(blockX, blockY, px, blockH);

            // Shadow edge (bottom + right)
            ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
            ctx.fillRect(blockX, blockY + blockH - px, blockW, px);
            ctx.fillRect(blockX + blockW - px, blockY, px, blockH);

            // Letter
            ctx.fillStyle = "#b8f0b8";
            ctx.font = `bold ${Math.floor(cellSize * 0.5 * scale)}px monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(value, x, y + 1);

        } else if (bs.type === "glass") {
            // ── Glass: translucent refractive tile ──
            const glassR = cellSize * 0.06;
            const gx = x - half + 2;
            const gy = y - half + 2;
            const gw = half * 2 - 4;
            const gh = half * 2 - 4;

            // Glass background
            ctx.globalAlpha = alpha * bs.opacity;
            const glassGrad = ctx.createLinearGradient(gx, gy, gx + gw, gy + gh);
            glassGrad.addColorStop(0, "rgba(255,255,255,0.18)");
            glassGrad.addColorStop(0.5, "rgba(200,220,255,0.1)");
            glassGrad.addColorStop(1, "rgba(255,255,255,0.06)");
            ctx.beginPath();
            ctx.roundRect(gx, gy, gw, gh, glassR);
            ctx.fillStyle = glassGrad;
            ctx.fill();

            // Glass border
            ctx.strokeStyle = "rgba(255,255,255,0.3)";
            ctx.lineWidth = 1;
            ctx.stroke();

            // Top shine
            ctx.beginPath();
            ctx.roundRect(gx + 3, gy + 2, gw - 6, gh * 0.35, [glassR, glassR, 0, 0]);
            ctx.fillStyle = "rgba(255,255,255,0.12)";
            ctx.fill();

            // Letter
            ctx.globalAlpha = alpha;
            ctx.fillStyle = color;
            ctx.font = this._getTokenFont(value, cellSize * 0.52 * scale);
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(value, x, y + 1);

        } else {
            // ── Default flat style ──
            ctx.fillStyle = color;
            ctx.font = this._getTokenFont(value, cellSize * 0.55 * scale);
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(value, x, y + 1);
        }

        ctx.restore();
    }

    draw(grid, block, dt) {
        const ctx = this.ctx;
        const cs = this.cellSize;
        const rows = grid.rows;
        const cols = grid.cols;
        const w = cs * cols;
        const h = this.totalH || cs * (rows + BUFFER_ROWS);

        // Update screen shake (enhanced with Kaboom noise shake)
        if (this.shakeIntensity > 0.1) {
            this._shakeTime = (this._shakeTime || 0) + dt;
            const normalizedT = Math.min(1, this._shakeTime * 3); // ~0.33s shake duration
            const kShake = screenShakeOffset(this.shakeIntensity, normalizedT, 14);
            this.shakeX = kShake.x;
            this.shakeY = kShake.y;
            this.shakeIntensity *= Math.exp(-this.shakeDecay * dt);
        } else {
            this.shakeX = 0;
            this.shakeY = 0;
            this.shakeIntensity = 0;
            this._shakeTime = 0;
        }

        // Background (full canvas including buffer) — drawn before shake transform
        const T = this.theme;
        ctx.fillStyle = T.bg;
        ctx.fillRect(0, 0, w, h);

        // Apply shake offset to all subsequent drawing
        ctx.save();
        ctx.translate(this.shakeX, this.shakeY);

        // Buffer zone subtle background
        ctx.fillStyle = T.buffer;
        ctx.fillRect(0, 0, w, this.offsetY);

        // Separator line between buffer and grid
        ctx.strokeStyle = T.separator;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, this.offsetY);
        ctx.lineTo(w, this.offsetY);
        ctx.stroke();

        // Grid cells
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = this.offsetX + c * cs;
                const y = this.offsetY + r * cs;
                const key = `${r},${c}`;

                // Cell background
                ctx.fillStyle = T.cell;
                ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);

                const isBlastCell = this.blastCells.has(key);

                if (isBlastCell) {
                    const pulse = 0.35 + 0.25 * Math.sin(this.blastProgress * Math.PI * 6);
                    ctx.fillStyle = `rgba(196, 168, 120, ${0.22 + pulse * 0.45})`;
                    ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
                    ctx.strokeStyle = `rgba(226, 216, 166, ${0.4 + pulse * 0.35})`;
                    ctx.lineWidth = 2;
                    ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
                }

                // Hint border (orange) — one letter away from a word
                if (this.hintCells.has(key) && !this.flashCells.has(key) && !isBlastCell && !this.validatedCells.has(key)) {
                    ctx.strokeStyle = "rgba(176, 168, 120, 0.85)";
                    ctx.lineWidth = 3;
                    ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
                }

                // Row drag cells glow (green) — interactive row clear bonus
                if (this.rowDragCells.has(key) && !this.flashCells.has(key) && !isBlastCell) {
                    ctx.fillStyle = "rgba(140, 184, 96, 0.35)";
                    ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
                    ctx.strokeStyle = "rgba(140, 184, 96, 0.9)";
                    ctx.lineWidth = 2.5;
                    ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
                }

                // Flash effect
                if (this.flashCells.has(key) && !isBlastCell) {
                    const alpha = 0.5 + 0.5 * Math.sin(this.flashTimer * 15);
                    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
                    ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
                }

                // Letter
                const letter = grid.get(r, c);
                if (letter && this.shuffleAnims.length === 0) {
                    let color = T.text;
                    if (this.rowDragCells.has(key) && !this.flashCells.has(key)) color = "#8cb860"; // green for row drag
                    else if (this.validatedCells.has(key) && !this.flashCells.has(key)) color = "#8cb860"; // green for validated
                    else if (letter === WILDCARD_SYMBOL && !this.flashCells.has(key)) color = "#c4a878"; // orchid purple for wildcards
                    let scale = 1;
                    let alpha = 1;
                    if (isBlastCell) {
                        if (key === this.blastCenterKey) {
                            scale = 0.95 + 0.12 * Math.sin(this.blastProgress * Math.PI * 4);
                        } else {
                            color = "#d4c890";
                            scale = Math.max(0.2, 1 - this.blastProgress * 0.55);
                            alpha = Math.max(0.12, 1 - this.blastProgress * 0.9);
                        }
                    }
                    this._drawToken(letter, x + cs / 2, y + cs / 2, cs, color, scale, alpha);

                    // Green overlay ON TOP of styled blocks (so scrabble wood etc. show through)
                    if (this.validatedCells.has(key) && !this.flashCells.has(key) && !isBlastCell) {
                        ctx.fillStyle = "rgba(140, 184, 96, 0.35)";
                        ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
                    }
                }
            }
        }

        // Gravity animations (letters sliding down)
        for (const anim of this.gravityAnims) {
            const currentRow = anim.fromRow + (anim.toRow - anim.fromRow) * anim.progress;
            const x = this.offsetX + anim.col * cs;
            const y = this.offsetY + currentRow * cs;
            ctx.fillStyle = T.cell;
            ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
            this._drawToken(anim.letter, x + cs / 2, y + cs / 2, cs, T.text);
        }

        // Shuffle animations (letters flying to new positions)
        for (const anim of this.shuffleAnims) {
            if (anim.progress <= 0) continue;
            const t = anim.progress;
            // Ease-in-out for smooth arcing flight
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            const curRow = anim.fromRow + (anim.toRow - anim.fromRow) * ease;
            const curCol = anim.fromCol + (anim.toCol - anim.fromCol) * ease;
            // Arc upward in the middle of the flight
            const arc = -1.5 * Math.sin(t * Math.PI);
            const x = this.offsetX + curCol * cs;
            const y = this.offsetY + (curRow + arc) * cs;
            const scale = 0.8 + 0.4 * Math.sin(t * Math.PI); // grow slightly mid-flight
            ctx.fillStyle = T.cell;
            ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
            this._drawToken(anim.letter, x + cs / 2, y + cs / 2, cs, T.textFalling, scale);
        }

        // Grid lines
        ctx.strokeStyle = T.gridLine;
        ctx.lineWidth = 1;
        for (let r = 0; r <= rows; r++) {
            ctx.beginPath();
            ctx.moveTo(this.offsetX, this.offsetY + r * cs);
            ctx.lineTo(this.offsetX + cols * cs, this.offsetY + r * cs);
            ctx.stroke();
        }
        for (let c = 0; c <= cols; c++) {
            ctx.beginPath();
            ctx.moveTo(this.offsetX + c * cs, this.offsetY);
            ctx.lineTo(this.offsetX + c * cs, this.offsetY + rows * cs);
            ctx.stroke();
        }

        const ghostRow = block ? this.getGhostRow(grid, block) : null;

        if (block && ghostRow !== null) {
            const ghostX = this.offsetX + block.col * cs;
            const ghostY = this.offsetY + ghostRow * cs;
            ctx.fillStyle = T.ghost;
            ctx.fillRect(ghostX + 1, ghostY + 1, cs - 2, cs - 2);
            ctx.strokeStyle = T.ghostBorder;
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(ghostX + 3, ghostY + 3, cs - 6, cs - 6);
            ctx.setLineDash([]);
            this._drawToken(block.letter, ghostX + cs / 2, ghostY + cs / 2, cs, T.ghostBorder);
        }

        // Falling block (smooth position)
        if (block) {
            const x = this.offsetX + block.col * cs;
            const y = this.offsetY + block.visualRow * cs;
            // Highlight border
            ctx.fillStyle = T.cell;
            ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
            ctx.strokeStyle = T.border;
            ctx.lineWidth = 3;
            ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
            // Letter
            this._drawToken(block.letter, x + cs / 2, y + cs / 2, cs, T.textFalling);
        }

        // Impact rings (landing effect)
        for (let i = this.impactRings.length - 1; i >= 0; i--) {
            const ring = this.impactRings[i];
            ring.progress += dt * 4; // complete in ~0.25s
            if (ring.progress >= 1) { this.impactRings.splice(i, 1); continue; }
            const alpha = 0.6 * (1 - ring.progress);
            const radius = ring.maxRadius * ring.progress;
            const bc = T.border;
            if (bc.startsWith('#')) {
                const r2 = parseInt(bc.slice(1,3),16), g2 = parseInt(bc.slice(3,5),16), b2 = parseInt(bc.slice(5,7),16);
                ctx.strokeStyle = `rgba(${r2},${g2},${b2},${alpha})`;
            } else {
                ctx.strokeStyle = bc;
            }
            ctx.lineWidth = 2 * (1 - ring.progress);
            ctx.beginPath();
            ctx.arc(ring.x, ring.y, radius, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            this.particles[i].update(dt);
            this.particles[i].draw(ctx);
            if (this.particles[i].dead) this.particles.splice(i, 1);
        }

        // End shake transform
        ctx.restore();
    }

    // Spawn particles at cell centers
    spawnParticles(cellSet) {
        for (const key of cellSet) {
            const [r, c] = key.split(",").map(Number);
            const { x, y } = this.cellCenter(r, c);
            for (let i = 0; i < 12; i++) {
                this.particles.push(new Particle(x, y));
            }
            // Matter.js physics debris
            spawnDebris(x, y, 6);
            // PixiJS dust burst
            pixiDustBurst(x, y, 8);
        }
    }
}

// ────────────────────────────────────────
// DEFAULT TRACK LIST
// Auto-generated by running:  node scan-music.js
// The game tries to load Music/tracks.json at startup.
// If that fails (e.g. file:// protocol), it uses FALLBACK_TRACKS below.
// Update FALLBACK_TRACKS when you add/remove music files.
// ────────────────────────────────────────
const FALLBACK_TRACKS = [
    { id: "track01", title: "LIQUID", artist: "Freddy River", file: "Music/liquid.mp3" },
];

let DEFAULT_TRACKS = [...FALLBACK_TRACKS];

// Try to load from tracks.json (works when served via HTTP, not file://)
async function loadTrackList() {
    try {
        const resp = await fetch("Music/tracks.json");
        if (!resp.ok) throw new Error(resp.status);
        const tracks = await resp.json();
        if (Array.isArray(tracks) && tracks.length > 0) {
            DEFAULT_TRACKS = tracks;
            console.log(`♪ Loaded ${tracks.length} track(s) from Music/tracks.json`);
            return;
        }
    } catch (_) {
        // fetch failed (file:// or missing) — use fallback
    }
    DEFAULT_TRACKS = [...FALLBACK_TRACKS];
    console.log(`♪ Using ${DEFAULT_TRACKS.length} fallback track(s).`);
}

// ────────────────────────────────────────
// PLAYLIST MANAGER (persists custom playlists & reorder to localStorage)
// ────────────────────────────────────────
class PlaylistManager {
    constructor(defaultTracks) {
        this.allTracks = defaultTracks;
        this.trackMap = new Map(defaultTracks.map(t => [t.id, t]));
        this.favorites = new Set();
        this._load();
    }

    _load() {
        try {
            const data = JSON.parse(localStorage.getItem("wf_playlists") || "null");
            if (data && data.version === 1) {
                this.defaultOrder = data.defaultOrder || this.allTracks.map(t => t.id);
                this.custom = data.custom || [];  // [{name, trackIds}]
                if (Array.isArray(data.favorites)) this.favorites = new Set(data.favorites);
            } else {
                this._reset();
            }
        } catch {
            this._reset();
        }
        this._cleanIds();
    }

    _reset() {
        this.defaultOrder = this.allTracks.map(t => t.id);
        this.custom = [];
        this.favorites = new Set();
    }

    // Remove any track IDs that no longer exist in allTracks
    _cleanIds() {
        const validIds = new Set(this.allTracks.map(t => t.id));
        this.defaultOrder = this.defaultOrder.filter(id => validIds.has(id));
        // Add any new tracks not in saved order
        for (const t of this.allTracks) {
            if (!this.defaultOrder.includes(t.id)) this.defaultOrder.push(t.id);
        }
        for (const pl of this.custom) {
            pl.trackIds = pl.trackIds.filter(id => validIds.has(id));
        }
        // Clean favorites
        for (const id of this.favorites) {
            if (!validIds.has(id)) this.favorites.delete(id);
        }
    }

    _save() {
        localStorage.setItem("wf_playlists", JSON.stringify({
            version: 1,
            defaultOrder: this.defaultOrder,
            custom: this.custom,
            favorites: [...this.favorites],
        }));
    }

    getTrack(id) { return this.trackMap.get(id) || null; }

    isFavorite(id) { return this.favorites.has(id); }

    toggleFavorite(id) {
        if (this.favorites.has(id)) this.favorites.delete(id);
        else this.favorites.add(id);
        this._save();
        return this.favorites.has(id);
    }

    getFavoriteTracks() {
        return this.defaultOrder.filter(id => this.favorites.has(id)).map(id => this.trackMap.get(id)).filter(Boolean);
    }

    getFavoriteTrackIds() {
        return this.defaultOrder.filter(id => this.favorites.has(id));
    }

    getDefaultPlaylist() {
        return this.defaultOrder.map(id => this.trackMap.get(id)).filter(Boolean);
    }

    getCustomPlaylists() { return this.custom; }

    getPlaylistTracks(playlist) {
        if (playlist === "__default") return this.getDefaultPlaylist();
        if (playlist === "__favorites") return this.getFavoriteTracks();
        const pl = this.custom.find(p => p.name === playlist);
        return pl ? pl.trackIds.map(id => this.trackMap.get(id)).filter(Boolean) : [];
    }

    getPlaylistTrackIds(playlist) {
        if (playlist === "__default") return [...this.defaultOrder];
        if (playlist === "__favorites") return this.getFavoriteTrackIds();
        const pl = this.custom.find(p => p.name === playlist);
        return pl ? [...pl.trackIds] : [];
    }

    // Reorder a track within a playlist
    moveTrack(playlist, fromIndex, toIndex) {
        const ids = playlist === "__default" ? this.defaultOrder
            : this.custom.find(p => p.name === playlist)?.trackIds;
        if (!ids || fromIndex < 0 || toIndex < 0 || fromIndex >= ids.length || toIndex >= ids.length) return;
        const [item] = ids.splice(fromIndex, 1);
        ids.splice(toIndex, 0, item);
        this._save();
    }

    createPlaylist(name, trackIds) {
        if (this.custom.some(p => p.name === name)) return false;
        this.custom.push({ name, trackIds: [...trackIds] });
        this._save();
        return true;
    }

    renamePlaylist(oldName, newName) {
        const pl = this.custom.find(p => p.name === oldName);
        if (!pl || this.custom.some(p => p.name === newName)) return false;
        pl.name = newName;
        this._save();
        return true;
    }

    deletePlaylist(name) {
        this.custom = this.custom.filter(p => p.name !== name);
        this._save();
    }

    removeTrackFromPlaylist(playlistName, trackId) {
        const pl = this.custom.find(p => p.name === playlistName);
        if (!pl) return;
        pl.trackIds = pl.trackIds.filter(id => id !== trackId);
        this._save();
    }
}

// ────────────────────────────────────────
// MUSIC MANAGER (handles audio playback)
// ────────────────────────────────────────
class MusicManager {
    constructor(playlistManager) {
        this.plMgr = playlistManager;
        this.audio = new Audio();
        this._volume = parseFloat(localStorage.getItem("wf_music_volume") || "0.5");
        this.audio.volume = 1; // keep at 1; real volume via GainNode
        this.muted = false;
        this.playing = false;
        this.currentTrackId = null;
        this.activePlaylist = "__default";
        this.queue = [];
        this.queueIndex = -1;

        // Web Audio API gain node for cross-platform volume control (iOS ignores audio.volume)
        this._audioCtx = null;
        this._gainNode = null;
        this._sourceNode = null;

        // Shuffle & repeat
        this.shuffleOn = localStorage.getItem("wf_music_shuffle") === "1";
        this._shuffledQueue = [];
        this._shuffledIndex = -1;
        // repeatMode: "off" | "all" | "one"
        this.repeatMode = localStorage.getItem("wf_music_repeat") || "off";

        // Crossfade
        this._crossfadeDuration = 1.5; // seconds
        this._crossfadeAudio = null;
        this._crossfading = false;

        // Track when current track started playing (guards against premature crossfade
        // caused by inaccurate duration estimates on VBR MP3s)
        this._trackPlayStart = 0;

        // AbortController for audio event listeners (enables clean removal)
        this._listenerAborter = null;

        // Preloaded next track for gapless playback
        this._preloadedAudio = null;
        this._preloadedTrackId = null;

        // Sleep timer
        this.sleepTimerEnd = 0;     // timestamp (ms) when playback should auto-stop
        this.sleepTimerInterval = null;
        this.onSleepTimerTick = null; // (remainingMs) => void

        // Callbacks for UI updates
        this.onStateChange = null;
        this.onTimeUpdate = null;

        this._lastSavedTime = 0;

        // iOS AudioContext suspension watchdog — iOS can suspend the AudioContext
        // mid-foreground (Siri, notification banners, system audio), which halts
        // playback without triggering visibilitychange. Poll every 3s to detect
        // and recover from this state.
        this._watchdogTimer = setInterval(() => this._audioWatchdog(), 3000);

        // Attach ended + timeupdate listeners to initial audio element
        this._bindAudioListeners(this.audio);

        this._buildQueue();
        this._restoreMusicState();
    }

    // ── Queue management ──

    _buildQueue() {
        this.queue = this.plMgr.getPlaylistTrackIds(this.activePlaylist);
        if (this.shuffleOn) this._reshuffleQueue();
    }

    _reshuffleQueue() {
        this._shuffledQueue = [...this.queue];
        // Fisher-Yates
        for (let i = this._shuffledQueue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this._shuffledQueue[i], this._shuffledQueue[j]] = [this._shuffledQueue[j], this._shuffledQueue[i]];
        }
        // Keep current track at position 0 if playing
        if (this.currentTrackId) {
            const idx = this._shuffledQueue.indexOf(this.currentTrackId);
            if (idx > 0) {
                [this._shuffledQueue[0], this._shuffledQueue[idx]] = [this._shuffledQueue[idx], this._shuffledQueue[0]];
            }
            this._shuffledIndex = 0;
        }
    }

    _getEffectiveQueue() {
        return this.shuffleOn ? this._shuffledQueue : this.queue;
    }

    _getEffectiveIndex() {
        return this.shuffleOn ? this._shuffledIndex : this.queueIndex;
    }

    _setEffectiveIndex(idx) {
        if (this.shuffleOn) this._shuffledIndex = idx;
        else this.queueIndex = idx;
    }

    setActivePlaylist(name) {
        this.activePlaylist = name;
        this._buildQueue();
        if (this.currentTrackId) {
            const q = this._getEffectiveQueue();
            const idx = q.indexOf(this.currentTrackId);
            if (idx >= 0) { this._setEffectiveIndex(idx); return; }
        }
        this._setEffectiveIndex(-1);
    }

    refreshQueue() {
        this._buildQueue();
        if (this.currentTrackId) {
            const q = this._getEffectiveQueue();
            const idx = q.indexOf(this.currentTrackId);
            if (idx >= 0) this._setEffectiveIndex(idx);
        }
    }

    _getNextTrackId() {
        const q = this._getEffectiveQueue();
        if (q.length === 0) return null;
        let nextIdx = this._getEffectiveIndex() + 1;
        if (nextIdx >= q.length) {
            if (this.repeatMode === "off") return null;
            nextIdx = 0;
        }
        return q[nextIdx] || null;
    }

    // ── Shuffle & Repeat ──

    toggleShuffle() {
        this.shuffleOn = !this.shuffleOn;
        localStorage.setItem("wf_music_shuffle", this.shuffleOn ? "1" : "0");
        if (this.shuffleOn) {
            this._reshuffleQueue();
        } else {
            // Restore normal index
            if (this.currentTrackId) {
                this.queueIndex = this.queue.indexOf(this.currentTrackId);
            }
        }
        this._notify();
    }

    cycleRepeat() {
        if (this.repeatMode === "off") this.repeatMode = "all";
        else if (this.repeatMode === "all") this.repeatMode = "one";
        else this.repeatMode = "off";
        localStorage.setItem("wf_music_repeat", this.repeatMode);
        this._notify();
    }

    // ── Playback ──

    playTrackById(trackId) {
        const track = this.plMgr.getTrack(trackId);
        if (!track) return;
        // Find in effective queue
        const q = this._getEffectiveQueue();
        const idx = q.indexOf(trackId);
        if (idx >= 0) this._setEffectiveIndex(idx);
        else {
            this.setActivePlaylist("__default");
            const q2 = this._getEffectiveQueue();
            this._setEffectiveIndex(q2.indexOf(trackId));
        }
        this.currentTrackId = trackId;
        this._cancelCrossfade();
        // Reset duration tracking for crossfade stability check
        this._lastKnownDuration = 0;
        this._durationStableSince = 0;

        // Stop and discard old audio element (abort listeners BEFORE clearing src
        // to prevent phantom events from src="" triggering handlers)
        if (this._listenerAborter) this._listenerAborter.abort();
        this.audio.pause();
        this.audio.src = "";
        this._trackPlayStart = Date.now();

        // Use preloaded audio if available for instant playback
        const preloaded = this._consumePreloaded(trackId);
        this.audio = preloaded || new Audio(track.file);
        this.audio.volume = 1;
        this.audio.muted = !!this.muted;
        this._ensureGainNode(this.audio);
        this._bindAudioListeners(this.audio);
        this.audio.play().catch(() => {});
        this.playing = true;
        this._saveMusicState();
        this._notify();
        this._preloadNextTrack();
    }

    play() {
        if (this.currentTrackId) {
            this._ensureGainNode(this.audio);
            this.audio.play().catch(() => {});
            this.playing = true;
            localStorage.setItem("wf_music_paused", "0");
            this._preloadNextTrack();
            this._notify();
        } else {
            const q = this._getEffectiveQueue();
            if (q.length > 0) {
                this._setEffectiveIndex(0);
                this.playTrackById(q[0]);
            }
        }
    }

    pause() {
        this.audio.pause();
        this._cancelCrossfade();
        this.playing = false;
        this._saveMusicState();
        localStorage.setItem("wf_music_paused", "1");
        this._notify();
    }

    toggle() {
        this.playing ? this.pause() : this.play();
    }

    resumePlayback() {
        if (!this.playing || !this.currentTrackId) return;
        if (this._audioCtx && this._audioCtx.state === "suspended") {
            this._audioCtx.resume().catch(() => {});
        }
        if (this.audio.paused) {
            this.audio.play().catch(() => {});
        }
    }

    _audioWatchdog() {
        if (!this.playing || !this.currentTrackId) return;
        // Detect AudioContext suspended mid-playback (common on iOS)
        if (this._audioCtx && this._audioCtx.state === "suspended") {
            this._audioCtx.resume().catch(() => {});
        }
        // Detect audio element paused while we think we're playing
        if (this.audio.paused && !this.audio.ended) {
            this.audio.play().catch(() => {});
        }
    }

    _preloadNextTrack() {
        const nextId = this._getNextTrackId();
        if (this._preloadedAudio && this._preloadedTrackId !== nextId) {
            this._preloadedAudio.src = "";
            this._preloadedAudio = null;
            this._preloadedTrackId = null;
        }
        if (!nextId || this._preloadedTrackId === nextId) return;
        const track = this.plMgr.getTrack(nextId);
        if (!track) return;
        this._preloadedAudio = new Audio();
        this._preloadedAudio.preload = "auto";
        this._preloadedAudio.src = track.file;
        this._preloadedTrackId = nextId;
    }

    _consumePreloaded(trackId) {
        if (this._preloadedTrackId === trackId && this._preloadedAudio) {
            const audio = this._preloadedAudio;
            this._preloadedAudio = null;
            this._preloadedTrackId = null;
            return audio;
        }
        return null;
    }

    next() {
        const q = this._getEffectiveQueue();
        if (q.length === 0) return;
        let newIdx = this._getEffectiveIndex() + 1;
        if (newIdx >= q.length) {
            if (this.repeatMode === "off") { this.pause(); return; }
            newIdx = 0;
            if (this.shuffleOn) this._reshuffleQueue();
        }
        this._setEffectiveIndex(newIdx);
        this.playTrackById(q[newIdx]);
    }

    prev() {
        const q = this._getEffectiveQueue();
        if (q.length === 0) return;
        if (this.audio.currentTime > 3) {
            this.audio.currentTime = 0;
            return;
        }
        let newIdx = this._getEffectiveIndex() - 1;
        if (newIdx < 0) newIdx = q.length - 1;
        this._setEffectiveIndex(newIdx);
        this.playTrackById(q[newIdx]);
    }

    seek(fraction) {
        if (this.audio.duration) {
            this.audio.currentTime = fraction * this.audio.duration;
        }
    }

    // ── Volume (via Web Audio GainNode for iOS compatibility) ──

    _ensureGainNode(audioEl) {
        if (!this._audioCtx) {
            this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            // Listen for iOS-triggered suspensions so we can auto-resume
            this._audioCtx.onstatechange = () => {
                if (this._audioCtx.state === "suspended" && this.playing) {
                    this._audioCtx.resume().catch(() => {});
                }
            };
        }
        if (this._audioCtx.state === "suspended") {
            this._audioCtx.resume().catch(() => {});
        }
        // Only create source node once per audio element
        if (this._sourceNode && this._sourceNodeEl === audioEl) return;
        // Disconnect old source if switching elements
        if (this._sourceNode) {
            try { this._sourceNode.disconnect(); } catch {}
        }
        try {
            this._sourceNode = this._audioCtx.createMediaElementSource(audioEl);
            this._sourceNodeEl = audioEl;
        } catch {
            // Already connected (can't create two sources for same element)
            return;
        }
        if (!this._gainNode) {
            this._gainNode = this._audioCtx.createGain();
            this._gainNode.connect(this._audioCtx.destination);
        }
        this._sourceNode.connect(this._gainNode);
        this._gainNode.gain.value = this.muted ? 0 : this._volume;
    }

    setVolume(vol) {
        this._volume = Math.max(0, Math.min(1, vol));
        if (this._gainNode) {
            this._gainNode.gain.value = this.muted ? 0 : this._volume;
        }
        // Also set audio.volume as fallback for non-WebAudio environments
        this.audio.volume = this.muted ? 0 : this._volume;
        if (this._crossfadeAudio) this._crossfadeAudio.volume = this.muted ? 0 : this._volume;
        localStorage.setItem("wf_music_volume", this._volume.toFixed(2));
        this._notify();
    }

    getVolume() {
        return this._volume;
    }

    setMuted(muted) {
        this.muted = muted;
        this.audio.muted = muted;
        if (this._crossfadeAudio) this._crossfadeAudio.muted = muted;
        // GainNode must also reflect mute (audio.muted alone doesn't
        // suppress signal routed through Web Audio API).
        if (this._gainNode) {
            this._gainNode.gain.value = muted ? 0 : this._volume;
        }
        // Fallback: also zero out audio.volume so sound is fully suppressed
        // even on browsers where audio.muted doesn't affect createMediaElementSource.
        this.audio.volume = muted ? 0 : 1;
        if (this._crossfadeAudio) this._crossfadeAudio.volume = muted ? 0 : 1;

        // When unmuting, if the player thinks it's playing but audio actually
        // stopped (e.g. a track ended while muted and next() silently failed),
        // restart playback so the user hears music again.
        if (!muted && this.playing && (this.audio.paused || this.audio.ended)) {
            this.audio.play().catch(() => {
                // Current audio truly dead — advance to next track
                if (this.currentTrackId) this.next();
            });
        }
    }

    getCurrentTrack() {
        return this.currentTrackId ? this.plMgr.getTrack(this.currentTrackId) : null;
    }

    // ── Audio event listeners ──

    _bindAudioListeners(audioEl) {
        // Abort previous listeners to prevent accumulation / phantom events
        if (this._listenerAborter) this._listenerAborter.abort();
        this._listenerAborter = new AbortController();
        const signal = this._listenerAborter.signal;

        audioEl.addEventListener("ended", () => {
            if (audioEl !== this.audio) return;
            this._onTrackEnded();
        }, { signal });

        audioEl.addEventListener("error", () => {
            if (audioEl !== this.audio) return;
            console.warn("♪ Audio error on track", this.currentTrackId, audioEl.error);
            // Skip to next track on load/decode errors instead of freezing
            // Guard: don't rapid-fire skip (debounce 2s between error-triggered skips)
            const now = Date.now();
            if (this._lastErrorSkipTime && now - this._lastErrorSkipTime < 2000) return;
            this._lastErrorSkipTime = now;
            if (this.playing) this.next();
        }, { signal });

        audioEl.addEventListener("timeupdate", () => {
            if (audioEl !== this.audio) return;
            if (this.onTimeUpdate) {
                this.onTimeUpdate(this.audio.currentTime, this.audio.duration || 0);
            }
            // Crossfade guard: require track has played at least 10 seconds to avoid
            // premature triggers from inaccurate VBR MP3 duration estimates.
            // Also require duration has stabilized (not changing rapidly).
            const playedSec = this.audio.currentTime;
            const dur = this.audio.duration;
            const minPlayTime = Math.max(15, this._crossfadeDuration * 5);
            // Track duration stability: only crossfade if duration hasn't changed
            // significantly in the last few timeupdates
            const now = Date.now();
            if (dur > 0) {
                if (!this._lastKnownDuration || Math.abs(dur - this._lastKnownDuration) > 0.5) {
                    this._lastKnownDuration = dur;
                    this._durationStableSince = now;
                }
            }
            const durationStable = this._durationStableSince && (now - this._durationStableSince > 5000);
            if (!this._crossfading && this.playing && dur > 0
                && durationStable
                && playedSec >= minPlayTime
                && this.repeatMode !== "one"
                && dur - playedSec <= this._crossfadeDuration
                && dur > this._crossfadeDuration * 2
                && this._getEffectiveQueue().length > 1) {
                this._startCrossfade();
            }
            if (now - this._lastSavedTime > 3000) {
                this._lastSavedTime = now;
                this._saveMusicState();
            }
        }, { signal });
    }

    _onTrackEnded() {
        if (this.repeatMode === "one") {
            this.audio.currentTime = 0;
            this.audio.play().catch(() => {});
            return;
        }
        // If crossfade already handled the transition, skip
        if (this._crossfading) return;
        this.next();
    }

    // ── Crossfade ──

    _startCrossfade() {
        const q = this._getEffectiveQueue();
        if (q.length <= 1) return;
        let nextIdx = this._getEffectiveIndex() + 1;
        if (nextIdx >= q.length) {
            if (this.repeatMode === "off") return;
            nextIdx = 0;
        }
        const nextTrack = this.plMgr.getTrack(q[nextIdx]);
        if (!nextTrack) return;

        this._crossfading = true;
        const preloadedCF = this._consumePreloaded(q[nextIdx]);
        this._crossfadeAudio = preloadedCF || new Audio(nextTrack.file);
        this._crossfadeAudio.volume = this.muted ? 0 : 1;
        this._crossfadeAudio.muted = !!this.muted;
        this._crossfadeAudio.play().catch(() => {
            // Crossfade audio failed to start — abort crossfade so
            // the normal ended → next() path can handle advancement
            this._crossfading = false;
            if (this._crossfadeTimer) clearInterval(this._crossfadeTimer);
            this._crossfadeTimer = null;
            if (this._crossfadeAudio) {
                this._crossfadeAudio.src = "";
                this._crossfadeAudio = null;
            }
            // Restore main audio gain (interval may have partially faded it)
            if (this._gainNode) {
                this._gainNode.gain.value = this.muted ? 0 : this._volume;
            }
            this.audio.volume = this.muted ? 0 : 1;
        });

        // Create a separate gain node for the crossfade audio
        let crossfadeGain = null;
        let crossfadeSource = null;
        if (this._audioCtx) {
            try {
                crossfadeSource = this._audioCtx.createMediaElementSource(this._crossfadeAudio);
                crossfadeGain = this._audioCtx.createGain();
                crossfadeGain.gain.value = 0;
                crossfadeGain.connect(this._audioCtx.destination);
                crossfadeSource.connect(crossfadeGain);
            } catch { crossfadeGain = null; crossfadeSource = null; }
        }

        const fadeStep = 50; // ms
        const steps = (this._crossfadeDuration * 1000) / fadeStep;
        const targetVol = this._volume;
        const volStep = targetVol / steps;
        let step = 0;

        this._crossfadeTimer = setInterval(() => {
            step++;
            const oldGain = Math.max(0, targetVol - step * volStep);
            const newGain = Math.min(targetVol, step * volStep);

            // Fade via gain nodes (cross-platform)
            const m = this.muted ? 0 : 1;
            if (this._gainNode) this._gainNode.gain.value = oldGain * m;
            if (crossfadeGain) crossfadeGain.gain.value = newGain * m;
            // Fallback for non-WebAudio
            this.audio.volume = oldGain * m;
            if (this._crossfadeAudio) this._crossfadeAudio.volume = newGain * m;

            if (step >= steps) {
                clearInterval(this._crossfadeTimer);
                this.audio.pause();
                // Disconnect old source from gain
                if (this._sourceNode) {
                    try { this._sourceNode.disconnect(); } catch {}
                }
                // Swap audio elements
                const oldAudio = this.audio;
                this.audio = this._crossfadeAudio;
                this._crossfadeAudio = null;
                this._crossfading = false;

                // Swap gain nodes: crossfade gain becomes the main gain
                if (crossfadeGain && crossfadeSource) {
                    if (this._gainNode) {
                        try { this._gainNode.disconnect(); } catch {}
                    }
                    this._gainNode = crossfadeGain;
                    this._sourceNode = crossfadeSource;
                    this._sourceNodeEl = this.audio;
                    this._gainNode.gain.value = this.muted ? 0 : this._volume;
                }

                this.audio.volume = this.muted ? 0 : 1;

                // Update track reference
                this._setEffectiveIndex(nextIdx);
                if (this.shuffleOn && nextIdx === 0) this._reshuffleQueue();
                this.currentTrackId = q[nextIdx];

                // Re-add event listeners to new audio
                this._bindAudioListeners(this.audio);

                this._saveMusicState();
                this._notify();
                this._preloadNextTrack();

                // Clean up
                oldAudio.src = "";
            }
        }, fadeStep);
    }

    _cancelCrossfade() {
        if (this._crossfadeTimer) clearInterval(this._crossfadeTimer);
        if (this._crossfadeAudio) {
            this._crossfadeAudio.pause();
            this._crossfadeAudio.src = "";
            this._crossfadeAudio = null;
        }
        this._crossfading = false;
        // Restore volume via gain node (respect mute)
        if (this._gainNode) {
            this._gainNode.gain.value = this.muted ? 0 : this._volume;
        }
        this.audio.volume = this.muted ? 0 : 1;
    }

    // ── Sleep timer ──

    startSleepTimer(minutes) {
        this.clearSleepTimer();
        this.sleepTimerEnd = Date.now() + minutes * 60 * 1000;
        this.sleepTimerInterval = setInterval(() => {
            const remaining = this.sleepTimerEnd - Date.now();
            if (remaining <= 0) {
                this.clearSleepTimer();
                this.pause();
                return;
            }
            if (this.onSleepTimerTick) this.onSleepTimerTick(remaining);
        }, 1000);
        this._notify();
    }

    clearSleepTimer() {
        if (this.sleepTimerInterval) clearInterval(this.sleepTimerInterval);
        this.sleepTimerInterval = null;
        this.sleepTimerEnd = 0;
        if (this.onSleepTimerTick) this.onSleepTimerTick(0);
        this._notify();
    }

    getSleepTimerRemaining() {
        if (!this.sleepTimerEnd) return 0;
        return Math.max(0, this.sleepTimerEnd - Date.now());
    }

    // ── Persistence ──

    _saveMusicState() {
        if (!this.currentTrackId) return;
        localStorage.setItem("wf_music_state", JSON.stringify({
            trackId: this.currentTrackId,
            position: this.audio.currentTime || 0,
            playlist: this.activePlaylist,
            queueIndex: this.queueIndex,
        }));
    }

    _restoreMusicState() {
        try {
            const data = JSON.parse(localStorage.getItem("wf_music_state") || "null");
            if (!data || !data.trackId) return;
            const track = this.plMgr.getTrack(data.trackId);
            if (!track) return;

            if (data.playlist) {
                this.activePlaylist = data.playlist;
                this._buildQueue();
            }

            this.currentTrackId = data.trackId;
            const q = this._getEffectiveQueue();
            const idx = q.indexOf(data.trackId);
            this._setEffectiveIndex(idx >= 0 ? idx : 0);
            this.audio.src = track.file;
            this.audio.muted = !!this.muted;

            if (data.position > 0) {
                const seekOnce = () => {
                    this.audio.currentTime = data.position;
                    this.audio.removeEventListener("canplay", seekOnce);
                };
                this.audio.addEventListener("canplay", seekOnce);
            }

            this.playing = false;
            this._notify();
        } catch {}
    }

    _notify() {
        if (this.onStateChange) this.onStateChange();
    }
}

// ────────────────────────────────────────
// PROFILE MANAGER (multiple save files, localStorage)
// Each profile stores: username, highScore, gamesPlayed, totalWords, gridSize, difficulty, gameMode
// ────────────────────────────────────────
class ProfileManager {
    constructor() {
        this._load();
    }

    _load() {
        try {
            const data = JSON.parse(localStorage.getItem("wf_profiles") || "null");
            if (data && data.version === 1) {
                this.profiles = data.profiles || [];
                this.activeId = data.activeId || null;
            } else {
                this.profiles = [];
                this.activeId = null;
            }
        } catch {
            this.profiles = [];
            this.activeId = null;
        }
    }

    _save() {
        try {
            localStorage.setItem("wf_profiles", JSON.stringify({
                version: 1,
                profiles: this.profiles,
                activeId: this.activeId,
            }));
        } catch (e) {
            console.error('[profile] localStorage save failed:', e);
        }
    }

    getAll() { return this.profiles; }

    getActive() {
        return this.profiles.find(p => p.id === this.activeId) || null;
    }

    create(username) {
        const id = "prof_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
        const profile = {
            id,
            username,
            highScore: 0,
            gamesPlayed: 0,
            totalWords: 0,
            uniqueWordsFound: [],
            gridSize: 5,
            difficulty: "casual",
            gameMode: GAME_MODES.SANDBOX,
            createdAt: Date.now(),
            level: 1,
            xp: 0,
            totalXp: 0,
            bestScores: {},
            // Coin system
            coins: 0,
            totalCoinsEarned: 0,
            inventory: [],           // owned item IDs
            equipped: {              // currently active cosmetics
                gridTheme: "theme_default",
                blockStyle: "block_default",
            },
            bonusSlotContents: [null, null, null],  // bonus type in each slot (null = empty)
            perks: {},               // consumable counts: { perk_headstart: 2, ... }
            unlockedGrids: {},       // { "3": true, "4": true } — purchased grid unlocks
            // Streak / daily tracking
            lastPlayDate: null,      // YYYY-MM-DD
            playStreak: 0,
            claimedMilestones: [],   // milestone IDs already paid out
        };
        this.profiles.push(profile);
        this.activeId = id;
        this._save();
        return profile;
    }

    select(id) {
        const p = this.profiles.find(p => p.id === id);
        if (p) {
            this.activeId = id;
            this._save();
        }
        return p;
    }

    delete(id) {
        this.profiles = this.profiles.filter(p => p.id !== id);
        if (this.activeId === id) {
            this.activeId = this.profiles.length > 0 ? this.profiles[0].id : null;
        }
        this._save();
    }

    rename(id, newUsername) {
        const p = this.profiles.find(p => p.id === id);
        if (p) {
            p.username = newUsername;
            this._save();
        }
        return p;
    }

    // Update stats for the active profile after a game ends
    recordGame(score, wordsFound) {
        const p = this.getActive();
        if (!p) return;
        p.gamesPlayed++;
        p.totalWords += wordsFound.length;
        if (!Array.isArray(p.uniqueWordsFound)) p.uniqueWordsFound = [];
        const uniqueSet = new Set(p.uniqueWordsFound);
        for (const entry of wordsFound) {
            const w = typeof entry === 'string' ? entry : (entry.word || '');
            if (w) uniqueSet.add(w);
        }
        p.uniqueWordsFound = [...uniqueSet];
        if (score > p.highScore) p.highScore = score;
        this._save();
    }

    // Save preferred grid size for the active profile
    setGridSize(size) {
        const p = this.getActive();
        if (!p) return;
        p.gridSize = size;
        this._save();
    }

    // Save preferred difficulty for the active profile
    setDifficulty(difficulty) {
        const p = this.getActive();
        if (!p) return;
        p.difficulty = difficulty;
        this._save();
    }

    setGameMode(gameMode) {
        const p = this.getActive();
        if (!p) return;
        p.gameMode = gameMode;
        this._save();
    }

    getChallengeStats(challengeType) {
        const p = this.getActive();
        if (!p) return { highScore: 0, gamesPlayed: 0, totalWords: 0, uniqueWordsFound: [], targetWordLevel: 1 };
        if (!p.challengeStats) p.challengeStats = {};
        const cs = p.challengeStats[challengeType] || { highScore: 0, gamesPlayed: 0, totalWords: 0, uniqueWordsFound: [] };
        if (cs.targetWordLevel === undefined) cs.targetWordLevel = 1;
        return cs;
    }

    recordChallengeGame(challengeType, score, wordsFound) {
        const p = this.getActive();
        if (!p) return;
        if (!p.challengeStats) p.challengeStats = {};
        if (!p.challengeStats[challengeType]) {
            p.challengeStats[challengeType] = { highScore: 0, gamesPlayed: 0, totalWords: 0, uniqueWordsFound: [], targetWordLevel: 1 };
        }
        const cs = p.challengeStats[challengeType];
        cs.gamesPlayed++;
        p.gamesPlayed++;  // Count challenges toward total games (matches server)
        cs.totalWords += wordsFound.length;
        if (!Array.isArray(cs.uniqueWordsFound)) cs.uniqueWordsFound = [];
        const uniqueSet = new Set(cs.uniqueWordsFound);
        for (const entry of wordsFound) {
            const w = typeof entry === 'string' ? entry : (entry.word || '');
            if (w) uniqueSet.add(w);
        }
        cs.uniqueWordsFound = [...uniqueSet];
        if (score > cs.highScore) cs.highScore = score;
        this._save();
    }

    getTargetWordLevel() {
        const stats = this.getChallengeStats(CHALLENGE_TYPES.TARGET_WORD);
        return stats.targetWordLevel || 1;
    }

    advanceTargetWordLevel() {
        const p = this.getActive();
        if (!p) return 1;
        if (!p.challengeStats) p.challengeStats = {};
        if (!p.challengeStats[CHALLENGE_TYPES.TARGET_WORD]) {
            p.challengeStats[CHALLENGE_TYPES.TARGET_WORD] = { highScore: 0, gamesPlayed: 0, totalWords: 0, uniqueWordsFound: [], targetWordLevel: 1 };
        }
        const cs = p.challengeStats[CHALLENGE_TYPES.TARGET_WORD];
        if (cs.targetWordLevel === undefined) cs.targetWordLevel = 1;
        cs.targetWordLevel++;
        this._save();
        return cs.targetWordLevel;
    }

    setTargetWordLevel(level) {
        const p = this.getActive();
        if (!p) return;
        if (!p.challengeStats) p.challengeStats = {};
        if (!p.challengeStats[CHALLENGE_TYPES.TARGET_WORD]) {
            p.challengeStats[CHALLENGE_TYPES.TARGET_WORD] = { highScore: 0, gamesPlayed: 0, totalWords: 0, uniqueWordsFound: [], targetWordLevel: 1 };
        }
        p.challengeStats[CHALLENGE_TYPES.TARGET_WORD].targetWordLevel = level;
        this._save();
    }

    getWordSearchLevel() {
        const stats = this.getChallengeStats(CHALLENGE_TYPES.WORD_SEARCH);
        return stats.wordSearchLevel || 1;
    }

    advanceWordSearchLevel() {
        const p = this.getActive();
        if (!p) return 1;
        if (!p.challengeStats) p.challengeStats = {};
        if (!p.challengeStats[CHALLENGE_TYPES.WORD_SEARCH]) {
            p.challengeStats[CHALLENGE_TYPES.WORD_SEARCH] = { highScore: 0, gamesPlayed: 0, totalWords: 0, uniqueWordsFound: [], wordSearchLevel: 1 };
        }
        const cs = p.challengeStats[CHALLENGE_TYPES.WORD_SEARCH];
        if (cs.wordSearchLevel === undefined) cs.wordSearchLevel = 1;
        cs.wordSearchLevel++;
        this._save();
        return cs.wordSearchLevel;
    }

    hasProfiles() { return this.profiles.length > 0; }

    /** Ensure legacy profiles have XP fields. */
    _ensureXPFields(p) {
        if (!p) return;
        if (p.level === undefined) p.level = 1;
        if (p.xp === undefined) p.xp = 0;
        if (p.totalXp === undefined) p.totalXp = 0;
        if (!p.bestScores) p.bestScores = {};
    }

    /** Ensure legacy profiles have coin/shop fields. */
    _ensureCoinFields(p) {
        if (!p) return;
        if (p.coins === undefined) p.coins = 0;
        if (p.totalCoinsEarned === undefined) p.totalCoinsEarned = 0;
        if (!Array.isArray(p.inventory)) p.inventory = [];
        if (!p.equipped) p.equipped = { gridTheme: "theme_default", blockStyle: "block_default" };
        // Migrate old equipped fields
        if (p.equipped.clearEffect !== undefined) delete p.equipped.clearEffect;
        if (p.equipped.badge !== undefined) delete p.equipped.badge;
        if (p.equipped.title !== undefined) delete p.equipped.title;
        if (p.equipped.profileColor !== undefined) delete p.equipped.profileColor;
        if (!Array.isArray(p.bonusSlotContents)) p.bonusSlotContents = [null, null, null];
        if (!p.perks || typeof p.perks !== "object") p.perks = {};
        if (!p.unlockedGrids || typeof p.unlockedGrids !== "object") p.unlockedGrids = {};
        if (p.lastPlayDate === undefined) p.lastPlayDate = null;
        if (p.playStreak === undefined) p.playStreak = 0;
        if (!Array.isArray(p.claimedMilestones)) p.claimedMilestones = [];
    }

    /** Build a key for bestScores lookup. */
    bestScoreKey(gridSize, difficulty, gameMode, isChallenge, challengeType) {
        if (isChallenge) return `ch-${challengeType}`;
        return `${gridSize}-${difficulty}-${gameMode}`;
    }

    /** Get the best score for a specific mode combination. */
    getBestScore(key) {
        const p = this.getActive();
        if (!p) return 0;
        this._ensureXPFields(p);
        return p.bestScores[key] || 0;
    }

    /** Update best score if new score is higher. */
    updateBestScore(key, score) {
        const p = this.getActive();
        if (!p) return;
        this._ensureXPFields(p);
        if (score > (p.bestScores[key] || 0)) {
            p.bestScores[key] = score;
            this._save();
        }
    }

    /** Check if the active profile has ZERO game history (truly brand new). */
    isFirstGameEver() {
        const p = this.getActive();
        if (!p) return false;
        if (p.gamesPlayed > 0) return false;
        if (p.challengeStats) {
            for (const key of Object.keys(p.challengeStats)) {
                if (p.challengeStats[key].gamesPlayed > 0) return false;
            }
        }
        return true;
    }

    /**
     * Award XP to the active profile. Returns info about the result.
     * @param {number} amount - XP to add
     * @returns {{ leveled, oldLevel, newLevel, oldXp, newXp, oldXpReq, newXpReq, totalXp }}
     */
    awardXP(amount) {
        const p = this.getActive();
        if (!p) return { leveled: false, oldLevel: 1, newLevel: 1, oldXp: 0, newXp: 0, oldXpReq: 100, newXpReq: 100, totalXp: 0 };
        this._ensureXPFields(p);

        const oldLevel = p.level;
        const oldXp = p.xp;
        const oldXpReq = xpRequiredForLevel(p.level);

        p.totalXp += amount;
        p.xp += amount;

        let leveled = false;
        while (p.level < MAX_LEVEL && p.xp >= xpRequiredForLevel(p.level)) {
            p.xp -= xpRequiredForLevel(p.level);
            p.level++;
            leveled = true;
        }
        // Cap at max level
        if (p.level >= MAX_LEVEL) {
            p.level = MAX_LEVEL;
            p.xp = 0;
        }

        this._save();

        return {
            leveled,
            oldLevel,
            newLevel: p.level,
            oldXp,
            newXp: p.xp,
            oldXpReq,
            newXpReq: xpRequiredForLevel(p.level),
            totalXp: p.totalXp,
        };
    }

    /** Get level info for the active profile. */
    getLevelInfo() {
        const p = this.getActive();
        if (!p) return { level: 1, xp: 0, xpRequired: 100, totalXp: 0 };
        this._ensureXPFields(p);
        return {
            level: p.level,
            xp: p.xp,
            xpRequired: xpRequiredForLevel(p.level),
            totalXp: p.totalXp,
        };
    }

    // ── Coin methods ──

    getCoins() {
        const p = this.getActive();
        if (!p) return 0;
        this._ensureCoinFields(p);
        return p.coins;
    }

    addCoins(amount) {
        const p = this.getActive();
        if (!p || amount <= 0) return 0;
        this._ensureCoinFields(p);
        p.coins += amount;
        p.totalCoinsEarned += amount;
        this._save();
        return p.coins;
    }

    spendCoins(amount) {
        const p = this.getActive();
        if (!p) return false;
        this._ensureCoinFields(p);
        if (p.coins < amount) return false;
        p.coins -= amount;
        this._save();
        return true;
    }

    // ── Inventory / Shop methods ──

    ownsItem(itemId) {
        const p = this.getActive();
        if (!p) return false;
        this._ensureCoinFields(p);
        // Defaults are always owned
        const item = SHOP_ITEMS[itemId];
        if (item && item.owned) return true;
        return p.inventory.includes(itemId);
    }

    purchaseItem(itemId) {
        const p = this.getActive();
        if (!p) return { success: false, reason: "no_profile" };
        this._ensureCoinFields(p);
        const item = SHOP_ITEMS[itemId];
        if (!item) return { success: false, reason: "invalid_item" };
        // Consumable perks (stackable)
        if (item.stackSize) {
            if (p.coins < item.price) return { success: false, reason: "insufficient_coins" };
            p.coins -= item.price;
            p.perks[itemId] = (p.perks[itemId] || 0) + item.stackSize;
            this._save();
            return { success: true, newBalance: p.coins, quantity: p.perks[itemId] };
        }
        // Unique items (one-time purchase)
        if (this.ownsItem(itemId)) return { success: false, reason: "already_owned" };
        if (p.coins < item.price) return { success: false, reason: "insufficient_coins" };
        p.coins -= item.price;
        p.inventory.push(itemId);
        this._save();
        return { success: true, newBalance: p.coins };
    }

    equipItem(itemId) {
        const p = this.getActive();
        if (!p) return false;
        this._ensureCoinFields(p);
        if (!this.ownsItem(itemId)) return false;
        const item = SHOP_ITEMS[itemId];
        if (!item) return false;
        switch (item.category) {
            case SHOP_CATEGORIES.GRID_THEMES:   p.equipped.gridTheme = itemId; break;
            case SHOP_CATEGORIES.BLOCK_STYLES:  p.equipped.blockStyle = itemId; break;
            default: return false;
        }
        this._save();
        return true;
    }

    getEquipped() {
        const p = this.getActive();
        if (!p) return { gridTheme: "theme_default", blockStyle: "block_default" };
        this._ensureCoinFields(p);
        return { ...p.equipped };
    }

    // ── Perk (consumable) methods ──

    getPerkCount(perkId) {
        const p = this.getActive();
        if (!p) return 0;
        this._ensureCoinFields(p);
        return p.perks[perkId] || 0;
    }

    consumePerk(perkId) {
        const p = this.getActive();
        if (!p) return false;
        this._ensureCoinFields(p);
        if ((p.perks[perkId] || 0) <= 0) return false;
        p.perks[perkId]--;
        this._save();
        return true;
    }

    // ── Bonus Slot methods ──

    getMaxBonusSlots() {
        const p = this.getActive();
        if (!p) return 0;
        this._ensureCoinFields(p);
        let slots = 0;
        if (p.inventory.includes("bonus_slot_1")) slots = 1;
        if (p.inventory.includes("bonus_slot_2")) slots = 2;
        if (p.inventory.includes("bonus_slot_3")) slots = 3;
        return slots;
    }

    getBonusSlotContents() {
        const p = this.getActive();
        if (!p) return [null, null, null];
        this._ensureCoinFields(p);
        return [...p.bonusSlotContents];
    }

    fillBonusSlot(slotIndex, bonusType) {
        const p = this.getActive();
        if (!p) return { success: false, reason: "no_profile" };
        this._ensureCoinFields(p);
        const maxSlots = this.getMaxBonusSlots();
        if (slotIndex < 0 || slotIndex >= maxSlots) return { success: false, reason: "slot_locked" };
        if (p.bonusSlotContents[slotIndex] !== null) return { success: false, reason: "slot_filled" };
        const fillCost = 500;
        if (p.coins < fillCost) return { success: false, reason: "insufficient_coins" };
        p.coins -= fillCost;
        p.bonusSlotContents[slotIndex] = bonusType;
        this._save();
        return { success: true, newBalance: p.coins };
    }

    useBonusSlot(slotIndex) {
        const p = this.getActive();
        if (!p) return null;
        this._ensureCoinFields(p);
        const maxSlots = this.getMaxBonusSlots();
        if (slotIndex < 0 || slotIndex >= maxSlots) return null;
        const bonusType = p.bonusSlotContents[slotIndex];
        if (!bonusType) return null;
        p.bonusSlotContents[slotIndex] = null;
        this._save();
        return bonusType;
    }

    // ── Grid unlock methods ──

    isGridUnlocked(gridSize) {
        const req = GRID_UNLOCK_REQUIREMENTS[gridSize];
        if (!req) return true; // no requirement = always available
        if (req.level === 0 && req.coins === 0) return true;
        const p = this.getActive();
        if (!p) return false;
        this._ensureCoinFields(p);
        this._ensureXPFields(p);
        // Must meet level requirement
        if (p.level < req.level) return false;
        // If costs coins, must have purchased it
        if (req.coins > 0 && !p.unlockedGrids[String(gridSize)]) return false;
        return true;
    }

    purchaseGridUnlock(gridSize) {
        const p = this.getActive();
        if (!p) return { success: false, reason: "no_profile" };
        this._ensureCoinFields(p);
        this._ensureXPFields(p);
        const req = GRID_UNLOCK_REQUIREMENTS[gridSize];
        if (!req) return { success: false, reason: "invalid_grid" };
        if (p.level < req.level) return { success: false, reason: "level_too_low" };
        if (p.unlockedGrids[String(gridSize)]) return { success: false, reason: "already_unlocked" };
        if (req.coins > 0 && p.coins < req.coins) return { success: false, reason: "insufficient_coins" };
        if (req.coins > 0) p.coins -= req.coins;
        p.unlockedGrids[String(gridSize)] = true;
        this._save();
        return { success: true, newBalance: p.coins };
    }

    // ── Daily / streak tracking ──

    _todayStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }

    /** Call at game start to update streak. Returns { isFirstGameToday, playStreak }. */
    recordDailyPlay() {
        const p = this.getActive();
        if (!p) return { isFirstGameToday: false, playStreak: 0 };
        this._ensureCoinFields(p);
        const today = this._todayStr();
        if (p.lastPlayDate === today) {
            return { isFirstGameToday: false, playStreak: p.playStreak };
        }
        // Check if yesterday was the last play date (streak continues)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
        if (p.lastPlayDate === yStr) {
            p.playStreak++;
        } else {
            p.playStreak = 1;
        }
        p.lastPlayDate = today;
        this._save();
        return { isFirstGameToday: true, playStreak: p.playStreak };
    }

    // ── Milestone checking ──

    /** Check and pay out any unclaimed milestones. Returns array of newly claimed milestones. */
    checkMilestones() {
        const p = this.getActive();
        if (!p) return [];
        this._ensureCoinFields(p);
        this._ensureXPFields(p);
        if (!p._milestoneTimestamps) p._milestoneTimestamps = {};
        const newClaims = [];
        const now = new Date().toISOString();
        for (const m of MILESTONES) {
            if (p.claimedMilestones.includes(m.id)) continue;
            if (m.check(p)) {
                p.claimedMilestones.push(m.id);
                p.coins += m.coins;
                p.totalCoinsEarned += m.coins;
                if (!p._milestoneTimestamps[m.id]) p._milestoneTimestamps[m.id] = now;
                newClaims.push(m);
            }
        }
        if (newClaims.length > 0) this._save();
        return newClaims;
    }
}

// ────────────────────────────────────────
// GAME
// ────────────────────────────────────────
class Game {
    constructor() {
        this.audio = new AudioManager();
        this.canvas = document.getElementById("game-canvas");
        this.renderer = new Renderer(this.canvas);
        this.usesTouchSwipeInput = window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(hover: none)").matches;

        // Music system (uses Howler.js for reliable cross-platform audio)
        this.plMgr = new PlaylistManager(DEFAULT_TRACKS);
        this.music = new HowlerMusicPlayer(this.plMgr);
        // Initialize muted state from localStorage (will be re-synced by _initMutePref)
        this.musicMuted = localStorage.getItem("wf_music_muted") === "1";
        this.activePlaylistTab = "__default";
        this._editingPlaylist = null;

        // Profile system
        this.profileMgr = new ProfileManager();

        // UI elements
        this.els = {
            profilesScreen: document.getElementById("profiles-screen"),
            profilesList:   document.getElementById("profiles-list"),
            newProfileBtn:  document.getElementById("new-profile-btn"),
            profileModal:   document.getElementById("profile-modal"),
            profileModalTitle: document.getElementById("profile-modal-title"),
            profileNameInput: document.getElementById("profile-name-input"),
            profileNameError: document.getElementById("profile-name-error"),
            profileSaveBtn: document.getElementById("profile-save-btn"),
            profileCancelBtn: document.getElementById("profile-cancel-btn"),
            menuScreen:     document.getElementById("menu-screen"),
            menuProfileName: document.getElementById("menu-profile-name"),
            switchProfileBtn: document.getElementById("switch-profile-btn"),
            menuGamesPlayed: document.getElementById("menu-games-played"),
            menuTotalWords: document.getElementById("menu-total-words"),
            playScreen:     document.getElementById("play-screen"),
            canvasWrapper:  document.getElementById("canvas-wrapper"),
            gameoverScreen: document.getElementById("gameover-screen"),
            musicScreen:    document.getElementById("music-screen"),
            pauseOverlay:   document.getElementById("pause-overlay"),
            timeSelectModal: document.getElementById("time-select-modal"),
            timeSelectCancelBtn: document.getElementById("time-select-cancel-btn"),
            perkSelectModal: document.getElementById("perk-select-modal"),
            perkSelectGrid: document.getElementById("perk-select-grid"),
            perkSelectSkipBtn: document.getElementById("perk-select-skip-btn"),
            confirmNewGameModal: document.getElementById("confirm-new-game-modal"),
            confirmNewGameBtn: document.getElementById("confirm-new-game-btn"),
            confirmNewGameCancelBtn: document.getElementById("confirm-new-game-cancel-btn"),
            confirmNewGameText: document.getElementById("confirm-new-game-text"),
            gameTimer: document.getElementById("game-timer"),
            timerScoreItem: document.getElementById("timer-score-item"),
            letterChoiceModal: document.getElementById("letter-choice-modal"),
            letterChoiceTitle: document.getElementById("letter-choice-title"),
            letterChoiceText: document.getElementById("letter-choice-text"),
            letterChoicePreview: document.getElementById("letter-choice-preview"),
            letterChoiceGrid: document.getElementById("letter-choice-grid"),
            letterChoiceCloseBtn: document.getElementById("letter-choice-close-btn"),
            letterChoiceAcceptBtn: document.getElementById("letter-choice-accept-btn"),
            letterChoiceLaterBtn: document.getElementById("letter-choice-later-btn"),
            playlistModal:  document.getElementById("playlist-modal"),
            menuHighScore:  document.getElementById("menu-high-score"),
            playHighScore:  document.getElementById("play-high-score"),
            currentScore:   document.getElementById("current-score"),
            finalScore:     document.getElementById("final-score-text"),
            newHighScore:   document.getElementById("new-high-score-text"),
            bonusBtn:       document.getElementById("bonus-btn"),
            radialMenu:     document.getElementById("radial-menu"),
            radialToggle:   document.getElementById("radial-toggle"),
            radialSlots:    document.getElementById("radial-slots"),
            startBtn:       document.getElementById("start-btn"),
            resumeGameBtn:  document.getElementById("resume-game-btn"),
            restartBtn:     document.getElementById("restart-btn"),
            menuBtn:        document.getElementById("menu-btn"),
            pauseBtn:       document.getElementById("pause-btn"),
            hintsBtn:       document.getElementById("hints-btn"),
            resumeBtn:      document.getElementById("resume-btn"),
            pauseWordsFoundBtn: document.getElementById("pause-words-found-btn"),
            pauseMusicBtn:  document.getElementById("pause-music-btn"),
            pauseShopBtn:   document.getElementById("pause-shop-btn"),
            playCoins:      document.getElementById("play-coins"),
            quitBtn:        document.getElementById("save-quit-btn"),
            endGameBtn:     document.getElementById("end-game-btn"),
            globalMuteBtn:  document.getElementById("global-mute-btn"),
            globalMusicDropdown: document.getElementById("global-music-dropdown"),
            globalMusicPanel: document.getElementById("global-music-panel"),
            gmpTrackName:   document.getElementById("gmp-track-name"),
            gmpPrev:        document.getElementById("gmp-prev"),
            gmpToggle:      document.getElementById("gmp-toggle"),
            gmpNext:        document.getElementById("gmp-next"),
            gmpMute:        document.getElementById("gmp-mute"),
            gmpVolume:      document.getElementById("gmp-volume"),
            gmpProgressBar: document.getElementById("gmp-progress-bar"),
            gmpProgressFill: document.getElementById("gmp-progress-fill"),
            gmpProgressThumb: document.getElementById("gmp-progress-thumb"),
            gmpCurrentTime: document.getElementById("gmp-current-time"),
            gmpDuration:    document.getElementById("gmp-duration"),
            nextLetter:     document.getElementById("next-letter"),
            playWordsFoundBtn: document.getElementById("play-words-found-btn"),
            btnLeft:        document.getElementById("btn-left"),
            btnRight:       document.getElementById("btn-right"),
            btnDrop:        document.getElementById("btn-drop"),
            // Music
            musicMenuBtn:   document.getElementById("music-menu-btn"),
            musicBackBtn:   document.getElementById("music-back-btn"),
            npTitle:        document.getElementById("np-title"),
            npArtist:       document.getElementById("np-artist"),
            npPrev:         document.getElementById("np-prev"),
            npPlay:         document.getElementById("np-play"),
            npNext:         document.getElementById("np-next"),
            npShuffle:      document.getElementById("np-shuffle"),
            npRepeat:       document.getElementById("np-repeat"),
            npProgressBar:  document.getElementById("np-progress-bar"),
            npProgressFill: document.getElementById("np-progress-fill"),
            npProgressThumb: document.getElementById("np-progress-thumb"),
            npCurrentTime:  document.getElementById("np-current-time"),
            npDuration:     document.getElementById("np-duration"),
            npVolumeIcon:   document.getElementById("np-volume-icon"),
            npVolumeSlider: document.getElementById("np-volume-slider"),
            npTimerBtn:     document.getElementById("np-timer-btn"),
            npTimerDisplay: document.getElementById("np-timer-display"),
            musicSearch:    document.getElementById("music-search"),
            sleepTimerModal: document.getElementById("sleep-timer-modal"),
            sleepTimerClear: document.getElementById("sleep-timer-clear"),
            sleepTimerClose: document.getElementById("sleep-timer-close"),
            playlistTabs:   document.getElementById("playlist-tabs"),
            newPlaylistTab: document.getElementById("new-playlist-tab"),
            trackList:      document.getElementById("track-list"),
            playlistActions: document.getElementById("playlist-actions"),
            editSongsBtn:      document.getElementById("edit-songs-btn"),
            renamePlaylistBtn: document.getElementById("rename-playlist-btn"),
            deletePlaylistBtn: document.getElementById("delete-playlist-btn"),
            playlistModalTitle: document.getElementById("playlist-modal-title"),
            playlistNameInput: document.getElementById("playlist-name-input"),
            playlistTrackPicker: document.getElementById("playlist-track-picker"),
            playlistSaveBtn: document.getElementById("playlist-save-btn"),
            playlistCancelBtn: document.getElementById("playlist-cancel-btn"),

            // Words Found
            wordsFoundScreen: document.getElementById("words-found-screen"),
            wordsFoundBtn:    document.getElementById("words-found-btn"),
            wordsFoundBackBtn: document.getElementById("words-found-back-btn"),
            wordsFoundTitle:  document.getElementById("words-found-title"),
            wordsFoundCount:  document.getElementById("words-found-count"),
            wordsFoundList:   document.getElementById("words-found-list"),
            wfDots:           document.getElementById("wf-dots"),
            wfSlideView:      document.getElementById("wf-slide-view"),
            wfSlideStrip:     document.getElementById("wf-slide-strip"),
            menuDots:         document.getElementById("menu-dots"),
            menuSlideView:    document.getElementById("menu-slide-view"),
            menuSlideStrip:   document.getElementById("menu-slide-strip"),
            menuPrevBtn:      document.getElementById("menu-prev-btn"),
            menuNextBtn:      document.getElementById("menu-next-btn"),
            milestonesGrid:   document.getElementById("milestones-grid"),
            milestonesFilterRow: document.getElementById("milestones-filter-row"),
            milestonesProgressFill: document.getElementById("milestones-progress-fill"),
            milestonesProgressText: document.getElementById("milestones-progress-text"),
            wotdToggle: document.getElementById("wotd-toggle"),
            bonusWordsCount:  document.getElementById("bonus-words-count"),
            bonusWordsList:   document.getElementById("bonus-words-list"),
            gameModeSelector: document.getElementById("game-mode-selector"),
            difficultySelector: document.getElementById("difficulty-selector"),
            wordPopup: document.getElementById("word-popup"),
            // Tutorial
            tutorialBtnProfiles: document.getElementById("tutorial-btn-profiles"),
            tutorialBtnMenu: document.getElementById("tutorial-btn-menu"),
            tutorialOverlay: document.getElementById("tutorial-overlay"),
            tutorialMenu: document.getElementById("tutorial-menu"),
            tutorialMenuList: document.getElementById("tutorial-menu-list"),
            tutorialCloseBtn: document.getElementById("tutorial-close-btn"),
            tutorialSlides: document.getElementById("tutorial-slides"),
            tutorialBackBtn: document.getElementById("tutorial-back-btn"),
            tutorialSlidesCloseBtn: document.getElementById("tutorial-slides-close-btn"),
            tutorialSlideView: document.getElementById("tutorial-slide-view"),
            tutorialSlideStrip: document.getElementById("tutorial-slide-strip"),
            tutorialDots: document.getElementById("tutorial-dots"),
            tutorialCounter: document.getElementById("tutorial-counter"),
            tutorialPrevBtn: document.getElementById("tutorial-prev-btn"),
            tutorialNextBtn: document.getElementById("tutorial-next-btn"),
            guidedTourOverlay: document.getElementById("guided-tour-overlay"),
            guidedTourDim: document.getElementById("guided-tour-dim"),
            guidedTourFocus: document.getElementById("guided-tour-focus"),
            guidedTourArrow: document.getElementById("guided-tour-arrow"),
            guidedTourPointer: document.getElementById("guided-tour-pointer"),
            guidedTourHotspot: document.getElementById("guided-tour-hotspot"),
            guidedTourCard: document.getElementById("guided-tour-card"),
            guidedTourCounter: document.getElementById("guided-tour-counter"),
            guidedTourTitle: document.getElementById("guided-tour-title"),
            guidedTourBody: document.getElementById("guided-tour-body"),
            guidedTourHint: document.getElementById("guided-tour-hint"),
            guidedTourContinueBtn: document.getElementById("guided-tour-continue-btn"),
            guidedTourBackBtn: document.getElementById("guided-tour-back-btn"),
            guidedTourExitBtn: document.getElementById("guided-tour-exit-btn"),
            // Challenges
            challengesBtn: document.getElementById("challenges-btn"),
            challengesScreen: document.getElementById("challenges-screen"),
            challengesBackBtn: document.getElementById("challenges-back-btn"),
            challengesGrid: document.getElementById("challenges-grid"),
            challengeSetupScreen: document.getElementById("challenge-setup-screen"),
            challengeSetupName: document.getElementById("challenge-setup-name"),
            challengeCategorySelector: document.getElementById("challenge-category-selector"),
            challengeCategoryButtons: document.getElementById("challenge-category-buttons"),
            challengeStartBtn: document.getElementById("challenge-start-btn"),
            challengeResumeBtn: document.getElementById("challenge-resume-btn"),
            challengeBackToSelectBtn: document.getElementById("challenge-back-to-select-btn"),
            challengeSetupMusicBtn: document.getElementById("challenge-setup-music-btn"),
            challengesMusicBtn: document.getElementById("challenges-music-btn"),
            challengeMainMenuBtn: document.getElementById("challenge-main-menu-btn"),
            challengeTutorialBtn: document.getElementById("challenge-tutorial-btn"),
            challengeTutorialOverlay: document.getElementById("challenge-tutorial-overlay"),
            challengeTutorialTitle: document.getElementById("challenge-tutorial-title"),
            challengeTutorialText: document.getElementById("challenge-tutorial-text"),
            challengeTutorialCanvas: document.getElementById("challenge-tutorial-canvas"),
            challengeTutorialCloseBtn: document.getElementById("challenge-tutorial-close-btn"),
            targetWordDisplay: document.getElementById("target-word-display"),
            targetWordText: document.getElementById("target-word-text"),
            freezeIndicator: document.getElementById("freeze-indicator"),
            freezeTimer: document.getElementById("freeze-timer"),
            score2xIndicator: document.getElementById("score-2x-indicator"),
            rowDragIndicator: document.getElementById("row-drag-indicator"),
            lineClearBtn: document.getElementById("line-clear-btn"),
            lineCancelBtn: document.getElementById("line-cancel-btn"),
            bgCanvas: document.getElementById("bg-canvas"),
            // Level / XP
            levelBar: document.getElementById("level-bar"),
            levelText: document.getElementById("level-text"),
            xpBarFill: document.getElementById("xp-bar-fill"),
            xpText: document.getElementById("xp-text"),
            menuLevelNum: document.getElementById("menu-level-num"),
            menuXpBarFill: document.getElementById("menu-xp-bar-fill"),
            menuXpText: document.getElementById("menu-xp-text"),
            xpEarnedDisplay: document.getElementById("xp-earned-display"),
            xpEarnedText: document.getElementById("xp-earned-text"),
            coinsEarnedText: document.getElementById("coins-earned-text"),
            gameoverLevelText: document.getElementById("gameover-level-text"),
            gameoverXpBarFill: document.getElementById("gameover-xp-bar-fill"),
            levelUpOverlay: document.getElementById("level-up-overlay"),
            levelUpLevel: document.getElementById("level-up-level"),
            levelUpBarFill: document.getElementById("level-up-bar-fill"),
            levelUpOkBtn: document.getElementById("level-up-ok-btn"),
            xpTutorialOverlay: document.getElementById("xp-tutorial-overlay"),
            xpTutorialCanvas: document.getElementById("xp-tutorial-canvas"),
            xpTutorialOkBtn: document.getElementById("xp-tutorial-ok-btn"),
            chainBanner: document.getElementById("chain-banner"),
            // Shop
            shopBtn: document.getElementById("shop-btn"),
            shopScreen: document.getElementById("shop-screen"),
            shopBackBtn: document.getElementById("shop-back-btn"),
            shopCoins: document.getElementById("shop-coins"),
            shopContent: document.getElementById("shop-content"),
            shopTabs: document.querySelectorAll(".shop-tab"),
            menuCoins: document.getElementById("menu-coins"),
            // Auth
            authScreen: document.getElementById("auth-screen"),
            authSubtitle: document.getElementById("auth-subtitle"),
            authError: document.getElementById("auth-error"),
            authSignin: document.getElementById("auth-signin"),
            authSignup: document.getElementById("auth-signup"),
            authEmail: document.getElementById("auth-email"),
            authPassword: document.getElementById("auth-password"),
            authSigninBtn: document.getElementById("auth-signin-btn"),
            authGotoSignup: document.getElementById("auth-goto-signup"),
            authGotoSignin: document.getElementById("auth-goto-signin"),
            authForgotBtn: document.getElementById("auth-forgot-btn"),
            authResetPassword: document.getElementById("auth-reset-password"),
            resetNewPassword: document.getElementById("reset-new-password"),
            resetConfirmPassword: document.getElementById("reset-confirm-password"),
            resetPasswordBtn: document.getElementById("reset-password-btn"),
            authLogoutBtn: document.getElementById("auth-logout-btn"),
            deleteAccountBtn: document.getElementById("delete-account-btn"),
            signupEmail: document.getElementById("signup-email"),
            signupSendCodeBtn: document.getElementById("signup-send-code-btn"),
            signupStepEmail: document.getElementById("signup-step-email"),
            signupStepVerify: document.getElementById("signup-step-verify"),
            signupEmailDisplay: document.getElementById("signup-email-display"),
            signupCodeInputs: document.getElementById("signup-code-inputs"),
            signupCodeTimer: document.getElementById("signup-code-timer"),
            signupVerifyCodeBtn: document.getElementById("signup-verify-code-btn"),
            signupResendBtn: document.getElementById("signup-resend-btn"),
            signupStepPassword: document.getElementById("signup-step-password"),
            signupPassword: document.getElementById("signup-password"),
            signupPasswordConfirm: document.getElementById("signup-password-confirm"),
            signupCreateBtn: document.getElementById("signup-create-btn"),
            // Leaderboard
            leaderboardScreen: document.getElementById("leaderboard-screen"),
            leaderboardBtn: document.getElementById("leaderboard-btn"),
            lbBackBtn: document.getElementById("lb-back-btn"),
            lbRefreshBtn: document.getElementById("lb-refresh-btn"),
            lbTitle: document.getElementById("lb-title"),
            lbTabs: document.querySelectorAll(".lb-tab"),
            lbClassBtns: document.querySelectorAll(".lb-class-btn"),
            lbMyRank: document.getElementById("lb-my-rank"),
            lbMyRankIcon: document.getElementById("lb-my-rank-icon"),
            lbMyRankClass: document.getElementById("lb-my-rank-class"),
            lbMyRankPos: document.getElementById("lb-my-rank-pos"),
            lbMyStats: document.getElementById("lb-my-stats"),
            lbMyStatsToggle: document.getElementById("lb-my-stats-toggle"),
            lbsRating: document.getElementById("lbs-rating"),
            lbsHighScore: document.getElementById("lbs-high-score"),
            lbsGames: document.getElementById("lbs-games"),
            lbsWords: document.getElementById("lbs-words"),
            lbsLevel: document.getElementById("lbs-level"),
            lbsStreak: document.getElementById("lbs-streak"),
            lbsComponents: document.getElementById("lbs-components"),
            lbsAnalysis: document.getElementById("lbs-analysis"),
            lbList: document.getElementById("lb-list"),
            lbLoadMore: document.getElementById("lb-load-more"),
            lbLoadMoreBtn: document.getElementById("lb-load-more-btn"),
            myRankCard: document.getElementById("my-rank-card"),
            myRankIcon: document.getElementById("my-rank-icon"),
            myRankClassLabel: document.getElementById("my-rank-class-label"),
            myRankPosition: document.getElementById("my-rank-position"),
            myRankRating: document.getElementById("my-rank-rating"),
            myRankStats: document.getElementById("my-rank-stats"),
            myRankToggle: document.getElementById("my-rank-toggle"),
            mrsRating: document.getElementById("mrs-rating"),
            mrsHighScore: document.getElementById("mrs-high-score"),
            mrsGames: document.getElementById("mrs-games"),
            mrsWords: document.getElementById("mrs-words"),
            mrsLevel: document.getElementById("mrs-level"),
            mrsStreak: document.getElementById("mrs-streak"),
            mrsComponents: document.getElementById("mrs-components"),
            mrsAnalysis: document.getElementById("mrs-analysis"),
            challengeLbBtns: document.querySelectorAll(".challenge-lb-btn"),
            // Word Search
            wsScreen: document.getElementById("ws-screen"),
            wsCanvas: document.getElementById("ws-canvas"),
            wsGridContainer: document.getElementById("ws-grid-container"),
            wsScore: document.getElementById("ws-score"),
            wsTimer: document.getElementById("ws-timer"),
            wsLevelNum: document.getElementById("ws-level-num"),
            wsCoins: document.getElementById("ws-coins"),
            wsWordsFoundCount: document.getElementById("ws-words-found-count"),
            wsWordPopup: document.getElementById("ws-word-popup"),
            wsPauseBtn: document.getElementById("ws-pause-btn"),
            wsPauseOverlay: document.getElementById("ws-pause-overlay"),
            wsResumeBtn: document.getElementById("ws-resume-btn"),
            wsMusicBtn: document.getElementById("ws-music-btn"),
            wsQuitBtn: document.getElementById("ws-save-quit-btn"),
            wsEndGameBtn: document.getElementById("ws-end-game-btn"),
            wsLevelText: document.getElementById("ws-level-text"),
            wsXpBarFill: document.getElementById("ws-xp-bar-fill"),
            wsXpText: document.getElementById("ws-xp-text"),

            // Word Runner
            wrScreen: document.getElementById("wr-screen"),
            wrCanvas: document.getElementById("wr-canvas"),
            wrCanvasContainer: document.getElementById("wr-canvas-container"),
            wrScore: document.getElementById("wr-score"),
            wrDistance: document.getElementById("wr-distance"),
            wrCoins: document.getElementById("wr-coins"),
            wrWordBoxes: document.getElementById("wr-word-boxes"),
            wrPauseBtn: document.getElementById("wr-pause-btn"),
            wrValidateBtn: document.getElementById("wr-validate-btn"),
            wrPauseOverlay: document.getElementById("wr-pause-overlay"),
            wrResumeBtn: document.getElementById("wr-resume-btn"),
            wrWordsFoundBtn: document.getElementById("wr-words-found-btn"),
            wrMusicBtn: document.getElementById("wr-music-btn"),
            wrShopBtn: document.getElementById("wr-shop-btn"),
            wrEndGameBtn: document.getElementById("wr-end-game-btn"),
            wrSaveQuitBtn: document.getElementById("wr-save-quit-btn"),
            wrLevelText: document.getElementById("wr-level-text"),
            wrXpBarFill: document.getElementById("wr-xp-bar-fill"),
            wrXpText: document.getElementById("wr-xp-text"),

            // Dictionary
            dictScreen: document.getElementById("dict-screen"),
            dictBackBtn: document.getElementById("dict-back-btn"),
            dictSearch: document.getElementById("dict-search"),
            dictSearchClear: document.getElementById("dict-search-clear"),
            dictResultCount: document.getElementById("dict-result-count"),
            dictFilterRow: document.getElementById("dict-filter-row"),
            dictAlphaBar: document.getElementById("dict-alpha-bar"),
            dictListWrap: document.getElementById("dict-list-wrap"),
            dictList: document.getElementById("dict-list"),
            dictTabSearch: document.getElementById("dict-tab-search"),
            dictTabSearchClear: document.getElementById("dict-tab-search-clear"),
            dictTabResultCount: document.getElementById("dict-tab-result-count"),
            dictTabFilterRow: document.getElementById("dict-tab-filter-row"),
            dictTabAlphaBar: document.getElementById("dict-tab-alpha-bar"),
            dictTabListWrap: document.getElementById("dict-tab-list-wrap"),
            dictTabList: document.getElementById("dict-tab-list"),
            dictBtnMenu: document.getElementById("dict-btn-menu"),
            dictBtnGameover: document.getElementById("dict-btn-gameover"),
            dictBtnChallenges: document.getElementById("dict-btn-challenges"),
            dictBtnChallengeSetup: document.getElementById("dict-btn-challengesetup"),
            dictBtnShop: document.getElementById("dict-btn-shop"),
            dictBtnRankings: document.getElementById("dict-btn-rankings"),
            dictBtnChallengesTab: document.getElementById("dict-btn-challenges-tab"),
            connectMainMenuBtn: document.getElementById("connect-main-menu-btn"),
            rankingsMainMenuBtn: document.getElementById("rankings-main-menu-btn"),
            pauseDictBtn: document.getElementById("pause-dict-btn"),
            wsDictBtn: document.getElementById("ws-dict-btn"),
            wrDictBtn: document.getElementById("wr-dict-btn"),
            pauseHowToPlayBtn: document.getElementById("pause-howtoplay-btn"),
            wsHowToPlayBtn: document.getElementById("ws-howtoplay-btn"),
            wrHowToPlayBtn: document.getElementById("wr-howtoplay-btn"),
        };

        this.state = State.MENU;
        this.gridSize = 5;
        this.difficulty = "casual";
        this.gameMode = GAME_MODES.SANDBOX;
        this.pendingStartMode = null;
        this.timeLimitSeconds = 0;
        this.timeRemainingSeconds = 0;
        this.highScore = 0;
        this.score = 0;
        this.grid = null;
        this.block = null;
        this.nextLetter = randomLetter();
        this.fallInterval = 0.5; // seconds per row
        this.fallTimer = 0;
        this.spawnFreezeTimer = 0; // 2s pause at top before falling
        this.lastTime = 0;
        this._autoSaveTimer = 0;

        // Clearing / chain state
        this.clearing = false;
        this.clearPhase = ""; // "flash", "gravity", "check"
        this.clearTimer = 0;
        this.totalWordsInChain = 0;
        this.totalLettersInChain = 0;
        this._chainWords = [];
        this._wordPopupActive = false;
        this.clearFlashDuration = STANDARD_CLEAR_FLASH_DURATION;
        this.pendingClearMode = "";
        this.pendingGravityMoves = [];
        this.foundWordsThisGame = new Set();
        this.availableBonusType = null;
        this.bonusBag = [];
        this.lastAwardedBonusType = null;
        this.nextBonusScore = BONUS_UNLOCK_SCORE_INTERVAL;
        this._bonusHistory = [];
        this._fullBonusHistory = [];
        this._bonusUsageCounts = {};
        this.letterChoiceActive = false;
        this.letterChoiceResumeState = null;
        this.wordsFoundBackTarget = "gameover";
        this.wordsFoundResumeState = null;
        this.swipeState = null;

        // ── Combo / Streak state (Preact-driven) ──
        this.comboCount = 0;
        this.bestCombo = 0;
        this.comboTimer = 0;            // seconds remaining in combo window
        this._totalWordsThisGame = 0;   // for difficulty progression

        // ── Difficulty progression ──
        this._difficultyLevel = 1;
        this._baseFallInterval = 1.5;   // set at game start, modified by difficulty

        // New bonus state
        this.freezeActive = false;
        this.freezeTimeRemaining = 0;
        this.scoreMultiplier = 1;

        // Line clear state (was row drag)
        this.rowDragActive = false;
        this._lineClearStart = null;   // {row, col} or null
        this._lineClearEnd = null;     // {row, col} or null

        // Challenge state
        this.activeChallenge = null; // null or CHALLENGE_TYPES value
        this._gameOverChallenge = null;
        this._gameOverCategoryKey = null;
        this.challengeGridSize = 7;
        this.targetWord = null;
        this.targetWordsCompleted = 0;
        this.speedRoundBaseInterval = 0.9;
        this._challengePreviewAnimations = [];

        // Target Word challenge: tap-to-claim state
        this._validatedWordGroups = []; // [{word, cells: Set of "r,c", pts}]
        this._claimAnimating = false;

        // ── Word Search state ──
        this._ws = null; // Active word search game object

        // ── Word Runner state ──
        this._wr = null; // Active word runner game object

        // ── Enhanced Systems (Chance.js, Difficulty Engine, Loot Tables) ──
        this._dynamicDifficulty = new DynamicDifficulty(30);
        this._bonusLootTable = createBonusLootTable();
        this._terrainLootTable = createTerrainLootTable();
        this._screenShake = null; // Initialized when play screen is shown
        this._gameSessionId = null; // Per-game Chance.js engine ID

        document.body.classList.toggle("touch-input", this.usesTouchSwipeInput);

        this._bindUI();
        // Buttons that should fade when the falling block overlaps them
        this._overlayBtns = [
            this.els.pauseBtn,
            this.els.hintsBtn,
            this.els.radialMenu,
        ].filter(Boolean);
        this._bindInput();
        this._bindMusic();
        this._bindGuidedTours();
        this._bindProfiles();
        this._bindLetterChoice();
        this._bindCanvasTap();
        this._bindRowDrag();
        this._bindLevelUpUI();
        this._bindAuth();
        this._bindLeaderboard();
        this._bindWordSearch();
        this._bindWordRunner();
        this._initMutePref();
        this._menuPage = 3;
        this._activeScreen = "menu";
        this._guidedTour = {
            active: false,
            tour: null,
            stepIndex: 0,
            activeTargetEl: null,
            cleanupTargetHandler: null,
            cleanupHotspotHandler: null,
            restoreTutorialOverlay: false,
            restoreTutorialMenuView: 'root',
            restoreScreen: 'menu',
            restoreMenuPage: 2,
            resizeHandler: null,
        };
        this._bindMenuSwipe();
        this._goToMenuPage(3);
        this.hintsEnabled = localStorage.getItem("wf_hints_enabled") === "1";
        this._updateHintsBtn();

        // Always start on profiles screen on fresh page load;
        // music starts once a profile is selected.
        // Only clear paused flag if user wasn't explicitly paused (F5)
        if (localStorage.getItem("wf_music_paused") !== "1") {
            localStorage.setItem("wf_music_paused", "0");
        }
        this._loadActiveProfile();
        this._initStartScreen();
        this._highlightSizeButton();
        this._highlightDifficultyButton();
        this._updateDifficultySelector();

        // Music UI callbacks
        this.music.onStateChange = () => this._updateMusicUI();
        this.music.onTimeUpdate = (cur, dur) => this._updateMusicProgress(cur, dur);

        // Audio resume on visibility change is handled by the global listener at bottom of file

        // Music starts when the player presses Start (see _startGame)

        // Background floating letters animation
        this.bgAnim = new BackgroundAnimation(this.els.bgCanvas);
        this.bgAnim.start();

        // ── Matter.js physics world (particles & debris) ──
        try {
            initPhysicsWorld(this.canvas);
        } catch (e) {
            console.warn('[Game] Matter.js init skipped:', e.message);
        }

        // ── PixiJS overlay (WebGL-accelerated particles) ──
        const gameContainer = this.canvas.parentElement;
        if (gameContainer) {
            initPixiOverlay(gameContainer, this.canvas.width, this.canvas.height).catch(e => {
                console.warn('[Game] PixiJS overlay init skipped:', e.message);
            });
        }

        // ── Spine renderers: preload best available ──
        loadSpineCanvas().catch(() => {});
        loadSpineWebgl().catch(() => {});

        // Confetti state (handled by bgAnim)

        // Wrap title letters for wave animation
        this._wrapTitleLetters();

        // GSAP: apply micro-interaction juice to all game buttons
        juiceAllButtons('.size-btn, .diff-btn, .game-mode-btn, .control-btn, #bonus-btn, #start-game-btn, #resume-game-btn, #back-to-menu, .challenge-card, .nav-btn');

        // Start RAF loop
        requestAnimationFrame((t) => this._loop(t));
    }

    // ── UI binding ──
    _bindUI() {
        // Grid size buttons
        document.querySelectorAll(".size-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const size = parseInt(btn.dataset.size, 10);
                const unlocked = this.profileMgr.isGridUnlocked(size);
                if (!unlocked) {
                    const req = GRID_UNLOCK_REQUIREMENTS[size];
                    if (!req) return;
                    const lvl = this.profileMgr.getLevelInfo();
                    if (lvl.level < req.level) {
                        this._showShopToast(`Reach Level ${req.level} to unlock ${req.label}`);
                        return;
                    }
                    if (req.coins > 0) {
                        if (confirm(`Unlock ${req.label} for ${req.coins} coins?`)) {
                            const result = this.profileMgr.purchaseGridUnlock(size);
                            if (result.success) {
                                this._showShopToast(`${req.label} unlocked!`);
                                this.gridSize = size;
                                this.profileMgr.setGridSize(this.gridSize);
                                this._syncProfileToCloud();
                                this._highlightSizeButton();
                                this._updateDifficultySelector();
                            } else if (result.reason === "insufficient_coins") {
                                this._showShopToast("Not enough coins!");
                            }
                        }
                        return;
                    }
                }
                if (btn.disabled) return;
                this.gridSize = size;
                this.profileMgr.setGridSize(this.gridSize);
                this._debouncedSyncProfileToCloud();
                this._highlightSizeButton();
                this._updateDifficultySelector();
            });
        });

        document.querySelectorAll(".difficulty-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                this.difficulty = btn.dataset.difficulty || "casual";
                this.profileMgr.setDifficulty(this.difficulty);
                // If switching to Hard and grid is too small, bump to 6
                if (this.difficulty === "hard" && this.gridSize < 6) {
                    this.gridSize = 6;
                    this.profileMgr.setGridSize(this.gridSize);
                }
                this._debouncedSyncProfileToCloud();
                this._highlightDifficultyButton();
                this._highlightSizeButton();
            });
        });

        document.querySelectorAll(".game-mode-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                this.gameMode = btn.dataset.mode || GAME_MODES.SANDBOX;
                this.profileMgr.setGameMode(this.gameMode);
                this._debouncedSyncProfileToCloud();
                this._highlightGameModeButton();
            });
        });

        this.els.startBtn.addEventListener("click", () => this._startGame());
        this.els.resumeGameBtn.addEventListener("click", () => this._resumeGame());
        this.els.restartBtn.addEventListener("click", () => {
            // Use instance variable first, fall back to data attribute on button
            const challenge = this._gameOverChallenge || this.els.restartBtn.dataset.challenge || null;
            const categoryKey = this._gameOverCategoryKey ?? (this.els.restartBtn.dataset.categoryKey || null);
            if (challenge) {
                this.activeChallenge = challenge;
                if (challenge === CHALLENGE_TYPES.WORD_CATEGORY) {
                    this._selectedCategoryKey = categoryKey;
                }
                this._gameOverChallenge = null;
                this._gameOverCategoryKey = null;
                delete this.els.restartBtn.dataset.challenge;
                delete this.els.restartBtn.dataset.categoryKey;
                this._startChallengeGame();
            } else {
                this._startGame();
            }
        });
        this.els.menuBtn.addEventListener("click", () => {
            const challenge = this._gameOverChallenge || this.els.restartBtn.dataset.challenge || null;
            if (challenge) {
                this._gameOverChallenge = null;
                this._gameOverCategoryKey = null;
                delete this.els.restartBtn.dataset.challenge;
                delete this.els.restartBtn.dataset.categoryKey;
                this._openChallengeSetup(challenge);
            } else {
                this._showScreen("menu");
            }
        });
        this.els.pauseBtn.addEventListener("click", () => this._togglePause());
        this.els.hintsBtn.addEventListener("click", () => {
            this.hintsEnabled = !this.hintsEnabled;
            localStorage.setItem("wf_hints_enabled", this.hintsEnabled ? "1" : "0");
            this._updateHintsBtn();
            this._computeHintCells();
        });
        this.els.resumeBtn.addEventListener("click", () => this._togglePause());
        this.els.pauseWordsFoundBtn.addEventListener("click", () => {
            this.els.pauseOverlay.classList.remove("active");
            this._openWordsFound("pause");
        });
        this.els.pauseMusicBtn.addEventListener("click", () => {
            this.els.pauseOverlay.classList.remove("active");
            this._musicBackTarget = "pause";
            this._showScreen("music");
            this._renderMusicScreen();
        });
        this.els.pauseShopBtn.addEventListener("click", () => {
            this.els.pauseOverlay.classList.remove("active");
            this._shopBackTarget = "pause";
            this._shopCurrentTab = "grid_themes";
            this._showScreen("shop");
        });
        this.els.quitBtn.addEventListener("click", () => {
            // Save BEFORE changing state (guard rejects State.MENU)
            this._saveGameState();
            this.els.pauseOverlay.classList.remove("active");
            const wasChallenge = this.activeChallenge;
            this.state = State.MENU;
            if (wasChallenge) {
                this._openChallengeSetup(wasChallenge);
            } else {
                this._showScreen("menu");
            }
        });
        this.els.endGameBtn.addEventListener("click", () => {
            this.els.pauseOverlay.classList.remove("active");
            this._gameOver("endgame");
        });

        // Switch Profile
        this.els.switchProfileBtn.addEventListener("click", () => {
            this._renderProfilesList();
            this._showScreen("profiles");
        });

        // Shop
        this.els.shopBtn.addEventListener("click", () => {
            this._shopCurrentTab = "grid_themes";
            this._showScreen("shop");
        });
        this.els.shopBackBtn.addEventListener("click", () => {
            if (this._shopBackTarget === "pause") {
                this._shopBackTarget = null;
                this._showScreen("play");
                this.els.pauseOverlay.classList.add("active");
            } else if (this._shopBackTarget === "wr-pause") {
                this._shopBackTarget = null;
                this._wrResumePause();
            } else {
                this._showScreen("menu");
            }
        });
        this.els.shopTabs.forEach(tab => {
            tab.addEventListener("click", () => {
                this._shopCurrentTab = tab.dataset.tab;
                this.els.shopTabs.forEach(t => t.classList.toggle("active", t === tab));
                this._renderShopTab(this._shopCurrentTab);
            });
        });
        this._bindShopSwipe();

        // Challenges
        this.els.challengeStartBtn.addEventListener("click", () => this._startChallengeGame());
        this.els.challengeResumeBtn.addEventListener("click", () => this._resumeChallengeGame());
        this.els.challengeBackToSelectBtn.addEventListener("click", () => {
            this._stopChallengePreviewAnimations();
            this._showScreen("menu");
            this._goToMenuPage(4);
        });
        this.els.challengeMainMenuBtn.addEventListener("click", () => {
            this._showScreen("menu");
            this._goToMenuPage(3);
        });        this.els.challengeSetupMusicBtn.addEventListener("click", () => {
            this._musicBackTarget = "challenge-setup";
            this._showScreen("music");
            this._renderMusicScreen();
        });
        this.els.challengeTutorialBtn.addEventListener("click", () => this._openChallengeTutorial());
        this.els.challengeTutorialCloseBtn.addEventListener("click", () => this._closeChallengeTutorial());

        // Dictionary / Thesaurus
        this._dictBackTarget = "menu";
        this._dictActiveFilter = "all";
        this._dictSearchTerm = "";
        this._dictSortedWords = [];
        this._dictFilteredWords = [];
        this._dictLetterCounts = new Map();
        this._dictLetterFirstIndex = new Map();
        this._dictRenderStartIndex = 0;
        this._dictRenderedCount = 0;
        this._dictChunkSize = 80;
        this._dictJumpRenderInProgress = false;
        this._dictTabActiveFilter = "all";
        this._dictTabSearchTerm = "";
        this._dictTabFilteredWords = [];
        this._dictTabLetterCounts = new Map();
        this._dictTabLetterFirstIndex = new Map();
        this._dictTabRenderStartIndex = 0;
        this._dictTabRenderedCount = 0;
        this._dictTabChunkSize = 80;
        this._dictTabReady = false;

        // Dict FAB buttons (open dictionary from various screens)
        const dictFabs = [
            [this.els.dictBtnMenu, "menu"],
            [this.els.dictBtnGameover, "gameover"],
            [this.els.dictBtnChallenges, "challenges"],
            [this.els.dictBtnChallengeSetup, "challengesetup"],
            [this.els.dictBtnShop, "shop"],
            [this.els.dictBtnRankings, "menu"],
            [this.els.dictBtnChallengesTab, "menu"],
        ];
        for (const [btn, screen] of dictFabs) {
            if (btn) btn.addEventListener("click", () => this._openDict(screen));
        }

        // Dict in pause menus
        if (this.els.pauseDictBtn) {
            this.els.pauseDictBtn.addEventListener("click", () => {
                this.els.pauseOverlay.classList.remove("active");
                this._openDict("pause");
            });
        }
        if (this.els.wsDictBtn) {
            this.els.wsDictBtn.addEventListener("click", () => {
                if (this.els.wsPauseOverlay) this.els.wsPauseOverlay.classList.remove("active");
                this._openDict("ws-pause");
            });
        }
        if (this.els.wrDictBtn) {
            this.els.wrDictBtn.addEventListener("click", () => {
                this.els.wrPauseOverlay.classList.remove("active");
                this._openDict("wr-pause");
            });
        }

        // How To Play in pause menus
        if (this.els.pauseHowToPlayBtn) {
            this.els.pauseHowToPlayBtn.addEventListener("click", () => {
                this.els.pauseOverlay.classList.remove("active");
                this._tutorialReturnToPauseMenu = 'main';
                this._openTutorial();
            });
        }
        if (this.els.wsHowToPlayBtn) {
            this.els.wsHowToPlayBtn.addEventListener("click", () => {
                if (this.els.wsPauseOverlay) this.els.wsPauseOverlay.classList.remove("active");
                this._tutorialReturnToPauseMenu = 'ws';
                this._openTutorial();
            });
        }
        if (this.els.wrHowToPlayBtn) {
            this.els.wrHowToPlayBtn.addEventListener("click", () => {
                this.els.wrPauseOverlay.classList.remove("active");
                this._tutorialReturnToPauseMenu = 'wr';
                this._openTutorial();
            });
        }

        // Dict back button
        if (this.els.dictBackBtn) {
            this.els.dictBackBtn.addEventListener("click", () => this._closeDict());
        }

        // Dict search
        if (this.els.dictSearch) {
            this.els.dictSearch.addEventListener("input", () => this._dictOnSearch());
            this.els.dictSearchClear.addEventListener("click", () => {
                this.els.dictSearch.value = "";
                this._dictOnSearch();
                this.els.dictSearch.focus();
            });
        }

        // Dict filter chips
        if (this.els.dictFilterRow) {
            this.els.dictFilterRow.addEventListener("click", (e) => {
                const chip = e.target.closest(".dict-chip");
                if (!chip) return;
                const filter = chip.dataset.filter;
                if (filter === this._dictActiveFilter) {
                    // Toggle off → reset to "all"
                    if (filter !== "all") {
                        this._dictActiveFilter = "all";
                    }
                } else {
                    this._dictActiveFilter = filter;
                }
                this.els.dictFilterRow.querySelectorAll(".dict-chip").forEach(c =>
                    c.classList.toggle("active", c.dataset.filter === this._dictActiveFilter));
                this._dictApplyFilters();
            });
        }

        // Dict tab search
        if (this.els.dictTabSearch) {
            this.els.dictTabSearch.addEventListener("input", () => this._dictTabOnSearch());
            this.els.dictTabSearchClear?.addEventListener("click", () => {
                this.els.dictTabSearch.value = "";
                this._dictTabOnSearch();
                this.els.dictTabSearch.focus();
            });
        }

        // Dict tab filter chips
        if (this.els.dictTabFilterRow) {
            this.els.dictTabFilterRow.addEventListener("click", (e) => {
                const chip = e.target.closest(".dict-chip");
                if (!chip) return;
                const filter = chip.dataset.filter;
                if (filter === this._dictTabActiveFilter) {
                    if (filter !== "all") this._dictTabActiveFilter = "all";
                } else {
                    this._dictTabActiveFilter = filter;
                }
                this.els.dictTabFilterRow.querySelectorAll(".dict-chip").forEach(c =>
                    c.classList.toggle("active", c.dataset.filter === this._dictTabActiveFilter));
                this._dictTabApplyFilters();
            });
        }

        // Dict alpha bar
        this._dictBuildAlphaBar();
        this._dictTabBuildAlphaBar();

        // Dict lazy-load on scroll
        if (this.els.dictListWrap) {
            this.els.dictListWrap.addEventListener("scroll", () => {
                const el = this.els.dictListWrap;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
                    this._dictRenderNextChunk();
                }
            });
        }

        // Dict tab lazy-load on scroll
        if (this.els.dictTabListWrap) {
            this.els.dictTabListWrap.addEventListener("scroll", () => {
                const el = this.els.dictTabListWrap;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
                    this._dictTabRenderNextChunk();
                }
            });
        }

        // Milestones filter chips
        if (this.els.milestonesFilterRow) {
            this._milestonesActiveFilter = "all";
            this._milestonesSortOrder = "default"; // "default", "recent", "oldest"
            this.els.milestonesFilterRow.addEventListener("click", (e) => {
                const chip = e.target.closest(".ms-chip");
                if (!chip) return;
                const filter = chip.dataset.filter;
                if (filter === this._milestonesActiveFilter) {
                    if (filter !== "all") {
                        this._milestonesActiveFilter = "all";
                    }
                } else {
                    this._milestonesActiveFilter = filter;
                }
                this.els.milestonesFilterRow.querySelectorAll(".ms-chip").forEach(c =>
                    c.classList.toggle("active", c.dataset.filter === this._milestonesActiveFilter));
                this._renderMilestonesPage();
            });
        }

        // Milestones sort buttons
        const sortRow = document.getElementById("milestones-sort-row");
        if (sortRow) {
            sortRow.addEventListener("click", (e) => {
                const btn = e.target.closest(".ms-sort-btn");
                if (!btn) return;
                const sort = btn.dataset.sort;
                this._milestonesSortOrder = sort;
                sortRow.querySelectorAll(".ms-sort-btn").forEach(b =>
                    b.classList.toggle("active", b.dataset.sort === sort));
                this._renderMilestonesPage();
            });
            // Set initial active state
            sortRow.querySelector('[data-sort="default"]')?.classList.add("active");
        }

        // Word of the Day toggle
        if (this.els.wotdToggle) {
            // Set initial state
            import('./src/lib/word-of-day.js').then(({ isWordOfDayEnabled }) => {
                this.els.wotdToggle.checked = isWordOfDayEnabled();
            }).catch(() => {});
            
            this.els.wotdToggle.addEventListener("change", async () => {
                try {
                    const { enableWordOfDay, disableWordOfDay } = await import('./src/lib/word-of-day.js');
                    if (this.els.wotdToggle.checked) {
                        const result = await enableWordOfDay(ENRICHED_DICT);
                        if (!result.success) {
                            this.els.wotdToggle.checked = false;
                            if (result.reason === 'permission_denied') {
                                alert('Please enable notifications in your device settings to receive Word of the Day.');
                            }
                        }
                    } else {
                        await disableWordOfDay();
                    }
                } catch (e) {
                    console.warn('[WOTD] Toggle error:', e);
                    this.els.wotdToggle.checked = false;
                }
            });
        }

        // Main Menu buttons on Connect and Rankings pages
        if (this.els.connectMainMenuBtn) {
            this.els.connectMainMenuBtn.addEventListener("click", () => this._goToMenuPage(3));
        }
        if (this.els.rankingsMainMenuBtn) {
            this.els.rankingsMainMenuBtn.addEventListener("click", () => this._goToMenuPage(3));
        }

        // Challenge grid size buttons
        document.querySelectorAll(".challenge-size-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                this.challengeGridSize = parseInt(btn.dataset.size, 10);
                document.querySelectorAll(".challenge-size-btn").forEach(b => b.classList.toggle("selected", b === btn));
            });
        });

        // Words Found
        this.els.playWordsFoundBtn.addEventListener("click", () => this._openWordsFound("play"));
        this.els.wordsFoundBtn.addEventListener("click", () => {
            this._openWordsFound("gameover");
        });
        this.els.wordsFoundBackBtn.addEventListener("click", () => this._closeWordsFound());

        this.els.bonusBtn.addEventListener("click", () => {
            if (this.rowDragActive) {
                this._cancelRowDragMode();
                return;
            }
            this._openLetterChoiceModal();
        });

        // Radial bonus slot menu
        this._radialOpen = false;
        this.els.radialToggle.addEventListener("click", () => this._toggleRadialMenu());
        this.els.radialSlots.querySelectorAll(".radial-slot").forEach(btn => {
            btn.addEventListener("click", () => {
                const slotIdx = parseInt(btn.dataset.slot, 10);
                this._useRadialSlot(slotIdx);
            });
        });

        // Music menu button
        this.els.musicMenuBtn.addEventListener("click", () => {
            this._showScreen("music");
            this._renderMusicScreen();
        });
        this.els.musicBackBtn.addEventListener("click", () => {
            if (this._musicBackTarget === "pause") {
                this._musicBackTarget = null;
                this._showScreen("play");
                this.els.pauseOverlay.classList.add("active");
            } else if (this._musicBackTarget === "ws-pause") {
                this._musicBackTarget = null;
                this._showScreen("ws");
                if (this.els.wsPauseOverlay) this.els.wsPauseOverlay.classList.add("active");
            } else if (this._musicBackTarget === "wr-pause") {
                this._musicBackTarget = null;
                this._wrResumePause();
            } else if (this._musicBackTarget === "challenges") {
                this._musicBackTarget = null;
                this._showScreen("menu");
                this._goToMenuPage(4);
            } else if (this._musicBackTarget === "challenge-setup") {
                this._musicBackTarget = null;
                this._showScreen("challengesetup");
            } else if (this._musicBackTarget === "shop") {
                this._musicBackTarget = null;
                this._showScreen("shop");
            } else if (this._musicBackTarget === "dict") {
                this._musicBackTarget = null;
                this._showScreen("dict");
            } else if (this._musicBackTarget === "leaderboard") {
                this._musicBackTarget = null;
                this._showScreen("leaderboard");
            } else if (this._musicBackTarget === "wordsfound") {
                this._musicBackTarget = null;
                this._showScreen("wordsfound");
            } else if (this._musicBackTarget === "gameover") {
                this._musicBackTarget = null;
                this._showScreen("gameover");
            } else if (this._musicBackTarget === "profiles") {
                this._musicBackTarget = null;
                this._showScreen("profiles");
            } else {
                this._showScreen("menu");
            }
        });

        // Global music dropdown toggle
        this.els.globalMuteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const dd = this.els.globalMusicDropdown;
            const opening = !dd.classList.contains("open");
            dd.classList.toggle("open");
            if (opening) {
                this._syncGlobalMusicPanel();
                this._pauseForMusicDropdown();
            } else {
                this._resumeFromMusicDropdown();
            }
        });

        // Close dropdown on outside click
        document.addEventListener("click", (e) => {
            const dd = this.els.globalMusicDropdown;
            if (dd.classList.contains("open") && !dd.contains(e.target)) {
                dd.classList.remove("open");
                this._resumeFromMusicDropdown();
            }
        });

        // Dropdown: prev / toggle / next
        this.els.gmpPrev.addEventListener("click", (e) => { e.stopPropagation(); this.music.prev(); });
        this.els.gmpToggle.addEventListener("click", (e) => { e.stopPropagation(); this.music.toggle(); });
        this.els.gmpNext.addEventListener("click", (e) => { e.stopPropagation(); this.music.next(); });

        // Dropdown: mute button
        this.els.gmpMute.addEventListener("click", (e) => {
            e.stopPropagation();
            const nowMuted = !this.musicMuted;
            this._setMuted(nowMuted);
            localStorage.setItem("wf_music_muted", nowMuted ? "1" : "0");
        });

        // Dropdown: volume slider
        this.els.gmpVolume.value = Math.round(this.music.getVolume() * 100);
        this.els.gmpVolume.addEventListener("input", (e) => {
            e.stopPropagation();
            const vol = parseInt(e.target.value, 10) / 100;
            this.music.setVolume(vol);
            this._updateVolumeIcon();
            // Update dropdown mute icon to reflect volume level
            const muteIcon = this.musicMuted ? "volumeMute" : vol < 0.5 ? "volumeLow" : "volumeHigh";
            this._setMusicControlButton(this.els.gmpMute, muteIcon, this.musicMuted ? "Unmute" : "Mute");
            // If they raise volume while muted, auto-unmute
            if (vol > 0 && this.musicMuted) {
                this._setMuted(false);
                localStorage.setItem("wf_music_muted", "0");
            }
        });

        // Dropdown: seekable progress bar
        {
            const bar = this.els.gmpProgressBar;
            const seek = (e) => {
                e.stopPropagation();
                if (!this.music.audio || !this.music.audio.duration) return;
                const rect = bar.getBoundingClientRect();
                const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
                const pct = Math.max(0, Math.min(1, x / rect.width));
                this.music.audio.currentTime = pct * this.music.audio.duration;
            };
            let seeking = false;
            bar.addEventListener("mousedown", (e) => { e.stopPropagation(); seeking = true; seek(e); });
            bar.addEventListener("touchstart", (e) => { e.stopPropagation(); seeking = true; seek(e); }, { passive: false });
            document.addEventListener("mousemove", (e) => { if (seeking) seek(e); });
            document.addEventListener("touchmove", (e) => { if (seeking) seek(e); }, { passive: false });
            document.addEventListener("mouseup", () => { seeking = false; });
            document.addEventListener("touchend", () => { seeking = false; });
        }

        // Track name click → go to full music page
        if (this.els.gmpTrackName) {
            this.els.gmpTrackName.style.cursor = "pointer";
            this.els.gmpTrackName.addEventListener("click", (e) => {
                e.stopPropagation();
                // Close the dropdown
                this.els.globalMusicDropdown.classList.remove("open");
                this._resumeFromMusicDropdown();
                // Set back target based on current screen/state
                this._musicBackTarget = this._getMusicBackTarget();
                // Navigate to music
                this._showScreen("music");
                this._renderMusicScreen();
            });
        }

        // Freeze indicator tap → early unfreeze with time bonus
        this.els.freezeIndicator.style.cursor = "pointer";
        this.els.freezeIndicator.addEventListener("click", () => {
            if (!this.freezeActive) return;
            this._earlyUnfreeze();
        });

        this.els.timeSelectCancelBtn.addEventListener("click", () => this._closeTimeSelectModal());
        document.querySelectorAll(".time-select-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const minutes = parseInt(btn.dataset.minutes, 10);
                if (!Number.isFinite(minutes)) return;
                this._closeTimeSelectModal();
                this._maybeShowPerkSelect(minutes * 60);
            });
        });

        // Perk selection modal
        this.els.perkSelectSkipBtn.addEventListener("click", () => {
            this._chosenPerk = null;
            this._closePerkSelectModal();
            this._beginNewGame(this._pendingTimeLimitSeconds || 0);
        });

        // Confirm new game modal
        this.els.confirmNewGameBtn.addEventListener("click", () => {
            // Must proceed BEFORE closing (close clears the pending values)
            this._proceedWithNewGame();
            this._closeConfirmNewGameModal();
        });
        this.els.confirmNewGameCancelBtn.addEventListener("click", () => {
            this._closeConfirmNewGameModal();
        });
    }

    _openConfirmNewGameModal(gameType, challengeType = null) {
        this._pendingNewGameType = gameType; // "main" or "challenge"
        this._pendingNewGameChallenge = challengeType;
        
        // Set appropriate message based on game type
        let message = "You have a saved game. Starting a new game will erase your progress.";
        if (challengeType) {
            const challengeNames = {
                "target-word": "Target Word",
                "speed-round": "Speed Round",
                "word-category": "Word Category",
                "word-search": "Word Search",
                "word-runner": "Word Runner"
            };
            const name = challengeNames[challengeType] || "this challenge";
            message = `You have a ${name} game in progress. Starting a new game will erase your progress.`;
        }
        this.els.confirmNewGameText.textContent = message;
        this.els.confirmNewGameModal.classList.add("active");
    }

    _closeConfirmNewGameModal() {
        this.els.confirmNewGameModal.classList.remove("active");
        this._pendingNewGameType = null;
        this._pendingNewGameChallenge = null;
    }

    _proceedWithNewGame() {
        const gameType = this._pendingNewGameType;
        const challengeType = this._pendingNewGameChallenge;
        
        if (gameType === "main") {
            // Clear main game save and start
            this._clearSavedGameForType(null);
            this._startGameDirect();
        } else if (gameType === "challenge") {
            // Clear challenge save and start
            this._clearSavedGameForType(challengeType);
            this._startChallengeGameDirect();
        }
    }

    _clearSavedGameForType(challengeType) {
        const key = this._saveKey(challengeType);
        if (key) localStorage.removeItem(key);
    }

    _bindLetterChoice() {
        const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
        this.els.letterChoiceGrid.innerHTML = "";
        this.els.letterChoiceCloseBtn.addEventListener("click", () => this._closeLetterChoiceModal(false));
        this.els.letterChoiceAcceptBtn.addEventListener("click", () => this._acceptActiveBonus());
        this.els.letterChoiceLaterBtn.addEventListener("click", () => this._closeLetterChoiceModal(false));

        for (const letter of letters) {
            const btn = document.createElement("button");
            btn.className = "letter-choice-btn";
            btn.type = "button";
            btn.textContent = letter;
            btn.addEventListener("click", () => this._applyLetterChoice(letter));
            this.els.letterChoiceGrid.appendChild(btn);
        }
    }

    // ── Mute helpers ──
    _initMutePref() {
        const saved = localStorage.getItem("wf_music_muted");
        const muted = saved === "1"; // default is unmuted
        this._setMuted(muted);
    }

    _setMuted(muted) {
        this.musicMuted = muted;
        this.audio.muted = muted;
        this.music.setMuted(muted);
        this._setMusicControlButton(this.els.globalMuteBtn, muted ? "volumeMute" : "volumeHigh", "Music");
        this.els.globalMuteBtn.classList.toggle("muted", muted);
        this._updateVolumeIcon();
        this._syncGlobalMusicPanel();
    }

    // Determine where music back button should return based on current screen/state
    _getMusicBackTarget() {
        const screen = this._activeScreen;
        // If in main game play screen with pause overlay
        if (screen === "play" && this.els.pauseOverlay.classList.contains("active")) {
            return "pause";
        }
        // Word Search with pause overlay
        if (screen === "ws" && this.els.wsPauseOverlay?.classList.contains("active")) {
            return "ws-pause";
        }
        // Word Runner with pause overlay
        if (screen === "wr" && this.els.wrPauseOverlay?.classList.contains("active")) {
            return "wr-pause";
        }
        // Challenge setup screen
        if (screen === "challengesetup") {
            return "challenge-setup";
        }
        // Shop screen
        if (screen === "shop") {
            return "shop";
        }
        // Dictionary screen
        if (screen === "dict") {
            return "dict";
        }
        // Leaderboard screen
        if (screen === "leaderboard") {
            return "leaderboard";
        }
        // Words found screen
        if (screen === "wordsfound") {
            return "wordsfound";
        }
        // Game over screen
        if (screen === "gameover") {
            return "gameover";
        }
        // Profiles screen
        if (screen === "profiles") {
            return "profiles";
        }
        // Default: return to menu
        return "menu";
    }

    _syncGlobalMusicPanel() {
        // Track name
        const track = this.music.getCurrentTrack?.();
        const title = track ? `${track.title} – ${track.artist}` : "---";
        if (this.els.gmpTrackName) this.els.gmpTrackName.textContent = title;
        // Play/pause icon (SVG)
        const isPlaying = this.music.playing ?? false;
        this._setMusicControlButton(this.els.gmpToggle, isPlaying ? "pause" : "play", isPlaying ? "Pause" : "Play");
        // Prev / Next icons (SVG)
        this._setMusicControlButton(this.els.gmpPrev, "prev", "Previous");
        this._setMusicControlButton(this.els.gmpNext, "next", "Next");
        // Mute icon (SVG)
        const vol = this.music.getVolume();
        const muteIcon = this.musicMuted ? "volumeMute" : vol < 0.5 ? "volumeLow" : "volumeHigh";
        this._setMusicControlButton(this.els.gmpMute, muteIcon, this.musicMuted ? "Unmute" : "Mute");
        // Volume slider
        if (this.els.gmpVolume) this.els.gmpVolume.value = Math.round(vol * 100);
        // Progress bar
        this._syncGlobalMusicProgress();
    }

    _syncGlobalMusicProgress() {
        const audio = this.music.audio;
        const cur = audio?.currentTime ?? 0;
        const dur = audio?.duration ?? 0;
        const pct = dur > 0 ? (cur / dur) * 100 : 0;
        if (this.els.gmpProgressFill) this.els.gmpProgressFill.style.width = pct + "%";
        if (this.els.gmpProgressThumb) this.els.gmpProgressThumb.style.left = pct + "%";
        if (this.els.gmpCurrentTime) this.els.gmpCurrentTime.textContent = this._formatTrackTime(cur);
        if (this.els.gmpDuration) this.els.gmpDuration.textContent = this._formatTrackTime(dur);
    }

    /** Pause whichever game is actively running when the music dropdown opens. */
    _pauseForMusicDropdown() {
        this._musicDropdownPausedGame = null;
        // Plummet
        if (this.state === State.PLAYING) {
            this.state = State.PAUSED;
            this._musicDropdownPausedGame = "plummet";
            return;
        }
        // Word Search
        if (this._ws && !this._ws.paused && !this._ws.gameOver && !this._ws.revealing) {
            this._ws.paused = true;
            this._musicDropdownPausedGame = "ws";
            return;
        }
        // Word Runner — silently freeze without showing pause overlay or countdown
        if (this._wrGame) {
            const scene = this._wrGame.getScene?.();
            if (scene && !scene.isPaused && !scene.dead && scene.countdownTimer <= 0) {
                scene.isPaused = true;
                if (scene.runner?._runTl) scene.runner._runTl.pause();
                this._musicDropdownPausedGame = "wr";
                return;
            }
        }
    }

    /** Resume the game that was paused by the music dropdown. */
    _resumeFromMusicDropdown() {
        const which = this._musicDropdownPausedGame;
        this._musicDropdownPausedGame = null;
        if (!which) return;
        if (which === "plummet" && this.state === State.PAUSED) {
            this.state = State.PLAYING;
        } else if (which === "ws" && this._ws && this._ws.paused) {
            this._ws.paused = false;
        } else if (which === "wr" && this._wrGame) {
            const scene = this._wrGame.getScene?.();
            if (scene && scene.isPaused) {
                scene.isPaused = false;
                if (scene.runner?._runTl) scene.runner._runTl.resume();
            }
        }
    }

    // ── Hints ──
    _updateHintsBtn() {
        this.els.hintsBtn.style.opacity = this.hintsEnabled ? "1" : "0.4";
        this.els.hintsBtn.title = this.hintsEnabled ? "Hints ON" : "Hints OFF";
    }

    _detectBoardWords() {
        if (!this.grid || this.clearing) return;
        const minLen = this._getMinWordLength();
        const result = this.grid.findAllWords(minLen);
        if (result.words.length === 0) return;
        this._addValidatedWords(result, result.words);
    }

    // After a non-wildcard block lands, re-check all wildcard cells on the grid.
    // A newly placed letter may complete a word through an existing wildcard.
    _rescanWildcardCells(skipRow, skipCol) {
        if (!this.grid || this.clearing) return;
        const minLen = this._getMinWordLength();
        for (let r = 0; r < this.grid.rows; r++) {
            for (let c = 0; c < this.grid.cols; c++) {
                if (r === skipRow && c === skipCol) continue; // already scanned
                if (this.grid.get(r, c) !== WILDCARD_SYMBOL) continue;
                const result = this.grid.findWordsThrough(r, c, minLen);
                if (result.words.length > 0) {
                    this._addValidatedWords(result, result.words);
                }
            }
        }
    }

    _computeHintCells() {
        // Hints: show cells that are one letter away from forming a word

        if (!this.hintsEnabled || !this.grid) {
            this.renderer.hintCells = new Set();
            this._activeHintKey = null;
            return;
        }
        const { rows, cols } = this.grid;
        const dirs = [[0,1],[1,0],[1,1],[1,-1]];
        // Collect every distinct hint sequence as an array of cell keys
        const allHints = []; // each entry: { key: string, cells: Set }

        for (const [dr, dc] of dirs) {
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    // Only start at the beginning of a run in this direction
                    const pr = r - dr, pc = c - dc;
                    if (pr >= 0 && pr < rows && pc >= 0 && pc < cols && isWordLetter(this.grid.get(pr, pc))) continue;

                    // Build the full consecutive run from this start cell
                    let seq = "";
                    const keys = [];
                    let cr = r, cc = c;
                    while (cr >= 0 && cr < rows && cc >= 0 && cc < cols) {
                        const letter = this.grid.get(cr, cc);
                        if (!isWordLetter(letter)) break;
                        seq += letter;
                        keys.push(`${cr},${cc}`);
                        cr += dr;
                        cc += dc;
                    }
                    if (keys.length < 2) continue;
                    const rKeys = [...keys].reverse();
                    const rSeq = seq.split("").reverse().join("");

                    // For each orientation (forward and reversed), check prefix/suffix hints
                    for (const [hSeq, hKeys, nr, nc] of [
                        // forward: completing letter goes AFTER (at cr,cc)
                        [seq,  keys,  cr, cc],
                        // reverse: completing letter goes AFTER the reversed run (at pr,pc)
                        [rSeq, rKeys, pr, pc],
                    ]) {
                        const afterFree = nr >= 0 && nr < rows && nc >= 0 && nc < cols && !this.grid.get(nr, nc);
                        if (afterFree) {
                            for (let start = 0; start < hKeys.length; start++) {
                                const sub = hSeq.slice(start);
                                if (sub.length >= 3 && HINT_PREFIXES.has(sub)) {
                                    const hintKeys = hKeys.slice(start);
                                    const hintKey = hintKeys.join("|") + ">" + `${nr},${nc}`;
                                    allHints.push({ key: hintKey, cells: new Set(hintKeys) });
                                }
                            }
                        }
                    }

                    // HINT_SUFFIXES: completing letter goes BEFORE the run.
                    for (const [hSeq, hKeys, bfr, bfc] of [
                        // forward: completing letter goes BEFORE (at pr,pc)
                        [seq,  keys,  pr, pc],
                        // reverse: completing letter goes BEFORE reversed run (at cr,cc)
                        [rSeq, rKeys, cr, cc],
                    ]) {
                        const beforeFree = bfr >= 0 && bfr < rows && bfc >= 0 && bfc < cols && !this.grid.get(bfr, bfc);
                        if (beforeFree) {
                            for (let end = 3; end <= hKeys.length; end++) {
                                const sub = hSeq.slice(0, end);
                                if (HINT_SUFFIXES.has(sub)) {
                                    const hintKeys = hKeys.slice(0, end);
                                    const hintKey = `<${bfr},${bfc}` + hintKeys.join("|");
                                    allHints.push({ key: hintKey, cells: new Set(hintKeys) });
                                }
                            }
                        }
                    }
                }
            }
        }

        if (allHints.length === 0) {
            this.renderer.hintCells = new Set();
            this._activeHintKey = null;
            return;
        }

        // If the current active hint is still present, keep showing it
        if (this._activeHintKey) {
            const current = allHints.find(h => h.key === this._activeHintKey);
            if (current) {
                this.renderer.hintCells = current.cells;
                return;
            }
        }

        // Active hint is gone — pick the longest available one
        allHints.sort((a, b) => b.cells.size - a.cells.size);
        this._activeHintKey = allHints[0].key;
        this.renderer.hintCells = allHints[0].cells;
    }

    // ── Music binding ──
    _bindMusic() {
        this._setMusicControlButton(this.els.npPrev, "prev", "Previous Track");
        this._setMusicControlButton(this.els.npNext, "next", "Next Track");


        // Shuffle & Repeat buttons (set initial icons)
        this._setMusicControlButton(this.els.npShuffle, "shuffle", "Shuffle");
        this.els.npShuffle.classList.toggle("active", this.music.shuffleOn);
        this._updateRepeatButton();

        // Timer & volume icons
        this._setMusicControlButton(this.els.npTimerBtn, "timer", "Sleep Timer");
        this._updateVolumeIcon();

        // Now Playing controls (full bar on music screen)
        this.els.npPlay.addEventListener("click", () => this.music.toggle());
        this.els.npPrev.addEventListener("click", () => this.music.prev());
        this.els.npNext.addEventListener("click", () => this.music.next());

        // Shuffle toggle
        this.els.npShuffle.addEventListener("click", () => {
            this.music.toggleShuffle();
        });

        // Repeat cycle
        this.els.npRepeat.addEventListener("click", () => {
            this.music.cycleRepeat();
        });

        // Volume slider
        this.els.npVolumeSlider.value = Math.round(this.music.getVolume() * 100);
        this.els.npVolumeSlider.addEventListener("input", (e) => {
            const vol = parseInt(e.target.value, 10) / 100;
            this.music.setVolume(vol);
            this._updateVolumeIcon();
        });

        // Volume icon click → toggle mute
        this.els.npVolumeIcon.addEventListener("click", () => {
            const nowMuted = !this.musicMuted;
            this._setMuted(nowMuted);
            localStorage.setItem("wf_music_muted", nowMuted ? "1" : "0");
        });

        // Draggable seek bar
        let seekDragging = false;
        const seekTo = (e) => {
            const rect = this.els.npProgressBar.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            this.music.seek(frac);
            this.els.npProgressFill.style.width = (frac * 100) + "%";
            this.els.npProgressThumb.style.left = (frac * 100) + "%";
        };
        const onSeekStart = (e) => {
            e.preventDefault();
            seekDragging = true;
            this.els.npProgressBar.classList.add("dragging");
            seekTo(e);
        };
        const onSeekMove = (e) => {
            if (!seekDragging) return;
            e.preventDefault();
            seekTo(e);
        };
        const onSeekEnd = () => {
            if (!seekDragging) return;
            seekDragging = false;
            this.els.npProgressBar.classList.remove("dragging");
        };
        this.els.npProgressBar.addEventListener("mousedown", onSeekStart);
        document.addEventListener("mousemove", onSeekMove);
        document.addEventListener("mouseup", onSeekEnd);
        this.els.npProgressBar.addEventListener("touchstart", onSeekStart, { passive: false });
        document.addEventListener("touchmove", onSeekMove, { passive: false });
        document.addEventListener("touchend", onSeekEnd);

        // Sleep timer button → open modal
        this.els.npTimerBtn.addEventListener("click", () => {
            this._updateSleepTimerModal();
            this.els.sleepTimerModal.classList.add("active");
        });

        // Sleep timer option buttons
        this.els.sleepTimerModal.querySelectorAll(".sleep-timer-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const minutes = parseInt(btn.dataset.minutes, 10);
                if (Number.isFinite(minutes)) {
                    this.music.startSleepTimer(minutes);
                    this.els.sleepTimerModal.classList.remove("active");
                }
            });
        });

        this.els.sleepTimerClear.addEventListener("click", () => {
            this.music.clearSleepTimer();
            this._updateSleepTimerModal();
        });

        this.els.sleepTimerClose.addEventListener("click", () => {
            this.els.sleepTimerModal.classList.remove("active");
        });

        // Sleep timer tick callback
        this.music.onSleepTimerTick = (remainingMs) => {
            if (remainingMs > 0) {
                const mins = Math.ceil(remainingMs / 60000);
                this.els.npTimerDisplay.textContent = `${mins}m`;
                this.els.npTimerDisplay.classList.remove("hidden");
                this._setMusicControlButton(this.els.npTimerBtn, "timer", "Sleep Timer");
                this.els.npTimerBtn.style.color = "#e2d8a6";
            } else {
                this.els.npTimerDisplay.classList.add("hidden");
                this.els.npTimerBtn.style.color = "";
            }
        };

        // Search input
        this.els.musicSearch.addEventListener("input", () => {
            this._renderTrackList();
        });

        // New playlist tab
        this.els.newPlaylistTab.addEventListener("click", () => this._openPlaylistModal(null));

        // Tutorial buttons (not from pause menu, so clear return flag)
        this.els.tutorialBtnProfiles.addEventListener("click", () => {
            this._tutorialReturnToPauseMenu = null;
            this._openTutorial();
        });
        this.els.tutorialBtnMenu.addEventListener("click", () => {
            this._tutorialReturnToPauseMenu = null;
            this._openTutorial();
        });
        this.els.tutorialCloseBtn.addEventListener("click", () => this._closeTutorial());
        this.els.tutorialSlidesCloseBtn.addEventListener("click", () => this._closeTutorial());
        this.els.tutorialBackBtn.addEventListener("click", () => this._tutorialBackToMenu());
        this.els.tutorialPrevBtn.addEventListener("click", () => this._goToTutorialSlide(this._tutorialIndex - 1));
        this.els.tutorialNextBtn.addEventListener("click", () => this._goToTutorialSlide(this._tutorialIndex + 1));

        // Playlist modal
        this.els.playlistSaveBtn.addEventListener("click", () => this._savePlaylistModal());
        this.els.playlistCancelBtn.addEventListener("click", () => {
            this.els.playlistModal.classList.remove("active");
        });

        // Playlist actions
        this.els.editSongsBtn.addEventListener("click", () => {
            if (this.activePlaylistTab === "__default") return;
            this._openPlaylistModal(this.activePlaylistTab);
        });
        this.els.renamePlaylistBtn.addEventListener("click", () => {
            if (this.activePlaylistTab === "__default") return;
            const newName = prompt("Rename playlist:", this.activePlaylistTab);
            if (newName && newName.trim()) {
                this.plMgr.renamePlaylist(this.activePlaylistTab, newName.trim());
                this.activePlaylistTab = newName.trim();
                this.music.refreshQueue();
                this._renderMusicScreen();
            }
        });
        this.els.deletePlaylistBtn.addEventListener("click", () => {
            if (this.activePlaylistTab === "__default") return;
            if (confirm(`Delete playlist "${this.activePlaylistTab}"?`)) {
                this.plMgr.deletePlaylist(this.activePlaylistTab);
                if (this.music.activePlaylist === this.activePlaylistTab) {
                    this.music.setActivePlaylist("__default");
                }
                this.activePlaylistTab = "__default";
                this._renderMusicScreen();
            }
        });
    }

    _bindGuidedTours() {
        this.els.guidedTourContinueBtn.addEventListener('click', () => this._advanceGuidedTour('continue'));
        this.els.guidedTourBackBtn.addEventListener('click', () => this._backGuidedTour());
        this.els.guidedTourExitBtn.addEventListener('click', () => this._stopGuidedTour(true));
    }

    _setMusicControlButton(button, iconName, label) {
        if (!button) return;
        button.innerHTML = getMusicControlIcon(iconName);
        if (label) button.setAttribute("aria-label", label);
    }

    // ── Input binding ──
    _bindInput() {
        // Keyboard
        document.addEventListener("keydown", (e) => {
            if (this.state !== State.PLAYING || this.clearing || this.rowDragActive) return;
            if (!this.block) return;
            switch (e.code) {
                case "ArrowLeft":
                case "KeyA":
                    e.preventDefault();
                    this._moveBlock(-1);
                    break;
                case "ArrowRight":
                case "KeyD":
                    e.preventDefault();
                    this._moveBlock(1);
                    break;
                case "Space":
                case "ArrowDown":
                case "KeyS":
                    e.preventDefault();
                    this._fastDrop();
                    break;
                case "Escape":
                case "KeyP":
                    e.preventDefault();
                    this._togglePause();
                    break;
            }
        });

        // Mobile buttons
        const preventAndDo = (el, fn) => {
            const handler = (e) => {
                e.preventDefault();
                if (this.state === State.PLAYING && !this.clearing && !this.rowDragActive && this.block) fn();
            };

            if (window.PointerEvent) {
                el.addEventListener("pointerdown", (e) => {
                    if (e.pointerType === "mouse" && e.button !== 0) return;
                    handler(e);
                });
                return;
            }

            el.addEventListener("touchstart", handler, { passive: false });
            el.addEventListener("mousedown", handler);
        };
        preventAndDo(this.els.btnLeft, () => this._moveBlock(-1));
        preventAndDo(this.els.btnRight, () => this._moveBlock(1));
        preventAndDo(this.els.btnDrop, () => this._fastDrop());

        if (this.usesTouchSwipeInput) {
            this._bindSwipeInput();
        }
    }

    _bindSwipeInput() {
        const swipeThreshold = 26;
        const dropThreshold = 32;
        const swipeSurface = this.els.canvasWrapper;
        if (!swipeSurface) return;

        const startSwipe = (clientX, clientY, pointerId = null) => {
            this.swipeState = {
                pointerId,
                startX: clientX,
                startY: clientY,
                lastX: clientX,
                dropTriggered: false,
            };
        };

        const moveSwipe = (clientX, clientY) => {
            if (!this.swipeState || this.state !== State.PLAYING || this.clearing || this.rowDragActive || !this.block) return;

            const totalDx = clientX - this.swipeState.startX;
            const totalDy = clientY - this.swipeState.startY;

            if (!this.swipeState.dropTriggered && totalDy >= dropThreshold && totalDy > Math.abs(totalDx) * 1.15) {
                if (this.spawnFreezeTimer > 0) {
                    // Cancel spawn freeze — block starts falling normally
                    this.spawnFreezeTimer = 0;
                } else {
                    this._fastDrop(true);
                }
                this.swipeState.dropTriggered = true;
                return;
            }

            if (Math.abs(totalDx) <= Math.abs(totalDy)) return;

            const deltaSinceLastMove = clientX - this.swipeState.lastX;
            if (Math.abs(deltaSinceLastMove) < swipeThreshold) return;

            const direction = deltaSinceLastMove > 0 ? 1 : -1;
            const steps = Math.floor(Math.abs(deltaSinceLastMove) / swipeThreshold);
            for (let step = 0; step < steps; step++) {
                this._moveBlock(direction);
            }
            this.swipeState.lastX += direction * steps * swipeThreshold;
        };

        const endSwipe = (pointerId = null) => {
            if (!this.swipeState) return;
            if (pointerId !== null && this.swipeState.pointerId !== null && pointerId !== this.swipeState.pointerId) return;
            this.swipeState = null;
        };

        if (window.PointerEvent) {
            swipeSurface.addEventListener("pointerdown", (e) => {
                if (e.pointerType === "mouse") return;
                if (this.state !== State.PLAYING || this.clearing || this.rowDragActive || !this.block) return;
                startSwipe(e.clientX, e.clientY, e.pointerId);
            });
            swipeSurface.addEventListener("pointermove", (e) => {
                if (!this.swipeState) return;
                if (this.swipeState.pointerId !== null && e.pointerId !== this.swipeState.pointerId) return;
                moveSwipe(e.clientX, e.clientY);
            });
            swipeSurface.addEventListener("pointerup", (e) => endSwipe(e.pointerId));
            swipeSurface.addEventListener("pointercancel", (e) => endSwipe(e.pointerId));
            return;
        }

        swipeSurface.addEventListener("touchstart", (e) => {
            if (this.state !== State.PLAYING || this.clearing || this.rowDragActive || !this.block) return;
            const touch = e.changedTouches[0];
            if (!touch) return;
            startSwipe(touch.clientX, touch.clientY, touch.identifier);
        }, { passive: true });

        swipeSurface.addEventListener("touchmove", (e) => {
            if (!this.swipeState) return;
            const touch = [...e.changedTouches].find(item => item.identifier === this.swipeState.pointerId);
            if (!touch) return;
            moveSwipe(touch.clientX, touch.clientY);
        }, { passive: true });

        swipeSurface.addEventListener("touchend", (e) => {
            if (!this.swipeState) return;
            const touch = [...e.changedTouches].find(item => item.identifier === this.swipeState.pointerId);
            if (touch) endSwipe(touch.identifier);
        }, { passive: true });

        swipeSurface.addEventListener("touchcancel", (e) => {
            if (!this.swipeState) return;
            const touch = [...e.changedTouches].find(item => item.identifier === this.swipeState.pointerId);
            if (touch) endSwipe(touch.identifier);
        }, { passive: true });
    }

    _highlightSizeButton() {
        const minSize = this.difficulty === "hard" ? 6 : 3;
        document.querySelectorAll(".size-btn").forEach(btn => {
            const size = parseInt(btn.dataset.size, 10);
            const tooSmall = size < minSize;
            const unlocked = this.profileMgr.isGridUnlocked(size);
            const disabled = tooSmall || !unlocked;
            btn.classList.toggle("selected", size === this.gridSize);
            btn.disabled = disabled;
            btn.classList.toggle("btn-disabled", disabled);
            // Show lock icon for grid-gated sizes
            const req = GRID_UNLOCK_REQUIREMENTS[size];
            if (!unlocked && req) {
                const lvl = this.profileMgr.getLevelInfo();
                if (lvl.level < req.level) {
                    btn.title = `Requires Level ${req.level}`;
                } else if (req.coins > 0) {
                    btn.title = `Unlock for ${req.coins} coins`;
                }
                btn.classList.add("grid-btn-locked");
            } else {
                btn.classList.remove("grid-btn-locked");
                btn.title = "";
            }
            // Show/remove unlock level label under locked buttons
            this._updateUnlockLabel(btn, !unlocked && req && req.level > 0 ? req.level : 0);
        });
    }

    _highlightDifficultyButton() {
        document.querySelectorAll(".difficulty-btn").forEach(btn => {
            const isSelected = btn.dataset.difficulty === this.difficulty;
            btn.classList.toggle("selected", isSelected);
            btn.classList.toggle("hard-selected", isSelected && this.difficulty === "hard");
        });
        const hint = document.getElementById("hard-mode-hint");
        if (hint) hint.classList.toggle("hidden", this.difficulty !== "hard");
    }

    _highlightGameModeButton() {
        document.querySelectorAll(".game-mode-btn").forEach(btn => {
            btn.classList.toggle("selected", btn.dataset.mode === this.gameMode);
        });
    }

    /**
     * Generic helper: show or remove a small "Level X" label under any
     * lockable button/element.  Pass requiredLevel > 0 to show, 0 to hide.
     * Reuse this for future unlockable items (themes, perks, etc.).
     */
    _updateUnlockLabel(el, requiredLevel) {
        let label = el.querySelector(".unlock-level-label");
        if (requiredLevel > 0) {
            if (!label) {
                label = document.createElement("span");
                label.className = "unlock-level-label";
                el.appendChild(label);
            }
            label.textContent = `Level ${requiredLevel}`;
        } else if (label) {
            label.remove();
        }
    }

    _isDifficultyActiveGrid() {
        return true;
    }

    _updateDifficultySelector() {
        if (!this.els.difficultySelector) return;
        this.els.difficultySelector.classList.toggle("hidden", !this._isDifficultyActiveGrid());
        if (this.els.gameModeSelector) {
            this.els.gameModeSelector.classList.remove("hidden");
        }
    }

    _getSelectedGameMode() {
        return this.gameMode;
    }

    _formatCountdownTime(seconds) {
        const safeSeconds = Math.max(0, Math.ceil(seconds));
        const mins = Math.floor(safeSeconds / 60);
        const secs = safeSeconds % 60;
        return `${mins}:${String(secs).padStart(2, "0")}`;
    }

    _updateTimerDisplay() {
        const isTimed = (this._getSelectedGameMode() === GAME_MODES.TIMED || this.activeChallenge) && this.timeLimitSeconds > 0;
        this.els.timerScoreItem.classList.toggle("hidden", !isTimed);
        if (isTimed) {
            this.els.gameTimer.textContent = this._formatCountdownTime(this.timeRemainingSeconds);
        }
    }

    _openTimeSelectModal() {
        this.pendingStartMode = this._getSelectedGameMode();
        this.els.timeSelectModal.classList.add("active");
    }

    _closeTimeSelectModal() {
        this.pendingStartMode = null;
        this.els.timeSelectModal.classList.remove("active");
    }

    _getMinWordLength() {
        if (this.difficulty === "hard") return 4;
        if (this.gridSize <= 4) return 2;
        return 3;
    }

    _showScreen(name) {
        this._activeScreen = name;
        if (this.els.authScreen) this.els.authScreen.classList.toggle("active", name === "auth");
        this.els.profilesScreen.classList.toggle("active", name === "profiles");
        this.els.menuScreen.classList.toggle("active", name === "menu");
        this.els.playScreen.classList.toggle("active", name === "play");
        this.els.gameoverScreen.classList.toggle("active", name === "gameover");
        this.els.musicScreen.classList.toggle("active", name === "music");
        this.els.wordsFoundScreen.classList.toggle("active", name === "wordsfound");
        if (this.els.challengesScreen) this.els.challengesScreen.classList.toggle("active", name === "challenges");
        this.els.challengeSetupScreen.classList.toggle("active", name === "challengesetup");
        this.els.shopScreen.classList.toggle("active", name === "shop");
        if (this.els.leaderboardScreen) this.els.leaderboardScreen.classList.toggle("active", name === "leaderboard");
        if (this.els.wsScreen) this.els.wsScreen.classList.toggle("active", name === "ws");
        if (this.els.wrScreen) this.els.wrScreen.classList.toggle("active", name === "wr");
        if (this.els.dictScreen) this.els.dictScreen.classList.toggle("active", name === "dict");
        if (name === "menu") {
            this._updateHighScoreDisplay();
            this._updateMenuStats();
            this._highlightSizeButton();
            this._updateDifficultySelector();
            this._updateLevelDisplay();
            this._refreshMyRankOnMenu();
            this._renderMilestonesPage();
            this._renderChallengesGrid();
            this._ensureDictTabReady();
            const hasSaved = this._hasSavedGame(null);
            this.els.resumeGameBtn.classList.toggle("hidden", !hasSaved);
        }
        if (name === "challengesetup") {
            const hasSaved = this.activeChallenge && this._hasSavedGame(this.activeChallenge);
            this.els.challengeResumeBtn.classList.toggle("hidden", !hasSaved);
        }
        if (name === "play") this._updateMiniNowPlaying();
        if (name === "ws") this._wsUpdateMiniPlayer();
        if (name === "wr") this._wrUpdateMiniPlayer();
        if (name === "profiles") this._renderProfilesList();
        if (name === "shop") this._renderShop();
        if (name === "leaderboard") {
            this._loadLeaderboard();
            this._subscribeLeaderboardRealtime();
        } else {
            this._unsubscribeLeaderboardRealtime();
        }

        // Control background animation (hide during gameplay)
        if (this.bgAnim) {
            if (name === "play") {
                this.bgAnim.stop();
            } else {
                this.bgAnim.start();
            }
        }

        // Confetti on new high score game over only
        if (name === "gameover" && this._lastGameNewHighScore) this._spawnConfetti();

        // ── Sync screen to Preact store ──
        gameStore.set({ screen: name, gameState: this.state });
    }

    _wrapTitleLetters() {
        document.querySelectorAll(".title").forEach(el => {
            const text = el.textContent.trim();
            el.textContent = "";
            [...text].forEach((ch, i) => {
                const span = document.createElement("span");
                span.className = "title-letter";
                span.textContent = ch === " " ? "\u00A0" : ch;
                span.style.animationDelay = `${i * 0.15}s`;
                el.appendChild(span);
            });
        });
    }

    _spawnConfetti() {
        if (!this.bgAnim) return;
        const rect = this.els.gameoverScreen.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height * 0.3;
        const particles = [];
        for (let i = 0; i < 80; i++) {
            particles.push(new ConfettiParticle(
                cx + (Math.random() - 0.5) * rect.width * 0.6,
                cy + (Math.random() - 0.5) * 40
            ));
        }
        this.bgAnim.addConfetti(particles);
    }

    _openWordsFound(fromScreen) {
        this.wordsFoundBackTarget = fromScreen;
        this.wordsFoundResumeState = fromScreen === "play" ? this.state : null;
        if (fromScreen === "play" && this.state === State.PLAYING) {
            this.state = State.PAUSED;
        }
        this._renderWordsFound();
        // Reset to page 0
        this._wfPage = 0;
        this._goToWfPage(0);
        this._showScreen("wordsfound");
        this._bindWfSwipe();
    }

    _closeWordsFound() {
        this._unbindWfSwipe();
        const target = this.wordsFoundBackTarget || "gameover";
        if (target === "wr-pause") {
            this._wrResumePause();
        } else {
            this._showScreen(target === "pause" ? "play" : target);
            if (target === "pause") {
                this.state = State.PAUSED;
                this.els.pauseOverlay.classList.add("active");
            }
            if (target === "play" && this.wordsFoundResumeState === State.PLAYING) {
                this.state = State.PLAYING;
            }
        }
        this.wordsFoundResumeState = null;
    }

    // ════════════════════════════════════════════════════════════════
    //  DICTIONARY / THESAURUS
    // ════════════════════════════════════════════════════════════════

    _openDict(fromScreen) {
        this._dictBackTarget = fromScreen;
        // Pause game if coming from active play
        if (fromScreen === "play" && this.state === State.PLAYING) {
            this.state = State.PAUSED;
        }
        // Build word list on first open
        if (!this._dictSortedWords.length) this._dictBuildWordList();
        this._dictApplyFilters();
        this._showScreen("dict");
    }

    _closeDict() {
        const target = this._dictBackTarget || "menu";
        if (target === "pause") {
            this._showScreen("play");
            this.els.pauseOverlay.classList.add("active");
        } else if (target === "ws-pause") {
            this._showScreen("ws");
            if (this.els.wsPauseOverlay) this.els.wsPauseOverlay.classList.add("active");
        } else if (target === "wr-pause") {
            this._wrResumePause();
        } else {
            this._showScreen(target);
        }
    }

    _ensureDictTabReady() {
        if (!this.els.dictTabList) return;
        if (!this._dictSortedWords.length) this._dictBuildWordList();
        if (!this._dictTabReady) {
            this._dictTabApplyFilters();
            this._dictTabReady = true;
        }
    }

    _dictBuildWordList() {
        // Build sorted array from the full game dictionary, enriching with definitions where available
        const arr = [];
        const enriched = ENRICHED_DICT || {};
        const source = DICTIONARY && DICTIONARY.size > 0 ? DICTIONARY : new Set(Object.keys(enriched).map(k => k.toUpperCase()));
        for (const upper of source) {
            const lower = upper.toLowerCase();
            const entry = enriched[lower];
            arr.push({
                word: lower,
                upper: upper,
                definitions: entry ? (entry.definitions || []) : [],
                synonyms: entry ? (entry.synonyms || []) : [],
                partsOfSpeech: entry ? (entry.partsOfSpeech || []) : [],
                len: upper.length,
            });
        }
        arr.sort((a, b) => a.upper.localeCompare(b.upper));
        this._dictSortedWords = arr;
    }

    _dictBuildAlphaBar() {
        if (!this.els.dictAlphaBar) return;
        const bar = this.els.dictAlphaBar;
        bar.innerHTML = "";
        for (let i = 65; i <= 90; i++) {
            const letter = String.fromCharCode(i);
            const btn = document.createElement("button");
            btn.className = "dict-alpha-btn";
            btn.textContent = letter;
            btn.dataset.letter = letter;
            btn.addEventListener("click", () => this._dictJumpToLetter(letter));
            bar.appendChild(btn);
        }
    }

    _dictTabBuildAlphaBar() {
        if (!this.els.dictTabAlphaBar) return;
        const bar = this.els.dictTabAlphaBar;
        bar.innerHTML = "";
        for (let i = 65; i <= 90; i++) {
            const letter = String.fromCharCode(i);
            const btn = document.createElement("button");
            btn.className = "dict-alpha-btn";
            btn.textContent = letter;
            btn.dataset.letter = letter;
            btn.addEventListener("click", () => this._dictTabJumpToLetter(letter));
            bar.appendChild(btn);
        }
    }

    _dictJumpToLetter(letter) {
        const words = this._dictFilteredWords;
        if (!words || words.length === 0) return;

        const targetIdx = this._dictLetterFirstIndex.get(letter);
        if (targetIdx === undefined) return;

        // Seek-render from the selected letter section to avoid huge DOM work.
        this._dictRenderStartIndex = targetIdx;
        this._dictRenderedCount = targetIdx;
        this._dictJumpRenderInProgress = false;
        this._dictRenderList();

        if (this.els.dictListWrap) this.els.dictListWrap.scrollTop = 0;
        const header = this.els.dictList.querySelector(`[data-letter-header="${letter}"]`);
        if (header) header.scrollIntoView({ behavior: "smooth", block: "start" });

        // Highlight active letter
        this.els.dictAlphaBar.querySelectorAll(".dict-alpha-btn").forEach(b =>
            b.classList.toggle("active", b.dataset.letter === letter));
        setTimeout(() => {
            this.els.dictAlphaBar.querySelectorAll(".dict-alpha-btn").forEach(b =>
                b.classList.remove("active"));
        }, 1200);
    }

    _dictTabJumpToLetter(letter) {
        const words = this._dictTabFilteredWords;
        if (!words || words.length === 0) return;

        const targetIdx = this._dictTabLetterFirstIndex.get(letter);
        if (targetIdx === undefined) return;

        this._dictTabRenderStartIndex = targetIdx;
        this._dictTabRenderedCount = targetIdx;
        this._dictTabRenderList();

        if (this.els.dictTabListWrap) this.els.dictTabListWrap.scrollTop = 0;
        const header = this.els.dictTabList?.querySelector(`[data-letter-header="${letter}"]`);
        if (header) header.scrollIntoView({ behavior: "smooth", block: "start" });

        this.els.dictTabAlphaBar?.querySelectorAll(".dict-alpha-btn").forEach(b =>
            b.classList.toggle("active", b.dataset.letter === letter));
        setTimeout(() => {
            this.els.dictTabAlphaBar?.querySelectorAll(".dict-alpha-btn").forEach(b =>
                b.classList.remove("active"));
        }, 1200);
    }

    _dictOnSearch() {
        const val = this.els.dictSearch.value.trim();
        this._dictSearchTerm = val.toUpperCase();
        this.els.dictSearchClear.classList.toggle("hidden", val.length === 0);
        this._dictApplyFilters();
    }

    _dictTabOnSearch() {
        if (!this.els.dictTabSearch) return;
        const val = this.els.dictTabSearch.value.trim();
        this._dictTabSearchTerm = val.toUpperCase();
        this.els.dictTabSearchClear?.classList.toggle("hidden", val.length === 0);
        this._dictTabApplyFilters();
    }

    _dictApplyFilters() {
        const search = this._dictSearchTerm;
        const filter = (typeof this._dictActiveFilter === "string" && this._dictActiveFilter)
            ? this._dictActiveFilter
            : "all";
        const source = this._dictSortedWords || [];

        let minLen = 0;
        let maxLen = Infinity;
        if (filter === "len-2-3") { minLen = 2; maxLen = 3; }
        else if (filter === "len-4-5") { minLen = 4; maxLen = 5; }
        else if (filter === "len-6-7") { minLen = 6; maxLen = 7; }
        else if (filter === "len-8+") { minLen = 8; }

        let posTag = null;
        let topicSet = null;
        if (filter.startsWith("cat-")) {
            const catKey = filter.slice(4);
            const POS_FILTER_MAP = {
                nouns: "noun",
                verbs: "verb",
                adjectives: "adjective",
                adverbs: "adverb",
            };
            posTag = POS_FILTER_MAP[catKey] || null;
            if (!posTag) {
                const catData = WORD_CATEGORIES[catKey];
                topicSet = catData ? catData.words : null;
            }
        }

        const filtered = [];
        const letterCounts = new Map();
        const letterFirstIndex = new Map();

        for (const w of source) {
            if (search && !w.upper.startsWith(search)) continue;
            if (w.len < minLen || w.len > maxLen) continue;

            if (posTag) {
                const parts = Array.isArray(w.partsOfSpeech) ? w.partsOfSpeech : [];
                const hasPos = parts.some(p => p === posTag || (posTag === "adjective" && p === "adjective satellite"));
                if (!hasPos) continue;
            } else if (topicSet && !topicSet.has(w.upper)) {
                continue;
            }

            filtered.push(w);
            const first = w.upper[0];
            if (!letterFirstIndex.has(first)) letterFirstIndex.set(first, filtered.length - 1);
            letterCounts.set(first, (letterCounts.get(first) || 0) + 1);
        }

        this._dictFilteredWords = filtered;
        this._dictLetterCounts = letterCounts;
        this._dictLetterFirstIndex = letterFirstIndex;
        this._dictRenderStartIndex = 0;
        this._dictRenderedCount = 0;
        this._dictJumpRenderInProgress = false;
        this._dictRenderList();

        // Update count
        if (this.els.dictResultCount) {
            this.els.dictResultCount.textContent = `${filtered.length} word${filtered.length !== 1 ? "s" : ""}`;
        }

        // Update alpha bar availability
        const availLetters = new Set(this._dictLetterCounts.keys());
        this.els.dictAlphaBar.querySelectorAll(".dict-alpha-btn").forEach(b => {
            b.classList.toggle("disabled", !availLetters.has(b.dataset.letter));
        });
    }

    _dictTabApplyFilters() {
        const search = this._dictTabSearchTerm;
        const filter = (typeof this._dictTabActiveFilter === "string" && this._dictTabActiveFilter)
            ? this._dictTabActiveFilter
            : "all";
        const source = this._dictSortedWords || [];

        let minLen = 0;
        let maxLen = Infinity;
        if (filter === "len-2-3") { minLen = 2; maxLen = 3; }
        else if (filter === "len-4-5") { minLen = 4; maxLen = 5; }
        else if (filter === "len-6-7") { minLen = 6; maxLen = 7; }
        else if (filter === "len-8+") { minLen = 8; }

        let posTag = null;
        let topicSet = null;
        if (filter.startsWith("cat-")) {
            const catKey = filter.slice(4);
            const POS_FILTER_MAP = {
                nouns: "noun",
                verbs: "verb",
                adjectives: "adjective",
                adverbs: "adverb",
            };
            posTag = POS_FILTER_MAP[catKey] || null;
            if (!posTag) {
                const catData = WORD_CATEGORIES[catKey];
                topicSet = catData ? catData.words : null;
            }
        }

        const filtered = [];
        const letterCounts = new Map();
        const letterFirstIndex = new Map();

        for (const w of source) {
            if (search && !w.upper.startsWith(search)) continue;
            if (w.len < minLen || w.len > maxLen) continue;

            if (posTag) {
                const parts = Array.isArray(w.partsOfSpeech) ? w.partsOfSpeech : [];
                const hasPos = parts.some(p => p === posTag || (posTag === "adjective" && p === "adjective satellite"));
                if (!hasPos) continue;
            } else if (topicSet && !topicSet.has(w.upper)) {
                continue;
            }

            filtered.push(w);
            const first = w.upper[0];
            if (!letterFirstIndex.has(first)) letterFirstIndex.set(first, filtered.length - 1);
            letterCounts.set(first, (letterCounts.get(first) || 0) + 1);
        }

        this._dictTabFilteredWords = filtered;
        this._dictTabLetterCounts = letterCounts;
        this._dictTabLetterFirstIndex = letterFirstIndex;
        this._dictTabRenderStartIndex = 0;
        this._dictTabRenderedCount = 0;
        this._dictTabRenderList();

        if (this.els.dictTabResultCount) {
            this.els.dictTabResultCount.textContent = `${filtered.length} word${filtered.length !== 1 ? "s" : ""}`;
        }

        const availLetters = new Set(this._dictTabLetterCounts.keys());
        this.els.dictTabAlphaBar?.querySelectorAll(".dict-alpha-btn").forEach(b => {
            b.classList.toggle("disabled", !availLetters.has(b.dataset.letter));
        });
    }

    _dictRenderList() {
        const list = this.els.dictList;
        list.innerHTML = "";
        if (!this._dictFilteredWords.length) {
            list.innerHTML = `
                <div class="dict-empty-state">
                    <div class="dict-empty-icon">📖</div>
                    <div class="dict-empty-text">No words match your search</div>
                    <div class="dict-empty-hint">Try a different search or filter</div>
                </div>`;
            return;
        }
        const wordsLen = this._dictFilteredWords.length;
        const start = Math.max(0, Math.min(this._dictRenderStartIndex || 0, Math.max(0, wordsLen - 1)));
        this._dictRenderedCount = start;
        this._dictRenderNextChunk();
    }

    _dictTabRenderList() {
        const list = this.els.dictTabList;
        if (!list) return;
        list.innerHTML = "";
        if (!this._dictTabFilteredWords.length) {
            list.innerHTML = `
                <div class="dict-empty-state">
                    <div class="dict-empty-icon">📖</div>
                    <div class="dict-empty-text">No words match your search</div>
                    <div class="dict-empty-hint">Try a different search or filter</div>
                </div>`;
            return;
        }
        const wordsLen = this._dictTabFilteredWords.length;
        const start = Math.max(0, Math.min(this._dictTabRenderStartIndex || 0, Math.max(0, wordsLen - 1)));
        this._dictTabRenderedCount = start;
        this._dictTabRenderNextChunk();
    }

    _dictRenderNextChunk() {
        const words = this._dictFilteredWords;
        if (!words || this._dictRenderedCount >= words.length) return;
        const list = this.els.dictList;
        const end = Math.min(this._dictRenderedCount + this._dictChunkSize, words.length);
        let lastLetter = "";

        // Check what last rendered letter was
        if (this._dictRenderedCount > 0 && this._dictRenderedCount <= words.length) {
            lastLetter = words[this._dictRenderedCount - 1].upper[0];
        }

        for (let i = this._dictRenderedCount; i < end; i++) {
            const w = words[i];
            const firstLetter = w.upper[0];

            // Insert letter section header
            if (firstLetter !== lastLetter) {
                lastLetter = firstLetter;
                const hdr = document.createElement("div");
                hdr.className = "dict-letter-header";
                hdr.dataset.letterHeader = firstLetter;
                hdr.innerHTML = `
                    <span class="dict-letter-char">${firstLetter}</span>
                    <span class="dict-letter-line"></span>
                    <span class="dict-letter-count">${this._dictLetterCounts.get(firstLetter) || 0}</span>`;
                list.appendChild(hdr);
            }

            list.appendChild(this._dictBuildCard(w));
        }
        this._dictRenderedCount = end;
    }

    _dictTabRenderNextChunk() {
        const words = this._dictTabFilteredWords;
        if (!words || this._dictTabRenderedCount >= words.length) return;
        const list = this.els.dictTabList;
        if (!list) return;
        const end = Math.min(this._dictTabRenderedCount + this._dictTabChunkSize, words.length);
        let lastLetter = "";

        if (this._dictTabRenderedCount > 0 && this._dictTabRenderedCount <= words.length) {
            lastLetter = words[this._dictTabRenderedCount - 1].upper[0];
        }

        for (let i = this._dictTabRenderedCount; i < end; i++) {
            const w = words[i];
            const firstLetter = w.upper[0];

            if (firstLetter !== lastLetter) {
                lastLetter = firstLetter;
                const hdr = document.createElement("div");
                hdr.className = "dict-letter-header";
                hdr.dataset.letterHeader = firstLetter;
                hdr.innerHTML = `
                    <span class="dict-letter-char">${firstLetter}</span>
                    <span class="dict-letter-line"></span>
                    <span class="dict-letter-count">${this._dictTabLetterCounts.get(firstLetter) || 0}</span>`;
                list.appendChild(hdr);
            }

            list.appendChild(this._dictTabBuildCard(w));
        }
        this._dictTabRenderedCount = end;
    }

    _dictBuildCard(w) {
        return this._dictBuildCardForContext(w, (syn) => {
            if (syn && ENRICHED_DICT && ENRICHED_DICT[syn.toLowerCase()] && this.els.dictSearch) {
                this.els.dictSearch.value = syn.toUpperCase();
                this._dictOnSearch();
            }
        });
    }

    _dictTabBuildCard(w) {
        return this._dictBuildCardForContext(w, (syn) => {
            if (syn && ENRICHED_DICT && ENRICHED_DICT[syn.toLowerCase()] && this.els.dictTabSearch) {
                this.els.dictTabSearch.value = syn.toUpperCase();
                this._dictTabOnSearch();
            }
        });
    }

    _dictBuildCardForContext(w, onSynonymJump) {
        const card = document.createElement("div");
        card.className = "dict-word-card";

        // POS badges
        const posHtml = w.partsOfSpeech.map(p => {
            const norm = p.toLowerCase().replace(/\s*satellite/i, "").trim();
            const cls = norm.startsWith("adj") ? "pos-adj" :
                        norm.startsWith("adv") ? "pos-adv" :
                        norm === "noun" ? "pos-noun" :
                        norm === "verb" ? "pos-verb" : "";
            return `<span class="dict-pos-badge ${cls}">${norm}</span>`;
        }).join("");

        card.innerHTML = `
            <div class="dict-word-head">
                <span class="dict-word-title">${w.upper}</span>
                <div class="dict-word-meta">
                    ${posHtml}
                    <span class="dict-len-badge">${w.len}</span>
                    <span class="dict-word-chevron">▾</span>
                </div>
            </div>
            <div class="dict-word-detail">
                
            </div>`;

        card.dataset.detailLoaded = "0";

        card.addEventListener("click", (e) => {
            // Clicking synonym chip → jump to that word
            if (e.target.classList.contains("dict-syn-chip")) {
                const syn = e.target.dataset.syn;
                if (onSynonymJump) onSynonymJump(syn);
                return;
            }
            const willOpen = !card.classList.contains("open");
            if (willOpen && card.dataset.detailLoaded !== "1") {
                const detail = card.querySelector(".dict-word-detail");
                if (detail) {
                    detail.innerHTML = this._dictBuildDetail(w);
                    card.dataset.detailLoaded = "1";
                }
            }
            card.classList.toggle("open");
        });

        return card;
    }

    _dictBuildDetail(w) {
        let html = "";

        // Definitions
        if (w.definitions.length) {
            html += `<div class="dict-def-section">
                <div class="dict-section-label">Definitions</div>`;
            w.definitions.forEach((d, i) => {
                html += `<div class="dict-def-item">
                    <span class="dict-def-num">${i + 1}</span>
                    <div class="dict-def-body">
                        <span class="dict-def-pos-tag">${d.pos}</span>
                        <span class="dict-def-text">${this._escapeHtml(d.definition)}</span>
                    </div>
                </div>`;
            });
            html += `</div>`;
        }

        // Synonyms
        if (w.synonyms.length) {
            html += `<div class="dict-syn-section">
                <div class="dict-section-label">Synonyms</div>
                <div class="dict-syn-wrap">`;
            for (const syn of w.synonyms) {
                const inDict = ENRICHED_DICT && ENRICHED_DICT[syn.toLowerCase()];
                html += `<span class="dict-syn-chip${inDict ? " in-dict" : ""}" data-syn="${this._escapeHtml(syn)}">${syn}</span>`;
            }
            html += `</div></div>`;
        }

        if (!w.definitions.length && !w.synonyms.length) {
            html += `<div class="dict-empty-hint" style="padding:8px 0;">No definitions available</div>`;
        }

        return html;
    }

    _escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    // ════════════════════════════════════════════════════════════════
    //  WORDS FOUND — Enriched Detail Dropdowns
    // ════════════════════════════════════════════════════════════════

    _buildWordFoundDetail(wordUpper) {
        const key = wordUpper.toLowerCase();
        const entry = ENRICHED_DICT && ENRICHED_DICT[key];
        if (!entry) return "";

        let html = '<div class="wf-word-detail">';

        // Definitions (max 3)
        const defs = entry.definitions || [];
        if (defs.length) {
            html += '<div class="wf-detail-label">Definition</div>';
            defs.slice(0, 3).forEach(d => {
                html += `<div class="wf-detail-def"><em>${d.pos}</em> — ${this._escapeHtml(d.definition)}</div>`;
            });
        }

        // Synonyms (max 6)
        const syns = entry.synonyms || [];
        if (syns.length) {
            html += '<div class="wf-detail-label" style="margin-top:6px;">Synonyms</div>';
            html += `<div class="wf-detail-def">${syns.slice(0, 6).join(", ")}</div>`;
        }

        html += '</div>';
        return html;
    }

    _hasBonusWordsView() {
        return this._gameOverChallenge === CHALLENGE_TYPES.TARGET_WORD
            || this._gameOverChallenge === CHALLENGE_TYPES.WORD_CATEGORY
            || this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD
            || this.activeChallenge === CHALLENGE_TYPES.WORD_CATEGORY;
    }

    _goToWfPage(index) {
        const total = this._hasBonusWordsView() ? 2 : 1;
        this._wfPage = Math.max(0, Math.min(index, total - 1));
        this.els.wfSlideStrip.classList.remove("swiping");
        this.els.wfSlideStrip.style.transform = `translateX(-${this._wfPage * 100}%)`;
        // Update dots
        this.els.wfDots.querySelectorAll(".wf-dot").forEach((d, i) =>
            d.classList.toggle("active", i === this._wfPage));
        // Update title
        this.els.wordsFoundTitle.textContent = this._wfPage === 0 ? "Words Found" : "Bonus Words";
    }

    _bindWfSwipe() {
        this._unbindWfSwipe();
        if (!this._hasBonusWordsView()) return;
        const view = this.els.wfSlideView;
        const strip = this.els.wfSlideStrip;
        let startX = 0, dragging = false, moved = false;
        const total = 2;

        this._wfPointerDown = (e) => {
            dragging = true; moved = false;
            startX = e.touches ? e.touches[0].clientX : e.clientX;
            strip.classList.add("swiping");
        };
        this._wfPointerMove = (e) => {
            if (!dragging) return;
            const x = e.touches ? e.touches[0].clientX : e.clientX;
            const y = e.touches ? e.touches[0].clientY : e.clientY;
            const dx = x - startX;
            if (!moved && Math.abs(dx) > 10) moved = true;
            if (moved && e.cancelable) e.preventDefault();
            if (moved) {
                const viewW = view.offsetWidth || 300;
                const base = -this._wfPage * viewW;
                const atStart = this._wfPage === 0 && dx > 0;
                const atEnd = this._wfPage === total - 1 && dx < 0;
                const dampened = (atStart || atEnd) ? dx * 0.25 : dx;
                strip.style.transform = `translateX(${base + dampened}px)`;
            }
        };
        this._wfPointerUp = (e) => {
            if (!dragging) return;
            dragging = false;
            strip.classList.remove("swiping");
            const x = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
            const dx = x - startX;
            const viewW = view.offsetWidth || 300;
            const threshold = viewW * 0.15;
            if (Math.abs(dx) > threshold) {
                if (dx < 0 && this._wfPage < total - 1) this._wfPage++;
                else if (dx > 0 && this._wfPage > 0) this._wfPage--;
            }
            this._goToWfPage(this._wfPage);
        };

        view.addEventListener("touchstart", this._wfPointerDown, { passive: true });
        view.addEventListener("touchmove", this._wfPointerMove, { passive: false });
        view.addEventListener("touchend", this._wfPointerUp);
        view.addEventListener("mousedown", this._wfPointerDown);
        view.addEventListener("mousemove", this._wfPointerMove);
        view.addEventListener("mouseup", this._wfPointerUp);
        view.addEventListener("mouseleave", this._wfPointerUp);

        // Dot clicks
        this.els.wfDots.querySelectorAll(".wf-dot").forEach(d => {
            d.addEventListener("click", () => this._goToWfPage(parseInt(d.dataset.page)));
        });
    }

    _unbindWfSwipe() {
        const view = this.els.wfSlideView;
        if (this._wfPointerDown) {
            view.removeEventListener("touchstart", this._wfPointerDown);
            view.removeEventListener("touchmove", this._wfPointerMove);
            view.removeEventListener("touchend", this._wfPointerUp);
            view.removeEventListener("mousedown", this._wfPointerDown);
            view.removeEventListener("mousemove", this._wfPointerMove);
            view.removeEventListener("mouseup", this._wfPointerUp);
            view.removeEventListener("mouseleave", this._wfPointerUp);
        }
    }

    // ── Menu page swipe ──

    _getMenuPageCount() {
        return this.els.menuSlideStrip.children.length;
    }

    _goToMenuPage(index) {
        const total = this._getMenuPageCount();
        // Wrap around for looping
        if (index < 0) index = total - 1;
        else if (index >= total) index = 0;
        this._menuPage = index;
        this.els.menuSlideStrip.classList.remove("swiping");
        this.els.menuSlideStrip.style.transform = `translateX(-${this._menuPage * 100}%)`;
        this.els.menuDots.querySelectorAll(".menu-dot").forEach((d, i) =>
            d.classList.toggle("active", i === this._menuPage));
        // Never disable arrows — looping is always possible
        this.els.menuPrevBtn.disabled = false;
        this.els.menuNextBtn.disabled = false;

        // Page 2 is the inline dictionary tab.
        if (this._menuPage === 2) {
            this._ensureDictTabReady();
        }
    }

    _bindMenuSwipe() {
        const view = this.els.menuSlideView;
        const strip = this.els.menuSlideStrip;
        let startX = 0, startY = 0, dragging = false, moved = false;

        // Check if target is inside a horizontally scrollable element
        const isInHScrollable = (el) => {
            while (el && el !== view) {
                const style = getComputedStyle(el);
                const overflowX = style.overflowX;
                if ((overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth) {
                    return true;
                }
                el = el.parentElement;
            }
            return false;
        };

        this._menuPointerDown = (e) => {
            // Skip page swipe if touch started inside a horizontally scrollable element (e.g., filter chips)
            const target = e.touches ? e.target : e.target;
            if (isInHScrollable(target)) {
                dragging = false;
                return;
            }
            dragging = true; moved = false;
            startX = e.touches ? e.touches[0].clientX : e.clientX;
            startY = e.touches ? e.touches[0].clientY : e.clientY;
            strip.classList.add("swiping");
        };
        this._menuPointerMove = (e) => {
            if (!dragging) return;
            const x = e.touches ? e.touches[0].clientX : e.clientX;
            const y = e.touches ? e.touches[0].clientY : e.clientY;
            const dx = x - startX, dy = y - startY;
            if (!moved && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
                dragging = false;
                strip.classList.remove("swiping");
                strip.style.transform = `translateX(-${this._menuPage * 100}%)`;
                return;
            }
            if (!moved && Math.abs(dx) > 10) moved = true;
            if (moved && e.cancelable) e.preventDefault();
            if (moved) {
                const viewW = view.offsetWidth || 300;
                const base = -this._menuPage * viewW;
                strip.style.transform = `translateX(${base + dx}px)`;
            }
        };
        this._menuPointerUp = (e) => {
            if (!dragging) return;
            dragging = false;
            strip.classList.remove("swiping");
            const x = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
            const dx = x - startX;
            const viewW = view.offsetWidth || 300;
            const threshold = viewW * 0.15;
            if (Math.abs(dx) > threshold) {
                if (dx < 0) this._menuPage++;
                else if (dx > 0) this._menuPage--;
            }
            this._goToMenuPage(this._menuPage);
        };

        view.addEventListener("touchstart", this._menuPointerDown, { passive: true });
        view.addEventListener("touchmove", this._menuPointerMove, { passive: false });
        view.addEventListener("touchend", this._menuPointerUp);
        view.addEventListener("mousedown", this._menuPointerDown);
        view.addEventListener("mousemove", this._menuPointerMove);
        view.addEventListener("mouseup", this._menuPointerUp);
        view.addEventListener("mouseleave", this._menuPointerUp);

        // Dot clicks
        this.els.menuDots.querySelectorAll(".menu-dot").forEach(d => {
            d.addEventListener("click", () => this._goToMenuPage(parseInt(d.dataset.page)));
        });

        // Arrow clicks (loop)
        this.els.menuPrevBtn.addEventListener("click", () => this._goToMenuPage(this._menuPage - 1));
        this.els.menuNextBtn.addEventListener("click", () => this._goToMenuPage(this._menuPage + 1));
    }

    _updateHighScoreDisplay() {
        if (this.activeChallenge) {
            const cs = this.profileMgr.getChallengeStats(this.activeChallenge);
            this.els.playHighScore.textContent = cs.highScore;
        } else {
            this.els.playHighScore.textContent = this.highScore;
        }
        this.els.menuHighScore.textContent = this.highScore;
    }

    // ── Milestones Page ──

    _renderMilestonesPage() {
        const grid = this.els.milestonesGrid;
        if (!grid) return;
        grid.innerHTML = '';

        const p = this.profileMgr.getActive();
        const claimed = p ? (p.claimedMilestones || []) : [];
        const earnedDates = (p && p._milestoneTimestamps) || {};
        const activeFilter = this._milestonesActiveFilter || 'all';
        const sortOrder = this._milestonesSortOrder || 'default';

        // Category display config — order matters
        const CAT_CONFIG = [
            { key: 'journey',        label: '🚀 Getting Started' },
            { key: 'words',          label: '📝 Unique Words' },
            { key: 'totalWords',     label: '📖 Total Words' },
            { key: 'games',          label: '🎮 Games Played' },
            { key: 'level',          label: '⬆ Leveling' },
            { key: 'score',          label: '🏅 High Scores' },
            { key: 'streak',         label: '🔥 Streaks' },
            { key: 'xp',            label: '✨ Experience' },
            { key: 'coins',         label: '🪙 Coins Earned' },
            { key: 'balance',       label: '💰 Coin Balance' },
            { key: 'shop',          label: '🛒 Shop & Inventory' },
            { key: 'grid',          label: '📐 Grid Mastery' },
            { key: 'bestScores',    label: '🎯 Mode Scores' },
            { key: 'challenges',    label: '⚔ Challenges' },
            { key: 'challengeScore',label: '🏆 Challenge Records' },
            { key: 'targetWord',    label: '🎯 Target Word' },
            { key: 'speedRound',    label: '⚡ Speed Round' },
            { key: 'wordCat',       label: '📂 Word Category' },
            { key: 'wordSearch',    label: '🔍 Word Search' },
            { key: 'wordRunner',    label: '🏃 Word Runner' },
            { key: 'meta',          label: '🌟 Meta Achievements' },
        ];

        // If sorting by date, flatten all milestones and sort
        if (sortOrder === 'recent' || sortOrder === 'oldest') {
            // Get all milestones, optionally filtered by category
            let milestones = [...MILESTONES];
            if (activeFilter !== 'all') {
                milestones = milestones.filter(m => m.cat === activeFilter);
            }

            // Sort by earned date (earned first, then by date)
            milestones.sort((a, b) => {
                const aEarned = claimed.includes(a.id);
                const bEarned = claimed.includes(b.id);
                
                // Earned milestones come first
                if (aEarned && !bEarned) return -1;
                if (!aEarned && bEarned) return 1;
                
                // Both earned - sort by date
                if (aEarned && bEarned) {
                    const aDate = earnedDates[a.id] ? new Date(earnedDates[a.id]).getTime() : 0;
                    const bDate = earnedDates[b.id] ? new Date(earnedDates[b.id]).getTime() : 0;
                    return sortOrder === 'recent' ? bDate - aDate : aDate - bDate;
                }
                
                // Both unearned - keep original order
                return 0;
            });

            // Render as flat list with date headers
            const section = document.createElement('div');
            section.className = 'ms-category ms-sorted-list';
            
            const label = document.createElement('div');
            label.className = 'ms-category-label';
            const earnedCount = milestones.filter(m => claimed.includes(m.id)).length;
            label.innerHTML = sortOrder === 'recent' 
                ? `🕐 Most Recent <span class="ms-cat-count">${earnedCount} earned</span>`
                : `📅 Oldest First <span class="ms-cat-count">${earnedCount} earned</span>`;
            section.appendChild(label);

            for (const m of milestones) {
                const isEarned = claimed.includes(m.id);
                const card = this._createMilestoneCard(m, isEarned, earnedDates);
                section.appendChild(card);
            }

            grid.appendChild(section);
        } else {
            // Default: group by category
            const grouped = {};
            for (const m of MILESTONES) {
                if (!grouped[m.cat]) grouped[m.cat] = [];
                grouped[m.cat].push(m);
            }

            for (const cat of CAT_CONFIG) {
                if (activeFilter !== 'all' && cat.key !== activeFilter) continue;
                
                const items = grouped[cat.key];
                if (!items || items.length === 0) continue;

                const section = document.createElement('div');
                section.className = 'ms-category';

                const catEarned = items.filter(m => claimed.includes(m.id)).length;
                const label = document.createElement('div');
                label.className = 'ms-category-label';
                label.innerHTML = `${cat.label} <span class="ms-cat-count">${catEarned}/${items.length}</span>`;
                section.appendChild(label);

                for (const m of items) {
                    const isEarned = claimed.includes(m.id);
                    const card = this._createMilestoneCard(m, isEarned, earnedDates);
                    section.appendChild(card);
                }

                grid.appendChild(section);
            }
        }

        // Calculate total earned count for progress bar (across ALL milestones)
        const totalEarnedCount = MILESTONES.filter(m => claimed.includes(m.id)).length;

        // Progress bar
        const total = MILESTONES.length;
        if (this.els.milestonesProgressFill) {
            this.els.milestonesProgressFill.style.width = `${(totalEarnedCount / total) * 100}%`;
        }
        if (this.els.milestonesProgressText) {
            this.els.milestonesProgressText.textContent = `${totalEarnedCount} / ${total}`;
        }
    }

    _createMilestoneCard(m, isEarned, earnedDates) {
        const card = document.createElement('div');
        card.className = `ms-card ${isEarned ? 'earned' : 'locked'}`;

        const icon = document.createElement('div');
        icon.className = 'ms-icon';
        icon.textContent = isEarned ? '🏆' : '🔒';

        const info = document.createElement('div');
        info.className = 'ms-info';

        const lbl = document.createElement('div');
        lbl.className = 'ms-label';
        lbl.textContent = m.label;

        const desc = document.createElement('div');
        desc.className = 'ms-desc';
        desc.textContent = m.desc;

        info.appendChild(lbl);
        info.appendChild(desc);

        // Earned date
        if (isEarned && earnedDates[m.id]) {
            const dateEl = document.createElement('div');
            dateEl.className = 'ms-date';
            const d = new Date(earnedDates[m.id]);
            dateEl.textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            info.appendChild(dateEl);
        }

        const reward = document.createElement('div');
        reward.className = 'ms-reward';
        reward.innerHTML = `<span class="ms-reward-coin">●</span> ${m.coins}<span class="ms-earned-check">${isEarned ? '✓' : ''}</span>`;

        card.appendChild(icon);
        card.appendChild(info);
        card.appendChild(reward);
        return card;
    }

    /**
     * Record newly earned milestones to the profile_milestones table.
     * Fire-and-forget — errors are logged but don't block the UI.
     */
    async _syncMilestonesToCloud(newMilestones) {
        try {
            const { isLocalMode, recordMilestone } = await import('./src/lib/supabase.js');
            if (isLocalMode) return;
            const p = this.profileMgr.getActive();
            if (!p || !p.cloudId || !newMilestones?.length) return;
            // Record each milestone and store timestamps locally
            if (!p._milestoneTimestamps) p._milestoneTimestamps = {};
            const now = new Date().toISOString();
            const promises = newMilestones.map(m => {
                if (!p._milestoneTimestamps[m.id]) p._milestoneTimestamps[m.id] = now;
                return recordMilestone(p.cloudId, m.id, m.coins).catch(err =>
                    console.warn(`[milestones] failed to record ${m.id}:`, err.message)
                );
            });
            await Promise.all(promises);
            this.profileMgr._save();
        } catch (err) {
            console.error('[milestones] sync to cloud failed:', err);
        }
    }

    /**
     * Load milestone timestamps from the cloud for the active profile.
     * Populates p._milestoneTimestamps for the milestones page.
     */
    async _loadMilestonesFromCloud() {
        try {
            const { isLocalMode, getProfileMilestones } = await import('./src/lib/supabase.js');
            if (isLocalMode) return;
            const p = this.profileMgr.getActive();
            if (!p || !p.cloudId) return;
            const rows = await getProfileMilestones(p.cloudId);
            if (!rows.length) return;
            if (!p._milestoneTimestamps) p._milestoneTimestamps = {};
            for (const row of rows) {
                p._milestoneTimestamps[row.milestone_id] = row.earned_at;
                // Ensure local claimed array is in sync
                if (!p.claimedMilestones.includes(row.milestone_id)) {
                    p.claimedMilestones.push(row.milestone_id);
                }
            }
            this.profileMgr._save();
        } catch (err) {
            console.error('[milestones] load from cloud failed:', err);
        }
    }

    _updateScoreDisplay() {
        const el = this.els.currentScore;
        const prevScore = parseInt(el.textContent, 10) || 0;
        el.textContent = this.score;

        // GSAP score bump: scale bounce + number roll for large jumps
        gsap.fromTo(el, { scale: 1.15 }, {
            scale: 1,
            duration: 0.3,
            ease: 'elastic.out(1, 0.4)',
        });
        if (this.score - prevScore > 50) {
            numberRoll(el, prevScore, this.score, { duration: 0.4 });
        }

        this._updateBonusButton();
        // Update coin count in HUD
        this._updatePlayCoins();

        // ── Sync to Preact store ──
        const comboMult = Math.min(COMBO_MAX_MULTIPLIER, 1 + (this.comboCount - 1) * COMBO_MULTIPLIER_STEP);
        gameStore.set({
            score: this.score,
            highScore: this.highScore,
            scoreMultiplier: this.scoreMultiplier,
            comboCount: this.comboCount,
            bestCombo: this.bestCombo,
            comboMultiplier: this.comboCount >= 2 ? comboMult : 1,
            comboActive: this.comboCount >= 2,
            chainCount: this.totalWordsInChain,
            wordsFoundCount: this._totalWordsThisGame,
            difficultyLevel: this._difficultyLevel,
            fallSpeed: this.fallInterval,
            freezeActive: this.freezeActive,
            freezeTimeRemaining: this.freezeTimeRemaining,
            isTimed: (this._getSelectedGameMode() === GAME_MODES.TIMED || this.activeChallenge) && this.timeLimitSeconds > 0,
            timeRemaining: this.timeRemainingSeconds,
            timeLimit: this.timeLimitSeconds,
            activeChallenge: this.activeChallenge,
            targetWord: this.targetWord,
            targetWordsCompleted: this.targetWordsCompleted,
        });
    }

    _updatePlayCoins() {
        if (this.els.playCoins) {
            this.els.playCoins.textContent = this.profileMgr.getCoins();
        }
    }

    _checkPlayBtnOverlaps() {
        if (!this.block) {
            // No block — clear all faded states
            this.els.bonusBtn?.classList.remove("bonus-btn-faded");
            for (const el of this._overlayBtns) el.classList.remove("play-btn-faded");
            return;
        }
        const r = this.renderer;
        const cr = this.canvas.getBoundingClientRect();
        // Block screen position (canvas CSS coords → viewport coords)
        const bx  = cr.left + r.offsetX + this.block.col * r.cellSize;
        const by  = cr.top  + r.offsetY + this.block.visualRow * r.cellSize;
        const bx2 = bx + r.cellSize;
        const by2 = by + r.cellSize;

        // Bonus button keeps its own dedicated class
        const bonus = this.els.bonusBtn;
        if (bonus && !bonus.classList.contains("hidden")) {
            const br = bonus.getBoundingClientRect();
            const hit = !(bx2 <= br.left || bx >= br.right || by2 <= br.top || by >= br.bottom);
            bonus.classList.toggle("bonus-btn-faded", hit);
        } else if (bonus) {
            bonus.classList.remove("bonus-btn-faded");
        }

        // All other overlay buttons use the generic class
        for (const el of this._overlayBtns) {
            if (!el || el.classList.contains("hidden") || el.offsetParent === null) {
                el?.classList.remove("play-btn-faded");
                continue;
            }
            const br = el.getBoundingClientRect();
            const hit = !(bx2 <= br.left || bx >= br.right || by2 <= br.top || by >= br.bottom);
            el.classList.toggle("play-btn-faded", hit);
        }
    }

    _updateBonusButton() {
        if (this.rowDragActive) {
            this.els.bonusBtn.classList.remove("hidden");
            this.els.bonusBtn.textContent = "Cancel Line";
            this.els.bonusBtn.title = "Cancel line clear bonus";
            this.els.bonusBtn.disabled = false;
            return;
        }
        const canUseBonus = Boolean(this.availableBonusType);
        const bonusMeta = canUseBonus ? BONUS_METADATA[this.availableBonusType] : null;
        this.els.bonusBtn.classList.toggle("hidden", !canUseBonus);
        this.els.bonusBtn.textContent = bonusMeta?.buttonLabel || "Bonus!";
        this.els.bonusBtn.title = bonusMeta?.buttonTitle || "Use Bonus";
        this.els.bonusBtn.disabled = !this.block || this.letterChoiceActive;
        this._updateRadialMenu();
    }

    // ── Radial bonus slot menu ──

    _toggleRadialMenu() {
        this._radialOpen = !this._radialOpen;
        this.els.radialMenu.classList.toggle("open", this._radialOpen);
        if (this._radialOpen) this._updateRadialSlots();
    }

    _closeRadialMenu() {
        this._radialOpen = false;
        this.els.radialMenu.classList.remove("open");
    }

    _updateRadialMenu() {
        const maxSlots = this.profileMgr.getMaxBonusSlots();
        // Show radial only during gameplay and if player has slots
        const inGame = this.state === State.PLAYING || this.state === State.PAUSED;
        this.els.radialMenu.classList.toggle("hidden", !inGame || maxSlots === 0);
        if (inGame && maxSlots > 0) this._updateRadialSlots();
    }

    _updateRadialSlots() {
        const maxSlots = this.profileMgr.getMaxBonusSlots();
        const contents = this.profileMgr.getBonusSlotContents();
        const bonusIcons = {
            [BONUS_TYPES.LETTER_PICK]: "🔤",
            [BONUS_TYPES.BOMB]: "💣",
            [BONUS_TYPES.WILDCARD]: "⭐",
            [BONUS_TYPES.ROW_CLEAR]: "─",
            [BONUS_TYPES.FREEZE]: "❄️",
            [BONUS_TYPES.SHUFFLE]: "⇄",
            [BONUS_TYPES.SCORE_2X]: "2×",
        };
        const blockIndependent = [BONUS_TYPES.SCORE_2X, BONUS_TYPES.FREEZE, BONUS_TYPES.SHUFFLE];
        const baseCanUse = !this.letterChoiceActive && !this.availableBonusType && !this.rowDragActive;

        this.els.radialSlots.querySelectorAll(".radial-slot").forEach(btn => {
            const idx = parseInt(btn.dataset.slot, 10);
            const purchased = idx < maxSlots;
            const filled = contents[idx];
            const canUseSlot = baseCanUse && (this.block || blockIndependent.includes(filled));

            btn.classList.toggle("slot-hidden", !purchased);
            btn.classList.toggle("slot-empty", purchased && !filled);
            btn.classList.toggle("slot-filled", purchased && !!filled);
            btn.textContent = filled ? (bonusIcons[filled] || "?") : "○";
            btn.disabled = !purchased || !filled || !canUseSlot;
            btn.title = filled ? (BONUS_METADATA[filled]?.buttonLabel || filled) : (purchased ? "Empty slot" : "Locked");
        });
    }

    _useRadialSlot(slotIdx) {
        if (this.availableBonusType || this.letterChoiceActive || this.rowDragActive || this.clearing) return;
        // Peek at what bonus is in this slot to check if a block is needed
        const contents = this.profileMgr.getBonusSlotContents();
        const peekType = contents[slotIdx];
        const needsBlock = [BONUS_TYPES.BOMB, BONUS_TYPES.WILDCARD, BONUS_TYPES.LETTER_PICK, BONUS_TYPES.ROW_CLEAR].includes(peekType);
        if (needsBlock && !this.block) return;
        const bonusType = this.profileMgr.useBonusSlot(slotIdx);
        if (!bonusType) return;
        console.log(`[SLOT] Used radial slot ${slotIdx} → bonus type: "${bonusType}"`);
        this._closeRadialMenu();
        this.availableBonusType = bonusType;
        this._bonusFromSlot = true;
        this._updateBonusButton();
        this._openLetterChoiceModal();
    }

    // ── Save / Resume game state ──

    _saveKey(challengeType) {
        const profile = this.profileMgr.getActive();
        if (!profile) return null;
        const ct = challengeType !== undefined ? challengeType : this.activeChallenge;
        return ct ? `wf_savedgame_${profile.id}_${ct}` : `wf_savedgame_${profile.id}`;
    }

    _saveGameState() {
        const key = this._saveKey();
        if (!key || !this.grid || this.state === State.GAMEOVER || this.state === State.MENU) return;
        const state = {
            version: 2,
            gridSize: this.gridSize,
            difficulty: this.difficulty,
            gameMode: this._getSelectedGameMode(),
            timeLimitSeconds: this.timeLimitSeconds,
            timeRemainingSeconds: this.timeRemainingSeconds,
            cells: this.grid.cells,
            score: this.score,
            nextLetter: this.nextLetter,
            wordsFound: this.wordsFound || [],
            bonusAvailable: Boolean(this.availableBonusType),
            availableBonusType: this.availableBonusType,
            bonusBag: this.bonusBag,
            lastAwardedBonusType: this.lastAwardedBonusType,
            nextBonusScore: this.nextBonusScore,
            bonusHistory: this._bonusHistory || [],
            fullBonusHistory: this._fullBonusHistory || [],
            bonusUsageCounts: this._bonusUsageCounts || {},
            block: this.block ? { letter: this.block.letter, col: this.block.col, row: this.block.row, kind: this.block.kind } : null,
            fallInterval: this.fallInterval,
            scoreMultiplier: this.scoreMultiplier || 1,
            freezeActive: this.freezeActive || false,
            freezeTimeRemaining: this.freezeTimeRemaining || 0,
            activeChallenge: this.activeChallenge || null,
            targetWord: this.targetWord || null,
            targetWordsCompleted: this.targetWordsCompleted || 0,
            activeCategoryKey: this.activeCategoryKey || null,
            categoryWordsFound: this.categoryWordsFound || [],
        };
        localStorage.setItem(key, JSON.stringify(state));
    }

    _loadGameState(challengeType) {
        const key = this._saveKey(challengeType);
        if (!key) return null;
        try {
            const data = JSON.parse(localStorage.getItem(key) || "null");
            if (data && (data.version === 1 || data.version === 2 || data.version === 3)) return data;
        } catch {}
        return null;
    }

    _clearGameState() {
        const key = this._saveKey();
        if (key) localStorage.removeItem(key);
    }

    _hasSavedGame(challengeType) {
        return this._loadGameState(challengeType) !== null;
    }

    _autoplayMusicFromUserAction() {
        if (this.music.playing) return;
        // Respect the user's manual pause — don't auto-start if they paused
        if (localStorage.getItem("wf_music_paused") === "1") return;
        if (this.music.queue.length === 0) {
            this.music.refreshQueue();
        }
        if (this.music.queue.length > 0) {
            this.music.play();
        }
    }

    _checkBonusUnlock(prevScore, newScore) {
        if (this.availableBonusType) return;
        if (prevScore < this.nextBonusScore && newScore >= this.nextBonusScore) {
            if (!this._bonusHistory) this._bonusHistory = [];
            if (!this._fullBonusHistory) this._fullBonusHistory = [];
            if (!this._bonusUsageCounts) this._bonusUsageCounts = {};

            // Calculate board fill ratio for context-aware randomization
            let filledCells = 0;
            const totalCells = this.grid.rows * this.grid.cols;
            for (let r = 0; r < this.grid.rows; r++) {
                for (let c = 0; c < this.grid.cols; c++) {
                    if (this.grid.get(r, c) !== null) filledCells++;
                }
            }

            const gameContext = {
                boardFillRatio: totalCells > 0 ? filledCells / totalCells : 0,
                freezeActive: this.freezeActive,
                score: this.score,
                fullBonusHistory: this._fullBonusHistory,
                bonusUsageCounts: this._bonusUsageCounts,
            };

            const draw = drawRandomBonusType(this.bonusBag, this.lastAwardedBonusType, this._bonusHistory, gameContext);
            let bonusType = draw.bonusType;

            // Lucky Draw perk: force first bonus to be bomb, wild, or score2x
            if (this._activePerks && this._activePerks.luckydraw) {
                const luckyPool = [BONUS_TYPES.BOMB, BONUS_TYPES.WILDCARD, BONUS_TYPES.SCORE_2X];
                bonusType = luckyPool[Math.floor(Math.random() * luckyPool.length)];
                this._activePerks.luckydraw = false; // consume on first use
            }

            this.availableBonusType = bonusType;
            this._bonusFromSlot = false;
            this.bonusBag = draw.nextBag;
            this._bonusHistory = draw.nextHistory;
            this._fullBonusHistory.push(draw.bonusType);
            this.lastAwardedBonusType = draw.bonusType;
            this._updateBonusButton();
            const bonusMeta = BONUS_METADATA[this.availableBonusType];
            this._showBonusPopup(bonusMeta.previewSymbol || "◇", bonusMeta.buttonLabel || "Bonus!");
        }
    }

    _showBonusPopup(icon, label) {
        const overlay = document.getElementById("bonus-popup-overlay");
        const card = document.getElementById("bonus-popup-card");
        const iconEl = document.getElementById("bonus-popup-icon");
        const labelEl = document.getElementById("bonus-popup-label");

        iconEl.textContent = icon;
        labelEl.textContent = label;
        card.classList.remove("dust-out");
        overlay.classList.remove("hidden");

        // GSAP-powered bonus unlock: card entrance → dust implosion → button pulse
        bonusUnlockSequence(card, this.els.bonusBtn, overlay, 1000);

        // PixiJS: sparkle burst at bonus button location
        const btnRect = this.els.bonusBtn.getBoundingClientRect();
        const canvasRect = this.canvas.getBoundingClientRect();
        pixiSparkleBurst(btnRect.left - canvasRect.left + btnRect.width / 2, btnRect.top - canvasRect.top + btnRect.height / 2, 12);

        // Matter.js: dust implosion physics toward button
        const cardRect = card.getBoundingClientRect();
        spawnDustImplosion(
            cardRect.left - canvasRect.left + cardRect.width / 2,
            cardRect.top - canvasRect.top + cardRect.height / 2,
            btnRect.left - canvasRect.left + btnRect.width / 2,
            btnRect.top - canvasRect.top + btnRect.height / 2,
            10
        );

        // Kaboom: emit event for bonus unlock tracking
        kEmit('bonusUnlock', { type: this.availableBonusType });
    }

    _openLetterChoiceModal() {
        const needsBlock = [BONUS_TYPES.BOMB, BONUS_TYPES.WILDCARD, BONUS_TYPES.LETTER_PICK, BONUS_TYPES.ROW_CLEAR].includes(this.availableBonusType);
        if (!this.availableBonusType || (needsBlock && !this.block) || this.clearing || this.letterChoiceActive) {
            console.warn(`[BONUS-MODAL] Cannot open: avail=${this.availableBonusType}, block=${!!this.block}, clearing=${this.clearing}, letterChoice=${this.letterChoiceActive}`);
            return;
        }
        console.log(`[BONUS-MODAL] Opening for type: "${this.availableBonusType}" (fromSlot=${!!this._bonusFromSlot})`);

        this.letterChoiceResumeState = this.state;
        this.letterChoiceActive = true;
        this.state = State.PAUSED;
        this._renderBonusModal();
        this.els.letterChoiceModal.classList.add("active");
        this._updateBonusButton();
    }

    _renderBonusModal() {
        const bonusMeta = BONUS_METADATA[this.availableBonusType] || BONUS_METADATA[BONUS_TYPES.LETTER_PICK];
        const showLetterGrid = this.availableBonusType === BONUS_TYPES.LETTER_PICK;

        this.els.letterChoiceTitle.textContent = bonusMeta.modalTitle;
        this.els.letterChoiceText.textContent = bonusMeta.modalText;
        this.els.letterChoiceGrid.classList.toggle("hidden", !showLetterGrid);
        this.els.letterChoicePreview.classList.toggle("hidden", showLetterGrid);
        this.els.letterChoiceAcceptBtn.classList.toggle("hidden", showLetterGrid);
        this.els.letterChoiceAcceptBtn.textContent = bonusMeta.acceptLabel || "Accept";
        this.els.letterChoicePreview.textContent = bonusMeta.previewSymbol || "";
        this.els.letterChoicePreview.dataset.bonusType = this.availableBonusType || "";
    }

    _closeLetterChoiceModal(consumeBonus) {
        if (!this.letterChoiceActive) return;

        this.letterChoiceActive = false;
        this.els.letterChoiceModal.classList.remove("active");
        if (consumeBonus) {
            console.log(`[BONUS-MODAL] Closing & consuming: "${this.availableBonusType}" (fromSlot=${!!this._bonusFromSlot})`);
            this.availableBonusType = null;
            // Only advance next-bonus threshold for score-earned bonuses, not slot-sourced
            if (!this._bonusFromSlot) {
                this.nextBonusScore = this.score + BONUS_UNLOCK_SCORE_INTERVAL;
            }
            this._bonusFromSlot = false;
        }
        this.state = this.letterChoiceResumeState === State.PAUSED ? State.PAUSED : State.PLAYING;
        this.letterChoiceResumeState = null;
        this._updateBonusButton();
    }

    _acceptActiveBonus() {
        if (!this.letterChoiceActive) {
            console.warn(`[BONUS-ACCEPT] Cannot accept: letterChoice=${this.letterChoiceActive}`);
            return;
        }
        const type = this.availableBonusType;
        // Some bonuses (SCORE_2X, FREEZE, SHUFFLE) don't require a live block
        const needsBlock = [BONUS_TYPES.BOMB, BONUS_TYPES.WILDCARD, BONUS_TYPES.LETTER_PICK, BONUS_TYPES.ROW_CLEAR].includes(type);
        if (needsBlock && !this.block) {
            console.warn(`[BONUS-ACCEPT] Cannot accept "${type}": no block in play`);
            return;
        }
        console.log(`[BONUS-ACCEPT] Activating type: "${type}"`);
        // Track usage counts for advanced randomizer
        if (!this._bonusUsageCounts) this._bonusUsageCounts = {};
        this._bonusUsageCounts[type] = (this._bonusUsageCounts[type] || 0) + 1;
        if (type === BONUS_TYPES.BOMB) {
            this.block.kind = "bomb";
            this.block.letter = BOMB_SYMBOL;
            this._closeLetterChoiceModal(true);
        } else if (type === BONUS_TYPES.WILDCARD) {
            this.block.kind = "wildcard";
            this.block.letter = WILDCARD_SYMBOL;
            console.log(`[BONUS-ACCEPT] Wildcard applied → block.kind="${this.block.kind}", block.letter="${this.block.letter}"`);
            this._closeLetterChoiceModal(true);
        } else if (type === BONUS_TYPES.ROW_CLEAR) {
            this._startRowDragMode();
            this._closeLetterChoiceModal(false);
        } else if (type === BONUS_TYPES.FREEZE) {
            this.freezeActive = true;
            this.freezeTimeRemaining = FREEZE_DURATION;
            this.els.freezeIndicator.classList.remove("hidden");
            this.els.freezeTimer.textContent = Math.ceil(this.freezeTimeRemaining);
            // Award base points for using freeze
            const prevScore = this.score;
            this.score += (this.gameMode === GAME_MODES.SANDBOX) ? Math.floor(50 * SANDBOX_SCORE_MULT) : 50;
            this._checkBonusUnlock(prevScore, this.score);
            this._updateScoreDisplay();
            this._closeLetterChoiceModal(true);
        } else if (type === BONUS_TYPES.SHUFFLE) {
            this._executeShuffle();
            this._closeLetterChoiceModal(true);
        } else if (type === BONUS_TYPES.SCORE_2X) {
            this.scoreMultiplier = 2;
            this.els.score2xIndicator.classList.remove("hidden");
            console.log(`[BONUS-ACCEPT] Score 2× activated → scoreMultiplier=${this.scoreMultiplier}`);
            this._closeLetterChoiceModal(true);
        }
    }

    _applyLetterChoice(letter) {
        if (!this.block || !this.letterChoiceActive || this.availableBonusType !== BONUS_TYPES.LETTER_PICK) return;
        this.block.letter = letter;
        this.block.kind = "letter";
        this._closeLetterChoiceModal(true);
    }

    _executeRowClear() {
        // Find the bottom-most row that has at least one letter
        let targetRow = -1;
        for (let r = this.grid.rows - 1; r >= 0; r--) {
            for (let c = 0; c < this.grid.cols; c++) {
                if (this.grid.get(r, c) !== null) {
                    targetRow = r;
                    break;
                }
            }
            if (targetRow >= 0) break;
        }
        if (targetRow < 0) return; // grid is empty, nothing to clear

        const cellsToClear = new Set();
        for (let c = 0; c < this.grid.cols; c++) {
            if (this.grid.get(targetRow, c) !== null) {
                cellsToClear.add(`${targetRow},${c}`);
            }
        }

        this.clearing = true;
        this.clearPhase = "flash";
        this.clearTimer = 0;
        this.clearFlashDuration = STANDARD_CLEAR_FLASH_DURATION;
        this.pendingClearMode = "words";
        this.renderer.flashCells = new Set(cellsToClear);
        this.renderer.blastCells.clear();
        this.renderer.blastCenterKey = null;
        this.renderer.blastProgress = 0;
        this.renderer.spawnParticles(cellsToClear);
        this._pendingClearCells = cellsToClear;
    }

    _startRowDragMode() {
        this.rowDragActive = true;
        this._lineClearStart = null;
        this._lineClearEnd = null;
        this.renderer.rowDragCells.clear();
        this.els.rowDragIndicator.classList.remove("hidden");
        this.els.lineClearBtn.disabled = true;
        this._updateBonusButton();
    }

    _cancelRowDragMode() {
        this.rowDragActive = false;
        this._lineClearStart = null;
        this._lineClearEnd = null;
        this.renderer.rowDragCells.clear();
        this.els.rowDragIndicator.classList.add("hidden");
        this._updateBonusButton();
    }

    /** Reset selection only (Cancel button) — stays in line clear mode */
    _resetLineClearSelection() {
        this._lineClearStart = null;
        this._lineClearEnd = null;
        this.renderer.rowDragCells.clear();
        this.els.lineClearBtn.disabled = true;
    }

    _earlyUnfreeze() {
        if (!this.freezeActive) return;
        // Award bonus points based on remaining freeze time (more time left = more points)
        // Up to 10 pts per second remaining
        let bonusPts = Math.floor(this.freezeTimeRemaining * 10);
        if (this.gameMode === GAME_MODES.SANDBOX) bonusPts = Math.floor(bonusPts * SANDBOX_SCORE_MULT);
        if (bonusPts > 0) {
            const prevScore = this.score;
            this.score += bonusPts;
            this._checkBonusUnlock(prevScore, this.score);
            this._updateScoreDisplay();
            this._showWordPopup([{ word: "❄️ UNFREEZE", pts: bonusPts, isBonus: true }]);
        }
        this.freezeActive = false;
        this.freezeTimeRemaining = 0;
        this.els.freezeIndicator.classList.add("hidden");
    }

    _clientToGridCell(clientX, clientY) {
        const rect = this.renderer.canvas.getBoundingClientRect();
        const scaleX = this.renderer.canvas.width / (window.devicePixelRatio || 1) / rect.width;
        const scaleY = this.renderer.canvas.height / (window.devicePixelRatio || 1) / rect.height;
        const px = (clientX - rect.left) * scaleX;
        const py = (clientY - rect.top) * scaleY;
        return this.renderer.pixelToCell(px, py);
    }

    _handleLineClearTap(clientX, clientY) {
        if (!this.rowDragActive || !this.grid) return;
        const { row, col } = this._clientToGridCell(clientX, clientY);
        if (row < 0 || row >= this.grid.rows || col < 0 || col >= this.grid.cols) return;
        if (this.grid.get(row, col) === null) return; // must tap a letter

        if (!this._lineClearStart) {
            // First tap — set start
            this._lineClearStart = { row, col };
            this._lineClearEnd = null;
            this._updateLineClearHighlight();
            return;
        }

        // Second+ tap — check if it forms a valid line with start
        const s = this._lineClearStart;
        const dr = row - s.row;
        const dc = col - s.col;

        // Same cell as start — toggle off (reset to just start)
        if (dr === 0 && dc === 0) {
            this._lineClearEnd = null;
            this._updateLineClearHighlight();
            return;
        }

        // Check valid direction: horizontal (dr==0), vertical (dc==0), diagonal (|dr|==|dc|)
        const isHorizontal = dr === 0;
        const isVertical = dc === 0;
        const isDiagonal = Math.abs(dr) === Math.abs(dc);

        if (!isHorizontal && !isVertical && !isDiagonal) return; // invalid direction, ignore

        this._lineClearEnd = { row, col };
        this._updateLineClearHighlight();
    }

    _updateLineClearHighlight() {
        this.renderer.rowDragCells.clear();

        if (!this._lineClearStart) {
            this.els.lineClearBtn.disabled = true;
            return;
        }

        const s = this._lineClearStart;

        if (!this._lineClearEnd) {
            // Only start selected
            this.renderer.rowDragCells.add(`${s.row},${s.col}`);
            this.els.lineClearBtn.disabled = false; // can clear even 1 letter
            return;
        }

        const e = this._lineClearEnd;
        const dr = Math.sign(e.row - s.row);
        const dc = Math.sign(e.col - s.col);
        const steps = Math.max(Math.abs(e.row - s.row), Math.abs(e.col - s.col));

        for (let i = 0; i <= steps; i++) {
            const r = s.row + dr * i;
            const c = s.col + dc * i;
            if (this.grid.get(r, c) !== null) {
                this.renderer.rowDragCells.add(`${r},${c}`);
            }
        }

        this.els.lineClearBtn.disabled = false;
    }

    _completeLineClear() {
        if (!this.rowDragActive || this.renderer.rowDragCells.size === 0) return;

        const cellsToClear = new Set(this.renderer.rowDragCells);
        const cellCount = cellsToClear.size;

        // End line clear mode
        this.rowDragActive = false;
        this._lineClearStart = null;
        this._lineClearEnd = null;
        this.renderer.rowDragCells.clear();
        this.els.rowDragIndicator.classList.add("hidden");

        // Consume the bonus
        this.availableBonusType = null;
        this.nextBonusScore = this.score + BONUS_UNLOCK_SCORE_INTERVAL;
        this._updateBonusButton();

        // Award points (20 pts per letter cleared)
        if (cellCount > 0) {
            const prevScore = this.score;
            const linePts = (this.gameMode === GAME_MODES.SANDBOX) ? Math.floor(cellCount * 20 * SANDBOX_SCORE_MULT) : cellCount * 20;
            this.score += linePts;
            this._checkBonusUnlock(prevScore, this.score);
            this._updateScoreDisplay();
            this._showWordPopup([{ word: "LINE", pts: linePts, isBonus: true }]);
        }

        // Execute the clear animation
        this._executeLineClear(cellsToClear);
    }

    _executeLineClear(cellsToClear) {
        if (cellsToClear.size === 0) return;

        this.clearing = true;
        this.clearPhase = "flash";
        this.clearTimer = 0;
        this.clearFlashDuration = STANDARD_CLEAR_FLASH_DURATION;
        this.pendingClearMode = "words";
        this.renderer.flashCells = new Set(cellsToClear);
        this.renderer.blastCells.clear();
        this.renderer.blastCenterKey = null;
        this.renderer.blastProgress = 0;
        this.renderer.spawnParticles(cellsToClear);
        this._pendingClearCells = cellsToClear;
    }

    _executeShuffle() {
        // Collect all letters and their current positions
        const entries = [];
        for (let r = 0; r < this.grid.rows; r++) {
            for (let c = 0; c < this.grid.cols; c++) {
                const letter = this.grid.get(r, c);
                if (letter !== null) entries.push({ letter, fromRow: r, fromCol: c });
            }
        }
        if (entries.length === 0) return;

        // Advanced randomization: multiple Fisher-Yates passes for thorough mixing
        const letters = entries.map(e => e.letter);
        for (let pass = 0; pass < 3; pass++) {
            for (let i = letters.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [letters[i], letters[j]] = [letters[j], letters[i]];
            }
        }

        // Distribute letters randomly across columns with gravity
        // Randomize column assignment order so letters don't fill left-to-right
        const cols = this.grid.cols;
        const rows = this.grid.rows;
        const colFill = new Array(cols).fill(0); // how many letters stacked in each column

        // Assign each letter to a random column (weighted toward less-full columns)
        const assignments = [];
        for (let i = 0; i < letters.length; i++) {
            // Build list of columns that still have space
            const available = [];
            for (let c = 0; c < cols; c++) {
                if (colFill[c] < rows) available.push(c);
            }
            // Pick a random available column
            const col = available[Math.floor(Math.random() * available.length)];
            const row = rows - 1 - colFill[col];
            colFill[col]++;
            assignments.push({ letter: letters[i], toRow: row, toCol: col });
        }

        // Clear grid and place shuffled letters
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                this.grid.cells[r][c] = null;
            }
        }
        for (const a of assignments) {
            this.grid.cells[a.toRow][a.toCol] = a.letter;
        }

        // Build animation data — each letter flies from old position to new position
        this._shuffleAnims = [];
        for (let i = 0; i < entries.length; i++) {
            this._shuffleAnims.push({
                letter: assignments[i].letter,
                fromRow: entries[i].fromRow,
                fromCol: entries[i].fromCol,
                toRow: assignments[i].toRow,
                toCol: assignments[i].toCol,
                progress: 0,
                delay: Math.random() * 0.15, // stagger starts slightly
            });
        }
        this._shuffleAnimActive = true;
        this._shuffleAnimTimer = 0;

        this._validatedWordGroups = [];
        this._rebuildValidatedCells();
        this._computeHintCells();
    }

    _updateShuffleAnim(dt) {
        if (!this._shuffleAnimActive) return;
        this._shuffleAnimTimer += dt;
        const duration = 0.55; // seconds for the flight
        let allDone = true;
        for (const a of this._shuffleAnims) {
            const elapsed = this._shuffleAnimTimer - a.delay;
            if (elapsed <= 0) { allDone = false; continue; }
            a.progress = Math.min(1, elapsed / duration);
            if (a.progress < 1) allDone = false;
        }
        this.renderer.shuffleAnims = this._shuffleAnims;
        if (allDone) {
            this._shuffleAnimActive = false;
            this._shuffleAnims = [];
            this.renderer.shuffleAnims = [];
        }
    }

    _resumeGame() {
        const saved = this._loadGameState(null);
        if (!saved) { this._startGame(); return; }

        this.gridSize = saved.gridSize;
        this.difficulty = saved.difficulty || this.profileMgr.getActive()?.difficulty || "casual";
        if (this.difficulty === "challenging") this.difficulty = "hard";
        this.gameMode = saved.gameMode || this.profileMgr.getActive()?.gameMode || GAME_MODES.SANDBOX;
        this.grid = new Grid(this.gridSize, this.gridSize);
        this.grid.cells = saved.cells;
        this.score = saved.score;
        this.timeLimitSeconds = saved.timeLimitSeconds || 0;
        this.timeRemainingSeconds = saved.timeRemainingSeconds || 0;
        this.nextLetter = saved.nextLetter;
        this.wordsFound = saved.wordsFound || [];
        this.foundWordsThisGame = new Set(this.wordsFound.map(({ word }) => word));
        this.availableBonusType = saved.availableBonusType || (saved.bonusAvailable ? BONUS_TYPES.LETTER_PICK : null);
        this.bonusBag = Array.isArray(saved.bonusBag) ? saved.bonusBag.filter(type => BONUS_TYPE_POOL.includes(type)) : [];
        this.lastAwardedBonusType = BONUS_TYPE_POOL.includes(saved.lastAwardedBonusType) ? saved.lastAwardedBonusType : this.availableBonusType;
        this.nextBonusScore = saved.nextBonusScore || BONUS_UNLOCK_SCORE_INTERVAL;
        this._bonusHistory = saved.bonusHistory || [];
        this._fullBonusHistory = saved.fullBonusHistory || [];
        this._bonusUsageCounts = saved.bonusUsageCounts || {};
        this.letterChoiceActive = false;
        this.letterChoiceResumeState = null;
        this.fallInterval = saved.fallInterval || (this.difficulty === "casual" ? 1.5 : 0.9);
        this.scoreMultiplier = saved.scoreMultiplier || 1;
        this.freezeActive = saved.freezeActive || false;
        this.freezeTimeRemaining = saved.freezeTimeRemaining || 0;
        this.clearing = false;
        this.clearPhase = "";
        this.totalWordsInChain = 0;
        this.totalLettersInChain = 0;
        this._chainWords = [];
        this._wordPopupActive = false;
        this._wordPopupCount = 0;
        this.els.wordPopup.innerHTML = "";
        this.clearFlashDuration = STANDARD_CLEAR_FLASH_DURATION;
        this.pendingClearMode = "";
        this.renderer.flashCells.clear();
        this.renderer.blastCells.clear();
        this.renderer.blastCenterKey = null;
        this.renderer.blastProgress = 0;
        this.renderer.particles = [];
        this.renderer.gravityAnims = [];
        this.renderer.hintCells = new Set();
        this._activeHintKey = null;
        this.pendingGravityMoves = [];
        this._validatedWordGroups = [];
        this._claimAnimating = false;
        this.renderer.validatedCells = new Set();
        this.comboCount = 0;
        this.bestCombo = 0;
        this.comboTimer = 0;
        this._totalWordsThisGame = 0;
        this._difficultyLevel = 1;
        this.activeChallenge = null;
        this._updateScoreDisplay();
        this._updateHighScoreDisplay();
        this._highlightSizeButton();
        this._highlightGameModeButton();
        this._highlightDifficultyButton();
        this._updateDifficultySelector();
        this._updateTimerDisplay();
        this._showScreen("play");
        this.state = State.PLAYING;

        // Restore bonus indicators
        this.els.score2xIndicator.classList.toggle("hidden", this.scoreMultiplier <= 1);
        this.els.freezeIndicator.classList.toggle("hidden", !this.freezeActive);

        // Apply equipped theme on resume
        const eqResume = this.profileMgr.getEquipped();
        this.renderer.setTheme(eqResume.gridTheme);
        this.renderer.setBlockStyle(eqResume.blockStyle);

        this._autoplayMusicFromUserAction();

        requestAnimationFrame(() => {
            this.renderer.resize(this.gridSize, this.gridSize);
            // Restore falling block or spawn a new one
            if (saved.block) {
                this.block = new FallingBlock(saved.block.letter, saved.block.col, this.gridSize, saved.block.kind || "letter");
                const savedRow = typeof saved.block.row === "number" ? saved.block.row : -1;
                this.block.row = savedRow;
                this.block.visualRow = savedRow;
            } else {
                this._spawnBlock();
            }
            this.els.nextLetter.textContent = this.nextLetter;
            this._updateBonusButton();
        });
    }

    _resumeChallengeGame() {
        if (!this.activeChallenge) return;
        const saved = this._loadGameState(this.activeChallenge);
        if (!saved) { this._startChallengeGame(); return; }

        // Word Search uses its own resume flow
        if (saved.type === "word-search") {
            this._clearGameState();
            this._wsResumeFromSave(saved);
            return;
        }

        // Word Runner uses its own resume flow
        if (saved.type === "word-runner") {
            this._clearGameState();
            this._wrResumeFromSave(saved);
            return;
        }

        this.gridSize = saved.gridSize;
        this.difficulty = saved.difficulty || "casual";
        if (this.difficulty === "challenging") this.difficulty = "hard";
        this.grid = new Grid(this.gridSize, this.gridSize);
        this.grid.cells = saved.cells;
        this.score = saved.score;
        this.timeLimitSeconds = saved.timeLimitSeconds || 0;
        this.timeRemainingSeconds = saved.timeRemainingSeconds || 0;
        this.nextLetter = saved.nextLetter;
        this.wordsFound = saved.wordsFound || [];
        this.foundWordsThisGame = new Set(this.wordsFound.map(({ word }) => word));
        this.availableBonusType = saved.availableBonusType || null;
        this.bonusBag = Array.isArray(saved.bonusBag) ? saved.bonusBag.filter(type => BONUS_TYPE_POOL.includes(type)) : [];
        this.lastAwardedBonusType = BONUS_TYPE_POOL.includes(saved.lastAwardedBonusType) ? saved.lastAwardedBonusType : this.availableBonusType;
        this.nextBonusScore = saved.nextBonusScore || BONUS_UNLOCK_SCORE_INTERVAL;
        this._bonusHistory = saved.bonusHistory || [];
        this._fullBonusHistory = saved.fullBonusHistory || [];
        this._bonusUsageCounts = saved.bonusUsageCounts || {};
        this.letterChoiceActive = false;
        this.letterChoiceResumeState = null;
        this.fallInterval = saved.fallInterval || (this.difficulty === "casual" ? 1.5 : 0.9);
        this.clearing = false;
        this.clearPhase = "";
        this.totalWordsInChain = 0;
        this.totalLettersInChain = 0;
        this._chainWords = [];
        this._wordPopupActive = false;
        this._wordPopupCount = 0;
        this.els.wordPopup.innerHTML = "";
        this.clearFlashDuration = STANDARD_CLEAR_FLASH_DURATION;
        this.pendingClearMode = "";
        this.renderer.flashCells.clear();
        this.renderer.blastCells.clear();
        this.renderer.blastCenterKey = null;
        this.renderer.blastProgress = 0;
        this.renderer.particles = [];
        this.renderer.gravityAnims = [];
        this.renderer.hintCells = new Set();
        this._activeHintKey = null;
        this.pendingGravityMoves = [];
        this._validatedWordGroups = [];
        this._claimAnimating = false;
        this.renderer.validatedCells = new Set();
        this.comboCount = 0;
        this.bestCombo = 0;
        this.comboTimer = 0;
        this._totalWordsThisGame = 0;
        this._difficultyLevel = 1;

        // Reset bonus state
        this.freezeActive = false;
        this.freezeTimeRemaining = 0;
        this.scoreMultiplier = 1;
        this.rowDragActive = false;
        this._lineClearStart = null;
        this._lineClearEnd = null;
        this.renderer.rowDragCells.clear();
        this.els.freezeIndicator.classList.add("hidden");
        this.els.score2xIndicator.classList.add("hidden");
        this.els.rowDragIndicator.classList.add("hidden");

        // Restore challenge-specific state
        if (this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD) {
            this.targetWord = saved.targetWord || null;
            this.targetWordsCompleted = saved.targetWordsCompleted || 0;
            this._targetWordLevel = this.profileMgr.getTargetWordLevel();
            if (this.targetWord) {
                this.els.targetWordDisplay.classList.remove("hidden");
                this.els.targetWordText.textContent = this.targetWord;
                this._updateTargetLevelDisplay();
            }
        } else if (this.activeChallenge === CHALLENGE_TYPES.SPEED_ROUND) {
            this.fallInterval = Math.min(this.fallInterval, 0.9);
            this.speedRoundBaseInterval = 0.9;
            this.els.targetWordDisplay.classList.add("hidden");
        } else if (this.activeChallenge === CHALLENGE_TYPES.WORD_CATEGORY) {
            this.activeCategoryKey = saved.activeCategoryKey || null;
            this.categoryWordsFound = saved.categoryWordsFound || [];
            if (this.activeCategoryKey && WORD_CATEGORIES[this.activeCategoryKey]) {
                this.activeCategorySet = WORD_CATEGORIES[this.activeCategoryKey].words;
                const cat = WORD_CATEGORIES[this.activeCategoryKey];
                this.els.targetWordDisplay.classList.remove("hidden");
                this.els.targetWordDisplay.querySelector(".target-label").textContent = "CATEGORY:";
                this.els.targetWordText.textContent = `${cat.icon} ${cat.label}`;
            }
        }

        this._updateScoreDisplay();
        this._updateTimerDisplay();
        this._showScreen("play");
        this.state = State.PLAYING;

        // Apply equipped theme on challenge resume
        const eqChal = this.profileMgr.getEquipped();
        this.renderer.setTheme(eqChal.gridTheme);
        this.renderer.setBlockStyle(eqChal.blockStyle);

        this._autoplayMusicFromUserAction();

        requestAnimationFrame(() => {
            this.renderer.resize(this.gridSize, this.gridSize);
            if (saved.block) {
                this.block = new FallingBlock(saved.block.letter, saved.block.col, this.gridSize, saved.block.kind || "letter");
                const savedRow = typeof saved.block.row === "number" ? saved.block.row : -1;
                this.block.row = savedRow;
                this.block.visualRow = savedRow;
            } else {
                this._spawnBlock();
            }
            this.els.nextLetter.textContent = this.nextLetter;
            this._updateBonusButton();
        });
    }

    // ── Game start / reset ──
    _startGame() {
        // Check if there's a saved game - if so, confirm before starting new
        if (this._hasSavedGame(null)) {
            this._openConfirmNewGameModal("main", null);
            return;
        }
        this._startGameDirect();
    }

    /** Direct start without saved game check (called after confirmation) */
    _startGameDirect() {
        this.activeChallenge = null;
        // Clean up any stale challenge tags
        delete this.els.restartBtn.dataset.challenge;
        delete this.els.restartBtn.dataset.categoryKey;
        // Only show time-select for regular timed grid games (not challenges or sandbox)
        if (this._getSelectedGameMode() === GAME_MODES.TIMED) {
            this._openTimeSelectModal();
            return;
        }
        this._maybeShowPerkSelect(0);
    }

    /** Check if player has perks; if so show selection modal, otherwise start immediately */
    _maybeShowPerkSelect(timeLimitSeconds) {
        this._pendingTimeLimitSeconds = timeLimitSeconds;
        this._chosenPerk = null;

        // Gather owned perks
        const ownedPerks = [];
        for (const [id, item] of Object.entries(SHOP_ITEMS)) {
            if (item.category === SHOP_CATEGORIES.STARTING_PERKS && this.profileMgr.getPerkCount(id) > 0) {
                ownedPerks.push({ id, ...item, count: this.profileMgr.getPerkCount(id) });
            }
        }

        if (ownedPerks.length === 0) {
            this._beginNewGame(timeLimitSeconds);
            return;
        }

        this._openPerkSelectModal(ownedPerks);
    }

    _openPerkSelectModal(ownedPerks) {
        const grid = this.els.perkSelectGrid;
        grid.innerHTML = "";
        for (const perk of ownedPerks) {
            const btn = document.createElement("button");
            btn.className = "perk-select-btn";
            btn.innerHTML = `<span class="perk-select-name">${perk.name}</span><span class="perk-select-desc">${perk.preview}</span><span class="perk-select-count">×${perk.count}</span>`;
            btn.addEventListener("click", () => {
                this._chosenPerk = perk.id;
                this._closePerkSelectModal();
                this._beginNewGame(this._pendingTimeLimitSeconds || 0);
            });
            grid.appendChild(btn);
        }
        this.els.perkSelectModal.classList.add("active");
    }

    _closePerkSelectModal() {
        this.els.perkSelectModal.classList.remove("active");
    }

    _beginNewGame(timeLimitSeconds = 0) {
        this.grid = new Grid(this.gridSize, this.gridSize);
        this.score = 0;
        this.timeLimitSeconds = timeLimitSeconds;
        this.timeRemainingSeconds = timeLimitSeconds;
        this.clearing = false;
        this.clearPhase = "";
        this.totalWordsInChain = 0;
        this.totalLettersInChain = 0;
        this._chainWords = [];
        this._wordPopupActive = false;
        this._wordPopupCount = 0;
        this.els.wordPopup.innerHTML = "";
        this.clearFlashDuration = STANDARD_CLEAR_FLASH_DURATION;
        this.pendingClearMode = "";
        this.renderer.flashCells.clear();
        this.renderer.blastCells.clear();
        this.renderer.blastCenterKey = null;
        this.renderer.blastProgress = 0;
        this.renderer.particles = [];
        this.renderer.gravityAnims = [];
        this.renderer.hintCells = new Set();
        this.renderer.validatedCells = new Set();
        this._activeHintKey = null;
        this.pendingGravityMoves = [];
        this.nextLetter = randomLetter();
        this.wordsFound = [];  // track all words found this round
        this.foundWordsThisGame = new Set();
        this.categoryWordsFound = [];  // track category words found this round
        this.availableBonusType = null;
        this.bonusBag = [];
        this.lastAwardedBonusType = null;
        this.nextBonusScore = BONUS_UNLOCK_SCORE_INTERVAL;
        this._bonusHistory = [];
        this._fullBonusHistory = [];
        this._bonusUsageCounts = {};
        this.letterChoiceActive = false;
        this.letterChoiceResumeState = null;

        // Reset bonus state
        this.freezeActive = false;
        this.freezeTimeRemaining = 0;
        this.scoreMultiplier = 1;
        this.rowDragActive = false;
        this._lineClearStart = null;
        this._lineClearEnd = null;
        this.renderer.rowDragCells.clear();
        this.els.freezeIndicator.classList.add("hidden");
        this.els.score2xIndicator.classList.add("hidden");
        this.els.rowDragIndicator.classList.add("hidden");

        // ── Reset combo / streak / difficulty (Preact-driven) ──
        this.comboCount = 0;
        this.bestCombo = 0;
        this.comboTimer = 0;
        this._totalWordsThisGame = 0;
        this._difficultyLevel = 1;
        this._baseFallInterval = this.difficulty === "casual" ? 1.5 : 0.9;

        // ── Coin tracking for this game ──
        this._coinsThisGame = 0;
        this._dailyInfo = this.profileMgr.recordDailyPlay();

        // ── Apply equipped theme ──
        const equipped = this.profileMgr.getEquipped();
        this.renderer.setTheme(equipped.gridTheme);
        this.renderer.setBlockStyle(equipped.blockStyle);

        // ── Apply chosen perk (only 1 per game) ──
        this._activePerks = {};
        const chosenPerk = this._chosenPerk;
        this._chosenPerk = null;

        if (chosenPerk && this.profileMgr.consumePerk(chosenPerk)) {
            switch (chosenPerk) {
                case "perk_headstart":
                    this.score = 200;
                    this._activePerks.headstart = true;
                    break;
                case "perk_slowstart":
                    this._activePerks.slowstart = 30;
                    break;
                case "perk_bonusboost":
                    this.nextBonusScore = 500;
                    this._activePerks.bonusboost = true;

                    break;
                case "perk_comboext":
                    this._activePerks.comboext = true;
                    break;
                case "perk_luckydraw":
                    this._activePerks.luckydraw = true;
                    break;
            }
        }

        // Sync daily streak + perk consumption to cloud (prevents data loss on crash)
        this._debouncedSyncProfileToCloud();

        // Reset challenge state (activeChallenge is set before calling this for challenges)
        this.targetWord = null;
        this.targetWordsCompleted = 0;
        this._validatedWordGroups = [];
        this._claimAnimating = false;
        this.els.targetWordDisplay.classList.add("hidden");

        this._updateScoreDisplay();
        this._updateTimerDisplay();
        this._updateHighScoreDisplay();
        this._updateLevelDisplay();
        this._showScreen("play");
        this.state = State.PLAYING;
        this.fallInterval = this._baseFallInterval;

        // Apply slow start perk (half speed for 30s)
        if (this._activePerks.slowstart) {
            this._slowStartTimeLeft = this._activePerks.slowstart;
            this.fallInterval *= 2; // double the interval = half speed
        } else {
            this._slowStartTimeLeft = 0;
        }

        // ── Sync full state to Preact store at game start ──
        const lvlInfo = this.profileMgr.getLevelInfo();
        gameStore.set({
            score: 0,
            highScore: this.highScore,
            gameState: State.PLAYING,
            comboCount: 0,
            bestCombo: 0,
            comboMultiplier: 1,
            comboActive: false,
            comboTimer: 0,
            difficultyLevel: 1,
            wordsFoundCount: 0,
            fallSpeed: this.fallInterval,
            scoreMultiplier: 1,
            freezeActive: false,
            freezeTimeRemaining: 0,
            isTimed: timeLimitSeconds > 0,
            timeRemaining: timeLimitSeconds,
            timeLimit: timeLimitSeconds,
            level: lvlInfo.level,
            xp: lvlInfo.xp,
            xpRequired: lvlInfo.xpRequired,
            profileName: this.profileMgr.getActive()?.username || '',
            activeChallenge: this.activeChallenge,
            isNewHighScore: false,
            finalScore: 0,
        });

        // Start or resume music from the player's start-game action.
        this._autoplayMusicFromUserAction();

        // Resize canvas
        requestAnimationFrame(() => {
            this.renderer.resize(this.gridSize, this.gridSize);
            this._spawnBlock();
        });
    }

    _spawnBlock() {
        const centerCol = Math.floor(this.gridSize / 2);
        this.block = new FallingBlock(this.nextLetter, centerCol, this.gridSize, "letter");
        const tw = this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD ? this.targetWord : null;
        this.nextLetter = randomLetter(this.grid, tw);
        this.els.nextLetter.textContent = this.nextLetter;
        this.fallTimer = 0;
        this.spawnFreezeTimer = this.activeChallenge === CHALLENGE_TYPES.SPEED_ROUND ? 0 : 2.0;
        this._updateBonusButton();
    }

    _moveBlock(dc) {
        if (!this.block || this._wordPopupActive) return;
        if (this.block.dropAnimating) return;
        const newCol = this.block.col + dc;
        if (newCol < 0 || newCol >= this.gridSize) return;
        // In buffer zone (row < 0) there are no obstacles
        if (this.block.row >= 0 && !this.grid.isEmpty(this.block.row, newCol)) return;
        this.block.col = newCol;
    }

    _fastDrop(animate = false) {
        if (!this.block || this._wordPopupActive) return;
        if (this.block.dropAnimating) return;
        // If the block is hovering over a full column, don't drop
        if (this.block.row < 0 && !this.grid.isEmpty(0, this.block.col)) return;
        // Start from row 0 if still in buffer
        let r = Math.max(0, this.block.row);
        while (r + 1 < this.gridSize && this.grid.isEmpty(r + 1, this.block.col)) {
            r++;
        }

        if (animate && r !== this.block.row) {
            this.block.row = r;
            this.block.dropAnimating = true;
            this.fallTimer = 0;
            return;
        }

        this.block.row = r;
        this.block.visualRow = r;
        this.block.dropAnimating = true; // flag for impact effect
        this._landBlock();
    }

    _landBlock() {
        if (!this.block) return;
        const wasFastDrop = this.block.dropAnimating;
        this.grid.set(this.block.row, this.block.col, this.block.letter);
        const landedRow = this.block.row;
        const landedCol = this.block.col;
        const landedKind = this.block.kind;
        if (landedKind === "wildcard") {
            console.log(`[WILDCARD] ★ landed at (${landedRow},${landedCol}) — grid cell now: "${this.grid.get(landedRow, landedCol)}"`);
        }
        this.block = null;
        this._updateBonusButton();
        this._saveGameState();

        if (landedKind === "bomb") {
            this.audio.bomb();
            this.renderer.triggerShake(6);
            this._triggerBombClear(landedRow, landedCol);
            return;
        }

        this._computeHintCells();
        if (wasFastDrop) {
            this.audio.land(true);
            this.renderer.triggerShake(1.5);
            this.renderer.triggerImpact(landedRow, landedCol);
        } else {
            this.audio.land(false);
        }

        // Start word detection chain
        this.totalWordsInChain = 0;
        this.totalLettersInChain = 0;
        this._chainWords = [];

        // Prune any stale validated groups before new detection
        this._pruneInvalidGroups();

        // Log state for diagnostics
        if (this._validatedWordGroups.length > 0) {
            console.log(`[WORD-VAL] Landing at (${landedRow},${landedCol})="${this.grid.get(landedRow, landedCol)}" — ${this._validatedWordGroups.length} existing groups:`,
                this._validatedWordGroups.map(g => `${g.word}@[${[...g.cells].join(";")}]`));
        }

        this._checkWords(landedRow, landedCol);

        // Re-scan through any wildcard cells on the grid — a new letter
        // anywhere may complete a word through an existing wildcard.
        this._rescanWildcardCells(landedRow, landedCol);
    }

    _triggerBombClear(row, col) {
        const cellsToClear = new Set();

        // Clear entire row (horizontal)
        for (let currentCol = 0; currentCol < this.grid.cols; currentCol++) {
            if (this.grid.get(row, currentCol) !== null) {
                cellsToClear.add(`${row},${currentCol}`);
            }
        }

        // Clear entire column (vertical)
        for (let currentRow = 0; currentRow < this.grid.rows; currentRow++) {
            if (this.grid.get(currentRow, col) !== null) {
                cellsToClear.add(`${currentRow},${col}`);
            }
        }

        // Clear diagonal (top-left to bottom-right)
        for (let offset = -Math.max(this.grid.rows, this.grid.cols); offset <= Math.max(this.grid.rows, this.grid.cols); offset++) {
            const diagRow = row + offset;
            const diagCol = col + offset;
            if (diagRow >= 0 && diagRow < this.grid.rows && diagCol >= 0 && diagCol < this.grid.cols) {
                if (this.grid.get(diagRow, diagCol) !== null) {
                    cellsToClear.add(`${diagRow},${diagCol}`);
                }
            }
        }

        // Clear diagonal (top-right to bottom-left)
        for (let offset = -Math.max(this.grid.rows, this.grid.cols); offset <= Math.max(this.grid.rows, this.grid.cols); offset++) {
            const diagRow = row + offset;
            const diagCol = col - offset;
            if (diagRow >= 0 && diagRow < this.grid.rows && diagCol >= 0 && diagCol < this.grid.cols) {
                if (this.grid.get(diagRow, diagCol) !== null) {
                    cellsToClear.add(`${diagRow},${diagCol}`);
                }
            }
        }

        // Award points for bomb blast (15 pts per letter cleared)
        if (cellsToClear.size > 0) {
            const prevScore = this.score;
            const bombPts = (this.gameMode === GAME_MODES.SANDBOX) ? Math.floor(cellsToClear.size * 15 * SANDBOX_SCORE_MULT) : cellsToClear.size * 15;
            this.score += bombPts;
            this._checkBonusUnlock(prevScore, this.score);
            this._updateScoreDisplay();
            this._showWordPopup([{ word: "💣 BOMB", pts: bombPts, isBonus: true }]);
        }

        this.renderer.hintCells = new Set();
        this._activeHintKey = null;

        this.renderer.triggerShake(8);
        this.clearing = true;
        this.clearPhase = "flash";
        this.clearTimer = 0;
        this.clearFlashDuration = BOMB_CLEAR_FLASH_DURATION;
        this.pendingClearMode = "bomb";
        this.renderer.flashCells = new Set(cellsToClear);
        this.renderer.blastCells = new Set(cellsToClear);
        this.renderer.blastCenterKey = `${row},${col}`;
        this.renderer.blastProgress = 0;
        this.renderer.spawnParticles(cellsToClear);
        this._pendingClearCells = cellsToClear;

        // Matter.js: bomb explosion shrapnel burst
        const blastCenter = this.renderer.cellCenter(row, col);
        if (blastCenter) {
            spawnExplosion(blastCenter.x, blastCenter.y, 25);
            spawnImpactRing(blastCenter.x, blastCenter.y, 2);
        }
        // PixiJS: sparkle burst at blast center
        if (blastCenter) {
            pixiSparkleBurst(blastCenter.x, blastCenter.y, 15);
        }
    }

    _checkWords(triggerRow, triggerCol) {
        // If triggerRow < 0, do a full-board scan (chain reaction)
        let result;
        if (triggerRow >= 0) {
            console.log(`[WORD-VAL] _checkWords LANDING at (${triggerRow},${triggerCol})`);
            result = this.grid.findWordsThrough(triggerRow, triggerCol, this._getMinWordLength());
        } else {
            console.log(`[WORD-VAL] _checkWords CHAIN SCAN (full board)`);
            result = this.grid.findAllWords(this._getMinWordLength());
        }
        console.log(`[WORD-VAL] _checkWords result: ${result.words.length} words [${result.words.join(", ")}]`);

        // Dump the grid when words are found for diagnostics
        if (result.words.length > 0) {
            const rows = [];
            for (let r = 0; r < this.grid.rows; r++) {
                const row = [];
                for (let c = 0; c < this.grid.cols; c++) {
                    row.push(this.grid.get(r, c) || ".");
                }
                rows.push(row.join(" "));
            }
            console.log(`[WORD-VAL] Grid state:\n${rows.join("\n")}`);
        }

        if (result.words.length === 0 && result.cells.size === 0) {
            // Word check already ran above and found nothing.
            // If the grid is now completely full, the last placed letter
            // didn't form any word — game over (unless validated words can be claimed).
            if (this.grid.isGridFull()) {
                if (this._validatedWordGroups.length > 0) {
                    // Player can still tap green cells to free space
                    this.clearing = false;
                    this._claimAnimating = false;
                    return;
                }
                this._gameOver();
                return;
            }
            // No more words but grid still has space — apply chain bonus and continue.
            if (this.totalWordsInChain > 0) {
                const prevScore = this.score;
                const chainPts = (this.gameMode === GAME_MODES.SANDBOX) ? Math.floor(this.totalWordsInChain * 50 * SANDBOX_SCORE_MULT) : this.totalWordsInChain * 50;
                this.score += chainPts;
                this._checkBonusUnlock(prevScore, this.score);
                this._updateScoreDisplay();
            }
            this.clearing = false;
            this._claimAnimating = false;
            this._computeHintCells();
            this._hideChainBanner();

            // Chain words were already shown via _addWordPopupRow during claiming
            if (this._chainWords && this._chainWords.length > 0) {
                this._chainWords = [];
                return;
            }
            // Don't spawn a new block if one already exists (e.g. after tap-to-claim)
            if (!this.block) this._spawnBlock();
            return;
        }

        // ── Tap-to-claim mode ──
        // Highlight validated words green and let the player tap to claim them.
        if (result.words.length > 0) {
            this._addValidatedWords(result, result.words);
        }
        // Don't enter clearing state — spawn next block
        this.clearing = false;
        this._computeHintCells();
        if (!this.block) this._spawnBlock();
        return;
    }

    _processClearPhase(dt) {
        if (this.clearPhase === "flash") {
            this.renderer.flashTimer += dt;
            this.clearTimer += dt;
            if (this.pendingClearMode === "bomb") {
                this.renderer.blastProgress = Math.min(1, this.clearTimer / this.clearFlashDuration);
            }
            if (this.clearTimer >= this.clearFlashDuration) {
                // Remove cells
                this.grid.removeCells(this._pendingClearCells);
                this.renderer.flashCells.clear();
                this.renderer.flashTimer = 0;
                this.renderer.blastCells.clear();
                this.renderer.blastCenterKey = null;
                this.renderer.blastProgress = 0;
                this.pendingClearMode = "";

                // Invalidate validated groups whose cells were just removed
                this._validatedWordGroups = this._validatedWordGroups.filter(g => {
                    for (const key of this._pendingClearCells) {
                        if (g.cells.has(key)) return false;
                    }
                    return true;
                });
                this._rebuildValidatedCells();

                // Apply gravity
                const moves = this.grid.applyGravity();
                if (moves.length > 0) {
                    // Gravity shifts cells — clear all validated groups (rescan will re-detect)
                    this._validatedWordGroups = [];
                    this._rebuildValidatedCells();

                    this.pendingGravityMoves = moves.map(m => ({ ...m, progress: 0 }));
                    this.renderer.gravityAnims = this.pendingGravityMoves;
                    this.clearPhase = "gravity";
                    this.clearTimer = 0;
                } else {
                    this.clearPhase = "check";
                    this.clearTimer = 0;
                }
            }
        } else if (this.clearPhase === "gravity") {
            this.clearTimer += dt;
            const speed = 6; // cells per second
            let allDone = true;
            for (const m of this.pendingGravityMoves) {
                m.progress += speed * dt / Math.max(1, m.toRow - m.fromRow);
                if (m.progress < 1) allDone = false;
                else m.progress = 1;
            }
            if (allDone || this.clearTimer > 0.5) {
                this.renderer.gravityAnims = [];
                this.pendingGravityMoves = [];
                this.clearPhase = "check";
                this.clearTimer = 0;
            }
        } else if (this.clearPhase === "check") {
            // Full board scan for chain reactions
            this._checkWords(-1, -1);
        }
    }

    _togglePause() {
        if (this.letterChoiceActive) return;
        if (this.state === State.PLAYING) {
            this.state = State.PAUSED;
            // Target Word has no Save & Quit — only End Game
            if (this.els.quitBtn) {
                this.els.quitBtn.style.display = this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD ? "none" : "";
            }
            this.els.pauseOverlay.classList.add("active");
        } else if (this.state === State.PAUSED) {
            this.state = State.PLAYING;
            this.els.pauseOverlay.classList.remove("active");
        }
    }

    _showWordPopup(words) {
        for (const entry of words) {
            this._addWordPopupRow(entry);
        }
    }

    _showEasterEggBanner() {
        // Secret jackpot: player spelled the game name. Create a temporary full-screen flash banner.
        let banner = document.getElementById('plummet-easter-egg-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'plummet-easter-egg-banner';
            banner.style.cssText = [
                'position:fixed', 'inset:0', 'z-index:9999',
                'display:flex', 'flex-direction:column',
                'align-items:center', 'justify-content:center',
                'background:rgba(0,0,0,0.82)',
                'color:#ffe066', 'font-family:inherit',
                'pointer-events:none', 'opacity:0',
                'transition:opacity 0.3s',
            ].join(';');
            banner.innerHTML = `
                <div style="font-size:2.8rem;font-weight:900;letter-spacing:0.08em;text-shadow:0 0 24px #ffe066,0 0 48px #ff9800;">✨ PLUMMET ✨</div>
                <div style="font-size:1.1rem;margin-top:0.5rem;color:#fff;opacity:0.9;">You found the secret word!</div>
                <div style="font-size:1.4rem;margin-top:0.6rem;font-weight:700;color:#4fffb0;">+10,000 pts &nbsp;•&nbsp; +1,000 coins</div>
            `;
            document.body.appendChild(banner);
        }
        banner.style.opacity = '1';
        setTimeout(() => { banner.style.opacity = '0'; }, 2800);
    }

    _showChainBanner(chainCount) {
        const el = this.els.chainBanner;
        if (!el) return;
        if (chainCount < 2) {
            this._hideChainBanner();
            return;
        }
        const labels = ["", "", "CHAIN ×2", "CHAIN ×3!", "CHAIN ×4!!", "🔥 CHAIN ×5!!", "🔥🔥 CHAIN ×6!!!"];
        el.textContent = chainCount < labels.length ? labels[chainCount] : `🔥🔥🔥 CHAIN ×${chainCount}!!!`;
        el.classList.remove("hidden", "pop");
        el.classList.add("visible");
        // GSAP-powered elastic entrance
        chainBannerEntrance(el, chainCount);
    }

    _hideChainBanner() {
        const el = this.els.chainBanner;
        if (!el) return;
        chainBannerExit(el);
    }

    _addWordPopupRow(entry) {
        const container = this.els.wordPopup;

        const row = document.createElement("div");
        row.className = "word-popup-row" + (entry.isBonus ? " bonus-popup" : "");

        let animDuration;
        if (entry.isBonus) {
            // Bonus popups: simple text, no letter blocks
            const label = document.createElement("span");
            label.className = "bonus-popup-label";
            label.textContent = entry.word;
            row.appendChild(label);

            const pts = document.createElement("span");
            pts.className = "bonus-popup-pts";
            pts.textContent = "+" + entry.pts;
            row.appendChild(pts);

            animDuration = 0.5;
        } else {
            const letters = entry.word.split("");
            letters.forEach((ch, i) => {
                const span = document.createElement("span");
                span.className = "word-popup-letter";
                span.textContent = ch;
                const randomRot = Math.floor(Math.random() * 120) - 60;
                span.style.setProperty("--r", randomRot);
                span.style.setProperty("--d", i * 0.06 + "s");
                row.appendChild(span);
            });

            const pts = document.createElement("span");
            pts.className = "word-popup-pts" + (entry.multiplied ? " multiplied" : "");
            pts.textContent = "+" + entry.pts + (entry.multiplied ? " ×2" : "");
            pts.style.setProperty("--d", letters.length * 0.06 + 0.1 + "s");
            row.appendChild(pts);

            animDuration = letters.length * 0.06 + 0.1 + 0.3;
        }

        container.appendChild(row);

        // GSAP letter assembly for non-bonus rows
        if (!entry.isBonus) {
            const letterSpans = row.querySelectorAll('.word-popup-letter');
            letterAssemble(row, letterSpans);
        }

        // Pause falling while any popup row is visible
        this._wordPopupActive = true;
        if (!this._wordPopupCount) this._wordPopupCount = 0;
        this._wordPopupCount++;

        // Track active timers for cleanup on game over / resume
        if (!this._wordPopupTimers) this._wordPopupTimers = [];

        const holdMs = Math.min((animDuration + 0.05) * 1000, 200);

        // Each row exits on its own timer after its animation completes
        const timerId = setTimeout(() => {
            this._removePopupTimer(timerId);
            try {
                const tween = wordPopupExit(row);
                if (tween && typeof tween.eventCallback === 'function') {
                    tween.eventCallback('onComplete', () => {
                        this._decrementPopupCount();
                    });
                } else {
                    // GSAP returned no tween — force cleanup after fallback duration
                    setTimeout(() => this._decrementPopupCount(), 400);
                }
            } catch (e) {
                // GSAP failure — remove row manually and decrement
                if (row.parentNode) row.parentNode.removeChild(row);
                this._decrementPopupCount();
            }
        }, holdMs);
        this._wordPopupTimers.push(timerId);

        // Absolute failsafe: if this popup still hasn't cleared after 1.5s, force-clear it
        const failsafeId = setTimeout(() => {
            this._removePopupTimer(failsafeId);
            if (row.parentNode) row.parentNode.removeChild(row);
            // Only decrement if this row is still counted
            if (this._wordPopupCount > 0) {
                this._decrementPopupCount();
            }
        }, holdMs + 1500);
        this._wordPopupTimers.push(failsafeId);
    }

    _decrementPopupCount() {
        this._wordPopupCount--;
        if (this._wordPopupCount <= 0) {
            this._wordPopupCount = 0;
            this._wordPopupActive = false;
            if (!this.block) this._spawnBlock();
        }
    }

    _removePopupTimer(id) {
        if (this._wordPopupTimers) {
            const idx = this._wordPopupTimers.indexOf(id);
            if (idx !== -1) this._wordPopupTimers.splice(idx, 1);
        }
    }

    _clearAllWordPopups() {
        // Cancel all pending popup timers
        if (this._wordPopupTimers) {
            for (const id of this._wordPopupTimers) clearTimeout(id);
            this._wordPopupTimers = [];
        }
        // Remove all popup rows from DOM
        if (this.els.wordPopup) {
            this.els.wordPopup.innerHTML = '';
        }
        // Reset popup state
        this._wordPopupCount = 0;
        this._wordPopupActive = false;
    }


    async _gameOver(reason = "board") {
        if (this.state === State.GAMEOVER) return;
        const timedOut = reason === "time";
        if (timedOut) {
            this.timeRemainingSeconds = 0;
            this._updateTimerDisplay();
        }

        this.state = State.GAMEOVER;
        this.block = null;
        this._clearAllWordPopups();  // Clean up any pending popups
        this.audio.gameOver();
        this.renderer.hintCells = new Set();
        this.renderer.validatedCells = new Set();
        this.renderer.rowDragCells.clear();
        this.rowDragActive = false;
        this._lineClearStart = null;
        this._lineClearEnd = null;
        this.els.rowDragIndicator.classList.add("hidden");
        this._activeHintKey = null;
        this._validatedWordGroups = [];
        this._claimAnimating = false;

        // Clean up bonus indicators
        this.freezeActive = false;
        this._closeRadialMenu();
        this.els.freezeIndicator.classList.add("hidden");
        this.els.score2xIndicator.classList.add("hidden");
        this.els.targetWordDisplay.classList.add("hidden");
        this.els.targetWordDisplay.querySelector(".target-label").textContent = "TARGET:";

        // Clear saved game — this run is over
        this._clearGameState();

        // ── XP System: check first-game status BEFORE recording ──
        const wasFirstGame = this.profileMgr.isFirstGameEver();

        // Record stats to profile
        const wordsCount = (this.wordsFound || []);
        if (this.activeChallenge) {
            this.profileMgr.recordChallengeGame(this.activeChallenge, this.score, wordsCount);
            this._syncChallengeStatsToCloud(this.activeChallenge);
        } else {
            this.profileMgr.recordGame(this.score, wordsCount);
        }

        // Update high score
        let isNew = false;
        if (this.activeChallenge) {
            const cs = this.profileMgr.getChallengeStats(this.activeChallenge);
            isNew = this.score > 0 && this.score >= cs.highScore;
        } else {
            const profile = this.profileMgr.getActive();
            if (profile && this.score >= profile.highScore) {
                this.highScore = profile.highScore;
                isNew = this.score > 0;
            }
        }
        this._lastGameNewHighScore = isNew;

        // ── XP Calculation ──
        const gs = this.activeChallenge ? this.challengeGridSize : this.gridSize;
        const bsKey = this.profileMgr.bestScoreKey(
            gs, this.difficulty, this.gameMode,
            !!this.activeChallenge, this.activeChallenge);
        const previousBest = this.profileMgr.getBestScore(bsKey);

        let xpEarned;
        if (wasFirstGame) {
            xpEarned = xpRequiredForLevel(1); // guarantee level 2
        } else {
            const lvlInfo = this.profileMgr.getLevelInfo();
            xpEarned = calculateGameXP({
                score: this.score,
                wordsFound: wordsCount,
                gridSize: gs,
                difficulty: this.difficulty,
                gameMode: this.gameMode,
                isChallenge: !!this.activeChallenge,
                challengeType: this.activeChallenge,
                previousBest,
                playerLevel: lvlInfo.level,
                timeLimitSeconds: this.timeLimitSeconds,
                timeRemainingSeconds: this.timeRemainingSeconds,
                targetWordsCompleted: this.targetWordsCompleted || 0,
                bonusWordsCompleted: (this.categoryWordsFound || []).length,
                categoryKey: this.activeCategoryKey || null,
                comboMax: this.bestCombo || 0,
            });
        }

        // Update best score for this mode combo
        this.profileMgr.updateBestScore(bsKey, this.score);

        // Award XP
        const xpResult = this.profileMgr.awardXP(xpEarned);

        // ── Award coins ──
        const gameCoins = calculateGameCoins({
            score: this.score,
            wordsFound: wordsCount,
            isNewHighScore: isNew,
            isChallenge: !!this.activeChallenge,
            challengeType: this.activeChallenge,
            comboMax: this.bestCombo,
            playerLevel: (this.profileMgr.getLevelInfo() || {}).level || 1,
            isFirstGameToday: this._dailyInfo ? this._dailyInfo.isFirstGameToday : false,
            playStreak: this._dailyInfo ? this._dailyInfo.playStreak : 0,
        });
        const totalCoins = (this._coinsThisGame || 0) + gameCoins;
        // Level-up coin bonus
        let levelUpCoins = 0;
        if (xpResult.leveled) {
            for (let lv = xpResult.oldLevel + 1; lv <= xpResult.newLevel; lv++) {
                levelUpCoins += COIN_LEVEL_UP_BASE + lv * COIN_LEVEL_UP_PER_LEVEL;
            }
        }
        const finalCoins = totalCoins + levelUpCoins;
        this.profileMgr.addCoins(finalCoins);
        this._lastGameCoins = finalCoins;

        // Check milestones
        const newMilestones = this.profileMgr.checkMilestones();
        this._lastMilestones = newMilestones;
        if (newMilestones.length > 0) this._syncMilestonesToCloud(newMilestones);

        // Build final score text (add challenge info if applicable)
        let finalText = `Score: ${this.score}`;
        if (this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD) {
            finalText += `\nTarget Words: ${this.targetWordsCompleted}`;
        } else if (this.activeChallenge === CHALLENGE_TYPES.SPEED_ROUND) {
            finalText += `\nFinal Speed: ${this.fallInterval.toFixed(2)}s`;
        } else if (this.activeChallenge === CHALLENGE_TYPES.WORD_CATEGORY) {
            const catCount = (this.categoryWordsFound || []).length;
            const cat = this.activeCategoryKey && WORD_CATEGORIES[this.activeCategoryKey];
            finalText += `\n${cat ? cat.icon + " " : ""}Category Words: ${catCount}`;
        }

        this.els.finalScore.textContent = finalText;
        this.els.newHighScore.classList.toggle("hidden", !isNew);

        // GSAP: Roll up the score number from 0
        if (this.score > 0) {
            numberRoll(this.els.finalScore, 0, this.score, {
                duration: 0.8,
                prefix: 'Score: ',
            });
        }

        // GSAP: confetti on new high score
        if (isNew && this.els.gameoverScreen) {
            confettiRain(this.els.gameoverScreen, 60, 2.0);
            // PixiJS: WebGL confetti burst
            pixiConfettiBurst(80);
            // Matter.js: physics confetti rain
            spawnConfettiPhysics(50);
        }

        // Matter.js: Falling letter physics cascade on every game over
        if (this.grid && this.grid.cells) {
            const cvs = this.canvas;
            const cellW = cvs ? cvs.width / (this.gridSize || 5) : 40;
            const cellH = cvs ? cvs.height / (this.gridSize || 5) : 40;
            let delay = 0;
            for (let r = (this.gridSize || 5) - 1; r >= 0; r--) {
                for (let c = 0; c < (this.gridSize || 5); c++) {
                    const cell = this.grid.cells[r]?.[c];
                    if (cell && cell.letter) {
                        setTimeout(() => {
                            spawnFallingLetter(c * cellW + cellW / 2, r * cellH + cellH / 2, cell.letter);
                        }, delay);
                        delay += 30;
                    }
                }
            }
        }

        // Store challenge type for gameover screen buttons before resetting
        this._gameOverChallenge = this.activeChallenge;
        this._gameOverCategoryKey = this.activeCategoryKey;

        // Reset challenge state
        this.activeChallenge = null;

        // Update gameover buttons based on whether this was a challenge game
        this.els.menuBtn.textContent = this._gameOverChallenge ? "Back to Challenges" : "Main Menu";
        this.els.restartBtn.textContent = this._gameOverChallenge ? "Play Again" : "Play Again";
        // Tag restart button with challenge type for robust detection on Play Again
        if (this._gameOverChallenge) {
            this.els.restartBtn.dataset.challenge = this._gameOverChallenge;
            this.els.restartBtn.dataset.categoryKey = this._gameOverCategoryKey || "";
        } else {
            delete this.els.restartBtn.dataset.challenge;
            delete this.els.restartBtn.dataset.categoryKey;
        }

        // ── Show gameover screen with XP animation ──
        this._showGameOverXP(xpEarned, xpResult, wasFirstGame);

        // ── Record to Supabase and update ranking — await before profile sync ──
        await this._recordGameToSupabase({
            gameMode: this.gameMode,
            isChallenge: !!this._gameOverChallenge,
            challengeType: this._gameOverChallenge || null,
            categoryKey: this._gameOverCategoryKey || null,
            gridSize: gs,
            difficulty: this.difficulty,
            timeLimitSeconds: this.timeLimitSeconds || null,
            score: this.score,
            wordsFound: wordsCount.length || 0,
            longestWordLength: Math.max(0, ...(wordsCount.map(w => (w.word || w || "").length) || [0])),
            bestCombo: this.bestCombo || 0,
            targetWordsCompleted: this.targetWordsCompleted ?? 0,
            bonusWordsCompleted: (this.categoryWordsFound || []).length,
            timeRemainingSeconds: this.timeRemainingSeconds ?? null,
            xpEarned,
            coinsEarned: finalCoins,
            gridFactor: gs / 8,
            difficultyMultiplier: this.difficulty === "hard" ? 1.5 : 1.0,
            modeMultiplier: this.gameMode === GAME_MODES.TIMED ? 1.2 : 1.0,
        });

        // ── OpenSkill: compute competitive rating for this game result ──
        try {
            // Compute a percentile estimate from score (higher score → higher percentile)
            const scorePercentile = Math.min(95, Math.max(5, 25 * Math.log10(1 + this.score / 100)));
            const skillResult = processGameResults(
                this._playerOpenSkillRating || null,
                [{ percentile: scorePercentile }]
            );
            this._playerOpenSkillRating = { mu: skillResult.mu, sigma: skillResult.sigma };
            this._playerOrdinal = skillResult.ordinal;
            console.log(`[OpenSkill] Rating: μ=${skillResult.mu.toFixed(1)} σ=${skillResult.sigma.toFixed(1)} ordinal=${skillResult.ordinal.toFixed(1)}`);
        } catch (err) {
            console.warn('[OpenSkill] Rating computation failed:', err);
        }

        // ── Sync profile state (level, xp, coins, stats) to cloud ──
        this._syncProfileToCloud();

        // ── Sync game-over state to Preact store ──
        gameStore.set({
            gameState: State.GAMEOVER,
            finalScore: this.score,
            isNewHighScore: isNew,
            xpEarned,
            bestCombo: this.bestCombo,
            wordsFoundCount: this._totalWordsThisGame,
            difficultyLevel: this._difficultyLevel,
            wordsFound: (this.wordsFound || []).slice(),
        });
    }

    // ── Level / XP display methods ──

    _updateLevelDisplay() {
        const info = this.profileMgr.getLevelInfo();
        const pct = info.xpRequired > 0 ? Math.min(100, (info.xp / info.xpRequired) * 100) : 0;

        // Play screen bar
        this.els.levelText.textContent = `Lv. ${info.level}`;
        this.els.xpBarFill.style.width = pct + "%";
        this.els.xpText.textContent = `${info.xp} / ${info.xpRequired}`;

        // Menu screen
        this.els.menuLevelNum.textContent = info.level;
        this.els.menuXpBarFill.style.width = pct + "%";
        this.els.menuXpText.textContent = `${info.xp} / ${info.xpRequired} XP`;
    }

    _showGameOverXP(xpEarned, xpResult, wasFirstGame) {
        // Set initial gameover XP state (before animation)
        const startPct = xpResult.oldXpReq > 0
            ? Math.min(100, (xpResult.oldXp / xpResult.oldXpReq) * 100) : 0;

        this.els.gameoverLevelText.textContent = `Level ${xpResult.oldLevel}`;
        this.els.gameoverXpBarFill.style.transition = "none";
        this.els.gameoverXpBarFill.style.width = startPct + "%";
        this.els.xpEarnedText.textContent = `+${xpEarned} XP`;
        this.els.xpEarnedText.classList.remove("visible");

        // Show coin earnings
        const coinsEarned = this._lastGameCoins || 0;
        if (this.els.coinsEarnedText) {
            this.els.coinsEarnedText.textContent = `+${coinsEarned} Coins`;
        }

        this._showScreen("gameover");

        // Animate after a brief delay
        setTimeout(() => {
            this.els.xpEarnedText.classList.add("visible");
        }, 300);

        // Show milestone toasts after a delay, one at a time
        const milestones = this._lastMilestones || [];
        if (milestones.length > 0) {
            this._milestoneQueue = milestones.slice();
            setTimeout(() => this._showNextMilestone(), 1500);
        }

        setTimeout(() => {
            this.els.gameoverXpBarFill.style.transition = "width 1.2s cubic-bezier(0.22,1,0.36,1)";

            if (xpResult.leveled) {
                // Animate to 100%, then after the transition show level-up
                this.els.gameoverXpBarFill.style.width = "100%";

                setTimeout(() => {
                    // Update to new level state
                    this.els.gameoverLevelText.textContent = `Level ${xpResult.newLevel}`;
                    this.els.gameoverXpBarFill.style.transition = "none";
                    this.els.gameoverXpBarFill.style.width = "0%";

                    setTimeout(() => {
                        const endPct = xpResult.newXpReq > 0
                            ? Math.min(100, (xpResult.newXp / xpResult.newXpReq) * 100) : 0;
                        this.els.gameoverXpBarFill.style.transition = "width 0.6s cubic-bezier(0.22,1,0.36,1)";
                        this.els.gameoverXpBarFill.style.width = endPct + "%";

                        // Show level-up popup after bar settles
                        setTimeout(() => {
                            if (wasFirstGame) {
                                this._showXPTutorial(xpResult.newLevel);
                            } else {
                                this._showLevelUpPopup(xpResult.newLevel, xpResult.newXp, xpResult.newXpReq);
                            }
                        }, 700);
                    }, 50);
                }, 1250);
            } else {
                // No level up — just animate to final position
                const endPct = xpResult.newXpReq > 0
                    ? Math.min(100, (xpResult.newXp / xpResult.newXpReq) * 100) : 0;
                this.els.gameoverXpBarFill.style.width = endPct + "%";
            }
        }, 600);

        // Also update the play-screen bar and menu bar
        this._updateLevelDisplay();
    }

    _showLevelUpPopup(newLevel, newXp, newXpReq) {
        this.els.levelUpLevel.textContent = `Level ${newLevel}`;
        const pct = newXpReq > 0 ? Math.min(100, (newXp / newXpReq) * 100) : 0;
        this.els.levelUpBarFill.style.transition = "none";
        this.els.levelUpBarFill.style.width = "0%";
        this.els.levelUpOverlay.classList.add("active");

        // GSAP: animate the progress bar fill
        gsap.fromTo(this.els.levelUpBarFill, { width: '0%' }, {
            width: pct + '%',
            duration: 0.8,
            delay: 0.4,
            ease: 'power2.out',
        });

        // Confetti burst — GSAP rain + background system
        confettiRain(this.els.levelUpOverlay, 80, 2.5);
        if (this.bgAnim && this.bgAnim.spawnConfetti) {
            this.bgAnim.spawnConfetti();
        }
        // PixiJS: star burst for level up
        pixiStarBurst(this.canvas.width / 2, this.canvas.height / 3, 20);
        // Matter.js: physics confetti rain
        spawnConfettiPhysics(60);
    }

    _showXPTutorial(newLevel) {
        this.els.levelUpOverlay.classList.remove("active");
        this.els.xpTutorialOverlay.classList.add("active");
        this._animateXPTutorialCanvas();
    }

    _animateXPTutorialCanvas() {
        const canvas = this.els.xpTutorialCanvas;
        const ctx = canvas.getContext("2d");
        const dpr = window.devicePixelRatio || 1;
        canvas.width = 300 * dpr;
        canvas.height = 180 * dpr;
        ctx.scale(dpr, dpr);
        const w = 300, h = 180;
        let start = null;
        let animId = null;

        const draw = (timestamp) => {
            if (!start) start = timestamp;
            const t = (timestamp - start) / 1000;
            ctx.clearRect(0, 0, w, h);

            // Draw a mini XP bar animation
            ctx.fillStyle = "#0d1117";
            ctx.fillRect(0, 0, w, h);

            // Level badge
            const lvl = Math.min(Math.floor(t * 0.8) + 1, 5);
            ctx.font = "bold 28px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#7eb8ff";
            ctx.fillText(`Lv. ${lvl}`, w / 2, 30);

            // XP bar background
            const barX = 40, barY = 55, barW = 220, barH = 16;
            ctx.fillStyle = "#1a2a3e";
            ctx.fillRect(barX, barY, barW, barH);
            ctx.strokeStyle = "#2a3a50";
            ctx.lineWidth = 1;
            ctx.strokeRect(barX, barY, barW, barH);

            // XP bar fill (animated cycling)
            const cycle = t % 3;
            const fillPct = cycle < 2 ? Math.min(cycle / 2, 1) : 1;
            const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
            grad.addColorStop(0, "#9a9478");
            grad.addColorStop(1, "#b0a878");
            ctx.fillStyle = grad;
            ctx.fillRect(barX, barY, barW * fillPct, barH);

            // "LEVEL UP!" flash
            if (cycle >= 2) {
                const flash = Math.sin(t * 8) > 0;
                ctx.font = "bold 20px sans-serif";
                ctx.fillStyle = flash ? "#e2d8a6" : "#b0a878";
                ctx.fillText("LEVEL UP!", w / 2, 95);
            }

            // Info text
            ctx.font = "12px sans-serif";
            ctx.fillStyle = "#9a9680";
            ctx.fillText("Earn XP by playing games", w / 2, 125);
            ctx.fillText("Harder modes = more XP", w / 2, 142);
            ctx.fillText("Beat your best = bonus XP!", w / 2, 159);

            animId = requestAnimationFrame(draw);
        };

        animId = requestAnimationFrame(draw);
        this._xpTutorialAnimId = animId;
    }

    _stopXPTutorialAnim() {
        if (this._xpTutorialAnimId) {
            cancelAnimationFrame(this._xpTutorialAnimId);
            this._xpTutorialAnimId = null;
        }
    }

    _bindLevelUpUI() {
        this.els.levelUpOkBtn.addEventListener("click", () => {
            this.els.levelUpOverlay.classList.remove("active");
        });
        this.els.xpTutorialOkBtn.addEventListener("click", () => {
            this._stopXPTutorialAnim();
            this.els.xpTutorialOverlay.classList.remove("active");
        });
    }

    // ── Profile methods ──

    _bindProfiles() {
        this.els.newProfileBtn.addEventListener("click", () => {
            if (this.profileMgr.getAll().length >= MAX_PROFILES_PER_ACCOUNT) {
                alert(`You can have up to ${MAX_PROFILES_PER_ACCOUNT} profiles.`);
                return;
            }
            this._openProfileModal('create');
        });
        this.els.profileSaveBtn.addEventListener("click", () => this._submitProfileModal());
        this.els.profileCancelBtn.addEventListener("click", () => {
            this._closeProfileModal();
        });
        // Allow Enter to submit
        this.els.profileNameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") this._submitProfileModal();
        });
        // Clear error when user types
        this.els.profileNameInput.addEventListener("input", () => {
            this.els.profileNameError.style.display = "none";
        });
        // Auto-convert spaces to underscores
        this.els.profileNameInput.addEventListener("keydown", (e) => {
            if (e.key === " ") {
                e.preventDefault();
                const input = this.els.profileNameInput;
                const start = input.selectionStart;
                const end = input.selectionEnd;
                const val = input.value;
                if (val.length - (end - start) < USERNAME_MAX_LENGTH) {
                    input.value = val.slice(0, start) + '_' + val.slice(end);
                    input.selectionStart = input.selectionEnd = start + 1;
                    input.dispatchEvent(new Event('input'));
                }
            }
        });
        // Tap profile name on home screen to edit
        this.els.menuProfileName.style.cursor = "pointer";
        this.els.menuProfileName.addEventListener("click", () => {
            const profile = this.profileMgr.getActive();
            if (profile) this._openProfileModal('edit', profile);
        });
    }

    /**
     * Open the profile modal in 'create' or 'edit' mode.
     * @param {'create'|'edit'} mode
     * @param {object} [profile] - The profile being edited (edit mode only)
     */
    _openProfileModal(mode, profile = null) {
        this._profileModalMode = mode;
        this._profileModalTarget = profile;
        this.els.profileNameError.style.display = "none";
        if (mode === 'edit' && profile) {
            this.els.profileModalTitle.textContent = "Edit Profile";
            this.els.profileNameInput.value = profile.username;
            this.els.profileSaveBtn.textContent = "Save";
        } else {
            this.els.profileModalTitle.textContent = "New Profile";
            this.els.profileNameInput.value = "";
            this.els.profileSaveBtn.textContent = "Create";
        }
        this.els.profileModal.classList.add("active");
        this.els.profileNameInput.focus();
    }

    _closeProfileModal() {
        this.els.profileModal.classList.remove("active");
        this._profileModalMode = null;
        this._profileModalTarget = null;
    }

    _showProfileNameError(msg) {
        this.els.profileNameError.textContent = msg;
        this.els.profileNameError.style.display = "block";
        this.els.profileNameInput.focus();
    }

    async _submitProfileModal() {
        if (this._profileModalBusy) return;
        const name = this.els.profileNameInput.value.trim();
        if (!name) { this.els.profileNameInput.focus(); return; }

        // Client-side validation (format, length, profanity)
        const validationError = validateUsername(name);
        if (validationError) {
            this._showProfileNameError(validationError);
            return;
        }

        // If editing and name hasn't changed, just close
        if (this._profileModalMode === 'edit' && this._profileModalTarget &&
            name === this._profileModalTarget.username) {
            this._closeProfileModal();
            return;
        }

        this._profileModalBusy = true;
        this.els.profileSaveBtn.disabled = true;
        try {
            // Check name uniqueness against cloud
            const available = await this._checkUsernameAvailable(name,
                this._profileModalMode === 'edit' ? this._profileModalTarget?.cloudId : null);
            if (!available) {
                this._showProfileNameError("Name already taken");
                return;
            }

            if (this._profileModalMode === 'edit') {
                await this._renameProfile(this._profileModalTarget, name);
            } else {
                await this._createProfile(name);
            }
            this._closeProfileModal();
        } finally {
            this._profileModalBusy = false;
            this.els.profileSaveBtn.disabled = false;
        }
    }

    /**
     * Check if a username is available (cloud + local fallback).
     * @param {string} username
     * @param {string|null} excludeCloudId - Exclude this profile's cloud ID from the check
     * @returns {Promise<boolean>}
     */
    async _checkUsernameAvailable(username, excludeCloudId = null) {
        try {
            const { isLocalMode, checkUsernameAvailable } = await import('./src/lib/supabase.js');
            if (!isLocalMode) {
                return await checkUsernameAvailable(username, excludeCloudId);
            }
        } catch (err) {
            console.error('[supabase] username check failed:', err);
        }
        // Local fallback: check against local profiles
        const lower = username.toLowerCase();
        return !this.profileMgr.getAll().some(p => {
            if (excludeCloudId && p.cloudId === excludeCloudId) return false;
            return p.username.toLowerCase() === lower;
        });
    }

    async _createProfile(name) {
        const localProfile = this.profileMgr.create(name);
        this._autoplayMusicFromUserAction();
        this._loadActiveProfile();
        this._showScreen("menu");

        // Sync to Supabase (awaited to ensure cloudId is assigned)
        await this._syncCreateProfile(localProfile);
    }

    async _renameProfile(profile, newName) {
        this.profileMgr.rename(profile.id, newName);
        this._updateMenuStats();
        // Re-render profiles list if visible
        if (this.els.profilesScreen.classList.contains('active')) {
            this._renderProfilesList();
        }
        // Sync to cloud
        this._syncProfileToCloud();
    }

    async _syncCreateProfile(localProfile) {
        try {
            const { isLocalMode, createProfile } = await import('./src/lib/supabase.js');
            if (isLocalMode || !this._authUser) return;
            const cloud = await createProfile(this._authUser.id, localProfile.username);
            if (cloud?.id) {
                localProfile.cloudId = cloud.id;
                this.profileMgr._save();
            }
        } catch (err) {
            console.error('[supabase] sync create profile failed:', err);
        }
    }

    async _syncDeleteProfile(profile) {
        const { isLocalMode, deleteProfile } = await import('./src/lib/supabase.js');
        if (isLocalMode || !profile.cloudId) return;
        await deleteProfile(profile.cloudId);
    }

    /**
     * Push the active profile's mutable state to Supabase.
     * Called after game end, shop purchase, equip, preference change, etc.
     * Fire-and-forget — errors are logged but don't block the UI.
     */
    async _syncProfileToCloud() {
        try {
            const { isLocalMode, updateProfile } = await import('./src/lib/supabase.js');
            if (isLocalMode) return;
            // Don't push local data until we've loaded cloud data (prevents overwriting with stale values)
            if (!this._initialSyncComplete) {
                console.log('[supabase] skipping sync - initial cloud load not complete');
                return;
            }
            const p = this.profileMgr.getActive();
            if (!p || !p.cloudId) return;
            this.profileMgr._ensureXPFields(p);
            this.profileMgr._ensureCoinFields(p);

            await updateProfile(p.cloudId, {
                username: p.username,
                // Level & XP
                level: p.level,
                xp: p.xp,
                total_xp: p.totalXp,
                // NOTE: games_played, high_score, total_words are updated server-side
                // by record_game() — do NOT overwrite them here to avoid race conditions.
                // Currency
                coins: p.coins,
                total_coins_earned: p.totalCoinsEarned,
                // Preferences
                preferred_grid_size: p.gridSize || 5,
                preferred_difficulty: p.difficulty || 'casual',
                preferred_game_mode: p.gameMode || 'sandbox',
                // Cosmetics
                equipped_theme: p.equipped?.gridTheme || 'theme_default',
                equipped_block_style: p.equipped?.blockStyle || 'block_default',
                bonus_slot_contents: p.bonusSlotContents || [null, null, null],
                perks: p.perks || {},
                unlocked_grids: p.unlockedGrids || {},
                // Streak
                last_play_date: p.lastPlayDate || null,
                play_streak: p.playStreak || 0,
                claimed_milestones: p.claimedMilestones || [],
                // Unique words
                unique_words_found: p.uniqueWordsFound || [],
            });

            // Challenge stats are now updated server-side by record_game() —
            // no need to push them separately from the client.
        } catch (err) {
            console.error('[supabase] sync profile to cloud failed:', err);
        }
    }

    /**
     * Challenge stats are now updated server-side by record_game().
     * This function is kept as a no-op to avoid breaking existing call sites.
     */
    async _syncChallengeStatsToCloud(challengeType) {
        // No-op: record_game() handles all challenge stat updates server-side.
    }

    /**
     * Debounced version of _syncProfileToCloud for rapid-fire preference changes.
     * Waits 1s of inactivity before syncing.
     */
    _debouncedSyncProfileToCloud() {
        clearTimeout(this._syncDebounceTimer);
        this._syncDebounceTimer = setTimeout(() => this._syncProfileToCloud(), 1000);
    }

    /**
     * Push a newly purchased item to the cloud inventory table.
     */
    async _syncInventoryItemToCloud(itemId, cost = 0) {
        try {
            const { isLocalMode, addInventoryItem } = await import('./src/lib/supabase.js');
            if (isLocalMode) return;
            const p = this.profileMgr.getActive();
            if (!p || !p.cloudId) return;
            await addInventoryItem(p.cloudId, itemId, cost);
        } catch (err) {
            console.error('[supabase] sync inventory item failed:', err);
        }
    }

    /**
     * Delete the user's entire account (Supabase + local data).
     */
    async _deleteAccount() {
        try {
            const { isLocalMode, deleteAccount } = await import('./src/lib/supabase.js');
            if (!isLocalMode) {
                await deleteAccount(); // Must succeed before clearing local data
            }
        } catch (err) {
            console.error('[supabase] delete account failed:', err);
            alert('Failed to delete account. Please try again.');
            return; // Do NOT clear local data if cloud delete failed
        }
        // Cloud delete succeeded (or local mode) — now safe to clear everything
        this.profileMgr.profiles = [];
        this.profileMgr.activeId = null;
        this.profileMgr._save();
        // Clear all app-specific localStorage keys
        const keysToRemove = [
            'wf_playlists', 'wf_music_volume', 'wf_music_shuffle',
            'wf_music_repeat', 'wf_music_paused', 'wf_music_state',
            'wf_hints_enabled', 'wf_music_muted', 'plummet_verification_codes',
            'wf_auth_user_id',
        ];
        keysToRemove.forEach(k => localStorage.removeItem(k));
        this._authUser = null;
        this._unsubscribeProfileRealtime();
        this._showScreen("auth");
    }

    _loadActiveProfile() {
        const profile = this.profileMgr.getActive();
        if (!profile) return;
        this.gridSize = profile.gridSize || 5;
        this.difficulty = profile.difficulty || "casual";
        if (this.difficulty === "challenging") this.difficulty = "hard";
        // Enforce Hard mode grid minimum
        if (this.difficulty === "hard" && this.gridSize < 6) {
            this.gridSize = 6;
            this.profileMgr.setGridSize(this.gridSize);
        }
        this.gameMode = profile.gameMode || GAME_MODES.SANDBOX;
        this.highScore = profile.highScore || 0;
        this._highlightSizeButton();
        this._highlightGameModeButton();
        this._highlightDifficultyButton();
        this._updateDifficultySelector();
        this._updateHighScoreDisplay();
        this._updateMenuStats();
        this._updateLevelDisplay();
        this._subscribeProfileRealtime();
    }

    _renderProfilesList() {
        const list = this.els.profilesList;
        list.innerHTML = "";
        const profiles = this.profileMgr.getAll();

        // Disable "New Profile" button when at limit
        const atLimit = profiles.length >= MAX_PROFILES_PER_ACCOUNT;
        this.els.newProfileBtn.disabled = atLimit;
        this.els.newProfileBtn.title = atLimit ? `Max ${MAX_PROFILES_PER_ACCOUNT} profiles` : 'Create a new profile';

        if (profiles.length === 0) {
            list.innerHTML = '<p style="color:#666;text-align:center;padding:20px;">No profiles yet. Create one to get started!</p>';
            return;
        }

        for (const p of profiles) {
            const card = document.createElement("div");
            card.className = "profile-card";
            const initial = p.username.charAt(0).toUpperCase();
            const lvl = p.level || 1;
            card.innerHTML = `
                <div class="profile-avatar">${initial}</div>
                <div class="profile-info">
                    <div class="profile-name">${p.username} <span class="profile-level">Lv.${lvl}</span></div>
                    <div class="profile-stats">High Score: ${p.highScore} · Games: ${p.gamesPlayed} · Words: ${p.totalWords}</div>
                </div>
                <button class="profile-edit-btn" title="Edit profile">✏️</button>
                <button class="profile-delete-btn" title="Delete profile">🗑</button>
            `;

            // Select profile
            card.addEventListener("click", (e) => {
                if (e.target.closest(".profile-delete-btn") || e.target.closest(".profile-edit-btn")) return;
                this.profileMgr.select(p.id);
                this._autoplayMusicFromUserAction();
                this._loadActiveProfile();
                this._showScreen("menu");
            });

            // Edit profile
            card.querySelector(".profile-edit-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                this._openProfileModal('edit', p);
            });

            // Delete profile
            card.querySelector(".profile-delete-btn").addEventListener("click", async (e) => {
                e.stopPropagation();
                if (!confirm(`Delete profile "${p.username}"? This cannot be undone.`)) return;
                try {
                    await this._syncDeleteProfile(p);
                } catch (err) {
                    console.error('[supabase] sync delete profile failed:', err);
                    alert('Failed to delete profile from cloud. Please try again.');
                    return;
                }
                this.profileMgr.delete(p.id);
                this._renderProfilesList();
                // If no profiles left, stay on profiles screen
                if (!this.profileMgr.hasProfiles()) return;
                // If active was deleted, load new active
                if (this.profileMgr.getActive()) {
                    this._loadActiveProfile();
                }
            });

            list.appendChild(card);
        }
    }

    _updateMenuStats() {
        const profile = this.profileMgr.getActive();
        if (!profile) return;
        this.els.menuProfileName.textContent = `👤 ${profile.username}`;
        this.els.menuGamesPlayed.textContent = profile.gamesPlayed;
        this.els.menuTotalWords.textContent = Array.isArray(profile.uniqueWordsFound) ? profile.uniqueWordsFound.length : profile.totalWords;
        // Update coin display
        if (this.els.menuCoins) {
            this.els.menuCoins.textContent = this.profileMgr.getCoins();
        }
    }

    // ── Shop rendering ──

    _shopTabOrder = ["grid_themes", "block_styles", "bonus_slots", "starting_perks"];

    _bindShopSwipe() {
        const content = this.els.shopContent;
        let startX = 0, startY = 0, dragging = false, moved = false;

        const onDown = (e) => {
            dragging = true; moved = false;
            startX = e.touches ? e.touches[0].clientX : e.clientX;
            startY = e.touches ? e.touches[0].clientY : e.clientY;
        };
        const onMove = (e) => {
            if (!dragging) return;
            const x = e.touches ? e.touches[0].clientX : e.clientX;
            const y = e.touches ? e.touches[0].clientY : e.clientY;
            const dx = x - startX, dy = y - startY;
            // If clearly scrolling vertically, cancel swipe
            if (!moved && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
                dragging = false; return;
            }
            if (Math.abs(dx) > 15) moved = true;
        };
        const onUp = (e) => {
            if (!dragging) return;
            dragging = false;
            if (!moved) return;
            const x = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
            const dx = x - startX;
            if (Math.abs(dx) < 40) return;

            const idx = this._shopTabOrder.indexOf(this._shopCurrentTab);
            let newIdx = idx;
            if (dx < 0 && idx < this._shopTabOrder.length - 1) newIdx = idx + 1;
            else if (dx > 0 && idx > 0) newIdx = idx - 1;
            if (newIdx !== idx) {
                this._shopCurrentTab = this._shopTabOrder[newIdx];
                this.els.shopTabs.forEach(t => t.classList.toggle("active", t.dataset.tab === this._shopCurrentTab));
                this._renderShopTab(this._shopCurrentTab);
                // Scroll active tab into view
                const activeTab = [...this.els.shopTabs].find(t => t.dataset.tab === this._shopCurrentTab);
                if (activeTab) activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            }
        };

        content.addEventListener('touchstart', onDown, { passive: true });
        content.addEventListener('touchmove', onMove, { passive: true });
        content.addEventListener('touchend', onUp);
        content.addEventListener('mousedown', onDown);
        content.addEventListener('mousemove', onMove);
        content.addEventListener('mouseup', onUp);
        content.addEventListener('mouseleave', onUp);
    }

    _renderShop() {
        // Update coin display
        this.els.shopCoins.textContent = this.profileMgr.getCoins();
        // Default to first tab
        if (!this._shopCurrentTab) this._shopCurrentTab = "grid_themes";
        this.els.shopTabs.forEach(t => t.classList.toggle("active", t.dataset.tab === this._shopCurrentTab));
        this._renderShopTab(this._shopCurrentTab);
    }

    _renderShopTab(tabName) {
        const content = this.els.shopContent;
        content.innerHTML = "";

        if (tabName === "bonus_slots") {
            this._renderSlotsTab(content);
            return;
        }

        const equipped = this.profileMgr.getEquipped();
        const items = Object.entries(SHOP_ITEMS).filter(([, v]) => v.category === tabName);

        if (items.length === 0) {
            content.innerHTML = '<p style="color:#888;text-align:center;padding:2rem;">Coming soon!</p>';
            return;
        }

        const grid = document.createElement("div");
        grid.className = "shop-grid";

        for (const [id, item] of items) {
            const owned = this.profileMgr.ownsItem(id);
            const isEquipped = this._isItemEquipped(id, equipped);
            const isPerk = !!item.stackSize;
            const perkCount = isPerk ? this.profileMgr.getPerkCount(id) : 0;

            const card = document.createElement("div");
            card.className = "shop-item" + (isEquipped ? " equipped" : "") + (owned && !isPerk ? " owned" : "");

            let badgeHtml = "";
            if (isEquipped) badgeHtml = '<span class="shop-item-badge equipped-badge">Equipped</span>';
            else if (owned && !isPerk) badgeHtml = '<span class="shop-item-badge owned-badge">Owned</span>';

            let perkCountHtml = isPerk && perkCount > 0 ? `<div class="shop-perk-count">${perkCount} remaining</div>` : "";

            card.innerHTML = `
                ${badgeHtml}
                <canvas class="shop-preview-canvas" width="100" height="80"></canvas>
                <div class="shop-item-name">${item.name}</div>
                <div class="shop-item-desc">${item.preview}</div>
                ${perkCountHtml}
                <div class="shop-item-actions">
                    ${this._shopItemButton(id, item, owned, isEquipped, isPerk)}
                </div>
            `;

            // Draw preview on the canvas
            const cvs = card.querySelector(".shop-preview-canvas");
            if (cvs) this._drawShopPreview(cvs, id, item, tabName);

            // Bind actions
            const btn = card.querySelector(".shop-action-btn");
            if (btn) {
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this._handleShopAction(id, item, owned, isEquipped, isPerk);
                });
            }

            grid.appendChild(card);
        }

        content.appendChild(grid);
    }

    _isItemEquipped(id, equipped) {
        return equipped.gridTheme === id || equipped.blockStyle === id;
    }

    _shopItemButton(id, item, owned, isEquipped, isPerk) {
        if (isEquipped) return '<button class="shop-action-btn equipped-btn" disabled>Equipped</button>';
        if (owned && !isPerk) return '<button class="shop-action-btn equip-btn">Equip</button>';
        const coins = this.profileMgr.getCoins();
        const canAfford = coins >= item.price;
        if (item.price === 0 && !owned) return '<button class="shop-action-btn equip-btn">Equip</button>';
        const label = isPerk ? `Buy ×${item.stackSize} · ${item.price}` : `Buy · ${item.price}`;
        return `<button class="shop-action-btn buy-btn${canAfford ? "" : " disabled-btn"}" ${canAfford ? "" : "disabled"}>${label}</button>`;
    }

    _handleShopAction(id, item, owned, isEquipped, isPerk) {
        if (isEquipped) return;

        // Equip owned item
        if (owned && !isPerk) {
            this.profileMgr.equipItem(id);
            this._syncProfileToCloud();
            this._renderShop();
            this._showShopToast(`${item.name} equipped!`);
            return;
        }

        // Free default item — just equip
        if (item.price === 0 && !owned) {
            this.profileMgr.equipItem(id);
            this._syncProfileToCloud();
            this._renderShop();
            return;
        }

        // Purchase
        const result = this.profileMgr.purchaseItem(id);
        if (result.success) {
            // Auto-equip non-perk items on purchase
            if (!isPerk) {
                this.profileMgr.equipItem(id);
            }
            this._syncProfileToCloud();
            if (!isPerk) this._syncInventoryItemToCloud(id, item.price || 0);
            this._renderShop();
            const msg = isPerk
                ? `Bought ${item.stackSize}× ${item.name}! (${result.quantity} total)`
                : `${item.name} purchased & equipped!`;
            this._showShopToast(msg);
        } else if (result.reason === "insufficient_coins") {
            this._showShopToast("Not enough coins!");
        }
    }

    _drawShopPreview(canvas, id, item, tabName) {
        const ctx = canvas.getContext("2d");
        const w = canvas.width, h = canvas.height;

        if (tabName === "grid_themes") {
            // Draw a mini 3x3 grid with theme colors
            const theme = GRID_THEMES[id] || GRID_THEMES.theme_default;
            ctx.fillStyle = theme.bg;
            ctx.fillRect(0, 0, w, h);

            const cellSize = 18;
            const gridW = cellSize * 3;
            const offsetX = (w - gridW) / 2;
            const offsetY = (h - gridW) / 2;
            const sampleLetters = ["P", "L", "U", "M", "M", "E", "T", "!", "★"];

            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 3; c++) {
                    const x = offsetX + c * cellSize;
                    const y = offsetY + r * cellSize;
                    ctx.fillStyle = theme.cell;
                    ctx.fillRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
                    // Grid lines
                    ctx.strokeStyle = theme.gridLine;
                    ctx.lineWidth = 0.5;
                    ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
                    // Letters
                    ctx.fillStyle = theme.text;
                    ctx.font = "bold 9px sans-serif";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(sampleLetters[r * 3 + c], x + cellSize / 2, y + cellSize / 2);
                }
            }
            // Accent border around grid
            if (theme.border) {
                ctx.strokeStyle = theme.border;
                ctx.lineWidth = 1;
                ctx.strokeRect(offsetX, offsetY, gridW, gridW);
            }
            // Glow effect
            if (theme.glow) {
                ctx.shadowColor = theme.glow;
                ctx.shadowBlur = 8;
                ctx.strokeStyle = theme.border || theme.text;
                ctx.lineWidth = 0.5;
                ctx.strokeRect(offsetX, offsetY, gridW, gridW);
                ctx.shadowBlur = 0;
            }
        } else if (tabName === "block_styles") {
            // Draw sample letter tiles
            const style = BLOCK_STYLES[id] || BLOCK_STYLES.block_default;
            ctx.fillStyle = "#1a1a2e";
            ctx.fillRect(0, 0, w, h);

            const tileSize = 22;
            const letters = ["W", "O", "R", "D"];
            const startX = (w - letters.length * (tileSize + 3)) / 2;
            const y = (h - tileSize) / 2;

            for (let i = 0; i < letters.length; i++) {
                const x = startX + i * (tileSize + 3);

                if (style.type === "bubble") {
                    // Round bubble
                    const cx = x + tileSize / 2, cy = y + tileSize / 2;
                    const gradient = ctx.createRadialGradient(cx - 3, cy - 3, 2, cx, cy, tileSize * 0.45);
                    gradient.addColorStop(0, "#e0e8f0");
                    gradient.addColorStop(1, "#8090b0");
                    ctx.beginPath();
                    ctx.arc(cx, cy, tileSize * 0.42, 0, Math.PI * 2);
                    ctx.fillStyle = gradient;
                    ctx.fill();
                } else if (style.type === "scrabble") {
                    // Wooden tile
                    ctx.fillStyle = style.tileColor || "#d4b87a";
                    ctx.fillRect(x, y, tileSize, tileSize);
                    ctx.strokeStyle = style.tileBorder || "#a08848";
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x + 0.5, y + 0.5, tileSize - 1, tileSize - 1);
                } else if (style.type === "typewriter") {
                    // Typewriter key
                    ctx.fillStyle = "#333";
                    const r = 3;
                    ctx.beginPath();
                    ctx.roundRect(x, y, tileSize, tileSize, r);
                    ctx.fill();
                    ctx.strokeStyle = "#555";
                    ctx.lineWidth = 1;
                    ctx.stroke();
                } else if (style.type === "pixel") {
                    // Pixel blocky
                    const ps = 4;
                    for (let py = 0; py < tileSize; py += ps) {
                        for (let px = 0; px < tileSize; px += ps) {
                            const brightness = 40 + Math.floor(Math.random() * 30);
                            ctx.fillStyle = `rgb(${brightness},${brightness + 20},${brightness + 40})`;
                            ctx.fillRect(x + px, y + py, ps - 0.5, ps - 0.5);
                        }
                    }
                } else if (style.type === "glass") {
                    // Glass transparent
                    ctx.globalAlpha = 0.5;
                    ctx.fillStyle = "#4060a0";
                    ctx.fillRect(x, y, tileSize, tileSize);
                    ctx.globalAlpha = 0.2;
                    ctx.fillStyle = "#fff";
                    ctx.fillRect(x + 2, y + 2, tileSize - 4, tileSize / 2 - 2);
                    ctx.globalAlpha = 1;
                } else {
                    // Flat default
                    ctx.fillStyle = "#2a2a42";
                    ctx.fillRect(x, y, tileSize, tileSize);
                }

                // Letter text
                ctx.fillStyle = style.type === "typewriter" ? (style.inkColor || "#ddd") :
                                style.type === "scrabble" ? "#3a2a10" : "#e0e0f0";
                ctx.font = style.type === "typewriter" ? "bold 10px 'Courier New', monospace" :
                           style.type === "pixel" ? "bold 10px monospace" : "bold 10px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(letters[i], x + tileSize / 2, y + tileSize / 2 + 1);

                // Scrabble point value
                if (style.showPoints) {
                    ctx.fillStyle = "#6a5020";
                    ctx.font = "6px sans-serif";
                    ctx.textAlign = "right";
                    ctx.fillText(String(i + 1), x + tileSize - 2, y + tileSize - 2);
                }
            }
        } else if (tabName === "starting_perks") {
            // Draw perk icon
            ctx.fillStyle = "#1a1a2e";
            ctx.fillRect(0, 0, w, h);

            const perkIcons = {
                perk_headstart: "🚀",
                perk_slowstart: "🐢",
                perk_bonusboost: "⚡",
                perk_comboext: "🔗",
                perk_luckydraw: "🎲",
            };

            const icon = perkIcons[id] || "✨";
            ctx.font = "28px serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(icon, w / 2, h / 2);

            // Subtle glow ring
            ctx.strokeStyle = "rgba(100,180,255,0.15)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(w / 2, h / 2, 24, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    _renderSlotsTab(container) {
        const maxSlots = this.profileMgr.getMaxBonusSlots();
        const contents = this.profileMgr.getBonusSlotContents();
        const coins = this.profileMgr.getCoins();
        const FILL_COST = 500;
        const bonusTypes = BONUS_TYPE_POOL;
        const bonusIcons = {
            [BONUS_TYPES.LETTER_PICK]: "🔤",
            [BONUS_TYPES.BOMB]: "💣",
            [BONUS_TYPES.WILDCARD]: "⭐",
            [BONUS_TYPES.ROW_CLEAR]: "─",
            [BONUS_TYPES.FREEZE]: "❄️",
            [BONUS_TYPES.SHUFFLE]: "⇄",
            [BONUS_TYPES.SCORE_2X]: "2×",
        };
        const bonusLabels = {
            [BONUS_TYPES.LETTER_PICK]: "Letter",
            [BONUS_TYPES.BOMB]: "Bomb",
            [BONUS_TYPES.WILDCARD]: "Wild",
            [BONUS_TYPES.ROW_CLEAR]: "Line",
            [BONUS_TYPES.FREEZE]: "Freeze",
            [BONUS_TYPES.SHUFFLE]: "Shuffle",
            [BONUS_TYPES.SCORE_2X]: "2× Score",
        };

        let html = '<div class="slots-config">';
        html += '<h3 class="slots-config-title">Bonus Slots</h3>';
        html += '<p class="slots-config-desc">Buy slots, then fill them with bonuses to use during gameplay!</p>';

        // Render 3 slots
        for (let i = 0; i < 3; i++) {
            const locked = i >= maxSlots;
            const filled = contents[i];
            const slotItemId = `bonus_slot_${i + 1}`;
            const slotItem = SHOP_ITEMS[slotItemId];

            html += `<div class="slot-row${locked ? " locked" : ""}${filled ? " filled" : ""}">`;
            html += `<div class="slot-icon">${filled ? (bonusIcons[filled] || "?") : (locked ? "🔒" : "○")}</div>`;
            html += `<div class="slot-info">`;
            html += `<span class="slot-label">Slot ${i + 1}</span>`;

            if (locked) {
                // Buy slot button
                const canAfford = coins >= slotItem.price;
                // Must buy sequentially
                const canBuy = i === maxSlots;
                html += `<span class="slot-status">Locked</span>`;
                html += `</div>`;
                if (canBuy) {
                    html += `<button class="shop-action-btn buy-btn slot-buy-btn${canAfford ? "" : " disabled-btn"}" data-slot-id="${slotItemId}" ${canAfford ? "" : "disabled"}>Unlock · ${slotItem.price}</button>`;
                }
            } else if (filled) {
                // Show what's in the slot
                html += `<span class="slot-status filled-status">${bonusLabels[filled] || filled}</span>`;
                html += `</div>`;
            } else {
                // Empty — show fill dropdown
                html += `<span class="slot-status">Empty</span>`;
                html += `</div>`;
                html += `<div class="slot-fill-controls">`;
                html += `<select class="slot-fill-select" data-slot="${i}">`;
                html += `<option value="">Choose bonus…</option>`;
                for (const bt of bonusTypes) {
                    html += `<option value="${bt}">${bonusIcons[bt]} ${bonusLabels[bt]}</option>`;
                }
                html += `</select>`;
                const canFill = coins >= FILL_COST;
                html += `<button class="shop-action-btn buy-btn slot-fill-btn${canFill ? "" : " disabled-btn"}" data-slot="${i}" ${canFill ? "" : "disabled"}>Fill · ${FILL_COST}</button>`;
                html += `</div>`;
            }

            html += '</div>';
        }

        html += '</div>';
        container.innerHTML = html;

        // Bind slot buy buttons
        container.querySelectorAll(".slot-buy-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const slotItemId = btn.dataset.slotId;
                const result = this.profileMgr.purchaseItem(slotItemId);
                if (result.success) {
                    this._syncProfileToCloud();
                    this._syncInventoryItemToCloud(slotItemId, SHOP_ITEMS[slotItemId].price || 0);
                    this._showShopToast(`${SHOP_ITEMS[slotItemId].name} unlocked!`);
                    this._renderShop();
                } else if (result.reason === "insufficient_coins") {
                    this._showShopToast("Not enough coins!");
                }
            });
        });

        // Bind fill buttons
        container.querySelectorAll(".slot-fill-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const slotIdx = parseInt(btn.dataset.slot, 10);
                const select = container.querySelector(`.slot-fill-select[data-slot="${slotIdx}"]`);
                const bonusType = select ? select.value : "";
                if (!bonusType) {
                    this._showShopToast("Choose a bonus type first!");
                    return;
                }
                const result = this.profileMgr.fillBonusSlot(slotIdx, bonusType);
                if (result.success) {
                    this._syncProfileToCloud();
                    this._showShopToast(`Slot ${slotIdx + 1} filled with ${bonusLabels[bonusType]}!`);
                    this._renderShop();
                } else if (result.reason === "insufficient_coins") {
                    this._showShopToast("Not enough coins!");
                } else if (result.reason === "slot_filled") {
                    this._showShopToast("Slot already filled!");
                }
            });
        });
    }

    _showShopToast(msg) {
        // Remove existing toast
        const existing = document.querySelector(".shop-toast");
        if (existing) existing.remove();

        const toast = document.createElement("div");
        toast.className = "shop-toast";
        toast.textContent = msg;
        document.body.appendChild(toast);
        // Force reflow then add visible class
        requestAnimationFrame(() => {
            toast.classList.add("visible");
            setTimeout(() => {
                toast.classList.remove("visible");
                setTimeout(() => toast.remove(), 400);
            }, 2000);
        });
    }

    _showNextMilestone() {
        if (!this._milestoneQueue || this._milestoneQueue.length === 0) return;
        const milestone = this._milestoneQueue.shift();
        this._showMilestoneToast(milestone, () => {
            if (this._milestoneQueue.length > 0) {
                setTimeout(() => this._showNextMilestone(), 400);
            }
        });
    }

    _showMilestoneToast(milestone, onDone) {
        const toast = document.createElement("div");
        toast.className = "milestone-toast";
        toast.innerHTML = `
            <div class="milestone-toast-icon">🏆</div>
            <div class="milestone-toast-body">
                <div class="milestone-toast-title">${milestone.label}</div>
                <div class="milestone-toast-desc">${milestone.desc}</div>
                <div class="milestone-toast-coins">+${milestone.coins} Coins</div>
            </div>
        `;
        document.body.appendChild(toast);
        requestAnimationFrame(() => {
            toast.classList.add("visible");
            setTimeout(() => {
                toast.classList.remove("visible");
                setTimeout(() => {
                    toast.remove();
                    if (onDone) onDone();
                }, 500);
            }, 2500);
        });
    }

    // ── Words Found rendering ──

    _getUniqueWordsFound() {
        const uniqueWords = new Map();

        for (const { word, pts, bonus } of this.wordsFound || []) {
            const existing = uniqueWords.get(word);
            if (existing) {
                existing.count += 1;
                existing.totalPts += pts;
                if (bonus) existing.bonus = true;
                continue;
            }

            uniqueWords.set(word, {
                word,
                count: 1,
                totalPts: pts,
                bonus: !!bonus,
            });
        }

        return [...uniqueWords.values()];
    }

    _renderWordsFound() {
        const list = this.els.wordsFoundList;
        list.innerHTML = "";
        const words = this._getUniqueWordsFound();
        this.els.wordsFoundCount.textContent = `${words.length} unique word${words.length !== 1 ? "s" : ""} found`;

        if (words.length === 0) {
            list.innerHTML = '<p style="color:#666;text-align:center;padding:20px;">No words found this round.</p>';
        } else {
            for (const { word, count, totalPts, bonus } of words) {
                const item = document.createElement("div");
                item.className = "word-found-item" + (bonus ? " bonus-word" : "") + (ENRICHED_DICT && ENRICHED_DICT[word.toLowerCase()] ? " wf-expandable" : "");
                const detailHtml = this._buildWordFoundDetail(word);
                item.innerHTML = `
                    <span class="word-found-text">${word}</span>
                    <span class="word-found-pts">${count > 1 ? `x${count} · ` : ""}+${totalPts} pts</span>
                    ${detailHtml}
                `;
                if (detailHtml) {
                    item.addEventListener("click", () => item.classList.toggle("wf-expanded"));
                }
                list.appendChild(item);
            }
        }

        // Populate bonus words page
        const bonusList = this.els.bonusWordsList;
        bonusList.innerHTML = "";
        const bonusWords = words.filter(w => w.bonus);
        const hasBonus = this._hasBonusWordsView();

        if (hasBonus) {
            this.els.wfDots.classList.remove("hidden");
            // Determine bonus label
            const ch = this.activeChallenge || this._gameOverChallenge;
            let label = "Bonus Words";
            if (ch === CHALLENGE_TYPES.TARGET_WORD) {
                label = "◎ Target Words";
            } else if (ch === CHALLENGE_TYPES.WORD_CATEGORY) {
                const catKey = this.activeCategoryKey || this._gameOverCategoryKey;
                const catMeta = catKey && WORD_CATEGORIES[catKey];
                label = catMeta ? `${catMeta.icon} ${catMeta.label}` : "▦ Category Words";
            }
            this.els.bonusWordsCount.textContent = `${bonusWords.length} ${label} found`;

            if (bonusWords.length === 0) {
                bonusList.innerHTML = '<p style="color:#666;text-align:center;padding:20px;">No bonus words found.</p>';
            } else {
                for (const { word, count, totalPts } of bonusWords) {
                    const item = document.createElement("div");
                    item.className = "word-found-item bonus-word" + (ENRICHED_DICT && ENRICHED_DICT[word.toLowerCase()] ? " wf-expandable" : "");
                    const detailHtml = this._buildWordFoundDetail(word);
                    item.innerHTML = `
                        <span class="word-found-text">${word}</span>
                        <span class="word-found-pts">${count > 1 ? `x${count} · ` : ""}+${totalPts} pts</span>
                        ${detailHtml}
                    `;
                    if (detailHtml) {
                        item.addEventListener("click", () => item.classList.toggle("wf-expanded"));
                    }
                    bonusList.appendChild(item);
                }
            }
        } else {
            this.els.wfDots.classList.add("hidden");
            this.els.bonusWordsCount.textContent = "";
        }
    }

    // ── Music UI rendering ──

    _formatTrackTime(seconds) {
        if (!seconds || !isFinite(seconds)) return "0:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, "0")}`;
    }

    _updateMusicUI() {
        const track = this.music.getCurrentTrack();
        const playing = this.music.playing;

        // Full now-playing bar (music screen)
        this.els.npTitle.textContent = track ? track.title : "No track playing";
        this.els.npArtist.textContent = track ? track.artist : "";
        this._setMusicControlButton(this.els.npPlay, playing ? "pause" : "play", playing ? "Pause" : "Play");

        // Shuffle button active state
        this.els.npShuffle.classList.toggle("active", this.music.shuffleOn);

        // Repeat button icon & active state
        this._updateRepeatButton();

        // Volume icon
        this._updateVolumeIcon();

        // Volume slider sync
        this.els.npVolumeSlider.value = Math.round(this.music.getVolume() * 100);

        // Highlight playing track in list
        this.els.trackList.querySelectorAll(".track-item").forEach(el => {
            const isCurrent = el.dataset.trackId === this.music.currentTrackId;
            el.classList.toggle("playing", isCurrent);
            el.classList.toggle("paused", isCurrent && !playing);
            const btn = el.querySelector(".track-play-btn");
            if (btn) {
                // Keep EQ bars, just swap the text node
                const textNode = btn.childNodes[0];
                if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                    textNode.textContent = (isCurrent && playing) ? "⏸" : "▶";
                }
            }
        });

        // Mini bar
        this._updateMiniNowPlaying();
    }

    _updateRepeatButton() {
        const mode = this.music.repeatMode;
        if (mode === "off") {
            this._setMusicControlButton(this.els.npRepeat, "repeatAll", "Repeat");
            this.els.npRepeat.classList.remove("active");
        } else if (mode === "all") {
            this._setMusicControlButton(this.els.npRepeat, "repeatAll", "Repeat All");
            this.els.npRepeat.classList.add("active");
        } else {
            this._setMusicControlButton(this.els.npRepeat, "repeatOne", "Repeat One");
            this.els.npRepeat.classList.add("active");
        }
    }

    _updateVolumeIcon() {
        const vol = this.music.getVolume();
        const muted = this.musicMuted;
        let icon;
        if (muted || vol === 0) icon = "volumeMute";
        else if (vol < 0.5) icon = "volumeLow";
        else icon = "volumeHigh";
        this._setMusicControlButton(this.els.npVolumeIcon, icon, "Volume");
    }

    _updateSleepTimerModal() {
        const remaining = this.music.getSleepTimerRemaining();
        this.els.sleepTimerClear.classList.toggle("hidden", remaining <= 0);
    }

    _updateMusicProgress(currentTime, duration) {
        const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
        this.els.npProgressFill.style.width = pct + "%";
        this.els.npProgressThumb.style.left = pct + "%";
        this.els.npCurrentTime.textContent = this._formatTrackTime(currentTime);
        this.els.npDuration.textContent = this._formatTrackTime(duration);
        // Sync global dropdown progress bar
        this._syncGlobalMusicProgress();
    }

    _updateMiniNowPlaying() {
        // Keep global music dropdown in sync
        this._syncGlobalMusicPanel();
    }

    // ── Tutorial System (Sub-menu + Animated Canvas Slides) ──

    _initTutorialSlides() {
        if (this._tutorialCategories) return;

        // ── Drawing helpers (shared by all slide animations) ──
        const gL = (w, h, gs, yBias = 0) => {
            const cs = Math.floor(Math.min(w * 0.8, h * 0.6) / gs);
            return { cs, ox: (w - cs * gs) / 2, oy: (h - cs * gs) / 2 + yBias };
        };
        const gBg = (ctx, ox, oy, cs, gs) => {
            for (let r = 0; r < gs; r++) for (let c = 0; c < gs; c++) {
                ctx.fillStyle = '#353530';
                ctx.fillRect(ox + c * cs + 1, oy + r * cs + 1, cs - 2, cs - 2);
                ctx.strokeStyle = '#4a493e'; ctx.lineWidth = 1;
                ctx.strokeRect(ox + c * cs, oy + r * cs, cs, cs);
            }
        };
        const gC = (ctx, ox, oy, cs, r, c, ltr, bg, glw) => {
            const x = ox + c * cs, y = oy + r * cs;
            ctx.fillStyle = bg || '#3a3933';
            ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
            if (glw) {
                ctx.save(); ctx.shadowColor = glw; ctx.shadowBlur = 10;
                ctx.strokeStyle = glw; ctx.lineWidth = 2;
                ctx.strokeRect(x + 3, y + 3, cs - 6, cs - 6); ctx.restore();
            }
            if (ltr) {
                ctx.fillStyle = '#fff';
                ctx.font = `bold ${Math.floor(cs * 0.45)}px sans-serif`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(ltr, x + cs / 2, y + cs / 2);
            }
        };
        const gF = (ctx, ox, oy, cs, r, c, ltr) => {
            const x = ox + c * cs, y = oy + r * cs;
            ctx.fillStyle = '#3a3933';
            ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
            ctx.save(); ctx.shadowColor = '#e2d8a6'; ctx.shadowBlur = 12;
            ctx.strokeStyle = '#e2d8a6'; ctx.lineWidth = 2;
            ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4); ctx.restore();
            ctx.fillStyle = '#fff';
            ctx.font = `bold ${Math.floor(cs * 0.45)}px sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(ltr, x + cs / 2, y + cs / 2);
        };
        const gG = (ctx, ox, oy, cs, r, c) => {
            const x = ox + c * cs, y = oy + r * cs;
            ctx.save(); ctx.strokeStyle = 'rgba(226,216,166,0.2)'; ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
            ctx.setLineDash([]); ctx.restore();
        };
        const gT = (ctx, x, y, txt, clr, sz, a) => {
            ctx.save();
            if (a !== undefined) ctx.globalAlpha = a;
            ctx.fillStyle = clr || '#e2d8a6';
            ctx.font = `bold ${sz || 16}px sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(txt, x, y); ctx.restore();
        };
        const gA = (ctx, x, y, dir, sz) => {
            sz = sz || 18;
            ctx.save(); ctx.strokeStyle = '#e2d8a6'; ctx.lineWidth = 3;
            ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
            const h = sz * 0.4;
            if (dir === 'left') {
                ctx.moveTo(x + sz, y); ctx.lineTo(x, y);
                ctx.lineTo(x + h, y - h); ctx.moveTo(x, y); ctx.lineTo(x + h, y + h);
            } else if (dir === 'right') {
                ctx.moveTo(x - sz, y); ctx.lineTo(x, y);
                ctx.lineTo(x - h, y - h); ctx.moveTo(x, y); ctx.lineTo(x - h, y + h);
            } else {
                ctx.moveTo(x, y - sz); ctx.lineTo(x, y);
                ctx.lineTo(x - h, y - h); ctx.moveTo(x, y); ctx.lineTo(x + h, y - h);
            }
            ctx.stroke(); ctx.restore();
        };
        const gTap = (ctx, x, y, t) => {
            const p = 0.5 + 0.5 * Math.sin(t * 6);
            ctx.save();
            ctx.beginPath(); ctx.arc(x, y, 10 + p * 12, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(226,216,166,${0.3 + p * 0.5})`; ctx.lineWidth = 2; ctx.stroke();
            ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#e2d8a6'; ctx.fill(); ctx.restore();
        };
        const ease = v => v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2;
        const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

        // ── Slide Definitions ──

        this._tutorialCategories = [
            // ═══ HOW TO PLAY ═══
            {
                id: 'basics', icon: '▷', label: 'How to Play',
                desc: 'Learn the basics — dropping letters, forming words, and scoring points',
                slides: [
                    {
                        title: 'Falling Letters',
                        desc: 'Letters fall one at a time from the top. When a block hits the bottom or lands on another letter, it locks in place. Check the preview above the grid to see what\'s coming next. The game ends when there\'s no room for a new block!',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const placed = [[4,0,'W'],[4,1,'O'],[4,2,'R'],[4,3,'D'],[4,4,'S'],
                                            [3,1,'A'],[3,3,'L'],[3,4,'E']];
                            for (const [r,c,l] of placed) gC(ctx, ox, oy, cs, r, c, l, '#3a3933');
                            const ltrs = 'TSPKRN', cyc = t % 3;
                            const ltr = ltrs[Math.floor(t / 3) % ltrs.length];
                            const tgtR = 2, col = 2;
                            const row = cyc < 2.2 ? lerp(-1, tgtR, ease(Math.min(cyc / 2.2, 1))) : tgtR;
                            gG(ctx, ox, oy, cs, tgtR, col);
                            gF(ctx, ox, oy, cs, clamp(row, -0.5, tgtR), col, ltr);
                            const nx = ltrs[(Math.floor(t / 3) + 1) % ltrs.length];
                            gT(ctx, w / 2, oy - cs * 0.9, 'Next: ' + nx, '#777', Math.floor(cs * 0.35));
                        }
                    },
                    {
                        title: 'Moving & Dropping',
                        desc: 'Swipe left or right to move a falling block. Swipe down to drop it instantly. On desktop, use arrow keys to move and space or down to drop. Once a block locks in, it can\'t be moved!',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const placed = [[4,1,'H'],[4,2,'E'],[4,3,'L'],[4,4,'P'],[3,3,'A']];
                            for (const [r,c,l] of placed) gC(ctx, ox, oy, cs, r, c, l, '#3a3933');
                            const ph = t % 7;
                            let col, row;
                            if (ph < 2) {
                                col = 2 + ease(Math.min(ph, 1)) * 2; row = 0.5;
                                const ax = ox + 3.5 * cs, ay = oy + 0.5 * cs;
                                gA(ctx, ax, ay, 'right', cs * 0.35);
                                gT(ctx, w / 2, oy - cs * 0.7, 'Swipe Right →', '#e2d8a6', Math.floor(cs * 0.3));
                            } else if (ph < 4) {
                                const p = ph - 2;
                                col = 4 - ease(Math.min(p, 1)) * 4; row = 0.5;
                                const ax = ox + 1.5 * cs, ay = oy + 0.5 * cs;
                                gA(ctx, ax, ay, 'left', cs * 0.35);
                                gT(ctx, w / 2, oy - cs * 0.7, '← Swipe Left', '#e2d8a6', Math.floor(cs * 0.3));
                            } else {
                                const p = ph - 4;
                                col = 0; row = clamp(ease(Math.min(p * 2, 1)) * 3, 0, 3);
                                gA(ctx, ox + 0.5 * cs, oy + 1.5 * cs, 'down', cs * 0.35);
                                gT(ctx, w / 2, oy - cs * 0.7, 'Swipe Down ↓', '#e2d8a6', Math.floor(cs * 0.3));
                            }
                            col = clamp(Math.round(col), 0, gs - 1);
                            gG(ctx, ox, oy, cs, col === 0 ? 3 : 4, col);
                            gF(ctx, ox, oy, cs, clamp(row, 0, 4), col, 'M');
                        }
                    },
                    {
                        title: 'Forming Words',
                        desc: 'The game scans for valid words in all 8 directions — horizontal, vertical, and diagonal. When a word is found, the letters glow green. Words must be 3+ letters (2-letter words count on small grids). Over 20,000 words in the dictionary!',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const grid = [
                                [' ',' ',' ',' ','D'],
                                [' ',' ',' ','O',' '],
                                [' ',' ','G',' ',' '],
                                [' ','A','O',' ',' '],
                                ['C','A','T','E','R']
                            ];
                            const words = [
                                { cells:[[4,0],[4,1],[4,2]], label:'→ Horizontal', name:'CAT' },
                                { cells:[[4,2],[3,2],[2,2]], label:'↕ Vertical', name:'TOG' },
                                { cells:[[4,2],[3,1],[2,0]], label:'↗ Diagonal', name:'TAX' }
                            ];
                            const wi = Math.floor(t * 0.5) % 3;
                            const active = words[wi];
                            for (let r = 0; r < gs; r++) for (let c = 0; c < gs; c++) {
                                if (grid[r][c] === ' ') continue;
                                const hit = active.cells.some(([wr,wc]) => wr === r && wc === c);
                                gC(ctx, ox, oy, cs, r, c, grid[r][c],
                                   hit ? '#4a5c38' : '#3a3933',
                                   hit ? '#8cb860' : null);
                            }
                            gT(ctx, w / 2, oy - cs * 0.7, active.label, '#8cb860', Math.floor(cs * 0.35));
                        }
                    },
                    {
                        title: 'Tap to Claim',
                        desc: 'When letters glow green, tap any highlighted letter to claim the word! Letters are cleared, you earn points based on length, and everything above drops down to fill the gaps. You can claim while a block is falling!',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const cyc = t % 4;
                            const placed = [[4,0,'F'],[4,1,'U'],[4,2,'N'],[4,3,'K'],[4,4,'Y'],
                                            [3,0,'R'],[3,2,'S'],[3,4,'E']];
                            const wordCells = [[4,0],[4,1],[4,2]];
                            if (cyc < 2.5) {
                                for (const [r,c,l] of placed) {
                                    const hit = wordCells.some(([wr,wc]) => wr === r && wc === c);
                                    gC(ctx, ox, oy, cs, r, c, l,
                                       hit ? '#4a5c38' : '#3a3933',
                                       hit ? '#8cb860' : null);
                                }
                                if (cyc > 0.5) {
                                    const tapX = ox + 1 * cs + cs / 2;
                                    const tapY = oy + 4 * cs + cs / 2;
                                    gTap(ctx, tapX, tapY, t);
                                    gT(ctx, w / 2, oy - cs * 0.7, 'TAP to claim!', '#e2d8a6', Math.floor(cs * 0.35));
                                } else {
                                    gT(ctx, w / 2, oy - cs * 0.7, 'Word found!', '#8cb860', Math.floor(cs * 0.35));
                                }
                            } else {
                                const alpha = 1 - (cyc - 2.5) * 2;
                                for (const [r,c,l] of placed) {
                                    const hit = wordCells.some(([wr,wc]) => wr === r && wc === c);
                                    if (hit) {
                                        ctx.save(); ctx.globalAlpha = Math.max(0, alpha);
                                        gC(ctx, ox, oy, cs, r, c, l, '#4a5c38', '#8cb860');
                                        ctx.restore();
                                    } else {
                                        gC(ctx, ox, oy, cs, r, c, l, '#3a3933');
                                    }
                                }
                                const pts = Math.floor(clamp(1 - alpha, 0, 1) * 90);
                                if (alpha < 0.5) gT(ctx, w / 2, oy + 2 * cs, '+' + pts + ' pts!', '#e2d8a6',
                                    Math.floor(cs * 0.5), clamp(1 - (cyc - 3) * 3, 0, 1));
                            }
                        }
                    },
                    {
                        title: 'Multi-Word Claims',
                        desc: 'If a green letter is shared by two or more words, tapping it claims them all at once! Look for spots where words cross — one tap scores every connected word. Great for big points!',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const cyc = t % 5;
                            const placed = [[2,2,'T'],[3,2,'A'],
                                            [4,0,'R'],[4,1,'A'],[4,2,'N'],[4,3,'K']];
                            const word1 = [[4,0],[4,1],[4,2],[4,3]]; // RANK
                            const word2 = [[2,2],[3,2],[4,2]]; // TAN
                            const allGreen = [...word1, ...word2];
                            const sharedR = 4, sharedC = 2; // N is shared
                            if (cyc < 3) {
                                for (const [r,c,l] of placed) {
                                    const hit = allGreen.some(([wr,wc]) => wr === r && wc === c);
                                    gC(ctx, ox, oy, cs, r, c, l,
                                       hit ? '#4a5c38' : '#3a3933',
                                       hit ? '#8cb860' : null);
                                }
                                if (cyc < 1.5) {
                                    gT(ctx, w / 2, oy - cs * 0.7, '"RANK" + "TAN"', '#8cb860', Math.floor(cs * 0.3));
                                } else {
                                    const tapX = ox + sharedC * cs + cs / 2;
                                    const tapY = oy + sharedR * cs + cs / 2;
                                    gTap(ctx, tapX, tapY, t);
                                    gT(ctx, w / 2, oy - cs * 0.7, 'TAP shared letter!', '#e2d8a6', Math.floor(cs * 0.3));
                                }
                            } else {
                                const alpha = 1 - (cyc - 3) * 0.8;
                                for (const [r,c,l] of placed) {
                                    const hit = allGreen.some(([wr,wc]) => wr === r && wc === c);
                                    if (hit) {
                                        ctx.save(); ctx.globalAlpha = Math.max(0, alpha);
                                        gC(ctx, ox, oy, cs, r, c, l, '#4a5c38', '#8cb860');
                                        ctx.restore();
                                    } else {
                                        gC(ctx, ox, oy, cs, r, c, l, '#3a3933');
                                    }
                                }
                                const pts = Math.floor(clamp(1 - alpha, 0, 1) * 340);
                                if (alpha < 0.5) gT(ctx, w / 2, oy + 2 * cs, '+' + pts + ' pts!', '#e2d8a6',
                                    Math.floor(cs * 0.5), clamp(1 - (cyc - 3.8) * 3, 0, 1));
                            }
                        }
                    },
                    {
                        title: 'Chains & Scoring',
                        desc: 'Points = word length² × 10 (3 letters = 90 pts, 5 letters = 250 pts). Rare letters like Q, Z, X, J earn extra bonus points. After clearing a word, letters drop down — if they form a new word, that\'s a chain worth +50 bonus!',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const cyc = t % 6;
                            if (cyc < 2) {
                                const cells = [[4,0,'S'],[4,1,'E'],[4,2,'T'],[4,3,'X'],[4,4,'L'],
                                               [3,0,'R'],[3,1,'A'],[3,2,'N'],[3,4,'D'],
                                               [2,2,'C'],[2,4,'O']];
                                const word1 = [[4,0],[4,1],[4,2]];
                                for (const [r,c,l] of cells) {
                                    const hit = word1.some(([wr,wc]) => wr === r && wc === c);
                                    gC(ctx, ox, oy, cs, r, c, l, hit ? '#4a5c38' : '#3a3933', hit ? '#8cb860' : null);
                                }
                                gT(ctx, w / 2, oy - cs * 0.7, '"SET" found!', '#8cb860', Math.floor(cs * 0.35));
                            } else if (cyc < 3.5) {
                                const p = cyc - 2;
                                const fallCells = [[3,0,'R'],[3,1,'A'],[3,2,'N'],[3,4,'D'],
                                                   [2,2,'C'],[2,4,'O']];
                                const landedCells = [[4,0,'R'],[4,1,'A'],[4,2,'N'],[4,4,'D'],
                                                     [3,2,'C'],[3,4,'O'],[4,3,'X'],[4,4,'L']];
                                const cells = p < 0.8 ? fallCells.map(([r,c,l]) =>
                                    [lerp(r, r + 1, ease(Math.min(p / 0.8, 1))), c, l]
                                ) : landedCells.map(([r,c,l]) => [r,c,l]);
                                for (const [r,c,l] of cells) gC(ctx, ox, oy, cs, Math.round(r), c, l, '#3a3933');
                                gT(ctx, w / 2, oy - cs * 0.7, 'Letters fall...', '#aaa', Math.floor(cs * 0.35));
                            } else {
                                const cells = [[4,0,'R'],[4,1,'A'],[4,2,'N'],[4,3,'X'],[4,4,'D'],
                                               [3,2,'C'],[3,4,'O']];
                                const word2 = [[4,0],[4,1],[4,2]];
                                for (const [r,c,l] of cells) {
                                    const hit = word2.some(([wr,wc]) => wr === r && wc === c);
                                    gC(ctx, ox, oy, cs, r, c, l, hit ? '#4a5c38' : '#3a3933', hit ? '#8cb860' : null);
                                }
                                const flash = Math.sin(t * 8) > 0;
                                gT(ctx, w / 2, oy - cs * 0.7, 'CHAIN +50!', flash ? '#b0a878' : '#e2d8a6',
                                    Math.floor(cs * 0.4));
                            }
                        }
                    },
                    {
                        title: 'Spawn Freeze',
                        desc: 'After a block lands, you get a 2-second pause before the next one falls. Use this to scan the board! Swipe down to skip the wait. In Speed Round, there\'s no freeze — blocks fall immediately!',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const placed = [[4,0,'P'],[4,1,'L'],[4,2,'A'],[4,3,'N'],[4,4,'E'],
                                            [3,2,'T']];
                            for (const [r,c,l] of placed) gC(ctx, ox, oy, cs, r, c, l, '#3a3933');
                            const cyc = t % 5;
                            if (cyc < 2) {
                                const row = lerp(-1, 2, ease(Math.min(cyc / 1.5, 1)));
                                gG(ctx, ox, oy, cs, 2, 2);
                                gF(ctx, ox, oy, cs, clamp(row, -0.5, 2), 2, 'H');
                            } else if (cyc < 4) {
                                gC(ctx, ox, oy, cs, 2, 2, 'H', '#3a3933');
                                const remain = 2 - (cyc - 2);
                                const barW = cs * 3, barH = 8;
                                const bx = (w - barW) / 2, by = oy - cs * 1.2;
                                ctx.fillStyle = '#4a493e';
                                ctx.fillRect(bx, by, barW, barH);
                                ctx.fillStyle = '#e2d8a6';
                                ctx.fillRect(bx, by, barW * (remain / 2), barH);
                                gT(ctx, w / 2, by - 14, remain.toFixed(1) + 's', '#e2d8a6', Math.floor(cs * 0.3));
                                if (cyc > 3) {
                                    gA(ctx, w / 2, by + cs * 0.8, 'down', 14);
                                    gT(ctx, w / 2, by + cs * 1.4, 'Swipe ↓ to skip', '#888', Math.floor(cs * 0.22));
                                }
                            } else {
                                gC(ctx, ox, oy, cs, 2, 2, 'H', '#3a3933');
                                gF(ctx, ox, oy, cs, -0.5, 2, 'R');
                                gT(ctx, w / 2, oy - cs * 0.9, 'Next block!', '#8cb860', Math.floor(cs * 0.3));
                            }
                        }
                    },
                    {
                        title: 'Pause & Resume',
                        desc: 'Tap ⏸ to pause the game. The timer stops and no blocks fall. From the pause menu you can view found words or toggle music. Tap Resume to continue. On desktop, press Escape or P.',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const placed = [[4,0,'G'],[4,1,'A'],[4,2,'M'],[4,3,'E'],[4,4,'S'],
                                            [3,1,'R'],[3,2,'I'],[3,3,'D']];
                            for (const [r,c,l] of placed) gC(ctx, ox, oy, cs, r, c, l, '#3a3933');
                            const cyc = t % 4;
                            // Pause button position - right side, near top (spawn area)
                            const btnX = ox + cs * gs + cs * 0.5, btnY = oy + cs * 0.5;
                            const btnR = cs * 0.35;
                            if (cyc < 1.5) {
                                // Show the pause icon pulsing
                                const pulse = 1 + Math.sin(t * 4) * 0.1;
                                ctx.save();
                                ctx.translate(btnX, btnY);
                                ctx.scale(pulse, pulse);
                                ctx.beginPath();
                                ctx.arc(0, 0, btnR, 0, Math.PI * 2);
                                ctx.fillStyle = 'rgba(255,255,255,0.15)';
                                ctx.fill();
                                ctx.fillStyle = '#fff';
                                ctx.font = `bold ${Math.floor(btnR * 1.1)}px sans-serif`;
                                ctx.textAlign = 'center';
                                ctx.textBaseline = 'middle';
                                ctx.fillText('⏸', 0, 1);
                                ctx.restore();
                                gTap(ctx, btnX, btnY, t);
                                gT(ctx, w / 2, oy - cs * 1.3, 'Tap ⏸ to pause!', '#e2d8a6', Math.floor(cs * 0.3));
                            } else {
                                // Show "PAUSED" overlay
                                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                                ctx.fillRect(ox, oy, cs * gs, cs * gs);
                                const flash = Math.sin(t * 3) > 0 ? '#fff' : '#b0a878';
                                gT(ctx, w / 2, oy + cs * 2.5, '⏸ PAUSED', flash, Math.floor(cs * 0.55));
                                gT(ctx, w / 2, oy + cs * 3.3, 'Tap Resume to continue', '#999', Math.floor(cs * 0.22));
                            }
                        }
                    },
                    {
                        title: 'Hints',
                        desc: 'Toggle hints with the ◈ button on the right side of the screen. When on, cells glow orange if they\'re one letter away from completing a word. Drop the right letter there and the word forms instantly! Hints update after every move.',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const placed = [[4,0,'C'],[4,1,'A'],[4,3,'S'],[4,4,'E'],
                                            [3,0,'R'],[3,2,'N']];
                            for (const [r,c,l] of placed) gC(ctx, ox, oy, cs, r, c, l, '#3a3933');
                            const cyc = t % 5;
                            // Orange glowing hint cell
                            const hintGlow = `rgba(255,165,0,${0.4 + 0.3 * Math.sin(t * 4)})`;
                            gC(ctx, ox, oy, cs, 4, 2, '', '#3a3933', hintGlow);
                            // Hint toggle button on right side
                            const btnX = ox + gs * cs + cs * 0.6, btnY = oy + gs * cs * 0.5;
                            const btnR = cs * 0.35;
                            const pulse = 1 + Math.sin(t * 3) * 0.08;
                            ctx.save();
                            ctx.translate(btnX, btnY); ctx.scale(pulse, pulse);
                            ctx.beginPath(); ctx.arc(0, 0, btnR, 0, Math.PI * 2);
                            ctx.fillStyle = 'rgba(255,165,0,0.2)'; ctx.fill();
                            ctx.strokeStyle = 'rgba(255,165,0,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
                            ctx.fillStyle = '#ffa500';
                            ctx.font = `bold ${Math.floor(btnR * 0.9)}px sans-serif`;
                            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                            ctx.fillText('◈', 0, 0);
                            ctx.restore();
                            gT(ctx, w / 2, oy - cs * 0.7, 'Hint: one letter away!', '#b0a878', Math.floor(cs * 0.3));
                            if (cyc > 2) {
                                const row = lerp(-1, 4, ease(clamp((cyc - 2) / 1.5, 0, 1)));
                                gF(ctx, ox, oy, cs, clamp(row, -0.5, 4), 2, 'T');
                                if (cyc > 3.8) {
                                    const word = [[4,0],[4,1],[4,2]];
                                    for (const [wr,wc] of word) {
                                        ctx.save(); ctx.shadowColor = '#8cb860'; ctx.shadowBlur = 8;
                                        ctx.strokeStyle = '#8cb860'; ctx.lineWidth = 2;
                                        ctx.strokeRect(ox + wc * cs + 3, oy + wr * cs + 3, cs - 6, cs - 6);
                                        ctx.restore();
                                    }
                                    gC(ctx, ox, oy, cs, 4, 2, 'T', '#4a5c38', '#8cb860');
                                    gT(ctx, w / 2, oy + gs * cs + cs * 0.5, '"CAT" complete!', '#8cb860', Math.floor(cs * 0.3));
                                }
                            }
                        }
                    },
                    {
                        title: 'Bonus Slots',
                        desc: 'Buy up to 3 bonus slots in the Shop to save power-ups for later. Fill a slot with any bonus type for 500 coins. During gameplay, tap the ⬡ button on the left to open your slots, then tap a filled slot to use that bonus!',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            // Some letters on the grid
                            const placed = [[4,0,'W'],[4,1,'O'],[4,2,'R'],[4,3,'D'],[4,4,'S'],
                                            [3,1,'A'],[3,3,'L']];
                            for (const [r,c,l] of placed) gC(ctx, ox, oy, cs, r, c, l, '#3a3933');

                            const cyc = t % 8;

                            // ⬡ toggle button on left side
                            const toggleX = ox - cs * 1.2, toggleY = oy + gs * cs * 0.35;
                            const toggleR = cs * 0.45;
                            const isOpen = cyc > 1.5;
                            const togglePulse = (!isOpen && cyc > 0.5) ? 1 + Math.sin(t * 5) * 0.1 : 1;

                            ctx.save();
                            ctx.translate(toggleX, toggleY); ctx.scale(togglePulse, togglePulse);
                            ctx.beginPath(); ctx.arc(0, 0, toggleR, 0, Math.PI * 2);
                            ctx.fillStyle = isOpen ? 'rgba(226,216,166,0.2)' : 'rgba(255,255,255,0.08)';
                            ctx.fill();
                            ctx.strokeStyle = isOpen ? '#e2d8a6' : 'rgba(226,216,166,0.5)';
                            ctx.lineWidth = 1.5; ctx.stroke();
                            ctx.fillStyle = isOpen ? '#e2d8a6' : 'rgba(226,216,166,0.55)';
                            ctx.font = `bold ${Math.floor(toggleR * 0.9)}px sans-serif`;
                            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                            ctx.fillText('⬡', 0, 1);
                            ctx.restore();

                            if (!isOpen) {
                                gTap(ctx, toggleX, toggleY, t);
                                gT(ctx, w / 2, oy - cs * 0.7, 'Tap ⬡ to open slots', '#e2d8a6', Math.floor(cs * 0.3));
                            }

                            // Radial slot buttons (fan out when open)
                            if (isOpen) {
                                const slotData = [
                                    { icon: '💣', filled: true },
                                    { icon: '★', filled: true },
                                    { icon: '', filled: false }
                                ];
                                const slotR = cs * 0.35;
                                const fanProgress = ease(clamp((cyc - 1.5) / 0.8, 0, 1));

                                for (let i = 0; i < 3; i++) {
                                    const sd = slotData[i];
                                    const targetY = toggleY + (i + 1) * (slotR * 2.4);
                                    const slotY = lerp(toggleY, targetY, fanProgress);
                                    const slotX = toggleX;

                                    ctx.beginPath(); ctx.arc(slotX, slotY, slotR, 0, Math.PI * 2);
                                    if (sd.filled) {
                                        ctx.fillStyle = 'rgba(212,160,96,0.15)'; ctx.fill();
                                        ctx.strokeStyle = '#d4a060'; ctx.lineWidth = 1.5; ctx.stroke();
                                        ctx.fillStyle = '#fff';
                                        ctx.font = `${Math.floor(slotR * 0.8)}px sans-serif`;
                                        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                        ctx.fillText(sd.icon, slotX, slotY);
                                    } else {
                                        ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
                                        ctx.setLineDash([3, 3]);
                                        ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.stroke();
                                        ctx.setLineDash([]);
                                        ctx.fillStyle = '#555';
                                        ctx.font = `${Math.floor(slotR * 0.6)}px sans-serif`;
                                        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                        ctx.fillText('—', slotX, slotY);
                                    }
                                }

                                // Tap a filled slot to use it
                                if (cyc > 3 && cyc < 5.5) {
                                    const tapSlotY = lerp(toggleY, toggleY + 1 * (slotR * 2.4), 1);
                                    gTap(ctx, toggleX, tapSlotY, t);
                                    gT(ctx, w / 2, oy - cs * 0.7, 'Tap a slot to use it!', '#d4a060', Math.floor(cs * 0.3));
                                }

                                // Show bonus activated
                                if (cyc > 5.5) {
                                    const flash = Math.sin(t * 6) > 0;
                                    gT(ctx, w / 2, oy - cs * 0.7, '💣 Bomb activated!',
                                        flash ? '#e2d8a6' : '#d4a060', Math.floor(cs * 0.35));
                                    // Show slot now empty
                                    const usedSlotY = lerp(toggleY, toggleY + 1 * (slotR * 2.4), 1);
                                    ctx.beginPath(); ctx.arc(toggleX, usedSlotY, slotR, 0, Math.PI * 2);
                                    ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
                                    ctx.setLineDash([3, 3]);
                                    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.stroke();
                                    ctx.setLineDash([]);
                                }
                            }

                            // Label at bottom
                            gT(ctx, w / 2, oy + gs * cs + cs * 0.5, 'Buy slots in Shop · Fill for 500 coins', '#706c58', Math.floor(cs * 0.22));
                        }
                    }
                ]
            },

            // ═══ BONUSES & POWER-UPS ═══
            {
                id: 'bonuses', icon: '◇', label: 'Bonuses & Power-Ups',
                desc: 'Earn powerful abilities every 1,000 points — 7 different types!',
                slides: [
                    {
                        title: 'Earning Bonuses',
                        desc: 'Every 1,000 points, you earn a random bonus! Tap the glowing button to activate it. There are 7 types: Letter Pick, Bomb, Wildcard, Line Clear, Freeze, Shuffle, and Score ×2. Most bonuses also award bonus points!',
                        draw(ctx, w, h, t) {
                            const cyc = t % 4;
                            const score = cyc < 2 ? Math.floor(lerp(800, 1000, ease(Math.min(cyc / 2, 1)))) : 1000;
                            gT(ctx, w / 2, h * 0.25, 'Score: ' + score, '#fff', 28);
                            if (cyc >= 2) {
                                const p = (cyc - 2) / 2;
                                const scale = 1 + Math.sin(p * Math.PI) * 0.3;
                                ctx.save();
                                ctx.translate(w / 2, h * 0.5);
                                ctx.scale(scale, scale);
                                gT(ctx, 0, 0, 'BONUS!', '#e2d8a6', 32);
                                ctx.restore();
                                const icons = ['A', '×', '★', '─', '□', '⇄', '×2'];
                                const ic = icons[Math.floor(t * 3) % icons.length];
                                gT(ctx, w / 2, h * 0.68, ic, '#fff', 36, 0.5 + p * 0.5);
                            }
                            const barW = w * 0.5, barH = 10;
                            const bx = (w - barW) / 2, by = h * 0.35;
                            ctx.fillStyle = '#4a493e'; ctx.fillRect(bx, by, barW, barH);
                            ctx.fillStyle = '#e2d8a6';
                            ctx.fillRect(bx, by, barW * ((score % 1000) / 1000 || (cyc >= 2 ? 1 : 0)), barH);
                        }
                    },
                    {
                        title: 'Letter Pick 🔤',
                        desc: 'Choose exactly which letter you want next! A full alphabet grid appears — tap any letter to select it. Perfect when you\'re one letter away from completing a big word.',
                        draw(ctx, w, h, t) {
                            const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                            const cols = 7, bsz = Math.floor(w / (cols + 2));
                            const rows = Math.ceil(26 / cols);
                            const gw = cols * bsz, gh = rows * bsz;
                            const ox = (w - gw) / 2, oy = (h - gh) / 2 - 20;
                            const selected = Math.floor(t * 2) % 26;
                            for (let i = 0; i < 26; i++) {
                                const r = Math.floor(i / cols), c = i % cols;
                                const x = ox + c * bsz, y = oy + r * bsz;
                                const sel = i === selected;
                                ctx.fillStyle = sel ? '#3a5a3a' : '#3a3933';
                                ctx.fillRect(x + 2, y + 2, bsz - 4, bsz - 4);
                                if (sel) {
                                    ctx.save(); ctx.shadowColor = '#e2d8a6'; ctx.shadowBlur = 10;
                                    ctx.strokeStyle = '#e2d8a6'; ctx.lineWidth = 2;
                                    ctx.strokeRect(x + 3, y + 3, bsz - 6, bsz - 6); ctx.restore();
                                }
                                ctx.fillStyle = sel ? '#e2d8a6' : '#b0a878';
                                ctx.font = `bold ${Math.floor(bsz * 0.5)}px sans-serif`;
                                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText(alphabet[i], x + bsz / 2, y + bsz / 2);
                            }
                            gT(ctx, w / 2, oy - bsz * 0.6, 'Pick your letter:', '#e2d8a6', 16);
                            gT(ctx, w / 2, oy + gh + bsz * 0.6,
                                'Selected: ' + alphabet[selected], '#8cb860', 18);
                        }
                    },
                    {
                        title: 'Bomb 💣',
                        desc: 'Your next block becomes a 💣 bomb. When it lands, it explodes and clears the entire row, column, and both diagonals (X + cross shape). You earn 15 points per letter cleared. Drop it in a crowded spot for maximum effect!',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const cyc = t % 4;
                            const bombCol = 2, bombRow = 2;
                            for (let r = 0; r < gs; r++) for (let c = 0; c < gs; c++) {
                                if (r >= 3 || (r === 2 && c !== bombCol))
                                    gC(ctx, ox, oy, cs, r, c, 'XYZAB'[c], '#3a3933');
                            }
                            if (cyc < 1.5) {
                                const row = lerp(-1, bombRow, ease(Math.min(cyc / 1.2, 1)));
                                gF(ctx, ox, oy, cs, clamp(row, -0.5, bombRow), bombCol, '💣');
                            } else if (cyc < 2.5) {
                                const p = (cyc - 1.5);
                                const flash = Math.sin(p * 20) > 0;
                                for (let r = 0; r < gs; r++) {
                                    if (r === bombRow || true) {
                                        const x = ox + bombCol * cs, y2 = oy + r * cs;
                                        ctx.fillStyle = flash ? 'rgba(255,100,0,0.5)' : 'rgba(255,200,0,0.3)';
                                        ctx.fillRect(x, y2, cs, cs);
                                    }
                                }
                                for (let c = 0; c < gs; c++) {
                                    const x2 = ox + c * cs, y = oy + bombRow * cs;
                                    ctx.fillStyle = flash ? 'rgba(255,100,0,0.5)' : 'rgba(255,200,0,0.3)';
                                    ctx.fillRect(x2, y, cs, cs);
                                }
                                gT(ctx, w / 2, oy - cs * 0.7, '💥 BOOM!', '#ff6600', Math.floor(cs * 0.45));
                            } else {
                                for (let r = 0; r < gs; r++) for (let c = 0; c < gs; c++) {
                                    if (r === bombRow || c === bombCol) continue;
                                    if (r >= 3) gC(ctx, ox, oy, cs, r, c, 'XYZAB'[c], '#3a3933');
                                }
                                gT(ctx, w / 2, oy - cs * 0.7, 'Row + Column cleared!', '#b0a878', Math.floor(cs * 0.3));
                            }
                        }
                    },
                    {
                        title: 'Wildcard ★',
                        desc: 'Places a golden ★ block that counts as any letter. The game checks all 26 possibilities to find valid words. One wildcard can complete multiple words at once if it sits at an intersection!',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const placed = [[4,0,'C'],[4,2,'T'],[4,3,'S'],[3,0,'R'],[3,2,'E']];
                            for (const [r,c,l] of placed) gC(ctx, ox, oy, cs, r, c, l, '#3a3933');
                            const cyc = t % 5;
                            if (cyc < 2) {
                                const row = lerp(-1, 4, ease(Math.min(cyc / 1.5, 1)));
                                gF(ctx, ox, oy, cs, clamp(row, -0.5, 4), 1, '★');
                            } else {
                                const morphLetters = 'AEIOU';
                                const mi = Math.floor((cyc - 2) * 2) % morphLetters.length;
                                const ml = morphLetters[mi];
                                const x = ox + 1 * cs, y = oy + 4 * cs;
                                ctx.fillStyle = '#4a3a1e';
                                ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
                                ctx.save(); ctx.shadowColor = '#e2d8a6'; ctx.shadowBlur = 15;
                                ctx.strokeStyle = '#e2d8a6'; ctx.lineWidth = 2;
                                ctx.strokeRect(x + 3, y + 3, cs - 6, cs - 6); ctx.restore();
                                ctx.fillStyle = '#e2d8a6';
                                ctx.font = `bold ${Math.floor(cs * 0.45)}px sans-serif`;
                                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText('★' + ml, x + cs / 2, y + cs / 2);
                                if (ml === 'A') {
                                    const word = [[4,0],[4,1],[4,2]];
                                    for (const [wr,wc] of word) {
                                        ctx.save(); ctx.shadowColor = '#8cb860'; ctx.shadowBlur = 8;
                                        ctx.strokeStyle = '#8cb860'; ctx.lineWidth = 2;
                                        ctx.strokeRect(ox + wc * cs + 3, oy + wr * cs + 3, cs - 6, cs - 6);
                                        ctx.restore();
                                    }
                                    gT(ctx, w / 2, oy - cs * 0.7, '"CAT" found!', '#8cb860', Math.floor(cs * 0.35));
                                } else {
                                    gT(ctx, w / 2, oy - cs * 0.7, '★ = ' + ml + '?', '#e2d8a6', Math.floor(cs * 0.35));
                                }
                            }
                        }
                    },
                    {
                        title: 'Line Clear & Freeze',
                        desc: 'LINE CLEAR: Tap two letters in a straight line to select everything between them, then press Clear to remove them (20 pts each). FREEZE: Pauses block falling for 10 seconds (+50 pts). Tap the timer early to unfreeze and earn up to 100 bonus points!',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs, -10);
                            gBg(ctx, ox, oy, cs, gs);
                            const cyc = t % 8;
                            if (cyc < 4) {
                                // Line Clear demo — diagonal selection
                                const letters = [
                                    [2,0,'P'],[2,1,'L'],[2,2,'A'],[2,3,'N'],[2,4,'K'],
                                    [3,0,'R'],[3,1,'I'],[3,2,'D'],[3,3,'E'],[3,4,'S'],
                                    [4,0,'T'],[4,1,'O'],[4,2,'W'],[4,3,'N'],[4,4,'X']
                                ];
                                // Diagonal selection: (2,0)->(4,2)
                                const selected = [[2,0],[3,1],[4,2]];
                                for (const [r,c,l] of letters) {
                                    const isSel = cyc > 1 && selected.some(([sr,sc]) => sr === r && sc === c);
                                    gC(ctx, ox, oy, cs, r, c, l, isSel ? '#1e4a1e' : '#3a3933', isSel ? '#00c853' : null);
                                }
                                if (cyc < 1) {
                                    gT(ctx, w / 2, oy - cs * 0.7, 'Line Clear!', '#b0a878', Math.floor(cs * 0.35));
                                } else if (cyc < 2.2) {
                                    gT(ctx, w / 2, oy - cs * 0.7, 'Tap start & end', '#4ade80', Math.floor(cs * 0.3));
                                } else if (cyc < 3.2) {
                                    gT(ctx, w / 2, oy - cs * 0.7, 'Press Clear!', '#22c55e', Math.floor(cs * 0.35));
                                } else {
                                    // Show cleared
                                    for (const [r,c,l] of letters) {
                                        if (!selected.some(([sr,sc]) => sr === r && sc === c))
                                            gC(ctx, ox, oy, cs, r, c, l, '#3a3933');
                                    }
                                    gT(ctx, w / 2, oy - cs * 0.7, '+60 pts!', '#e2d8a6', Math.floor(cs * 0.35));
                                }
                            } else {
                                // Freeze demo with tap-to-unfreeze
                                for (let r = 3; r < gs; r++) for (let c = 0; c < gs; c++)
                                    gC(ctx, ox, oy, cs, r, c, 'FGHIJ'[c], '#3a3933');
                                const freezePhase = cyc - 4;
                                if (freezePhase < 2.5) {
                                    const remain = 10 - freezePhase * 2;
                                    gT(ctx, w / 2, oy - cs * 0.9, '❄️ FREEZE +50', '#64b5f6', Math.floor(cs * 0.4));
                                    const barW = gs * cs * 0.8, barH = 8;
                                    const bx = (w - barW) / 2, by = oy - cs * 0.3;
                                    ctx.fillStyle = '#4a493e'; ctx.fillRect(bx, by, barW, barH);
                                    ctx.fillStyle = '#64b5f6';
                                    ctx.fillRect(bx, by, barW * Math.max(0, remain / 10), barH);
                                    gT(ctx, w / 2, by - 14, remain.toFixed(1) + 's', '#64b5f6', Math.floor(cs * 0.25));
                                    gT(ctx, w / 2, oy + gs * cs + cs * 0.3, 'tap to unfreeze early!', '#64b5f6', Math.floor(cs * 0.22));
                                } else {
                                    const flash = Math.sin(t * 8) > 0;
                                    gT(ctx, w / 2, oy - cs * 0.7, flash ? '👆 TAP!' : '❄️ Unfreeze!', '#64b5f6', Math.floor(cs * 0.4));
                                    gT(ctx, w / 2, oy + gs * cs + cs * 0.3, '+50 bonus pts!', '#e2d8a6', Math.floor(cs * 0.28));
                                }
                                const snowT = t * 2;
                                for (let i = 0; i < 6; i++) {
                                    const sx = ox + (Math.sin(snowT + i * 1.5) * 0.5 + 0.5) * gs * cs;
                                    const sy = oy + ((snowT * 0.3 + i * 0.2) % 1) * gs * cs;
                                    gT(ctx, sx, sy, '❄', '#64b5f6', 10, 0.4);
                                }
                            }
                        }
                    },
                    {
                        title: 'Shuffle & Score ×2',
                        desc: 'SHUFFLE rearranges all letters on the grid randomly — great for breaking up dead-end layouts. SCORE ×2 doubles the points of your next claimed word. Save it for a long word to maximize the payoff!',
                        draw(ctx, w, h, t) {
                            const gs = 4, { cs, ox, oy } = gL(w, h, gs, -10);
                            const cyc = t % 8;
                            if (cyc < 4) {
                                gBg(ctx, ox, oy, cs, gs);
                                const ltrs1 = 'ABCDEFGHIJKLMNOP';
                                const shuffled = 'DKBOPFMACGJELNIH';
                                const p = ease(clamp((cyc - 0.5) / 1.5, 0, 1));
                                for (let r = 0; r < gs; r++) for (let c = 0; c < gs; c++) {
                                    const i = r * gs + c;
                                    const l = cyc < 2 ? ltrs1[i] : shuffled[i];
                                    const jitter = cyc > 0.5 && cyc < 2 ? Math.sin(t * 20 + i) * 3 : 0;
                                    ctx.save(); ctx.translate(jitter, jitter * 0.5);
                                    gC(ctx, ox, oy, cs, r, c, l, '#3a3933');
                                    ctx.restore();
                                }
                                gT(ctx, w / 2, oy - cs * 0.7, '🔀 Shuffle!',
                                   '#e040fb', Math.floor(cs * 0.4));
                            } else {
                                gBg(ctx, ox, oy, cs, gs);
                                for (let r = 0; r < gs; r++) for (let c = 0; c < gs; c++)
                                    gC(ctx, ox, oy, cs, r, c, 'WORD'[c], '#3a3933');
                                const flash = Math.sin(t * 5) > 0;
                                const badge = '×2';
                                gT(ctx, w / 2, oy - cs * 0.8, '💰 Score ×2 Active!',
                                    flash ? '#e2d8a6' : '#b0a878', Math.floor(cs * 0.35));
                                const word = [[3,0],[3,1],[3,2],[3,3]];
                                for (const [r,c] of word) {
                                    ctx.save(); ctx.shadowColor = '#e2d8a6'; ctx.shadowBlur = 8;
                                    ctx.strokeStyle = '#e2d8a6'; ctx.lineWidth = 2;
                                    ctx.strokeRect(ox + c * cs + 3, oy + r * cs + 3, cs - 6, cs - 6);
                                    ctx.restore();
                                }
                                if (cyc > 5.5) {
                                    const pts = '×2 = 180 pts!';
                                    gT(ctx, w / 2, oy + gs * cs + cs * 0.5, pts, '#e2d8a6', Math.floor(cs * 0.35));
                                }
                            }
                        }
                    }
                ]
            },

            // ═══ GAME MODES ═══
            {
                id: 'modes', icon: '◦', label: 'Game Modes',
                desc: 'Choose your playstyle — modes, grid sizes, difficulty & hints',
                slides: [
                    {
                        title: 'Sandbox & Timed',
                        desc: 'SANDBOX has no time limit — play until the grid fills up. Great for practice, but earns only 25% points and XP. TIMED gives you a countdown clock — score as much as you can before time runs out or the grid fills!',
                        draw(ctx, w, h, t) {
                            const mid = w / 2;
                            ctx.strokeStyle = '#4a493e'; ctx.lineWidth = 1;
                            ctx.beginPath(); ctx.moveTo(mid, h * 0.15); ctx.lineTo(mid, h * 0.85);
                            ctx.stroke();
                            gT(ctx, mid * 0.5, h * 0.2, 'SANDBOX', '#8cb860', 18);
                            gT(ctx, mid * 0.5, h * 0.35, '∞', '#8cb860', 48);
                            gT(ctx, mid * 0.5, h * 0.52, 'No timer', '#888', 13);
                            gT(ctx, mid * 0.5, h * 0.62, 'Relaxed play', '#888', 13);
                            const gs1 = 3, cs1 = Math.floor(mid * 0.22);
                            const ox1 = (mid - gs1 * cs1) / 2, oy1 = h * 0.68;
                            for (let r = 0; r < gs1; r++) for (let c = 0; c < gs1; c++) {
                                ctx.fillStyle = '#353530'; ctx.fillRect(ox1 + c * cs1 + 1, oy1 + r * cs1 + 1, cs1 - 2, cs1 - 2);
                                ctx.strokeStyle = '#4a493e'; ctx.strokeRect(ox1 + c * cs1, oy1 + r * cs1, cs1, cs1);
                            }
                            gT(ctx, mid * 1.5, h * 0.2, 'TIMED', '#c45c4a', 18);
                            const timeLeft = 300 - (t % 300);
                            const mm = Math.floor(timeLeft / 60), ss = Math.floor(timeLeft % 60);
                            gT(ctx, mid * 1.5, h * 0.35, `${mm}:${String(ss).padStart(2,'0')}`, '#c45c4a', 32);
                            gT(ctx, mid * 1.5, h * 0.52, 'Beat the clock', '#888', 13);
                            gT(ctx, mid * 1.5, h * 0.62, 'Race for points', '#888', 13);
                            const gs2 = 3, cs2 = cs1;
                            const ox2 = mid + (mid - gs2 * cs2) / 2, oy2 = h * 0.68;
                            for (let r = 0; r < gs2; r++) for (let c = 0; c < gs2; c++) {
                                ctx.fillStyle = '#353530'; ctx.fillRect(ox2 + c * cs2 + 1, oy2 + r * cs2 + 1, cs2 - 2, cs2 - 2);
                                ctx.strokeStyle = '#4a493e'; ctx.strokeRect(ox2 + c * cs2, oy2 + r * cs2, cs2, cs2);
                            }
                        }
                    },
                    {
                        title: 'Grid Sizes & Difficulty',
                        desc: 'Choose from 3×3 up to 8×8 grids. Larger grids give more room but more letters to manage. On 3×3 and 4×4, 2-letter words count! NORMAL mode requires minimum word length, HARD requires 4+ letters.',
                        draw(ctx, w, h, t) {
                            const sizes = [3, 5, 8];
                            const si = Math.floor(t * 0.4) % sizes.length;
                            const gs = sizes[si];
                            const { cs, ox, oy } = gL(w, h, gs, -15);
                            gBg(ctx, ox, oy, cs, gs);
                            for (let r = gs - 2; r < gs; r++) for (let c = 0; c < gs; c++)
                                gC(ctx, ox, oy, cs, r, c, String.fromCharCode(65 + (r * gs + c) % 26), '#3a3933');
                            gT(ctx, w / 2, oy - cs * 0.9, gs + '×' + gs + ' Grid', '#e2d8a6', 20);
                            const diffY = oy + gs * cs + 25;
                            gT(ctx, w * 0.3, diffY, 'Normal', '#8cb860', 14);
                            gT(ctx, w * 0.3, diffY + 20, '3+ letters', '#888', 11);
                            gT(ctx, w * 0.7, diffY, 'Hard', '#c45c4a', 14);
                            gT(ctx, w * 0.7, diffY + 20, '4+ letters', '#888', 11);
                        }
                    },
                    {
                        title: 'Hints System',
                        desc: 'Cells glowing orange are hints — they\'re one letter away from completing a word. Drop the right letter there to complete it instantly. Toggle hints on or off with the ◈ button during gameplay. Hints update in real-time as the grid changes.',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const placed = [[4,0,'C'],[4,1,'A'],[4,3,'S'],[4,4,'E'],
                                            [3,0,'R'],[3,2,'N']];
                            for (const [r,c,l] of placed) gC(ctx, ox, oy, cs, r, c, l, '#3a3933');
                            const cyc = t % 5;
                            const hintGlow = `rgba(255,165,0,${0.4 + 0.3 * Math.sin(t * 4)})`;
                            gC(ctx, ox, oy, cs, 4, 2, '', '#3a3933', hintGlow);
                            gT(ctx, w / 2, oy - cs * 0.7, 'Hint: one letter away!', '#b0a878', Math.floor(cs * 0.3));
                            if (cyc > 2) {
                                const row = lerp(-1, 4, ease(clamp((cyc - 2) / 1.5, 0, 1)));
                                gF(ctx, ox, oy, cs, clamp(row, -0.5, 4), 2, 'T');
                                if (cyc > 3.8) {
                                    const word = [[4,0],[4,1],[4,2]];
                                    for (const [wr,wc] of word) {
                                        ctx.save(); ctx.shadowColor = '#8cb860'; ctx.shadowBlur = 8;
                                        ctx.strokeStyle = '#8cb860'; ctx.lineWidth = 2;
                                        ctx.strokeRect(ox + wc * cs + 3, oy + wr * cs + 3, cs - 6, cs - 6);
                                        ctx.restore();
                                    }
                                    gC(ctx, ox, oy, cs, 4, 2, 'T', '#4a5c38', '#8cb860');
                                    gT(ctx, w / 2, oy + gs * cs + cs * 0.5, '"CAT" complete!', '#8cb860', Math.floor(cs * 0.3));
                                }
                            }
                        }
                    }
                ]
            },

            // ═══ CHALLENGES ═══
            {
                id: 'challenges', icon: '◎', label: 'Challenges',
                desc: 'Special timed modes with unique twists',
                slides: [
                    {
                        title: 'Target Word',
                        desc: 'A target word appears at the top. Spell it anywhere on the grid to earn a 200-point bonus and advance to the next level. Words get longer and harder as you progress. Your level is saved permanently. All challenges are 7 minutes.',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs, 15);
                            gBg(ctx, ox, oy, cs, gs);
                            const target = 'PLAY';
                            const targetY = oy - cs * 1.4;
                            ctx.fillStyle = '#1a1a2e';
                            const tw = cs * 5, th = cs * 0.8;
                            ctx.fillRect((w - tw) / 2, targetY - th / 2, tw, th);
                            ctx.strokeStyle = '#e2d8a6'; ctx.lineWidth = 1;
                            ctx.strokeRect((w - tw) / 2, targetY - th / 2, tw, th);
                            gT(ctx, w / 2, targetY, '◎ ' + target, '#e2d8a6', Math.floor(cs * 0.4));
                            const cyc = t % 6;
                            const letters = [
                                { l:'P', r:4, c:0, t:0 },
                                { l:'L', r:4, c:1, t:1.2 },
                                { l:'A', r:4, c:2, t:2.4 },
                                { l:'Y', r:4, c:3, t:3.6 }
                            ];
                            const otherCells = [[4,4,'E'],[3,0,'S'],[3,2,'T']];
                            for (const [r,c,l] of otherCells) gC(ctx, ox, oy, cs, r, c, l, '#3a3933');
                            for (const lt of letters) {
                                if (cyc < lt.t) continue;
                                const p = cyc - lt.t;
                                if (p < 1) {
                                    const row = lerp(-1, lt.r, ease(Math.min(p / 0.8, 1)));
                                    gF(ctx, ox, oy, cs, clamp(row, -0.5, lt.r), lt.c, lt.l);
                                } else {
                                    const complete = letters.every(x => cyc >= x.t + 1);
                                    gC(ctx, ox, oy, cs, lt.r, lt.c, lt.l,
                                        complete ? '#4a5c38' : '#3a3933',
                                        complete ? '#8cb860' : null);
                                }
                            }
                            if (cyc > 5) {
                                gT(ctx, w / 2, oy + gs * cs + cs * 0.5, '+200 BONUS!', '#e2d8a6',
                                    Math.floor(cs * 0.4), clamp((cyc - 5) * 3, 0, 1));
                            }
                        }
                    },
                    {
                        title: 'Speed Round',
                        desc: 'Blocks fall faster every 500 points — and there\'s no spawn freeze! Score as high as you can in 3 minutes before the grid fills up. Tests your reaction time and quick thinking.',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            for (let r = 3; r < gs; r++) for (let c = 0; c < gs; c++)
                                gC(ctx, ox, oy, cs, r, c, String.fromCharCode(65 + (r * gs + c) % 26), '#3a3933');
                            const speed = 0.5 + (t % 10) * 0.15;
                            const meterX = ox + gs * cs + 12, meterY = oy;
                            const meterH = gs * cs, meterW = 12;
                            ctx.fillStyle = '#4a493e'; ctx.fillRect(meterX, meterY, meterW, meterH);
                            const fill = Math.min(speed / 2, 1);
                            const grad = ctx.createLinearGradient(0, meterY + meterH, 0, meterY);
                            grad.addColorStop(0, '#8cb860'); grad.addColorStop(0.5, '#b0a878'); grad.addColorStop(1, '#c45c4a');
                            ctx.fillStyle = grad;
                            ctx.fillRect(meterX, meterY + meterH * (1 - fill), meterW, meterH * fill);
                            gT(ctx, meterX + meterW / 2, meterY - 14, '▲', '#fff', 14);
                            const fallSpeed = 0.3 + fill * 2;
                            const fallRow = ((t * fallSpeed) % (gs + 1)) - 1;
                            gF(ctx, ox, oy, cs, clamp(fallRow, -0.5, 2), 2, 'Z');
                            gT(ctx, ox + gs * cs / 2, oy - cs * 0.7,
                                `Speed: ${speed.toFixed(1)}×`, '#b0a878', Math.floor(cs * 0.35));
                        }
                    },
                    {
                        title: 'Word Category',
                        desc: 'A category like "Food" or "Animals" appears at the top. Category words earn 2× points, other words earn only ¼. Find as many category matches as possible in 7 minutes! Swipe left on the results screen to see your matches.',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs, 15);
                            gBg(ctx, ox, oy, cs, gs);
                            // Category banner
                            const catY = oy - cs * 1.4;
                            ctx.fillStyle = '#1a1a2e';
                            const tw = cs * 5, th = cs * 0.8;
                            ctx.fillRect((w - tw) / 2, catY - th / 2, tw, th);
                            ctx.strokeStyle = '#8cb860'; ctx.lineWidth = 1;
                            ctx.strokeRect((w - tw) / 2, catY - th / 2, tw, th);
                            gT(ctx, w / 2, catY, '▦ Food', '#8cb860', Math.floor(cs * 0.4));
                            const foodCells = [
                                [3,0,'C'],[3,1,'A'],[3,2,'K'],[3,3,'E'],
                                [4,1,'P'],[4,2,'I'],[4,3,'E']
                            ];
                            const otherCells = [[4,0,'X'],[4,4,'R'],[3,4,'W'],[2,0,'N'],[2,3,'H']];
                            for (const [r,c,l] of otherCells) gC(ctx, ox, oy, cs, r, c, l, '#3a3933');
                            const cyc = t % 4;
                            for (let i = 0; i < foodCells.length; i++) {
                                const [r,c,l] = foodCells[i];
                                const lit = cyc > 2;
                                gC(ctx, ox, oy, cs, r, c, l, lit ? '#4a5c38' : '#3a3933', lit ? '#8cb860' : null);
                            }
                            if (cyc > 2.5) {
                                gT(ctx, w / 2, oy + gs * cs + cs * 0.5, '2× POINTS!', '#8cb860',
                                    Math.floor(cs * 0.4), clamp((cyc - 2.5) * 3, 0, 1));
                            }
                        }
                    },
                    {
                        title: 'Word Search',
                        desc: 'A grid filled with letters — find hidden words by swiping across them. Words go horizontal, vertical, or diagonal. As levels increase, grids get larger and words get harder. Your level is saved. Each round is 7 minutes.',
                        draw(ctx, w, h, t) {
                            const gs = 8, { cs, ox, oy } = gL(w, h, gs, 10);
                            gBg(ctx, ox, oy, cs, gs);

                            // Fill grid with letters
                            const gridLetters = [
                                'CATSLPWE',
                                'RVBHOGMN',
                                'AXDIFKUT',
                                'FLRUNZEP',
                                'TEAQJWSY',
                                'SMOKNBDG',
                                'WIREPLXH',
                                'GHTOVFCA'
                            ];
                            for (let r = 0; r < gs; r++) for (let c = 0; c < gs; c++)
                                gC(ctx, ox, oy, cs, r, c, gridLetters[r][c], '#3a3933');

                            // Animate swiping over hidden words
                            const words = [
                                { cells: [[0,0],[0,1],[0,2]], label: 'CAT', dir: '→' },
                                { cells: [[1,4],[2,4],[3,4],[4,4]], label: 'OFJW', dir: '↓' },
                                { cells: [[3,0],[3,1],[3,2],[3,3]], label: 'FLRU', dir: '→' },
                                { cells: [[6,0],[6,1],[6,2],[6,3]], label: 'WIRE', dir: '→' }
                            ];
                            const realWords = [
                                { cells: [[0,0],[0,1],[0,2]], label: 'CAT' },
                                { cells: [[6,0],[6,1],[6,2],[6,3]], label: 'WIRE' }
                            ];
                            const cyc = t % 6;
                            const wi = Math.floor(cyc / 3) % 2;
                            const word = realWords[wi];
                            const swipeProgress = clamp((cyc % 3) / 1.5, 0, 1);
                            const litCount = Math.floor(swipeProgress * word.cells.length);

                            for (let i = 0; i < litCount; i++) {
                                const [r, c] = word.cells[i];
                                gC(ctx, ox, oy, cs, r, c, gridLetters[r][c], '#4a5c38', '#8cb860');
                            }

                            // Show swipe finger
                            if (swipeProgress < 1 && litCount < word.cells.length) {
                                const [cr, cc] = word.cells[Math.min(litCount, word.cells.length - 1)];
                                gTap(ctx, ox + cc * cs + cs / 2, oy + cr * cs + cs / 2, t);
                            }

                            if ((cyc % 3) > 2) {
                                gT(ctx, w / 2, oy - cs * 0.7, '"' + word.label + '" found!', '#8cb860', Math.floor(cs * 0.4));
                            } else {
                                gT(ctx, w / 2, oy - cs * 0.7, '🔍 Swipe to find words!', '#e2d8a6', Math.floor(cs * 0.35));
                            }

                            // Level badge
                            gT(ctx, w / 2, oy + gs * cs + cs * 0.5, 'Lv. 1 — 7:00', '#b0a878', Math.floor(cs * 0.3));
                        }
                    },
                    {
                        title: 'Word Runner',
                        desc: 'Side-scrolling action! Your character runs automatically. Tap or press space to jump (up to 5 jumps). Dodge spikes, leap gaps, and collect floating letters to fill word boxes. Submit valid words for points and coins. Speed increases as you go!',
                        _spineState: null,
                        draw(ctx, w, h, t) {

                            const groundY = h * 0.72;
                            const scrollX = t * 40;

                            // Neon gradient background
                            const grd = ctx.createLinearGradient(0, 0, 0, h);
                            grd.addColorStop(0, '#0a0e1a');
                            grd.addColorStop(0.6, '#111830');
                            grd.addColorStop(1, '#0a1520');
                            ctx.fillStyle = grd;
                            ctx.fillRect(0, 0, w, h);

                            // Distant neon city silhouette
                            ctx.fillStyle = '#141a2e';
                            for (let i = 0; i < 6; i++) {
                                const bx = ((i * w * 0.22 - t * 8) % (w * 1.5) + w * 1.7) % (w * 1.5) - w * 0.1;
                                const bh = 20 + (i * 17) % 35;
                                ctx.fillRect(bx, groundY - bh, w * 0.08, bh);
                            }

                            // Ground with neon edge
                            ctx.fillStyle = '#1a3040';
                            ctx.fillRect(0, groundY, w, h - groundY);
                            ctx.strokeStyle = '#00ccaa'; ctx.lineWidth = 2;
                            ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(w, groundY); ctx.stroke();

                            // Gap (hole) in the ground — scrolls
                            const gapX = ((w * 0.65 - scrollX * 0.5) % w + w * 1.3) % w - w * 0.1;
                            const gapW = w * 0.12;
                            ctx.fillStyle = '#0a0e1a';
                            ctx.fillRect(gapX, groundY, gapW, h - groundY);
                            // Re-draw ground edges around gap
                            ctx.strokeStyle = '#00ccaa'; ctx.lineWidth = 2;
                            ctx.beginPath();
                            ctx.moveTo(gapX, groundY); ctx.lineTo(gapX, groundY + 15);
                            ctx.moveTo(gapX + gapW, groundY); ctx.lineTo(gapX + gapW, groundY + 15);
                            ctx.stroke();

                            // Scrolling spike clusters
                            const spikePositions = [0.35, 0.82];
                            for (const sp of spikePositions) {
                                const sx = ((sp * w - scrollX * 0.5) % w + w * 1.3) % w - w * 0.1;
                                ctx.fillStyle = '#ff4444';
                                for (let s = 0; s < 3; s++) {
                                    const ox = sx + s * 8;
                                    ctx.beginPath();
                                    ctx.moveTo(ox - 4, groundY);
                                    ctx.lineTo(ox, groundY - 10);
                                    ctx.lineTo(ox + 4, groundY);
                                    ctx.closePath();
                                    ctx.fill();
                                }
                                // Spike glow
                                ctx.shadowColor = '#ff4444'; ctx.shadowBlur = 6;
                                ctx.fillStyle = '#ff6666';
                                ctx.beginPath();
                                ctx.moveTo(sx + 4, groundY);
                                ctx.lineTo(sx + 8, groundY - 10);
                                ctx.lineTo(sx + 12, groundY);
                                ctx.closePath();
                                ctx.fill();
                                ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
                            }

                            // Floating neon letters
                            const ltrs = ['P','L','U','M','M','E','T'];
                            for (let i = 0; i < 5; i++) {
                                const lx = ((i * w * 0.25 + w * 0.15 - scrollX * 0.8) % w + w * 1.3) % w - w * 0.15;
                                const ly = groundY - 30 + Math.sin(t * 3 + i * 1.5) * 8;
                                const lClr = i % 3 === 0 ? '#ffaa00' : '#00ddff';
                                ctx.shadowColor = lClr; ctx.shadowBlur = 10;
                                ctx.fillStyle = lClr;
                                ctx.font = `bold ${Math.floor(w * 0.065)}px sans-serif`;
                                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText(ltrs[i % ltrs.length], lx, ly);
                            }
                            ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;

                            // Word boxes at top with neon styling
                            const boxCount = 5, boxW = w * 0.1, boxH = w * 0.08;
                            const boxStartX = (w - boxCount * (boxW + 5)) / 2;
                            const collected = Math.floor(t * 0.7) % (boxCount + 1);
                            for (let i = 0; i < boxCount; i++) {
                                const bx = boxStartX + i * (boxW + 5), by = 8;
                                ctx.fillStyle = i < collected ? 'rgba(0,204,170,0.2)' : 'rgba(255,255,255,0.04)';
                                ctx.fillRect(bx, by, boxW, boxH);
                                ctx.strokeStyle = i < collected ? '#00ccaa' : '#334455';
                                ctx.lineWidth = 1;
                                ctx.strokeRect(bx, by, boxW, boxH);
                                if (i < collected) {
                                    ctx.fillStyle = '#fff';
                                    ctx.font = `bold ${Math.floor(boxH * 0.55)}px sans-serif`;
                                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                    ctx.fillText(ltrs[i], bx + boxW / 2, by + boxH / 2);
                                }
                            }

                            // Validate button indicator (green check) — pulses when word complete
                            if (collected >= boxCount) {
                                const btnX = w * 0.85, btnY = 8 + boxH / 2;
                                const pulse = 0.9 + Math.sin(t * 6) * 0.1;
                                ctx.save();
                                ctx.translate(btnX, btnY);
                                ctx.scale(pulse, pulse);
                                ctx.fillStyle = '#22aa44';
                                ctx.beginPath();
                                ctx.roundRect(-14, -10, 28, 20, 4);
                                ctx.fill();
                                ctx.strokeStyle = '#44ff66'; ctx.lineWidth = 1.5;
                                ctx.beginPath();
                                ctx.roundRect(-14, -10, 28, 20, 4);
                                ctx.stroke();
                                ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.floor(boxH * 0.5)}px sans-serif`;
                                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText('✓', 0, 0);
                                ctx.restore();
                            }

                            // Animated neon stick figure
                            const charX = w * 0.25;
                            const jumpCyc = t % 3;
                            const charY = jumpCyc > 1.5 && jumpCyc < 2.3
                                ? groundY - Math.sin((jumpCyc - 1.5) / 0.8 * Math.PI) * 30
                                : groundY;
                            const airborne = charY < groundY;

                            {
                                const phase = airborne ? 0 : t * 8; // freeze pose in air, run on ground
                                const headR = 6;
                                const headY = charY - 30;
                                const neckY = headY + headR;
                                const shoulderY = neckY + 2;
                                const hipY = charY - 8;
                                const torsoMidY = (shoulderY + hipY) / 2;

                                ctx.strokeStyle = '#ffaa00'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
                                ctx.shadowColor = '#ffaa00'; ctx.shadowBlur = 8;

                                // Head (circle)
                                ctx.beginPath();
                                ctx.arc(charX, headY, headR, 0, Math.PI * 2);
                                ctx.fillStyle = '#ffaa00';
                                ctx.fill();
                                ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2;
                                ctx.stroke();

                                // Torso (neck to hip)
                                ctx.strokeStyle = '#ffaa00'; ctx.lineWidth = 2.5;
                                ctx.beginPath();
                                ctx.moveTo(charX, neckY);
                                ctx.lineTo(charX, hipY);
                                ctx.stroke();

                                // Arms — swing while running, spread in air
                                const armLen = 10;
                                if (airborne) {
                                    // Arms up and out (jump pose)
                                    ctx.beginPath(); ctx.moveTo(charX, shoulderY);
                                    ctx.lineTo(charX - 10, shoulderY - 8); ctx.stroke();
                                    ctx.beginPath(); ctx.moveTo(charX, shoulderY);
                                    ctx.lineTo(charX + 10, shoulderY - 8); ctx.stroke();
                                } else {
                                    // Running arm swing
                                    const armSwing = Math.sin(phase) * 0.8;
                                    ctx.beginPath(); ctx.moveTo(charX, shoulderY);
                                    ctx.lineTo(charX + Math.sin(armSwing) * armLen, shoulderY + Math.cos(armSwing) * 8);
                                    ctx.stroke();
                                    ctx.beginPath(); ctx.moveTo(charX, shoulderY);
                                    ctx.lineTo(charX + Math.sin(-armSwing) * armLen, shoulderY + Math.cos(-armSwing) * 8);
                                    ctx.stroke();
                                }

                                // Legs — run cycle or tucked in air
                                const legLen = 10;
                                if (airborne) {
                                    // Tucked legs (jump pose)
                                    ctx.beginPath(); ctx.moveTo(charX, hipY);
                                    ctx.lineTo(charX - 5, hipY + 6);
                                    ctx.lineTo(charX - 3, hipY + legLen + 2); ctx.stroke();
                                    ctx.beginPath(); ctx.moveTo(charX, hipY);
                                    ctx.lineTo(charX + 5, hipY + 6);
                                    ctx.lineTo(charX + 3, hipY + legLen + 2); ctx.stroke();
                                } else {
                                    // Running leg swing
                                    const legSwing = Math.sin(phase) * 0.9;
                                    ctx.beginPath(); ctx.moveTo(charX, hipY);
                                    ctx.lineTo(charX + Math.sin(-legSwing) * 8, hipY + Math.cos(-legSwing) * legLen);
                                    ctx.stroke();
                                    ctx.beginPath(); ctx.moveTo(charX, hipY);
                                    ctx.lineTo(charX + Math.sin(legSwing) * 8, hipY + Math.cos(legSwing) * legLen);
                                    ctx.stroke();
                                }

                                // Neon glow trail behind runner
                                ctx.globalAlpha = 0.3;
                                ctx.strokeStyle = '#ffaa00'; ctx.lineWidth = 1;
                                for (let trail = 1; trail <= 3; trail++) {
                                    const tx = charX - trail * 5;
                                    const ta = 0.3 - trail * 0.08;
                                    ctx.globalAlpha = ta;
                                    ctx.beginPath();
                                    ctx.arc(tx, headY, headR - 1, 0, Math.PI * 2);
                                    ctx.stroke();
                                    ctx.beginPath(); ctx.moveTo(tx, neckY); ctx.lineTo(tx, hipY); ctx.stroke();
                                }
                                ctx.globalAlpha = 1;
                                ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
                            }

                            gT(ctx, w / 2, h - 14, '🏃 Tap to jump! Collect letters!', '#00ccaa', Math.floor(w * 0.04));
                        }
                    }
                ]
            },

            // ═══ LEADERBOARD ═══
            {
                id: 'leaderboard', icon: '⬡', label: 'Leaderboard',
                desc: 'Compete for skill-based rankings across every game mode',
                slides: [
                    {
                        title: 'Skill-Based Rankings',
                        desc: 'Players are ranked by skill rating, not just high scores. Your rating (0–10,000) is based on consistency, word quality, combo efficiency, and games played. It updates after every game. You need 15 games for it to stabilize.',
                        draw(ctx, w, h, t) {
                            ctx.fillStyle = '#0d1117';
                            ctx.fillRect(0, 0, w, h);

                            gT(ctx, w / 2, 24, '⬡ Leaderboard', '#e2d8a6', 18);

                            // Animated ranks
                            const players = [
                                { name: 'ProPlayer', rating: 8742, cls: 'high' },
                                { name: 'WordNinja', rating: 6281, cls: 'high' },
                                { name: 'LetterDrop', rating: 3105, cls: 'medium' },
                                { name: 'NewPlayer', rating: 890, cls: 'low' },
                                { name: 'You', rating: 2450, cls: 'medium' },
                            ];
                            const rowH = 28;
                            for (let i = 0; i < players.length; i++) {
                                const py = 48 + i * rowH;
                                const p = players[i];
                                const isYou = p.name === 'You';
                                const clsColor = p.cls === 'high' ? '#e2d8a6' : p.cls === 'medium' ? '#7eb8ff' : '#888';

                                if (isYou) {
                                    ctx.fillStyle = 'rgba(226,216,166,0.08)';
                                    ctx.fillRect(16, py - 10, w - 32, rowH);
                                }

                                ctx.font = isYou ? 'bold 13px sans-serif' : '12px sans-serif';
                                ctx.textAlign = 'left';
                                ctx.fillStyle = isYou ? '#e2d8a6' : '#aaa';
                                ctx.fillText(`${i + 1}. ${p.name}`, 24, py);

                                // Rating bar
                                const barX = w - 110, barW = 60, barH = 8;
                                const fill = p.rating / 10000;
                                ctx.fillStyle = '#1a2a3e';
                                ctx.fillRect(barX, py - 4, barW, barH);
                                ctx.fillStyle = clsColor;
                                ctx.fillRect(barX, py - 4, barW * fill, barH);

                                ctx.font = '10px sans-serif';
                                ctx.textAlign = 'right';
                                ctx.fillStyle = clsColor;
                                ctx.fillText(p.rating.toLocaleString(), w - 24, py);
                            }
                        }
                    },
                    {
                        title: 'Classes & Tabs',
                        desc: 'Players are grouped into Master, High, Medium, and Low classes based on skill rating. Filter by class to compare with similar players. Separate tabs show rankings for Overall and each challenge mode, each with its own skill rating.',
                        draw(ctx, w, h, t) {
                            ctx.fillStyle = '#0d1117';
                            ctx.fillRect(0, 0, w, h);

                            // Tabs
                            const tabs = ['Overall', 'Target', 'Speed', 'Category', 'Search'];
                            const activeTab = Math.floor(t * 0.4) % tabs.length;
                            const tabW = (w - 20) / tabs.length;
                            for (let i = 0; i < tabs.length; i++) {
                                const tx = 10 + i * tabW;
                                const isActive = i === activeTab;
                                ctx.fillStyle = isActive ? 'rgba(226,216,166,0.15)' : 'transparent';
                                ctx.fillRect(tx, 12, tabW - 2, 22);
                                if (isActive) {
                                    ctx.strokeStyle = '#e2d8a6'; ctx.lineWidth = 1;
                                    ctx.strokeRect(tx, 12, tabW - 2, 22);
                                }
                                ctx.font = `${isActive ? 'bold ' : ''}9px sans-serif`;
                                ctx.textAlign = 'center'; ctx.fillStyle = isActive ? '#e2d8a6' : '#888';
                                ctx.fillText(tabs[i], tx + (tabW - 2) / 2, 27);
                            }

                            // Class filter buttons
                            const classes = [
                                { label: 'All', color: '#aaa' },
                                { label: 'High', color: '#e2d8a6' },
                                { label: 'Medium', color: '#7eb8ff' },
                                { label: 'Low', color: '#888' }
                            ];
                            const clsW = (w - 40) / classes.length;
                            const activeCls = Math.floor(t * 0.3) % classes.length;
                            for (let i = 0; i < classes.length; i++) {
                                const cx = 20 + i * clsW;
                                const isA = i === activeCls;
                                ctx.fillStyle = isA ? classes[i].color : 'transparent';
                                if (isA) ctx.fillRect(cx, 42, clsW - 4, 18);
                                ctx.font = `${isA ? 'bold ' : ''}10px sans-serif`;
                                ctx.textAlign = 'center';
                                ctx.fillStyle = isA ? '#111' : classes[i].color;
                                ctx.fillText(classes[i].label, cx + (clsW - 4) / 2, 55);
                            }

                            // Mini leaderboard rows
                            const rows = [
                                { rank: 1, name: 'Champion', rating: 9100, cls: '#e2d8a6' },
                                { rank: 2, name: 'Contender', rating: 7800, cls: '#e2d8a6' },
                                { rank: 3, name: 'Climber', rating: 5200, cls: '#e2d8a6' },
                            ];
                            for (let i = 0; i < rows.length; i++) {
                                const ry = 74 + i * 24;
                                const r = rows[i];
                                ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
                                ctx.fillStyle = '#aaa';
                                ctx.fillText(`${r.rank}. ${r.name}`, 24, ry);
                                ctx.textAlign = 'right';
                                ctx.fillStyle = r.cls;
                                ctx.fillText(r.rating.toLocaleString(), w - 24, ry);
                            }

                            // "Your rank" highlight
                            const yourY = 74 + 3 * 24;
                            ctx.fillStyle = 'rgba(226,216,166,0.08)';
                            ctx.fillRect(16, yourY - 12, w - 32, 24);
                            ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'left';
                            ctx.fillStyle = '#e2d8a6';
                            ctx.fillText('15. You', 24, yourY);
                            ctx.textAlign = 'right';
                            ctx.fillText('2,450', w - 24, yourY);
                        }
                    },
                    {
                        title: 'Player Analysis',
                        desc: 'Tap any player to see their stats — consistency, average word length, combo rate, rating trend, and more. Each challenge tab has its own analysis with challenge-specific stats.',
                        draw(ctx, w, h, t) {
                            ctx.fillStyle = '#0d1117';
                            ctx.fillRect(0, 0, w, h);

                            gT(ctx, w / 2, 22, 'Player Analysis', '#e2d8a6', 16);

                            // Analysis card
                            const cardX = 16, cardY = 38, cardW = w - 32;
                            ctx.fillStyle = '#1a1a2e';
                            ctx.fillRect(cardX, cardY, cardW, h - 56);
                            ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
                            ctx.strokeRect(cardX, cardY, cardW, h - 56);

                            // Stats grid
                            const stats = [
                                { label: 'Consistency', val: '87%', color: '#8cb860' },
                                { label: 'Avg Word Len', val: '4.2', color: '#7eb8ff' },
                                { label: 'Combo Rate', val: '34%', color: '#e2d8a6' },
                                { label: 'Games', val: '52', color: '#b0a878' },
                            ];
                            const sgW = (cardW - 24) / 2;
                            for (let i = 0; i < stats.length; i++) {
                                const col = i % 2, row = Math.floor(i / 2);
                                const sx = cardX + 12 + col * sgW;
                                const sy = cardY + 18 + row * 40;
                                const s = stats[i];

                                ctx.font = 'bold 18px sans-serif';
                                ctx.textAlign = 'center';
                                ctx.fillStyle = s.color;
                                ctx.fillText(s.val, sx + sgW / 2, sy);

                                ctx.font = '9px sans-serif';
                                ctx.fillStyle = '#888';
                                ctx.fillText(s.label, sx + sgW / 2, sy + 14);
                            }

                            // Trend line
                            const trendY = cardY + 105;
                            gT(ctx, w / 2, trendY, 'Rating Trend', '#888', 10);
                            ctx.beginPath();
                            ctx.strokeStyle = '#8cb860'; ctx.lineWidth = 2;
                            const pts = [0.2, 0.25, 0.3, 0.28, 0.35, 0.42, 0.5, 0.48, 0.55, 0.6, 0.65, 0.7];
                            const lineW = cardW - 40, lineH = 40;
                            const lineX = cardX + 20, lineY2 = trendY + 14;
                            for (let i = 0; i < pts.length; i++) {
                                const px = lineX + (i / (pts.length - 1)) * lineW;
                                const py = lineY2 + lineH - pts[i] * lineH;
                                if (i === 0) ctx.moveTo(px, py);
                                else ctx.lineTo(px, py);
                            }
                            ctx.stroke();
                        }
                    }
                ]
            },

            // ═══ MUSIC ═══
            {
                id: 'music', icon: '♪', label: 'Music',
                desc: 'Background music player with custom playlists',
                slides: [
                    {
                        title: 'Browsing & Playing',
                        desc: 'Tap the Music button on the main menu to open the music screen. You\'ll see a list of all available tracks with their title and artist. Tap the circular \u25b7 play button next to any track to start playing it \u2014 the currently playing track is highlighted. Music continues playing in the background while you play the game, so pick your vibe before you start!',
                        draw(ctx, w, h, t) {
                            const pad = 20, cw = w - pad * 2;
                            ctx.fillStyle = '#1a1a2e';
                            ctx.fillRect(pad, 30, cw, h - 60);
                            ctx.strokeStyle = '#4a493e'; ctx.lineWidth = 1;
                            ctx.strokeRect(pad, 30, cw, h - 60);
                            gT(ctx, w / 2, 55, '♪ Music', '#e2d8a6', 18);
                            const tabs = ['All Songs', 'My Mix', '+ New'];
                            const tabW = cw / tabs.length;
                            for (let i = 0; i < tabs.length; i++) {
                                const tx = pad + i * tabW, ty = 72;
                                const active = i === 0;
                                ctx.fillStyle = active ? '#e2d8a6' : '#4a493e';
                                ctx.fillRect(tx + 4, ty, tabW - 8, 26);
                                ctx.fillStyle = active ? '#111' : '#888';
                                ctx.font = 'bold 11px sans-serif';
                                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText(tabs[i], tx + tabW / 2, ty + 13);
                            }
                            const tracks = [
                                { title: 'Sunset Vibes', artist: 'ChillBeats' },
                                { title: 'Focus Flow', artist: 'LofiLab' },
                                { title: 'Night Drive', artist: 'SynthWave' },
                                { title: 'Pixel Dreams', artist: 'RetroFM' }
                            ];
                            const playing = Math.floor(t * 0.4) % tracks.length;
                            for (let i = 0; i < tracks.length; i++) {
                                const ty = 108 + i * 44;
                                const pl = i === playing;
                                ctx.fillStyle = pl ? 'rgba(226,216,166,0.1)' : 'transparent';
                                ctx.fillRect(pad + 10, ty, cw - 20, 38);
                                ctx.strokeStyle = pl ? '#e2d8a6' : '#4a493e';
                                ctx.strokeRect(pad + 10, ty, cw - 20, 38);
                                const btnX = pad + 28, btnY = ty + 19;
                                ctx.beginPath(); ctx.arc(btnX, btnY, 12, 0, Math.PI * 2);
                                ctx.fillStyle = pl ? '#e2d8a6' : '#4a493e'; ctx.fill();
                                ctx.fillStyle = pl ? '#111' : '#aaa';
                                ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText(pl ? '⏸' : '▶', btnX, btnY);
                                ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'left';
                                ctx.fillText(tracks[i].title, pad + 48, ty + 14);
                                ctx.fillStyle = '#888'; ctx.font = '9px sans-serif';
                                ctx.fillText(tracks[i].artist, pad + 48, ty + 28);
                                if (pl) {
                                    gTap(ctx, btnX, btnY, t);
                                }
                            }
                            const barY = h - 60, barW = cw - 40;
                            ctx.fillStyle = '#4a493e'; ctx.fillRect(pad + 20, barY, barW, 5);
                            const prog = (t * 0.05) % 1;
                            ctx.fillStyle = '#e2d8a6'; ctx.fillRect(pad + 20, barY, barW * prog, 5);
                        }
                    },
                    {
                        title: 'Reordering Tracks',
                        desc: 'Hold the ☰ handle on any track and drag it up or down to reorder. Your custom order is used for auto-play — when one song ends, the next starts automatically.',
                        draw(ctx, w, h, t) {
                            const pad = 20, cw = w - pad * 2;
                            ctx.fillStyle = '#1a1a2e';
                            ctx.fillRect(pad, 40, cw, h - 80);
                            ctx.strokeStyle = '#4a493e'; ctx.lineWidth = 1;
                            ctx.strokeRect(pad, 40, cw, h - 80);
                            gT(ctx, w / 2, 60, 'Reorder Tracks', '#e2d8a6', 16);
                            const names = ['Sunset Vibes', 'Focus Flow', 'Night Drive'];
                            const cyc = t % 4;
                            const swapA = 0, swapB = 1;
                            let order = [0, 1, 2];
                            if (cyc > 2) order = [1, 0, 2];
                            for (let i = 0; i < 3; i++) {
                                const idx = order[i];
                                const ty = 85 + i * 56;
                                const moving = (cyc > 1 && cyc < 2.5 && idx === 0);
                                const yOff = moving ? Math.sin((cyc - 1) * Math.PI) * -20 : 0;
                                ctx.save(); ctx.translate(0, yOff);
                                ctx.fillStyle = moving ? 'rgba(226,216,166,0.15)' : 'transparent';
                                ctx.fillRect(pad + 10, ty, cw - 20, 46);
                                ctx.strokeStyle = moving ? '#e2d8a6' : '#4a493e';
                                ctx.strokeRect(pad + 10, ty, cw - 20, 46);
                                ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif';
                                ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                                ctx.fillText(names[idx], pad + 22, ty + 23);
                                const hX = pad + cw - 36;
                                ctx.fillStyle = moving ? '#e2d8a6' : '#5c5b4c'; ctx.font = '18px sans-serif';
                                ctx.textAlign = 'center';
                                ctx.fillText('☰', hX, ty + 23);
                                ctx.restore();
                            }
                            if (cyc > 0.5 && cyc < 2) {
                                const hX = pad + cw - 36;
                                const ty = 85;
                                gTap(ctx, hX, ty + 23, t);
                                gT(ctx, w / 2, h - 50, 'Hold & drag ☰', '#e2d8a6', 14);
                            } else if (cyc > 2.5) {
                                gT(ctx, w / 2, h - 50, 'Track moved ✓', '#8cb860', 14);
                            }
                        }
                    },
                    {
                        title: 'Custom Playlists',
                        desc: 'Tap "+ New" to create a playlist. Name it, check the songs you want, and tap Save. Your playlist appears as a new tab. You can rename, delete, or remove tracks with the ✕ button.',
                        draw(ctx, w, h, t) {
                            const pad = 20, cw = w - pad * 2;
                            const cyc = t % 8;
                            if (cyc < 4) {
                                ctx.fillStyle = '#1a1a2e';
                                ctx.fillRect(pad, 30, cw, h - 60);
                                ctx.strokeStyle = '#4a493e'; ctx.lineWidth = 1;
                                ctx.strokeRect(pad, 30, cw, h - 60);
                                gT(ctx, w / 2, 52, 'Create Playlist', '#e2d8a6', 16);
                                const inputY = 68;
                                ctx.fillStyle = '#222'; ctx.fillRect(pad + 16, inputY, cw - 32, 28);
                                ctx.strokeStyle = '#5c5b4c'; ctx.strokeRect(pad + 16, inputY, cw - 32, 28);
                                const nameProgress = clamp(cyc / 1.5, 0, 1);
                                const typedName = 'Chill Vibes'.substring(0, Math.floor(nameProgress * 11));
                                ctx.fillStyle = typedName ? '#fff' : '#706c58';
                                ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                                ctx.fillText(typedName || 'Playlist name...', pad + 24, inputY + 14);
                                if (nameProgress < 1) {
                                    ctx.fillStyle = '#e2d8a6'; ctx.fillRect(pad + 24 + ctx.measureText(typedName).width, inputY + 4, 2, 20);
                                }
                                const songs = ['Sunset Vibes', 'Focus Flow', 'Night Drive', 'Pixel Dreams', 'Ocean Waves'];
                                const checkOrder = [0, 2, 4];
                                for (let i = 0; i < songs.length; i++) {
                                    const sy = 106 + i * 32;
                                    const checkTime = checkOrder.indexOf(i);
                                    const checked = checkTime !== -1 && cyc > 1.5 + checkTime * 0.6;
                                    ctx.fillStyle = '#222'; ctx.fillRect(pad + 16, sy, cw - 32, 28);
                                    ctx.strokeStyle = '#4a493e'; ctx.strokeRect(pad + 16, sy, cw - 32, 28);
                                    const bx = pad + 24, by = sy + 6;
                                    ctx.strokeStyle = checked ? '#e2d8a6' : '#5c5b4c'; ctx.lineWidth = 1.5;
                                    ctx.strokeRect(bx, by, 16, 16);
                                    if (checked) {
                                        ctx.fillStyle = '#e2d8a6'; ctx.font = 'bold 13px sans-serif';
                                        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                        ctx.fillText('✓', bx + 8, by + 9);
                                    }
                                    ctx.fillStyle = '#b0a878'; ctx.font = '11px sans-serif';
                                    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                                    ctx.fillText(songs[i], bx + 24, sy + 14);
                                }
                                if (cyc > 3.2) {
                                    const saveW = 80, saveH = 30;
                                    const saveX = (w - saveW) / 2, saveY = h - 75;
                                    ctx.fillStyle = '#e2d8a6'; ctx.fillRect(saveX, saveY, saveW, saveH);
                                    ctx.fillStyle = '#111'; ctx.font = 'bold 13px sans-serif';
                                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                    ctx.fillText('Save', saveX + saveW / 2, saveY + saveH / 2);
                                    gTap(ctx, saveX + saveW / 2, saveY + saveH / 2, t);
                                }
                            } else {
                                ctx.fillStyle = '#1a1a2e';
                                ctx.fillRect(pad, 30, cw, h - 60);
                                ctx.strokeStyle = '#4a493e'; ctx.lineWidth = 1;
                                ctx.strokeRect(pad, 30, cw, h - 60);
                                gT(ctx, w / 2, 52, '♪ Music', '#e2d8a6', 16);
                                const tabs = ['All Songs', 'Chill Vibes', '+ New'];
                                const tabW = cw / tabs.length;
                                const activeTab = 1;
                                for (let i = 0; i < tabs.length; i++) {
                                    const tx = pad + i * tabW, ty = 68;
                                    ctx.fillStyle = i === activeTab ? '#e2d8a6' : '#4a493e';
                                    ctx.fillRect(tx + 3, ty, tabW - 6, 24);
                                    ctx.fillStyle = i === activeTab ? '#111' : '#888';
                                    ctx.font = 'bold 10px sans-serif';
                                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                    ctx.fillText(tabs[i], tx + tabW / 2, ty + 12);
                                }
                                const plTracks = ['Sunset Vibes', 'Night Drive', 'Ocean Waves'];
                                for (let i = 0; i < plTracks.length; i++) {
                                    const ty = 104 + i * 44;
                                    ctx.fillStyle = 'transparent';
                                    ctx.strokeStyle = '#4a493e'; ctx.lineWidth = 1;
                                    ctx.strokeRect(pad + 10, ty, cw - 20, 38);
                                    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif';
                                    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                                    ctx.fillText(plTracks[i], pad + 24, ty + 19);
                                    ctx.fillStyle = '#c45c4a'; ctx.font = '12px sans-serif';
                                    ctx.textAlign = 'center';
                                    ctx.fillText('✕', pad + cw - 30, ty + 19);
                                }
                                const flash = Math.sin(t * 4) > 0;
                                gT(ctx, w / 2, h - 55, 'Playlist created! ✓',
                                    flash ? '#e2d8a6' : '#8cb860', 14);
                            }
                        }
                    },
                    {
                        title: 'Background Music',
                        desc: 'Music plays continuously in the background during gameplay. To change tracks or adjust settings, pause the game and tap the Music button, or use the ♪ dropdown in the top-right corner.',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs, -30);
                            gBg(ctx, ox, oy, cs, gs);
                            for (let r = 2; r < gs; r++) for (let c = 0; c < gs; c++)
                                gC(ctx, ox, oy, cs, r, c, String.fromCharCode(65 + (r * gs + c) % 26), '#3a3933');
                            const fallRow = ((t * 0.5) % 4) - 1;
                            gF(ctx, ox, oy, cs, clamp(fallRow, -0.5, 2), 2, 'M');
                            gT(ctx, w / 2, oy - cs * 0.7, 'Score: 1250', '#fff', Math.floor(cs * 0.3));
                            // Music notes floating
                            const notes = ['♪', '♫', '♬'];
                            for (let i = 0; i < 3; i++) {
                                const nx = w * 0.2 + i * w * 0.3;
                                const ny = h * 0.3 + Math.sin(t * 1.5 + i * 2) * 15;
                                const alpha = 0.4 + Math.sin(t * 2 + i) * 0.2;
                                ctx.fillStyle = `rgba(226, 216, 166, ${alpha})`;
                                ctx.font = '18px sans-serif';
                                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText(notes[i], nx, ny);
                            }
                            // Pause button hint
                            const flash = Math.sin(t * 3) > 0;
                            gT(ctx, w / 2, h - 50, 'Pause → Music button', flash ? '#e2d8a6' : '#8cb860', 13);
                        }
                    },
                    {
                        title: 'Quick Music Controls',
                        desc: 'Tap the ♪ button in the top-right corner to open a dropdown music player. It shows the current track, a progress bar, play/pause, skip, mute, and volume controls — all without leaving the screen you\'re on.',
                        draw(ctx, w, h, t) {
                            ctx.fillStyle = '#1a1a2e';
                            ctx.fillRect(20, 30, w - 40, h - 60);
                            ctx.strokeStyle = '#4a493e'; ctx.lineWidth = 1;
                            ctx.strokeRect(20, 30, w - 40, h - 60);

                            // ♪ button in corner
                            const btnX = w - 55, btnY = 55, btnSz = 32;
                            const cyc = t % 8;
                            const open = cyc > 1.5;

                            ctx.save();
                            const pulse = 1 + Math.sin(t * 4) * 0.06;
                            ctx.translate(btnX, btnY); ctx.scale(pulse, pulse); ctx.translate(-btnX, -btnY);
                            ctx.fillStyle = open ? '#e2d8a6' : 'rgba(226,216,166,0.2)';
                            ctx.beginPath(); ctx.arc(btnX, btnY, btnSz / 2, 0, Math.PI * 2); ctx.fill();
                            ctx.strokeStyle = '#e2d8a6'; ctx.lineWidth = 1.5; ctx.stroke();
                            ctx.fillStyle = open ? '#111' : '#fff'; ctx.font = `${Math.floor(btnSz * 0.5)}px sans-serif`;
                            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                            ctx.fillText('♪', btnX, btnY);
                            ctx.restore();

                            if (cyc < 1.5) {
                                gTap(ctx, btnX, btnY, t);
                                gT(ctx, w / 2, h / 2, 'Tap ♪ to open', '#e2d8a6', 14);
                            }

                            if (open) {
                                // Dropdown panel
                                const panelX = 30, panelY = 78, panelW = w - 60, panelH = h - 130;
                                ctx.fillStyle = '#111'; ctx.fillRect(panelX, panelY, panelW, panelH);
                                ctx.strokeStyle = '#4a493e'; ctx.lineWidth = 1;
                                ctx.strokeRect(panelX, panelY, panelW, panelH);

                                // Track name
                                const trackNames = ['Sunset Vibes', 'Focus Flow'];
                                const ti = Math.floor(t * 0.15) % trackNames.length;
                                ctx.fillStyle = '#e2d8a6'; ctx.font = 'bold 12px sans-serif';
                                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText('♪ ' + trackNames[ti], w / 2, panelY + 22);

                                // Progress bar
                                const progY = panelY + 38, progW = panelW - 40;
                                ctx.fillStyle = '#888'; ctx.font = '9px sans-serif';
                                ctx.textAlign = 'left'; ctx.fillText('1:23', panelX + 10, progY + 2);
                                ctx.textAlign = 'right'; ctx.fillText('3:45', panelX + panelW - 10, progY + 2);
                                ctx.fillStyle = '#4a493e'; ctx.fillRect(panelX + 34, progY - 2, progW - 28, 4);
                                const prog = (t * 0.04) % 1;
                                ctx.fillStyle = '#e2d8a6'; ctx.fillRect(panelX + 34, progY - 2, (progW - 28) * prog, 4);
                                // Thumb
                                const thumbX = panelX + 34 + (progW - 28) * prog;
                                ctx.beginPath(); ctx.arc(thumbX, progY, 5, 0, Math.PI * 2);
                                ctx.fillStyle = '#e2d8a6'; ctx.fill();

                                // Playback controls: prev, play/pause, next
                                const ctrlY = panelY + 62;
                                const ctrlBtns = ['◁', '▶', '▷'];
                                const ctrlSpace = 40;
                                const ctrlStartX = w / 2 - ctrlSpace;
                                for (let i = 0; i < 3; i++) {
                                    const cx = ctrlStartX + i * ctrlSpace;
                                    ctx.beginPath(); ctx.arc(cx, ctrlY, 13, 0, Math.PI * 2);
                                    ctx.fillStyle = i === 1 ? '#e2d8a6' : '#4a493e'; ctx.fill();
                                    ctx.fillStyle = i === 1 ? '#111' : '#b0a878';
                                    ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                    ctx.fillText(ctrlBtns[i], cx, ctrlY);
                                }

                                // Volume row: mute btn + slider
                                const volY = panelY + 92;
                                ctx.beginPath(); ctx.arc(panelX + 26, volY, 10, 0, Math.PI * 2);
                                ctx.fillStyle = '#4a493e'; ctx.fill();
                                ctx.fillStyle = '#b0a878'; ctx.font = '10px sans-serif';
                                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText('🔊', panelX + 26, volY);
                                // Volume slider track
                                const sliderX = panelX + 46, sliderW = panelW - 60;
                                ctx.fillStyle = '#4a493e'; ctx.fillRect(sliderX, volY - 2, sliderW, 4);
                                const vol = 0.75 + Math.sin(t * 0.5) * 0.15;
                                ctx.fillStyle = '#e2d8a6'; ctx.fillRect(sliderX, volY - 2, sliderW * vol, 4);
                                ctx.beginPath(); ctx.arc(sliderX + sliderW * vol, volY, 5, 0, Math.PI * 2);
                                ctx.fillStyle = '#e2d8a6'; ctx.fill();

                                // Hint at bottom
                                if (cyc > 4 && cyc < 6) {
                                    gT(ctx, w / 2, h - 48, 'All controls in one place', '#8cb860', 12);
                                }
                            }
                        }
                    }
                ]
            },

            // ═══ LEVELING ═══
            {
                id: 'leveling', icon: '△', label: 'Leveling & XP',
                desc: 'Earn XP to level up — push yourself to climb higher!',
                slides: [
                    {
                        title: 'How XP Works',
                        desc: 'Every game earns XP based on your score, grid size, word quality, difficulty, and game mode. Smaller grids and harder modes give more XP. Sandbox earns only 25% XP.',
                        draw(ctx, w, h, t) {
                            ctx.fillStyle = '#0d1117';
                            ctx.fillRect(0, 0, w, h);

                            // Animated level badge
                            const lvl = Math.min(Math.floor(t * 0.6) + 1, 10);
                            ctx.font = 'bold 26px sans-serif';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillStyle = '#7eb8ff';
                            ctx.fillText(`Lv. ${lvl}`, w / 2, 28);

                            // XP bar
                            const barX = 40, barY = 50, barW = w - 80, barH = 14;
                            ctx.fillStyle = '#1a2a3e';
                            ctx.fillRect(barX, barY, barW, barH);
                            ctx.strokeStyle = '#2a3a50';
                            ctx.lineWidth = 1;
                            ctx.strokeRect(barX, barY, barW, barH);
                            const cycle = t % 4;
                            const fill = cycle < 3 ? Math.min(cycle / 3, 1) : 1;
                            const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
                            grad.addColorStop(0, '#3b82f6');
                            grad.addColorStop(1, '#60a5fa');
                            ctx.fillStyle = grad;
                            ctx.fillRect(barX, barY, barW * fill, barH);

                            if (cycle >= 3) {
                                const fl = Math.sin(t * 8) > 0;
                                ctx.font = 'bold 18px sans-serif';
                                ctx.fillStyle = fl ? '#e2d8a6' : '#b0a878';
                                ctx.fillText('LEVEL UP!', w / 2, 88);
                            }

                            // Multiplier icons
                            const items = [
                                { icon: '◎', label: 'Hard Mode', mult: '1.5×', color: '#c45c4a' },
                                { icon: '◷', label: 'Timed', mult: '1.3×', color: '#b0a878' },
                                { icon: '◎', label: 'Challenge', mult: '1.4×', color: '#e2d8a6' },
                                { icon: '▢', label: 'Small Grid', mult: '1.8×', color: '#8cb860' },
                            ];
                            for (let i = 0; i < items.length; i++) {
                                const x = 20, y = 108 + i * 24;
                                ctx.font = '12px sans-serif';
                                ctx.textAlign = 'left';
                                ctx.fillStyle = '#fff';
                                ctx.fillText(items[i].icon + ' ' + items[i].label, x, y);
                                ctx.textAlign = 'right';
                                ctx.fillStyle = items[i].color;
                                ctx.fillText(items[i].mult + ' XP', w - 20, y);
                            }
                        }
                    },
                    {
                        title: 'Beating Your Best',
                        desc: 'Your best score in each mode combo is tracked. Beat your personal best to get bonus XP! The bigger the improvement, the bigger the bonus.',
                        draw(ctx, w, h, t) {
                            ctx.fillStyle = '#0d1117';
                            ctx.fillRect(0, 0, w, h);

                            gT(ctx, w / 2, 24, 'Your Best: 500 pts', '#888', 14);

                            const cyc = t % 6;
                            const scenarios = [
                                { score: 720, label: 'Beat PB by 44%!', color: '#8cb860', bonus: '+50 bonus XP!', mult: '1.22×' },
                                { score: 480, label: '96% of PB', color: '#b0a878', bonus: 'Normal XP', mult: '1.0×' },
                                { score: 200, label: '40% of PB', color: '#c45c4a', bonus: 'Reduced XP', mult: '0.5×' },
                            ];
                            const si = Math.floor(cyc / 2) % scenarios.length;
                            const s = scenarios[si];

                            ctx.font = 'bold 28px sans-serif';
                            ctx.textAlign = 'center';
                            ctx.fillStyle = s.color;
                            ctx.fillText(`Score: ${s.score}`, w / 2, 65);

                            ctx.font = '14px sans-serif';
                            ctx.fillStyle = '#aaa';
                            ctx.fillText(s.label, w / 2, 90);

                            // XP bar animation
                            const barX = 40, barY = 110, barW = w - 80, barH = 12;
                            ctx.fillStyle = '#1a2a3e';
                            ctx.fillRect(barX, barY, barW, barH);
                            const phase = (cyc % 2);
                            const fillPct = Math.min(phase / 1.5, 1);
                            const g2 = ctx.createLinearGradient(barX, 0, barX + barW, 0);
                            g2.addColorStop(0, '#3b82f6'); g2.addColorStop(1, '#60a5fa');
                            ctx.fillStyle = g2;
                            ctx.fillRect(barX, barY, barW * fillPct * (si === 0 ? 0.9 : si === 1 ? 0.5 : 0.2), barH);

                            ctx.font = 'bold 16px sans-serif';
                            ctx.fillStyle = s.color;
                            ctx.fillText(s.bonus, w / 2, 148);

                            ctx.font = '12px sans-serif';
                            ctx.fillStyle = '#706c58';
                            ctx.fillText(`XP multiplier: ${s.mult}`, w / 2, 170);
                        }
                    }
                ]
            },

            // ═══ SHOP ═══
            {
                id: 'shop', icon: '●', label: 'Shop & Coins',
                desc: 'Earn coins, buy cosmetics, and unlock upgrades',
                slides: [
                    {
                        title: 'Earning Coins',
                        desc: 'Earn coins by finding words — longer words earn more. Combos add a coin bonus. You also earn coins from leveling up and milestone achievements.',
                        draw(ctx, w, h, t) {
                            ctx.fillStyle = '#0d1117';
                            ctx.fillRect(0, 0, w, h);

                            // Coin icon
                            const coinY = 35;
                            ctx.beginPath(); ctx.arc(w / 2, coinY, 22, 0, Math.PI * 2);
                            ctx.fillStyle = '#d4a060'; ctx.fill();
                            ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 2; ctx.stroke();
                            gT(ctx, w / 2, coinY, '●', '#fff', 18);

                            // Coin sources
                            const sources = [
                                { label: 'Word Found (3 letters)', val: '+2', color: '#8cb860' },
                                { label: 'Word Found (5 letters)', val: '+6', color: '#8cb860' },
                                { label: 'Word Found (7 letters)', val: '+12', color: '#8cb860' },
                                { label: 'Combo Bonus (×3)', val: '+3', color: '#e2d8a6' },
                                { label: 'Level Up (Lv. 5)', val: '+25', color: '#7eb8ff' },
                                { label: 'Milestone: Wordsmith', val: '+30', color: '#d4a060' },
                            ];
                            const visCount = Math.min(Math.floor(t * 0.8) + 1, sources.length);
                            for (let i = 0; i < visCount; i++) {
                                const y = 72 + i * 22;
                                ctx.font = '12px sans-serif';
                                ctx.textAlign = 'left'; ctx.fillStyle = '#aaa';
                                ctx.fillText(sources[i].label, 24, y);
                                ctx.textAlign = 'right'; ctx.fillStyle = sources[i].color;
                                ctx.fillText(sources[i].val, w - 24, y);
                            }
                        }
                    },
                    {
                        title: 'Browsing the Shop',
                        desc: 'The shop has four tabs: Grid (board themes), Blocks (letter styles), Slots (bonus storage), and Perks (one-time boosts). Swipe between tabs or tap them. Your coin balance shows in the top-right.',
                        draw(ctx, w, h, t) {
                            ctx.fillStyle = '#0d1117';
                            ctx.fillRect(0, 0, w, h);

                            // Tab bar
                            const tabs = ['Grid', 'Blocks', 'Slots', 'Perks'];
                            const activeTab = Math.floor(t * 0.5) % tabs.length;
                            const tabW = (w - 40) / tabs.length;
                            for (let i = 0; i < tabs.length; i++) {
                                const tx = 20 + i * tabW;
                                const isActive = i === activeTab;
                                ctx.fillStyle = isActive ? 'rgba(212,160,96,0.12)' : 'transparent';
                                ctx.fillRect(tx, 10, tabW - 4, 28);
                                if (isActive) {
                                    ctx.strokeStyle = 'rgba(212,160,96,0.4)'; ctx.lineWidth = 1;
                                    ctx.strokeRect(tx, 10, tabW - 4, 28);
                                }
                                ctx.font = `${isActive ? 'bold ' : ''}11px sans-serif`;
                                ctx.textAlign = 'center';
                                ctx.fillStyle = isActive ? '#d4a060' : '#888';
                                ctx.fillText(tabs[i], tx + (tabW - 4) / 2, 28);
                            }

                            // Item cards
                            const items = [
                                ['Obsidian', '150'], ['Neon', '200'], ['Ocean', '175'],
                                ['Charcoal', '125'], ['Ember', '200'], ['Amethyst', '175']
                            ];
                            const cardW = (w - 52) / 2, cardH = 56;
                            for (let i = 0; i < 6; i++) {
                                const col = i % 2, row = Math.floor(i / 2);
                                const cx = 18 + col * (cardW + 16), cy = 50 + row * (cardH + 10);
                                ctx.fillStyle = '#1a1a2e'; ctx.fillRect(cx, cy, cardW, cardH);
                                ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.strokeRect(cx, cy, cardW, cardH);
                                ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'left';
                                ctx.fillStyle = '#ddd'; ctx.fillText(items[i][0], cx + 8, cy + 20);
                                ctx.font = '10px sans-serif'; ctx.fillStyle = '#d4a060';
                                ctx.fillText('● ' + items[i][1], cx + 8, cy + 38);
                            }

                            // Swipe hint
                            const swipeAlpha = 0.4 + 0.4 * Math.sin(t * 3);
                            ctx.save(); ctx.globalAlpha = swipeAlpha;
                            gA(ctx, w * 0.35, h - 18, 'left', 14);
                            gA(ctx, w * 0.65, h - 18, 'right', 14);
                            gT(ctx, w / 2, h - 18, 'Swipe', '#e2d8a6', 11);
                            ctx.restore();
                        }
                    },
                    {
                        title: 'Buying & Equipping',
                        desc: 'Tap an item to see details, then tap Buy if you have enough coins. Cosmetics can be equipped after buying — one grid theme and one block style active at a time. Owned items show badges.',
                        draw(ctx, w, h, t) {
                            ctx.fillStyle = '#0d1117';
                            ctx.fillRect(0, 0, w, h);

                            // Card preview
                            const cardX = 40, cardY = 20, cardW = w - 80, cardH = 80;
                            ctx.fillStyle = '#1a1a2e'; ctx.fillRect(cardX, cardY, cardW, cardH);
                            ctx.strokeStyle = '#d4a060'; ctx.lineWidth = 1; ctx.strokeRect(cardX, cardY, cardW, cardH);
                            gT(ctx, w / 2, cardY + 22, 'Neon Theme', '#fff', 16);
                            gT(ctx, w / 2, cardY + 42, 'Bright outlines, dark bg', '#888', 11);
                            gT(ctx, w / 2, cardY + 62, '● 200 coins', '#d4a060', 13);

                            // Button states cycling
                            const cyc = t % 6;
                            const btnY = 120, btnH = 34, btnW = 120;
                            const btnX = (w - btnW) / 2;
                            if (cyc < 2) {
                                // Buy button
                                ctx.fillStyle = '#d4a060';
                                ctx.fillRect(btnX, btnY, btnW, btnH);
                                ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
                                ctx.fillStyle = '#000'; ctx.fillText('Buy · 200', w / 2, btnY + 21);
                                gTap(ctx, w / 2, btnY + 17, t);
                            } else if (cyc < 4) {
                                // Owned badge
                                ctx.fillStyle = 'rgba(139,184,96,0.15)';
                                ctx.fillRect(btnX, btnY, btnW, btnH);
                                ctx.strokeStyle = '#8cb860'; ctx.strokeRect(btnX, btnY, btnW, btnH);
                                ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
                                ctx.fillStyle = '#8cb860'; ctx.fillText('Equip', w / 2, btnY + 21);
                                gTap(ctx, w / 2, btnY + 17, t);
                            } else {
                                // Equipped badge
                                ctx.fillStyle = 'rgba(212,160,96,0.15)';
                                ctx.fillRect(btnX, btnY, btnW, btnH);
                                ctx.strokeStyle = '#d4a060'; ctx.strokeRect(btnX, btnY, btnW, btnH);
                                ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
                                ctx.fillStyle = '#d4a060'; ctx.fillText('✓ Equipped', w / 2, btnY + 21);
                            }
                        }
                    },
                    {
                        title: 'Bonus Slots & Perks',
                        desc: 'Buy up to 3 bonus slots to store power-ups for later instead of using them right away. Starting perks give a one-time boost to your next game — like extra points, slower drops, or a guaranteed strong first bonus.',
                        draw(ctx, w, h, t) {
                            ctx.fillStyle = '#0d1117';
                            ctx.fillRect(0, 0, w, h);

                            // Bonus slots visualization
                            gT(ctx, w / 2, 20, 'Bonus Slots', '#d4a060', 16);
                            const slotSize = 42, slotGap = 16;
                            const totalSlotW = 3 * slotSize + 2 * slotGap;
                            const slotStartX = (w - totalSlotW) / 2;
                            const slotY = 36;
                            const slotIcons = ['💣', '❄', '★'];
                            const unlocked = Math.min(Math.floor(t * 0.4) + 1, 3);
                            for (let i = 0; i < 3; i++) {
                                const sx = slotStartX + i * (slotSize + slotGap);
                                if (i < unlocked) {
                                    ctx.fillStyle = '#2a2a3e'; ctx.fillRect(sx, slotY, slotSize, slotSize);
                                    ctx.strokeStyle = '#d4a060'; ctx.lineWidth = 1; ctx.strokeRect(sx, slotY, slotSize, slotSize);
                                    gT(ctx, sx + slotSize / 2, slotY + slotSize / 2, slotIcons[i], '#fff', 18);
                                } else {
                                    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(sx, slotY, slotSize, slotSize);
                                    ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.strokeRect(sx, slotY, slotSize, slotSize);
                                    gT(ctx, sx + slotSize / 2, slotY + slotSize / 2, '🔒', '#555', 16);
                                }
                            }

                            // Perks list
                            gT(ctx, w / 2, slotY + slotSize + 24, 'Starting Perks', '#8cb860', 14);
                            const perks = [
                                { name: 'Head Start', desc: '+200 pts', icon: '▲' },
                                { name: 'Slow Start', desc: '0.5× speed 30s', icon: '◷' },
                                { name: 'Bonus Boost', desc: '1st bonus at 500', icon: '◇' },
                                { name: 'Lucky Draw', desc: 'Bomb/Wild/2×', icon: '★' },
                            ];
                            for (let i = 0; i < perks.length; i++) {
                                const py = slotY + slotSize + 44 + i * 22;
                                ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
                                ctx.fillStyle = '#888'; ctx.fillText(perks[i].icon + ' ' + perks[i].name, 30, py);
                                ctx.textAlign = 'right'; ctx.fillStyle = '#8cb860';
                                ctx.fillText(perks[i].desc, w - 30, py);
                            }
                        }
                    },
                    {
                        title: 'Milestones',
                        desc: 'Milestones are one-time achievements that reward coins. They unlock as you find words, play games, reach levels, and build streaks. A gold notification appears when you earn one.',
                        draw(ctx, w, h, t) {
                            ctx.fillStyle = '#0d1117';
                            ctx.fillRect(0, 0, w, h);

                            gT(ctx, w / 2, 22, '🏆 Milestones', '#d4a060', 18);

                            const milestones = [
                                { label: 'Wordsmith', desc: '50 unique words', coins: '+30', done: true },
                                { label: 'Getting Started', desc: 'Play 10 games', coins: '+25', done: true },
                                { label: 'Rising Star', desc: 'Reach Level 5', coins: '+30', done: true },
                                { label: 'Four Digits', desc: 'Score 1,000+', coins: '+25', done: false },
                                { label: 'Dedicated', desc: 'Play 50 games', coins: '+75', done: false },
                                { label: 'Weekly Warrior', desc: '7-day streak', coins: '+75', done: false },
                            ];
                            const visCount = Math.min(Math.floor(t * 0.6) + 1, milestones.length);
                            for (let i = 0; i < visCount; i++) {
                                const my = 42 + i * 26;
                                const m = milestones[i];
                                ctx.font = m.done ? 'bold 11px sans-serif' : '11px sans-serif';
                                ctx.textAlign = 'left';
                                ctx.fillStyle = m.done ? '#8cb860' : '#666';
                                ctx.fillText((m.done ? '✓ ' : '○ ') + m.label, 20, my);
                                ctx.font = '10px sans-serif';
                                ctx.fillStyle = '#888'; ctx.fillText(m.desc, 20, my + 13);
                                ctx.textAlign = 'right';
                                ctx.fillStyle = m.done ? '#d4a060' : '#555';
                                ctx.fillText(m.coins, w - 20, my + 6);
                            }
                        }
                    }
                ]
            },

            // ═══ DICTIONARY ═══
            {
                id: 'dictionary', icon: '📖', label: 'Dictionary',
                desc: 'Browse words, definitions, synonyms & filters',
                slides: [
                    {
                        title: 'Search & Browse',
                        desc: 'Open the Dictionary from the main menu. Use the search bar to find any word, or tap a letter in the A-Z bar to jump to that section. Over 20,000 words to explore!',
                        draw(ctx, w, h, t) {
                            const pad = 20, cw = w - pad * 2;
                            ctx.fillStyle = '#1a1a2e';
                            ctx.fillRect(pad, 20, cw, h - 40);
                            ctx.strokeStyle = '#4a493e'; ctx.lineWidth = 1;
                            ctx.strokeRect(pad, 20, cw, h - 40);

                            gT(ctx, w / 2, 42, '📖 Dictionary', '#e2d8a6', 16);

                            // Search bar
                            const searchY = 56;
                            ctx.fillStyle = '#222'; ctx.fillRect(pad + 12, searchY, cw - 24, 26);
                            ctx.strokeStyle = '#5c5b4c'; ctx.strokeRect(pad + 12, searchY, cw - 24, 26);
                            const cyc = t % 6;
                            const searchText = 'plum';
                            const typed = searchText.substring(0, Math.floor(clamp(cyc / 1.5, 0, 1) * searchText.length));
                            ctx.fillStyle = typed ? '#fff' : '#706c58';
                            ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                            ctx.fillText(typed ? '⌕ ' + typed.toUpperCase() : '⌕ Search words...', pad + 20, searchY + 13);

                            // A-Z bar
                            const azY = searchY + 34;
                            const azH = 14, azLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                            const letterW = (cw - 24) / 26;
                            const activeIdx = Math.floor(t * 2) % 26;
                            for (let i = 0; i < 26; i++) {
                                const lx = pad + 12 + i * letterW;
                                const isActive = i === activeIdx;
                                ctx.fillStyle = isActive ? '#e2d8a6' : '#706c58';
                                ctx.font = `${isActive ? 'bold ' : ''}${Math.floor(letterW * 0.8)}px sans-serif`;
                                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText(azLetters[i], lx + letterW / 2, azY + azH / 2);
                            }

                            // Word list entries
                            const words = ['PLUMB', 'PLUME', 'PLUMMET', 'PLUMP', 'PLUNDER'];
                            const startY = azY + azH + 12;
                            for (let i = 0; i < words.length; i++) {
                                const wy = startY + i * 28;
                                if (wy > h - 50) break;
                                const highlighted = cyc > 1.5 && i === 0;
                                ctx.fillStyle = highlighted ? 'rgba(226,216,166,0.08)' : 'transparent';
                                ctx.fillRect(pad + 12, wy, cw - 24, 24);
                                ctx.strokeStyle = '#333'; ctx.lineWidth = 0.5;
                                ctx.strokeRect(pad + 12, wy, cw - 24, 24);
                                ctx.fillStyle = highlighted ? '#e2d8a6' : '#b0a878';
                                ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'left';
                                ctx.fillText(words[i], pad + 20, wy + 14);
                                // Length badge
                                ctx.fillStyle = '#4a493e';
                                const bw = 16, bx = pad + cw - 36;
                                ctx.fillRect(bx, wy + 5, bw, 14);
                                ctx.fillStyle = '#888'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
                                ctx.fillText(words[i].length, bx + bw / 2, wy + 13);
                            }

                            gT(ctx, w / 2, h - 30, '20,000+ words', '#706c58', 10);
                        }
                    },
                    {
                        title: 'Filters',
                        desc: 'Filter words by type (Nouns, Verbs, Adjectives, Adverbs), by length (2-3, 4-5, 6-7, 8+), or by category (Food, Animals, Nature, Tech, Sports, and more). Combine filters to narrow results.',
                        draw(ctx, w, h, t) {
                            const pad = 20, cw = w - pad * 2;
                            ctx.fillStyle = '#1a1a2e';
                            ctx.fillRect(pad, 20, cw, h - 40);
                            ctx.strokeStyle = '#4a493e'; ctx.lineWidth = 1;
                            ctx.strokeRect(pad, 20, cw, h - 40);

                            gT(ctx, w / 2, 42, 'Filter Words', '#e2d8a6', 16);

                            // POS filter chips
                            const posFilters = ['All', '📦 Nouns', '⚡ Verbs', '✨ Adj', '📣 Adv'];
                            const posY = 58;
                            const posActive = Math.floor(t * 0.5) % posFilters.length;
                            let posX = pad + 12;
                            for (let i = 0; i < posFilters.length; i++) {
                                const chipW = ctx.measureText ? 8 + posFilters[i].length * 6.5 : 50;
                                ctx.font = '10px sans-serif';
                                const tw = posFilters[i].length * 6 + 12;
                                const isA = i === posActive;
                                ctx.fillStyle = isA ? '#e2d8a6' : '#333';
                                ctx.fillRect(posX, posY, tw, 20);
                                ctx.strokeStyle = isA ? '#e2d8a6' : '#5c5b4c'; ctx.lineWidth = 1;
                                ctx.strokeRect(posX, posY, tw, 20);
                                ctx.fillStyle = isA ? '#111' : '#888';
                                ctx.font = `${isA ? 'bold ' : ''}9px sans-serif`;
                                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText(posFilters[i], posX + tw / 2, posY + 10);
                                posX += tw + 4;
                            }

                            // Length filter chips
                            const lenFilters = ['2-3', '4-5', '6-7', '8+'];
                            const lenY = posY + 28;
                            const lenActive = Math.floor(t * 0.4) % lenFilters.length;
                            let lenX = pad + 12;
                            gT(ctx, pad + 10, lenY - 4, 'Length:', '#706c58', 9);
                            lenX = pad + 48;
                            for (let i = 0; i < lenFilters.length; i++) {
                                const tw = 28;
                                const isA = i === lenActive;
                                ctx.fillStyle = isA ? '#8cb860' : '#333';
                                ctx.fillRect(lenX, lenY, tw, 20);
                                ctx.strokeStyle = isA ? '#8cb860' : '#5c5b4c'; ctx.lineWidth = 1;
                                ctx.strokeRect(lenX, lenY, tw, 20);
                                ctx.fillStyle = isA ? '#111' : '#888';
                                ctx.font = `${isA ? 'bold ' : ''}9px sans-serif`;
                                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText(lenFilters[i], lenX + tw / 2, lenY + 10);
                                lenX += tw + 4;
                            }

                            // Category chips
                            const cats = ['🍕 Food', '🐾 Animals', '🌿 Nature', '💻 Tech', '⚽ Sports'];
                            const catY = lenY + 28;
                            let catX = pad + 12;
                            for (let i = 0; i < cats.length; i++) {
                                const tw = cats[i].length * 6.5 + 8;
                                const isA = i === Math.floor(t * 0.6) % cats.length;
                                ctx.fillStyle = isA ? '#7eb8ff' : '#333';
                                ctx.fillRect(catX, catY, tw, 20);
                                ctx.strokeStyle = isA ? '#7eb8ff' : '#5c5b4c'; ctx.lineWidth = 1;
                                ctx.strokeRect(catX, catY, tw, 20);
                                ctx.fillStyle = isA ? '#111' : '#888';
                                ctx.font = `${isA ? 'bold ' : ''}9px sans-serif`;
                                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText(cats[i], catX + tw / 2, catY + 10);
                                catX += tw + 4;
                                if (catX > w - pad - 20) { catX = pad + 12; }
                            }

                            // Result count
                            const counts = [20000, 8200, 5400, 3100, 820];
                            const count = counts[posActive];
                            gT(ctx, w / 2, h - 48, count.toLocaleString() + ' results', '#b0a878', 12);

                            // Sample filtered results
                            const resultY = catY + 32;
                            const results = ['APPLE', 'BACON', 'BREAD', 'CAKE'];
                            for (let i = 0; i < results.length; i++) {
                                const ry = resultY + i * 22;
                                if (ry > h - 58) break;
                                ctx.fillStyle = '#b0a878'; ctx.font = '10px sans-serif';
                                ctx.textAlign = 'left'; ctx.fillText(results[i], pad + 20, ry);
                            }
                        }
                    },
                    {
                        title: 'Word Cards',
                        desc: 'Tap any word to expand its card. See definitions with part-of-speech tags, synonyms you can tap to jump to, and length badges. A great way to discover new words for your next game!',
                        draw(ctx, w, h, t) {
                            const pad = 20, cw = w - pad * 2;
                            ctx.fillStyle = '#1a1a2e';
                            ctx.fillRect(pad, 20, cw, h - 40);
                            ctx.strokeStyle = '#4a493e'; ctx.lineWidth = 1;
                            ctx.strokeRect(pad, 20, cw, h - 40);

                            const cyc = t % 6;
                            const isExpanded = cyc > 1.5;

                            // Collapsed card
                            const cardY = 36;
                            const cardH = isExpanded ? 130 : 32;
                            ctx.fillStyle = isExpanded ? 'rgba(226,216,166,0.06)' : '#222';
                            ctx.fillRect(pad + 10, cardY, cw - 20, cardH);
                            ctx.strokeStyle = isExpanded ? '#e2d8a6' : '#4a493e'; ctx.lineWidth = 1;
                            ctx.strokeRect(pad + 10, cardY, cw - 20, cardH);

                            // Word title
                            ctx.fillStyle = '#e2d8a6'; ctx.font = 'bold 13px sans-serif';
                            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                            ctx.fillText('PLUMMET', pad + 18, cardY + 16);

                            // POS badges
                            const badges = [{ label: 'noun', color: '#4a7a4a' }, { label: 'verb', color: '#4a4a7a' }];
                            let bx = pad + 82;
                            for (const b of badges) {
                                const bw = b.label.length * 6.5 + 8;
                                ctx.fillStyle = b.color; ctx.fillRect(bx, cardY + 8, bw, 16);
                                ctx.fillStyle = '#ddd'; ctx.font = '9px sans-serif';
                                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText(b.label, bx + bw / 2, cardY + 16);
                                bx += bw + 4;
                            }

                            // Length badge
                            ctx.fillStyle = '#4a493e';
                            ctx.fillRect(pad + cw - 42, cardY + 8, 22, 16);
                            ctx.fillStyle = '#888'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
                            ctx.fillText('7', pad + cw - 31, cardY + 16);

                            // Chevron
                            ctx.fillStyle = '#888'; ctx.font = '12px sans-serif';
                            ctx.textAlign = 'right';
                            ctx.fillText(isExpanded ? '▴' : '▾', pad + cw - 16, cardY + 16);

                            if (isExpanded) {
                                // Definitions
                                const defY = cardY + 38;
                                ctx.fillStyle = '#888'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
                                ctx.fillText('1. (noun) a steep, rapid fall', pad + 18, defY);
                                ctx.fillText('2. (verb) to fall or drop straight', pad + 18, defY + 16);
                                ctx.fillText('   down at high speed', pad + 18, defY + 28);

                                // Synonyms
                                const synY = defY + 46;
                                ctx.fillStyle = '#706c58'; ctx.font = '9px sans-serif';
                                ctx.fillText('Synonyms:', pad + 18, synY);
                                const syns = ['drop', 'fall', 'plunge', 'dive'];
                                let sx = pad + 18;
                                for (const syn of syns) {
                                    const sw = syn.length * 6 + 10;
                                    ctx.fillStyle = '#2a2a3e'; ctx.fillRect(sx, synY + 6, sw, 18);
                                    ctx.strokeStyle = '#5c5b4c'; ctx.lineWidth = 0.5;
                                    ctx.strokeRect(sx, synY + 6, sw, 18);
                                    ctx.fillStyle = '#7eb8ff'; ctx.font = '9px sans-serif';
                                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                    ctx.fillText(syn, sx + sw / 2, synY + 15);
                                    sx += sw + 4;
                                }
                            }

                            if (!isExpanded) {
                                gTap(ctx, w / 2, cardY + 16, t);
                                gT(ctx, w / 2, cardY + 46, 'Tap to expand', '#706c58', 10);
                            }

                            // Second card (collapsed) below
                            const card2Y = cardY + cardH + 8;
                            if (card2Y < h - 60) {
                                ctx.fillStyle = '#222';
                                ctx.fillRect(pad + 10, card2Y, cw - 20, 32);
                                ctx.strokeStyle = '#4a493e'; ctx.lineWidth = 1;
                                ctx.strokeRect(pad + 10, card2Y, cw - 20, 32);
                                ctx.fillStyle = '#b0a878'; ctx.font = 'bold 13px sans-serif';
                                ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                                ctx.fillText('PLUMP', pad + 18, card2Y + 16);
                                ctx.fillStyle = '#4a7a4a'; ctx.fillRect(pad + 70, card2Y + 8, 28, 16);
                                ctx.fillStyle = '#ddd'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
                                ctx.fillText('adj', pad + 84, card2Y + 16);
                                ctx.fillStyle = '#888'; ctx.font = '12px sans-serif';
                                ctx.textAlign = 'right';
                                ctx.fillText('▾', pad + cw - 16, card2Y + 16);
                            }

                            // Third card
                            const card3Y = card2Y + 40;
                            if (card3Y < h - 58) {
                                ctx.fillStyle = '#222';
                                ctx.fillRect(pad + 10, card3Y, cw - 20, 32);
                                ctx.strokeStyle = '#4a493e'; ctx.lineWidth = 1;
                                ctx.strokeRect(pad + 10, card3Y, cw - 20, 32);
                                ctx.fillStyle = '#b0a878'; ctx.font = 'bold 13px sans-serif';
                                ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                                ctx.fillText('PLUNDER', pad + 18, card3Y + 16);
                                ctx.fillStyle = '#4a4a7a'; ctx.fillRect(pad + 82, card3Y + 8, 30, 16);
                                ctx.fillStyle = '#ddd'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
                                ctx.fillText('verb', pad + 97, card3Y + 16);
                                ctx.fillStyle = '#888'; ctx.font = '12px sans-serif';
                                ctx.textAlign = 'right';
                                ctx.fillText('▾', pad + cw - 16, card3Y + 16);
                            }
                        }
                    }
                ]
            }
        ];
    }

    _openTutorial() {
        this._initTutorialSlides();
        this._stopTutorialAnim();
        this._tutorialMenuView = 'root';
        this._tutorialParentMenuView = 'root';
        this._renderTutorialMenu();

        this.els.tutorialMenu.style.display = '';
        this.els.tutorialSlides.classList.add('hidden');
        this.els.tutorialOverlay.classList.add('active');
    }

    _renderTutorialMenu() {
        if (this._tutorialMenuView === 'guided') {
            this._renderGuidedTutorialMenu();
            return;
        }
        this._renderTutorialRootMenu();
    }

    _renderTutorialRootMenu() {
        const list = this.els.tutorialMenuList;
        list.innerHTML = '';

        // Guided Tours section hidden for now — code preserved, UI removed
        // To re-enable, uncomment the guided heading + button block below

        const standardHeading = document.createElement('div');
        standardHeading.className = 'tutorial-menu-section-title';
        standardHeading.textContent = 'Tutorial Library';
        list.appendChild(standardHeading);

        for (let i = 0; i < this._tutorialCategories.length; i++) {
            const cat = this._tutorialCategories[i];
            const btn = document.createElement('button');
            btn.className = 'tutorial-category-btn';
            btn.innerHTML = `<span class="tutorial-cat-icon">${cat.icon}</span>
                <span class="tutorial-cat-info">
                    <span class="tutorial-cat-label">${cat.label}</span>
                    <span class="tutorial-cat-desc">${cat.desc}</span>
                </span>`;
            btn.addEventListener('click', () => this._openTutorialCategory(i, 'root'));
            list.appendChild(btn);
        }
    }

    _renderGuidedTutorialMenu() {
        const list = this.els.tutorialMenuList;
        list.innerHTML = '';

        const backBtn = document.createElement('button');
        backBtn.className = 'tutorial-submenu-back-btn';
        backBtn.textContent = '← Back to Tutorials';
        backBtn.addEventListener('click', () => {
            this._tutorialMenuView = 'root';
            this._renderTutorialMenu();
        });
        list.appendChild(backBtn);

        const heading = document.createElement('div');
        heading.className = 'tutorial-menu-section-title';
        heading.textContent = 'Guided Tour Options';
        list.appendChild(heading);

        const note = document.createElement('div');
        note.className = 'tutorial-guided-note';
        note.textContent = 'These entries are now grouped in their own guided-tour submenu at the top of the tutorial menu.';
        list.appendChild(note);

        const options = this._getGuidedTutorialOptions();
        for (const option of options) {
            const btn = document.createElement('button');
            btn.className = 'tutorial-category-btn tutorial-guided-option-btn';
            btn.innerHTML = `<span class="tutorial-cat-icon">${option.icon}</span>
                <span class="tutorial-cat-info">
                    <span class="tutorial-cat-label">${option.label}</span>
                    <span class="tutorial-cat-desc">${option.desc}</span>
                </span>`;
            btn.addEventListener('click', () => this._openGuidedTutorialOption(option));
            list.appendChild(btn);
        }
    }

    _getGuidedTutorialOptions() {
        return [
            {
                id: 'guided-general',
                icon: '◉',
                label: 'General Tour',
                desc: 'Main grid gameplay, pause menu, hints, shop, dictionary, and music.',
                fallbackCategoryId: 'basics',
            },
            {
                id: 'guided-target-word',
                icon: '◎',
                label: 'Target Word Tour',
                desc: 'Challenge-specific walkthrough for Target Word.',
                fallbackCategoryId: 'challenges',
            },
            {
                id: 'guided-speed-round',
                icon: '▲',
                label: 'Speed Round Tour',
                desc: 'Challenge-specific walkthrough for Speed Round.',
                fallbackCategoryId: 'challenges',
            },
            {
                id: 'guided-word-category',
                icon: '▦',
                label: 'Word Category Tour',
                desc: 'Challenge-specific walkthrough for category-based scoring.',
                fallbackCategoryId: 'challenges',
            },
            {
                id: 'guided-word-search',
                icon: '🔍',
                label: 'Word Search Tour',
                desc: 'Challenge-specific walkthrough for hidden-word gameplay.',
                fallbackCategoryId: 'challenges',
            },
            {
                id: 'guided-word-runner',
                icon: '🏃',
                label: 'Word Runner Tour',
                desc: 'Challenge-specific walkthrough for the runner mode.',
                fallbackCategoryId: 'challenges',
            },
            {
                id: 'guided-bonuses',
                icon: '◇',
                label: 'Bonuses Tour',
                desc: 'Dedicated walkthrough for bonuses, slots, and power-ups.',
                fallbackCategoryId: 'bonuses',
            },
            {
                id: 'guided-leaderboard',
                icon: '⬡',
                label: 'Leaderboards & Skill System',
                desc: 'Dedicated walkthrough for leaderboards, classes, and skill rating.',
                fallbackCategoryId: 'leaderboard',
            },
        ];
    }

    _openGuidedTutorialOption(option) {
        this._startGuidedTour(option.id);
    }

    _startGuidedTour(tourId) {
        const tours = this._getGuidedTourDefinitions();
        const tour = tours[tourId];
        if (!tour) return;

        this._cleanupGuidedTourStep();
        this._guidedTour.active = true;
        this._guidedTour.tour = tour;
        this._guidedTour.stepIndex = 0;
        this._guidedTour.restoreTutorialOverlay = this.els.tutorialOverlay.classList.contains('active');
        this._guidedTour.restoreTutorialMenuView = this._tutorialMenuView || 'root';
        this._guidedTour.restoreScreen = this._activeScreen || 'menu';
        this._guidedTour.restoreMenuPage = this._menuPage || 1;

        this._stopTutorialAnim();
        this._unbindTutorialSwipe();
        this.els.tutorialOverlay.classList.remove('active');

        this.els.guidedTourOverlay.classList.add('active');
        // Ensure clean initial state for overlay layers
        this.els.guidedTourDim.style.opacity = '0';
        this.els.guidedTourFocus.style.opacity = '0';
        this.els.guidedTourCard.classList.remove('visible');
        this.els.guidedTourCard.classList.remove('hidden');
        if (!this._guidedTour.resizeHandler) {
            this._guidedTour.resizeHandler = () => this._positionGuidedTourStep();
        }
        window.addEventListener('resize', this._guidedTour.resizeHandler);
        this._enterGuidedTourStep(0);
    }

    _getGuidedTourDefinitions() {
        const call = (method, ...args) => ({ type: 'call', method, args });
        const hot = (container, x, y, width, height, extra = {}) => ({
            type: 'hotspot',
            container,
            x,
            y,
            width,
            height,
            radius: extra.radius || '18px',
        });

        return {
            'guided-general': {
                label: 'General Tour',
                steps: [
                    {
                        title: 'Welcome to PLUMMET!',
                        body: 'Let\'s walk you through the game step by step. We\'ll show you how everything works so you\'re ready to play!',
                        mode: 'continue',
                        target: '#menu-profile-name',
                        onEnter: [call('_setupGuidedMenuPage', 1)],
                        focusPadding: 10,
                        hideArrow: true,
                    },
                    {
                        title: 'Game Settings',
                        body: 'Before you play, pick your grid size and difficulty here. Bigger grids and harder modes give more points but are trickier!',
                        mode: 'continue',
                        target: '#grid-size-selector',
                        onEnter: [call('_setupGuidedMenuPage', 1)],
                        focusPadding: 12,
                    },
                    {
                        title: 'Challenges',
                        body: 'Tap here to try special game modes like Target Word, Speed Round, and more. Each one has different rules and rewards.',
                        mode: 'continue',
                        target: '#challenges-btn',
                        onEnter: [call('_setupGuidedMenuPage', 1)],
                    },
                    {
                        title: 'Start Playing!',
                        body: 'Tap the Start button to jump into a practice round. Don\'t worry — this is just for learning!',
                        mode: 'tap-target',
                        target: '#start-btn',
                        onEnter: [call('_setupGuidedMenuPage', 1)],
                        onAdvance: [call('_setupGuidedPlummetScene', {
                            score: 0,
                            coins: 12,
                            nextLetter: 'A',
                            bonusVisible: true,
                            popupText: 'Guided practice board',
                            levelText: 'Lv. 6',
                            xpText: '420 / 700',
                            wordsButtonText: 'Words So Far',
                        })],
                        showPointer: true,
                    },
                    {
                        title: 'Your Game Info',
                        body: 'This bar at the top shows your score, coins, level, and high score. Keep an eye on it during the game!',
                        mode: 'continue',
                        target: '#score-bar',
                        focusPadding: 14,
                    },
                    {
                        title: 'Next Letter',
                        body: 'This shows what letter is coming next. Use it to plan ahead instead of just reacting!',
                        mode: 'continue',
                        target: '#next-letter-display',
                    },
                    {
                        title: 'Place a Letter',
                        body: 'Tap the glowing spot on the board to drop a letter there. Try to spell words across or down!',
                        mode: 'tap-target',
                        target: hot('#canvas-wrapper', 0.43, 0.36, 0.14, 0.14),
                        noOverlay: true,
                        onAdvance: [call('_setupGuidedPlummetScene', {
                            score: 120,
                            coins: 15,
                            nextLetter: 'R',
                            bonusVisible: true,
                            popupText: 'CAT +120',
                            levelText: 'Lv. 6',
                            xpText: '448 / 700',
                        })],
                        showPointer: true,
                    },
                    {
                        title: 'Make Multiple Words!',
                        body: 'Nice — one letter can make more than one word at a time! Tap here to see it in action.',
                        mode: 'tap-target',
                        target: hot('#canvas-wrapper', 0.58, 0.51, 0.14, 0.14),
                        noOverlay: true,
                        onAdvance: [call('_setupGuidedPlummetScene', {
                            score: 340,
                            coins: 22,
                            nextLetter: 'E',
                            bonusVisible: true,
                            popupText: 'CAT +120   CAR +100',
                            radialVisible: true,
                            levelText: 'Lv. 6',
                            xpText: '501 / 700',
                        })],
                        showPointer: true,
                        pointerX: 0.72,
                        pointerY: 0.62,
                    },
                    {
                        title: 'Need a Hint?',
                        body: 'Stuck? Tap the hint button to get help finding a word. It\'s right here on the board.',
                        mode: 'continue',
                        target: '#hints-btn',
                    },
                    {
                        title: 'Bonuses',
                        body: 'The Bonus button gives you a power-up right away. The slots around it let you save power-ups for later when you really need them.',
                        mode: 'continue',
                        target: '#radial-menu',
                        focusPadding: 14,
                    },
                    {
                        title: 'Words So Far',
                        body: 'Tap this to see all the words you\'ve made so far in the current game.',
                        mode: 'continue',
                        target: '#play-words-found-btn',
                    },
                    {
                        title: 'Pause',
                        body: 'Tap the pause button to take a break or access other options.',
                        mode: 'tap-target',
                        target: '#pause-btn',
                        onAdvance: [call('_openGuidedPauseOverlay')],
                        showPointer: true,
                    },
                    {
                        title: 'Pause Menu',
                        body: 'From here you can resume, check your words, open the dictionary, change music, visit the shop, or quit the game.',
                        mode: 'continue',
                        target: '#pause-overlay .overlay-content',
                        focusPadding: 16,
                    },
                    {
                        title: 'The Shop',
                        body: 'Spend your coins here on themes, extra bonus slots, and other goodies to power up your game.',
                        mode: 'continue',
                        target: '#shop-tabs',
                        onEnter: [call('_setupGuidedShopScene')],
                    },
                    {
                        title: 'Dictionary',
                        body: 'Look up any word! You can search, filter by length, and browse by category. Great for building your vocabulary.',
                        mode: 'continue',
                        target: '#dict-search-bar',
                        onEnter: [call('_setupGuidedDictionaryScene')],
                        focusPadding: 14,
                    },
                    {
                        title: 'Music Player',
                        body: 'Control the background music here — play, pause, skip, shuffle, and adjust volume.',
                        mode: 'continue',
                        target: '#now-playing-bar',
                        onEnter: [call('_setupGuidedMusicScene')],
                        focusPadding: 16,
                    },
                    {
                        title: 'Tour Complete!',
                        body: 'That\'s the basics — settings, gameplay, hints, bonuses, pause menu, shop, dictionary, and music. You\'re ready to play for real!',
                        mode: 'continue',
                        target: '#np-controls',
                        hideArrow: true,
                    },
                ],
            },
            'guided-target-word': {
                label: 'Target Word Tour',
                steps: [
                    {
                        title: 'Target Word Mode',
                        body: 'In this mode, you\'re given a specific word to spell. Tap this card to start!',
                        mode: 'tap-target',
                        target: '.challenge-card[data-challenge="target-word"]',
                        onEnter: [call('_setupGuidedChallengeSelectScene')],
                        onAdvance: [call('_setupGuidedChallengeSetupScene', CHALLENGE_TYPES.TARGET_WORD)],
                        showPointer: true,
                    },
                    {
                        title: 'Setup Screen',
                        body: 'This is where you start the challenge. Check the details, then jump in when you\'re ready!',
                        mode: 'continue',
                        target: '#challenge-setup-name',
                    },
                    {
                        title: 'Ready to Go',
                        body: 'Hit this button to begin. Your goal is to spell the target word shown on screen.',
                        mode: 'continue',
                        target: '#challenge-start-btn',
                    },
                    {
                        title: 'Your Target Word',
                        body: 'See it right here! This is the word you need to spell. Keep your eye on it the whole time.',
                        mode: 'continue',
                        target: '#target-word-display',
                        onEnter: [call('_setupGuidedPlummetScene', {
                            score: 340,
                            coins: 24,
                            nextLetter: 'T',
                            bonusVisible: false,
                            popupText: 'Target Word practice',
                            targetWord: 'TREE',
                            targetLabel: 'TARGET:',
                            showTargetWord: true,
                            levelText: 'Lv. 9',
                            xpText: '290 / 900',
                        })],
                    },
                    {
                        title: 'Build the Word',
                        body: 'Tap the glowing spot to place a letter. Every letter you drop should help you spell the target!',
                        mode: 'tap-target',
                        target: hot('#canvas-wrapper', 0.48, 0.42, 0.14, 0.14),
                        noOverlay: true,
                        onAdvance: [call('_setupGuidedPlummetScene', {
                            score: 520,
                            coins: 29,
                            nextLetter: 'E',
                            bonusVisible: false,
                            popupText: 'TREE progress +180',
                            targetWord: 'TREE',
                            targetLabel: 'TARGET:',
                            showTargetWord: true,
                            levelText: 'Lv. 9',
                            xpText: '372 / 900',
                        })],
                        showPointer: true,
                    },
                    {
                        title: 'Finish the Word!',
                        body: 'Almost there! Tap again to complete the target word and earn bonus points.',
                        mode: 'tap-target',
                        target: hot('#canvas-wrapper', 0.62, 0.34, 0.14, 0.14),
                        noOverlay: true,
                        onAdvance: [call('_setupGuidedPlummetScene', {
                            score: 890,
                            coins: 38,
                            nextLetter: 'B',
                            bonusVisible: true,
                            popupText: 'TARGET COMPLETE +370',
                            targetWord: 'BARK',
                            targetLabel: 'NEXT:',
                            showTargetWord: true,
                            levelText: 'Lv. 10',
                            xpText: '110 / 1000',
                        })],
                        showPointer: true,
                    },
                    {
                        title: 'Next Target!',
                        body: 'Done! A new target word appears automatically. Keep spelling to rack up points!',
                        mode: 'continue',
                        target: '#target-word-display',
                    },
                ],
            },
            'guided-speed-round': {
                label: 'Speed Round Tour',
                steps: [
                    {
                        title: 'Speed Round Mode',
                        body: 'This is a race against the clock! Spell words fast before time runs out. Tap here to start.',
                        mode: 'tap-target',
                        target: '.challenge-card[data-challenge="speed-round"]',
                        onEnter: [call('_setupGuidedChallengeSelectScene')],
                        onAdvance: [call('_setupGuidedChallengeSetupScene', CHALLENGE_TYPES.SPEED_ROUND)],
                        showPointer: true,
                    },
                    {
                        title: 'Setup Screen',
                        body: 'Ready? Once you start, the timer begins ticking right away!',
                        mode: 'continue',
                        target: '#challenge-setup-name',
                    },
                    {
                        title: 'The Timer',
                        body: 'See the clock? It\'s counting down! You need to spell words quickly to score before time\'s up.',
                        mode: 'continue',
                        target: '#timer-score-item',
                        onEnter: [call('_setupGuidedPlummetScene', {
                            score: 680,
                            coins: 18,
                            nextLetter: 'S',
                            bonusVisible: false,
                            popupText: 'Speed Round simulation',
                            timerText: '0:45',
                            showTimer: true,
                            levelText: 'Lv. 7',
                            xpText: '510 / 780',
                        })],
                    },
                    {
                        title: 'Quick! Place a Letter',
                        body: 'Tap fast! Every second counts in Speed Round. Drop letters and make words before the timer hits zero.',
                        mode: 'tap-target',
                        target: hot('#canvas-wrapper', 0.36, 0.48, 0.14, 0.14),
                        noOverlay: true,
                        onAdvance: [call('_setupGuidedPlummetScene', {
                            score: 810,
                            coins: 21,
                            nextLetter: 'D',
                            bonusVisible: false,
                            popupText: 'Quick score +130',
                            timerText: '0:31',
                            showTimer: true,
                            levelText: 'Lv. 7',
                            xpText: '553 / 780',
                        })],
                        showPointer: true,
                    },
                    {
                        title: 'Keep Going!',
                        body: 'Your score and timer are both up top. The faster you spell words, the higher your score!',
                        mode: 'continue',
                        target: '#score-bar',
                    },
                    {
                        title: 'Need a Breather?',
                        body: 'Even in Speed Round, you can pause. Tap the pause button if you need a moment.',
                        mode: 'tap-target',
                        target: '#pause-btn',
                        onAdvance: [call('_openGuidedPauseOverlay')],
                        showPointer: true,
                    },
                    {
                        title: 'Pause Menu',
                        body: 'Take a breath! From here you can resume, check your words, or quit if you need to.',
                        mode: 'continue',
                        target: '#pause-overlay .overlay-content',
                    },
                ],
            },
            'guided-word-category': {
                label: 'Word Category Tour',
                steps: [
                    {
                        title: 'Word Category Mode',
                        body: 'In this mode, you pick a topic and try to spell words that match it. Tap the card to get started!',
                        mode: 'tap-target',
                        target: '.challenge-card[data-challenge="word-category"]',
                        onEnter: [call('_setupGuidedChallengeSelectScene')],
                        onAdvance: [call('_setupGuidedChallengeSetupScene', CHALLENGE_TYPES.WORD_CATEGORY, { categoryKey: 'nature' })],
                        showPointer: true,
                    },
                    {
                        title: 'Pick a Topic',
                        body: 'Choose a category like Nature, Food, or Animals. You\'ll get extra points for words that fit your topic!',
                        mode: 'continue',
                        target: '#challenge-category-selector',
                        focusPadding: 14,
                    },
                    {
                        title: 'Your Pick',
                        body: 'This is the category you chose. Words matching this topic will score higher!',
                        mode: 'continue',
                        target: '.category-pick-btn.selected',
                    },
                    {
                        title: 'Category on Screen',
                        body: 'During the game, your chosen category shows up here. Spell words that match it for bonus points!',
                        mode: 'continue',
                        target: '#target-word-display',
                        onEnter: [call('_setupGuidedPlummetScene', {
                            score: 420,
                            coins: 16,
                            nextLetter: 'N',
                            bonusVisible: false,
                            popupText: 'Nature category practice',
                            targetWord: '🌿 Nature',
                            targetLabel: 'CATEGORY:',
                            showTargetWord: true,
                            levelText: 'Lv. 8',
                            xpText: '280 / 840',
                        })],
                    },
                    {
                        title: 'Match the Topic!',
                        body: 'Tap here to place a letter. If the word you make fits the category, you get extra points!',
                        mode: 'tap-target',
                        target: hot('#canvas-wrapper', 0.57, 0.40, 0.14, 0.14),
                        noOverlay: true,
                        onAdvance: [call('_setupGuidedPlummetScene', {
                            score: 630,
                            coins: 22,
                            nextLetter: 'G',
                            bonusVisible: false,
                            popupText: 'Category match bonus +210',
                            targetWord: '🌿 Nature',
                            targetLabel: 'CATEGORY:',
                            showTargetWord: true,
                            levelText: 'Lv. 8',
                            xpText: '349 / 840',
                        })],
                        showPointer: true,
                    },
                    {
                        title: 'Not Every Word Counts',
                        body: 'You can still spell any word, but only words that match the category give you the bonus. That\'s the challenge!',
                        mode: 'continue',
                        target: '#target-word-display',
                    },
                ],
            },
            'guided-word-search': {
                label: 'Word Search Tour',
                steps: [
                    {
                        title: 'Word Search Mode',
                        body: 'This one works differently — find hidden words in a grid of letters! Tap the card to try it.',
                        mode: 'tap-target',
                        target: '.challenge-card[data-challenge="word-search"]',
                        onEnter: [call('_setupGuidedChallengeSelectScene')],
                        onAdvance: [call('_setupGuidedChallengeSetupScene', CHALLENGE_TYPES.WORD_SEARCH)],
                        showPointer: true,
                    },
                    {
                        title: 'Setup',
                        body: 'Word Search has its own setup. Jump in and start hunting for hidden words!',
                        mode: 'continue',
                        target: '#challenge-setup-name',
                    },
                    {
                        title: 'The Word Grid',
                        body: 'Here\'s the grid! Swipe across letters to find hidden words. They can go in any direction.',
                        mode: 'continue',
                        target: '#ws-grid-container',
                        noOverlay: true,
                        onEnter: [call('_setupGuidedWsScene', {
                            score: '180',
                            timer: '5:00',
                            words: 'Words Found: 2',
                            level: '3',
                            coins: '8',
                            levelText: 'Lv. 3',
                        })],
                    },
                    {
                        title: 'Find a Word!',
                        body: 'Tap the glowing area to find a hidden word. In the real game, you\'d swipe across the letters.',
                        mode: 'tap-target',
                        target: hot('#ws-grid-container', 0.22, 0.28, 0.28, 0.12, { radius: '12px' }),
                        noOverlay: true,
                        onAdvance: [call('_setupGuidedWsScene', {
                            score: '320',
                            timer: '4:36',
                            words: 'Words Found: 3',
                            level: '3',
                            coins: '11',
                            levelText: 'Lv. 3',
                        })],
                        showPointer: true,
                        pointerX: 0.5,
                        pointerY: 0.5,
                    },
                    {
                        title: 'Words Found',
                        body: 'This counter shows how many words you\'ve discovered so far. Find them all to win!',
                        mode: 'continue',
                        target: '#ws-words-found-bar',
                    },
                    {
                        title: 'Timer',
                        body: 'You still have a time limit, but it\'s more relaxed than Speed Round. Take your time to search!',
                        mode: 'continue',
                        target: '#ws-score-bar',
                    },
                    {
                        title: 'Pause',
                        body: 'Tap pause to take a break from searching.',
                        mode: 'tap-target',
                        target: '#ws-pause-btn',
                        onAdvance: [call('_openGuidedWsPauseOverlay')],
                        showPointer: true,
                    },
                    {
                        title: 'Pause Options',
                        body: 'Same as before — resume, check your words, open the dictionary, listen to music, or quit.',
                        mode: 'continue',
                        target: '#ws-pause-overlay .overlay-content',
                    },
                ],
            },
            'guided-word-runner': {
                label: 'Word Runner Tour',
                steps: [
                    {
                        title: 'Word Runner Mode',
                        body: 'This is an endless runner with a twist — you collect letters to spell words as you run! Tap to start.',
                        mode: 'tap-target',
                        target: '.challenge-card[data-challenge="word-runner"]',
                        onEnter: [call('_setupGuidedChallengeSelectScene')],
                        onAdvance: [call('_setupGuidedChallengeSetupScene', CHALLENGE_TYPES.WORD_RUNNER)],
                        showPointer: true,
                    },
                    {
                        title: 'Setup',
                        body: 'Once you start, your character runs automatically. Get ready to jump and collect!',
                        mode: 'continue',
                        target: '#challenge-setup-name',
                    },
                    {
                        title: 'The Runner',
                        body: 'Here\'s the game! Your character runs forward while you jump to grab letters floating above.',
                        mode: 'continue',
                        target: '#wr-canvas-container',
                        noOverlay: true,
                        onEnter: [call('_setupGuidedWrScene', {
                            score: '250',
                            distance: '42m',
                            coins: '11',
                            wordBoxesHtml: '<div class="wr-box guided-wr-box">C</div><div class="wr-box guided-wr-box">A</div><div class="wr-box guided-wr-box empty">_</div>'
                        })],
                    },
                    {
                        title: 'Jump & Collect!',
                        body: 'Tap to jump and grab a letter! Collect the right letters to spell words.',
                        mode: 'tap-target',
                        target: hot('#wr-canvas-container', 0.38, 0.46, 0.2, 0.18),
                        noOverlay: true,
                        onAdvance: [call('_setupGuidedWrScene', {
                            score: '390',
                            distance: '61m',
                            coins: '14',
                            wordBoxesHtml: '<div class="wr-box guided-wr-box">C</div><div class="wr-box guided-wr-box">A</div><div class="wr-box guided-wr-box">T</div>'
                        })],
                        showPointer: true,
                    },
                    {
                        title: 'Letter Boxes',
                        body: 'These boxes at the top show the letters you\'ve collected. Fill them up to spell a word!',
                        mode: 'continue',
                        target: '#wr-word-boxes',
                    },
                    {
                        title: 'Submit Your Word',
                        body: 'When the boxes are full, tap this button to check if it\'s a real word. If it is, you score points!',
                        mode: 'continue',
                        target: '#wr-validate-btn',
                    },
                    {
                        title: 'Pause',
                        body: 'Need a break from running? Tap pause.',
                        mode: 'tap-target',
                        target: '#wr-pause-btn',
                        onAdvance: [call('_openGuidedWrPauseOverlay')],
                        showPointer: true,
                    },
                    {
                        title: 'Pause Menu',
                        body: 'Resume, check your words, open the dictionary, change music, visit the shop, or call it a day.',
                        mode: 'continue',
                        target: '#wr-pause-overlay .overlay-content',
                    },
                ],
            },
            'guided-bonuses': {
                label: 'Bonuses Tour',
                steps: [
                    {
                        title: 'Bonuses!',
                        body: 'During a game, you\'ll earn power-ups called bonuses. This button appears when one is ready to use!',
                        mode: 'continue',
                        target: '#bonus-btn',
                        onEnter: [call('_setupGuidedPlummetScene', {
                            score: 900,
                            coins: 33,
                            nextLetter: 'B',
                            bonusVisible: true,
                            popupText: 'Bonus tutorial scene',
                            radialVisible: true,
                            levelText: 'Lv. 12',
                            xpText: '480 / 1200',
                        })],
                    },
                    {
                        title: 'Bonus Slots',
                        body: 'These slots let you save bonuses for later. Don\'t have to use them right away — hold onto them for when you really need help!',
                        mode: 'continue',
                        target: '#radial-toggle',
                    },
                    {
                        title: 'Use It Now',
                        body: 'Or tap the bonus button to use your power-up immediately. It\'s up to you — save it or use it!',
                        mode: 'continue',
                        target: '#bonus-btn',
                    },
                    {
                        title: 'Freeze Power-Up',
                        body: 'Freeze stops the letters from falling for a few seconds. Great when you need time to think!',
                        mode: 'continue',
                        target: '#freeze-indicator',
                        onEnter: [call('_setupGuidedPlummetScene', {
                            score: 1040,
                            coins: 36,
                            nextLetter: 'F',
                            bonusVisible: true,
                            popupText: 'Freeze active',
                            radialVisible: true,
                            freezeVisible: true,
                            levelText: 'Lv. 12',
                            xpText: '536 / 1200',
                        })],
                    },
                    {
                        title: 'Save for Later',
                        body: 'Your saved bonuses stay in these slots until you choose to use them. Sometimes the perfect moment comes later!',
                        mode: 'continue',
                        target: '#radial-slots',
                    },
                    {
                        title: '2× Score!',
                        body: 'This power-up doubles the points from your next word. Try to use it right before a big word!',
                        mode: 'continue',
                        target: '#score-2x-indicator',
                        onEnter: [call('_setupGuidedPlummetScene', {
                            score: 1180,
                            coins: 39,
                            nextLetter: 'X',
                            bonusVisible: true,
                            popupText: '2× next word',
                            radialVisible: true,
                            score2xVisible: true,
                            levelText: 'Lv. 12',
                            xpText: '601 / 1200',
                        })],
                    },
                    {
                        title: 'Bonus Wrap-Up',
                        body: 'That\'s bonuses! Use them now for quick help, or save them for the perfect moment. Smart timing wins games!',
                        mode: 'continue',
                        target: '#radial-menu',
                    },
                ],
            },
            'guided-leaderboard': {
                label: 'Leaderboards & Skill System',
                steps: [
                    {
                        title: 'Rankings',
                        body: 'Tap here to see how you stack up against other players!',
                        mode: 'continue',
                        target: '#leaderboard-btn',
                        onEnter: [call('_setupGuidedMenuPage', 2)],
                    },
                    {
                        title: 'Open Leaderboards',
                        body: 'Tap to see the full leaderboard and your ranking!',
                        mode: 'tap-target',
                        target: '#leaderboard-btn',
                        onAdvance: [call('_setupGuidedLeaderboardScene')],
                        showPointer: true,
                    },
                    {
                        title: 'Different Boards',
                        body: 'There are separate leaderboards for the main game and each challenge mode. Tap the tabs to switch between them.',
                        mode: 'continue',
                        target: '#lb-tabs',
                        focusPadding: 14,
                    },
                    {
                        title: 'Skill Levels',
                        body: 'Players are grouped by skill level. You compete against people at your level, so it\'s always a fair match!',
                        mode: 'continue',
                        target: '#lb-class-filter',
                        focusPadding: 14,
                    },
                    {
                        title: 'Your Rank',
                        body: 'Here\'s where you stand! This shows your current rank and skill level.',
                        mode: 'continue',
                        target: '#lb-my-rank',
                    },
                    {
                        title: 'Your Stats',
                        body: 'This breaks down how your rank is calculated — your best scores, how often you play, and your challenge results all count.',
                        mode: 'continue',
                        target: '#lb-my-stats',
                        focusPadding: 14,
                    },
                    {
                        title: 'The Ladder',
                        body: 'See where everyone else is! Climb higher by playing well and completing challenges.',
                        mode: 'continue',
                        target: '#lb-list',
                        focusPadding: 18,
                    },
                    {
                        title: 'All Done!',
                        body: 'Your rank isn\'t just about one lucky game — it\'s about real skill over time. Keep playing and watch yourself climb!',
                        mode: 'continue',
                        target: '#lb-header',
                        hideArrow: true,
                    },
                ],
            },
        };
    }

    _enterGuidedTourStep(index) {
        if (!this._guidedTour.active || !this._guidedTour.tour) return;
        if (index >= this._guidedTour.tour.steps.length) {
            this._stopGuidedTour(true);
            return;
        }
        if (index < 0) {
            index = 0;
        }
        this._cleanupGuidedTourStep();
        this._guidedTour.stepIndex = index;
        const step = this._guidedTour.tour.steps[index];
        
        // Intro mode: show full screen first, no overlay, no card
        if (step.mode === 'intro') {
            this.els.guidedTourCard.classList.add('hidden');
            this.els.guidedTourCard.classList.remove('visible');
            this.els.guidedTourDim.style.opacity = '0';
            this.els.guidedTourFocus.style.opacity = '0';
            this.els.guidedTourFocus.style.width = '0px';
            this.els.guidedTourFocus.style.height = '0px';
            this.els.guidedTourArrow.style.opacity = '0';
            this.els.guidedTourPointer.classList.remove('active');
            // On next tap/click anywhere, show the explanation
            const introHandler = () => {
                document.removeEventListener('click', introHandler, true);
                this._showGuidedTourCard(step);
            };
            document.addEventListener('click', introHandler, true);
            return;
        }
        
        this._showGuidedTourCard(step);
    }

    _showGuidedTourCard(step) {
        if (Array.isArray(step.onEnter)) this._runGuidedTourCommands(step.onEnter);

        // Hide card first for transition
        this.els.guidedTourCard.classList.remove('visible');
        this.els.guidedTourCard.classList.remove('hidden');

        this.els.guidedTourTitle.textContent = step.title || this._guidedTour.tour.label;
        this.els.guidedTourBody.textContent = step.body || '';
        this.els.guidedTourCounter.textContent = `${this._guidedTour.stepIndex + 1} / ${this._guidedTour.tour.steps.length}`;
        this.els.guidedTourContinueBtn.textContent = step.continueLabel || 'Tap to Continue';
        this.els.guidedTourContinueBtn.classList.toggle('hidden', step.mode === 'tap-target');
        this.els.guidedTourBackBtn.classList.toggle('hidden', this._guidedTour.stepIndex === 0);
        this.els.guidedTourHint.textContent = step.mode === 'tap-target'
            ? 'Tap the highlighted area to continue.'
            : 'Tap to Continue when you are ready.';

        // Position everything, then reveal card with transition
        requestAnimationFrame(() => {
            this._positionGuidedTourStep();
            // Trigger the card entrance after positioning
            requestAnimationFrame(() => {
                this.els.guidedTourCard.classList.add('visible');
            });
        });
    }

    _resolveGuidedTourTarget(step) {
        if (!step || !step.target) return null;
        const padding = step.focusPadding ?? 6;
        if (typeof step.target === 'string') {
            const el = document.querySelector(step.target);
            if (!el) return null;
            return {
                type: 'selector',
                element: el,
                rect: el.getBoundingClientRect(),
                radius: getComputedStyle(el).borderRadius || '18px',
                padding,
            };
        }
        if (step.target.type === 'hotspot') {
            const container = document.querySelector(step.target.container);
            if (!container) return null;
            const rect = container.getBoundingClientRect();
            return {
                type: 'hotspot',
                rect: {
                    left: rect.left + rect.width * step.target.x,
                    top: rect.top + rect.height * step.target.y,
                    width: rect.width * step.target.width,
                    height: rect.height * step.target.height,
                    right: rect.left + rect.width * (step.target.x + step.target.width),
                    bottom: rect.top + rect.height * (step.target.y + step.target.height),
                },
                radius: step.target.radius || '18px',
                padding,
            };
        }
        return null;
    }

    _positionGuidedTourStep() {
        if (!this._guidedTour.active || !this._guidedTour.tour) return;
        const step = this._guidedTour.tour.steps[this._guidedTour.stepIndex];
        const target = this._resolveGuidedTourTarget(step);

        // "noOverlay" mode: no dimming or spotlight at all — screen is fully visible
        if (step.noOverlay) {
            this.els.guidedTourDim.style.opacity = '0';
            this.els.guidedTourFocus.style.opacity = '0';
            this.els.guidedTourFocus.style.width = '0px';
            this.els.guidedTourFocus.style.height = '0px';
            this.els.guidedTourArrow.style.opacity = '0';
            this.els.guidedTourPointer.classList.remove('active');
            this.els.guidedTourHotspot.classList.add('hidden');
            if (target && step.mode === 'tap-target') {
                // Still set up tap handler even without overlay
                if (target.type === 'hotspot') {
                    this.els.guidedTourHotspot.classList.remove('hidden');
                    const rect = target.rect;
                    this.els.guidedTourHotspot.style.left = `${rect.left}px`;
                    this.els.guidedTourHotspot.style.top = `${rect.top}px`;
                    this.els.guidedTourHotspot.style.width = `${rect.width}px`;
                    this.els.guidedTourHotspot.style.height = `${rect.height}px`;
                    this.els.guidedTourHotspot.style.borderRadius = target.radius;
                    const handler = (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        this._advanceGuidedTour('target');
                    };
                    this.els.guidedTourHotspot.addEventListener('click', handler, true);
                    this._guidedTour.cleanupHotspotHandler = () => this.els.guidedTourHotspot.removeEventListener('click', handler, true);
                } else if (target.type === 'selector' && target.element) {
                    target.element.classList.add('guided-tour-focus-target');
                    this._guidedTour.activeTargetEl = target.element;
                    const handler = (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        this._advanceGuidedTour('target');
                    };
                    target.element.addEventListener('click', handler, true);
                    this._guidedTour.cleanupTargetHandler = () => target.element.removeEventListener('click', handler, true);
                }
                this._positionGuidedTourPointer(target.rect, step);
            }
            this._positionGuidedTourCard(target ? target.rect : null);
            return;
        }

        if (!target) {
            // No target: use dim overlay (full-screen darkness), hide spotlight
            this.els.guidedTourDim.style.opacity = '1';
            this.els.guidedTourFocus.style.opacity = '0';
            this.els.guidedTourFocus.style.width = '0px';
            this.els.guidedTourFocus.style.height = '0px';
            this.els.guidedTourArrow.style.opacity = '0';
            this.els.guidedTourPointer.classList.remove('active');
            this.els.guidedTourHotspot.classList.add('hidden');
            this._positionGuidedTourCard(null);
            return;
        }

        // Has target: use spotlight focus (box-shadow provides darkness), hide dim
        this.els.guidedTourDim.style.opacity = '0';
        this.els.guidedTourFocus.style.opacity = '1';

        const rect = target.rect;
        const pad = target.padding ?? 6;
        this.els.guidedTourFocus.style.left = `${rect.left - pad}px`;
        this.els.guidedTourFocus.style.top = `${rect.top - pad}px`;
        this.els.guidedTourFocus.style.width = `${rect.width + pad * 2}px`;
        this.els.guidedTourFocus.style.height = `${rect.height + pad * 2}px`;
        this.els.guidedTourFocus.style.borderRadius = target.radius;

        if (target.type === 'selector' && target.element) {
            target.element.classList.add('guided-tour-focus-target');
            this._guidedTour.activeTargetEl = target.element;
            if (step.mode === 'tap-target') {
                const handler = (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    this._advanceGuidedTour('target');
                };
                target.element.addEventListener('click', handler, true);
                this._guidedTour.cleanupTargetHandler = () => target.element.removeEventListener('click', handler, true);
            }
            this.els.guidedTourHotspot.classList.add('hidden');
        } else if (target.type === 'hotspot') {
            this.els.guidedTourHotspot.classList.remove('hidden');
            this.els.guidedTourHotspot.style.left = `${rect.left}px`;
            this.els.guidedTourHotspot.style.top = `${rect.top}px`;
            this.els.guidedTourHotspot.style.width = `${rect.width}px`;
            this.els.guidedTourHotspot.style.height = `${rect.height}px`;
            this.els.guidedTourHotspot.style.borderRadius = target.radius;
            if (step.mode === 'tap-target') {
                const handler = (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    this._advanceGuidedTour('target');
                };
                this.els.guidedTourHotspot.addEventListener('click', handler, true);
                this._guidedTour.cleanupHotspotHandler = () => this.els.guidedTourHotspot.removeEventListener('click', handler, true);
            }
        }

        this._positionGuidedTourCard(rect);
        this._positionGuidedTourArrow(rect, step);
        this._positionGuidedTourPointer(rect, step);
    }

    _positionGuidedTourArrow(targetRect, step) {
        const arrow = this.els.guidedTourArrow;
        const card = this.els.guidedTourCard;
        if (!targetRect || !card) {
            arrow.style.opacity = '0';
            return;
        }

        const cardRect = card.getBoundingClientRect();
        const startX = cardRect.left + cardRect.width / 2;
        const startY = cardRect.top + cardRect.height / 2;
        const endX = targetRect.left + targetRect.width / 2;
        const endY = targetRect.top + targetRect.height / 2;
        const dx = endX - startX;
        const dy = endY - startY;
        const len = Math.max(24, Math.sqrt(dx * dx + dy * dy) - 18);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;

        if (step.hideArrow) {
            arrow.style.opacity = '0';
            return;
        }

        arrow.style.left = `${startX}px`;
        arrow.style.top = `${startY}px`;
        arrow.style.width = `${len}px`;
        arrow.style.transform = `rotate(${angle}deg)`;
        arrow.style.opacity = '1';
    }

    _positionGuidedTourPointer(targetRect, step) {
        const pointer = this.els.guidedTourPointer;
        const shouldShow = step.showPointer ?? (step.mode === 'tap-target');
        if (!targetRect || !shouldShow) {
            pointer.classList.remove('active');
            return;
        }
        const x = targetRect.left + targetRect.width * (step.pointerX ?? 0.78);
        const y = targetRect.top + targetRect.height * (step.pointerY ?? 0.72);
        pointer.style.left = `${x}px`;
        pointer.style.top = `${y}px`;
        pointer.classList.add('active');
    }

    _positionGuidedTourCard(targetRect) {
        const card = this.els.guidedTourCard;
        const margin = 24;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let left = (vw - card.offsetWidth) / 2;
        let top = vh - card.offsetHeight - margin;

        if (targetRect) {
            left = Math.min(Math.max(targetRect.left + targetRect.width / 2 - card.offsetWidth / 2, margin), vw - card.offsetWidth - margin);
            const spaceBelow = vh - targetRect.bottom;
            const preferredBelow = targetRect.bottom + margin * 1.5;
            const preferredAbove = targetRect.top - card.offsetHeight - margin * 1.5;
            top = spaceBelow > card.offsetHeight + 40 ? preferredBelow : Math.max(margin, preferredAbove);
        }

        card.style.left = `${left}px`;
        card.style.top = `${Math.max(margin, Math.min(top, vh - card.offsetHeight - margin))}px`;
    }

    _advanceGuidedTour(triggerSource) {
        if (!this._guidedTour.active || !this._guidedTour.tour) return;
        const step = this._guidedTour.tour.steps[this._guidedTour.stepIndex];
        if (triggerSource === 'continue' && step.mode === 'tap-target') return;
        if (triggerSource === 'target' && step.mode !== 'tap-target') return;
        if (Array.isArray(step.onAdvance)) this._runGuidedTourCommands(step.onAdvance);
        this._enterGuidedTourStep(this._guidedTour.stepIndex + 1);
    }

    _backGuidedTour() {
        if (!this._guidedTour.active || !this._guidedTour.tour) return;
        if (this._guidedTour.stepIndex > 0) {
            this._enterGuidedTourStep(this._guidedTour.stepIndex - 1);
        }
    }

    _cleanupGuidedTourStep() {
        if (this._guidedTour.cleanupTargetHandler) {
            this._guidedTour.cleanupTargetHandler();
            this._guidedTour.cleanupTargetHandler = null;
        }
        if (this._guidedTour.cleanupHotspotHandler) {
            this._guidedTour.cleanupHotspotHandler();
            this._guidedTour.cleanupHotspotHandler = null;
        }
        if (this._guidedTour.activeTargetEl) {
            this._guidedTour.activeTargetEl.classList.remove('guided-tour-focus-target');
            this._guidedTour.activeTargetEl = null;
        }
        this.els.guidedTourArrow.style.opacity = '0';
        this.els.guidedTourPointer.classList.remove('active');
        this.els.guidedTourHotspot.classList.add('hidden');
        // Fade out card between steps
        this.els.guidedTourCard.classList.remove('visible');
    }

    _stopGuidedTour(restoreUi) {
        if (!this._guidedTour.active && !this.els.guidedTourOverlay.classList.contains('active')) return;
        this._cleanupGuidedTourStep();
        this._teardownGuidedSceneState();
        // Reset all overlay states
        this.els.guidedTourDim.style.opacity = '0';
        this.els.guidedTourFocus.style.opacity = '0';
        this.els.guidedTourCard.classList.remove('visible');
        this.els.guidedTourCard.classList.add('hidden');
        this.els.guidedTourOverlay.classList.remove('active');
        if (this._guidedTour.resizeHandler) {
            window.removeEventListener('resize', this._guidedTour.resizeHandler);
        }

        if (restoreUi) {
            this._showScreen(this._guidedTour.restoreScreen || 'menu');
            if ((this._guidedTour.restoreScreen || 'menu') === 'menu') {
                this._goToMenuPage(this._guidedTour.restoreMenuPage || 1);
            }
            if (this._guidedTour.restoreTutorialOverlay) {
                this._tutorialMenuView = this._guidedTour.restoreTutorialMenuView || 'root';
                this._renderTutorialMenu();
                this.els.tutorialMenu.style.display = '';
                this.els.tutorialSlides.classList.add('hidden');
                this.els.tutorialOverlay.classList.add('active');
            }
        }

        this._guidedTour.active = false;
        this._guidedTour.tour = null;
        this._guidedTour.stepIndex = 0;
    }

    _runGuidedTourCommands(commands) {
        for (const command of commands) {
            if (!command || !command.type) continue;
            if (command.type === 'call' && typeof this[command.method] === 'function') {
                this[command.method](...(command.args || []));
            }
        }
    }

    _setupGuidedMenuPage(pageIndex = 1) {
        this._teardownGuidedSceneState();
        this._showScreen('menu');
        this._goToMenuPage(pageIndex);
    }

    _setupGuidedChallengeSelectScene() {
        this._teardownGuidedSceneState();
        this._showScreen('challenges');
    }

    _setupGuidedChallengeSetupScene(challengeType, config = {}) {
        this._teardownGuidedSceneState();
        this._openChallengeSetup(challengeType);
        if (challengeType === CHALLENGE_TYPES.WORD_CATEGORY && config.categoryKey) {
            const btn = this.els.challengeCategoryButtons?.querySelector(`.category-pick-btn[data-cat="${config.categoryKey}"]`);
            if (btn) btn.click();
        }
    }

    _setupGuidedShopScene() {
        this._teardownGuidedSceneState();
        this._showScreen('shop');
        this._renderShop();
    }

    _setupGuidedDictionaryScene() {
        this._teardownGuidedSceneState();
        this._showScreen('dict');
        if (!this._dictSortedWords.length) this._dictBuildWordList();
        this._dictApplyFilters();
    }

    _setupGuidedMusicScene() {
        this._teardownGuidedSceneState();
        this._showScreen('music');
        this._renderMusicScreen();
    }

    _setupGuidedLeaderboardScene() {
        this._teardownGuidedSceneState();
        this._showScreen('leaderboard');
        this.els.lbMyRank?.classList.remove('hidden');
        if (this.els.lbMyRankIcon) this.els.lbMyRankIcon.textContent = '⚔️';
        if (this.els.lbMyRankClass) this.els.lbMyRankClass.textContent = 'Medium Class';
        if (this.els.lbMyRankPos) this.els.lbMyRankPos.textContent = '#15';
        if (this.els.lbMyStats) this.els.lbMyStats.classList.remove('hidden');
    }

    _setupGuidedPlummetScene(config = {}) {
        this._teardownGuidedSceneState();
        this._showScreen('play');
        this.state = State.PAUSED;
        this.els.pauseOverlay.classList.remove('active');
        this.els.currentScore.textContent = String(config.score ?? 0);
        this.els.playCoins.textContent = String(config.coins ?? 0);
        this.els.playHighScore.textContent = String(config.highScore ?? 900);
        this.els.nextLetter.textContent = config.nextLetter || 'A';
        this.els.wordPopup.textContent = config.popupText || '';
        this.els.bonusBtn.classList.toggle('hidden', !config.bonusVisible);
        this.els.bonusBtn.textContent = 'Bonus!';
        this.els.radialMenu.classList.toggle('hidden', !config.radialVisible);
        this.els.freezeIndicator.classList.toggle('hidden', !config.freezeVisible);
        this.els.score2xIndicator.classList.toggle('hidden', !config.score2xVisible);
        this.els.targetWordDisplay.classList.toggle('hidden', !config.showTargetWord);
        this.els.targetWordText.textContent = config.targetWord || 'TREE';
        const targetLabel = this.els.targetWordDisplay?.querySelector('.target-label');
        if (targetLabel) targetLabel.textContent = config.targetLabel || 'TARGET:';
        this.els.timerScoreItem.classList.toggle('hidden', !config.showTimer);
        this.els.gameTimer.textContent = config.timerText || '0:45';
        if (this.els.levelText && config.levelText) this.els.levelText.textContent = config.levelText;
        if (this.els.xpText && config.xpText) this.els.xpText.textContent = config.xpText;
        if (this.els.playWordsFoundBtn && config.wordsButtonText) this.els.playWordsFoundBtn.textContent = config.wordsButtonText;

        // Show a simulated grid so the board isn't blank
        const boardState = config.board || this._getDefaultGuidedBoard(config);
        this._setupGuidedSimulatedGrid({ cols: 5, rows: 5, grid: boardState });
    }

    _getDefaultGuidedBoard(config) {
        // Return different pre-set boards depending on what the scene is showing
        const score = config.score ?? 0;
        if (config.showTargetWord && config.targetWord === 'TREE') {
            if (score >= 520) {
                // Progress made on TREE
                return [
                    [null, null, null, null, null],
                    [null, 'T',  'R',  'E',  null],
                    ['W',  'O',  'R',  'D',  null],
                    [null, 'P',  null, 'A',  null],
                    ['S',  'A',  'T',  null, null],
                ];
            }
            return [
                [null, null, null, null, null],
                [null, 'T',  'R',  null, null],
                ['W',  'O',  'R',  'D',  null],
                [null, 'P',  null, null, null],
                ['S',  'A',  'T',  null, null],
            ];
        }
        if (config.showTargetWord && config.targetWord === 'BARK') {
            return [
                [null, null, null, 'B',  null],
                [null, 'T',  'R',  'E',  'E'],
                ['W',  'O',  'R',  'D',  null],
                [null, 'P',  null, 'A',  null],
                ['S',  'A',  'T',  null, null],
            ];
        }
        if (config.showTimer) {
            // Speed round board
            if (score >= 810) {
                return [
                    [null, null, null, null, null],
                    ['F',  'A',  'S',  'T',  null],
                    [null, 'R',  'U',  'N',  null],
                    ['G',  'O',  null, 'E',  'W'],
                    ['S',  'P',  'E',  'D',  null],
                ];
            }
            return [
                [null, null, null, null, null],
                ['F',  'A',  'S',  'T',  null],
                [null, 'R',  'U',  'N',  null],
                ['G',  'O',  null, null, null],
                ['S',  'P',  'E',  'D',  null],
            ];
        }
        if (config.showTargetWord && config.targetLabel === 'CATEGORY:') {
            // Word category board
            if (score >= 630) {
                return [
                    [null, null, 'L',  null, null],
                    [null, 'O',  'A',  'K',  null],
                    ['R',  'O',  'S',  'E',  null],
                    ['F',  'E',  'R',  'N',  null],
                    [null, 'L',  null, null, null],
                ];
            }
            return [
                [null, null, null, null, null],
                [null, 'O',  'A',  'K',  null],
                ['R',  'O',  'S',  'E',  null],
                [null, 'E',  'R',  'N',  null],
                [null, 'L',  null, null, null],
            ];
        }
        if (config.freezeVisible || config.score2xVisible) {
            // Bonus tour board
            return [
                [null, 'B',  null, null, null],
                ['F',  'L',  'A',  'T',  null],
                [null, 'O',  'R',  'E',  null],
                ['G',  'C',  null, 'A',  'M'],
                ['S',  'K',  'I',  'P',  null],
            ];
        }
        // Default starter board
        if (score >= 340) {
            return [
                [null, null, null, null, null],
                [null, 'C',  'A',  'T',  null],
                [null, null, 'R',  null, null],
                ['W',  'O',  'R',  'D',  null],
                ['P',  'L',  'A',  'Y',  null],
            ];
        }
        if (score >= 120) {
            return [
                [null, null, null, null, null],
                [null, 'C',  'A',  'T',  null],
                [null, null, null, null, null],
                ['W',  'O',  'R',  'D',  null],
                ['P',  'L',  'A',  'Y',  null],
            ];
        }
        // Fresh board (score 0)
        return [
            [null, null, null, null, null],
            [null, null, null, null, null],
            [null, null, null, null, null],
            ['W',  'O',  'R',  'D',  null],
            ['P',  'L',  'A',  'Y',  null],
        ];
    }

    _setupGuidedWsScene(config = {}) {
        this._teardownGuidedSceneState();
        this._showScreen('ws');
        if (this.els.wsPauseOverlay) this.els.wsPauseOverlay.classList.remove('active');
        if (this.els.wsScore) this.els.wsScore.textContent = config.score || '0';
        if (this.els.wsTimer) this.els.wsTimer.textContent = config.timer || '5:00';
        if (this.els.wsWordsFoundCount) this.els.wsWordsFoundCount.textContent = config.words || 'Words Found: 0';
        if (this.els.wsLevelNum) this.els.wsLevelNum.textContent = config.level || '1';
        if (this.els.wsCoins) this.els.wsCoins.textContent = config.coins || '0';
        if (this.els.wsLevelText && config.levelText) this.els.wsLevelText.textContent = config.levelText;
    }

    _setupGuidedWrScene(config = {}) {
        this._teardownGuidedSceneState();
        this._showScreen('wr');
        if (this.els.wrPauseOverlay) this.els.wrPauseOverlay.classList.remove('active');
        if (this.els.wrScore) this.els.wrScore.textContent = config.score || '0';
        if (this.els.wrDistance) this.els.wrDistance.textContent = config.distance || '0m';
        if (this.els.wrCoins) this.els.wrCoins.textContent = config.coins || '0';
        if (this.els.wrWordBoxes && config.wordBoxesHtml !== undefined) this.els.wrWordBoxes.innerHTML = config.wordBoxesHtml;
    }

    _openGuidedPauseOverlay() {
        this.els.pauseOverlay.classList.add('active');
    }

    _openGuidedWsPauseOverlay() {
        if (this.els.wsPauseOverlay) this.els.wsPauseOverlay.classList.add('active');
    }

    _openGuidedWrPauseOverlay() {
        if (this.els.wrPauseOverlay) this.els.wrPauseOverlay.classList.add('active');
    }

    _setupGuidedSimulatedGrid(config = {}) {
        // Create a visual teaching grid overlaid on the canvas-wrapper
        // config.grid = 2D array of letters (null = empty cell), e.g.:
        //   [
        //     [null, null, null, null, null],
        //     [null, 'C',  'A',  'T',  null],
        //     [null, null, 'R',  null, null],
        //     ...
        //   ]
        // config.cols / config.rows override grid dimensions (default 5×5)
        const canvas = this.els.canvasWrapper;
        if (!canvas) return;

        // Remove any existing teaching grid
        let existing = document.getElementById('guided-teaching-grid');
        if (existing) existing.remove();

        const cols = config.cols || 5;
        const rows = config.rows || 5;
        const grid = config.grid || [];

        const gridEl = document.createElement('div');
        gridEl.id = 'guided-teaching-grid';
        gridEl.className = 'guided-teaching-grid';
        gridEl.style.setProperty('--gt-cols', cols);
        gridEl.style.setProperty('--gt-rows', rows);

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const letter = (grid[r] && grid[r][c]) || null;
                const cell = document.createElement('div');
                cell.className = letter ? 'gt-cell gt-filled' : 'gt-cell gt-empty';
                if (letter) cell.textContent = letter;
                gridEl.appendChild(cell);
            }
        }

        canvas.appendChild(gridEl);
        return gridEl;
    }

    _teardownGuidedSceneState() {
        // Clean up teaching grid if it exists
        const teachingGrid = document.getElementById('guided-teaching-grid');
        if (teachingGrid) teachingGrid.remove();

        this.els.pauseOverlay.classList.remove('active');
        if (this.els.wsPauseOverlay) this.els.wsPauseOverlay.classList.remove('active');
        if (this.els.wrPauseOverlay) this.els.wrPauseOverlay.classList.remove('active');
        this.els.wordPopup.textContent = '';
        this.els.bonusBtn.classList.add('hidden');
        this.els.radialMenu.classList.add('hidden');
        this.els.freezeIndicator.classList.add('hidden');
        this.els.score2xIndicator.classList.add('hidden');
        this.els.targetWordDisplay.classList.add('hidden');
        const targetLabel = this.els.targetWordDisplay?.querySelector('.target-label');
        if (targetLabel) targetLabel.textContent = 'TARGET:';
        this.els.timerScoreItem.classList.add('hidden');
        if (this.els.playWordsFoundBtn) this.els.playWordsFoundBtn.textContent = 'Words So Far';
        if (this.els.wrWordBoxes) this.els.wrWordBoxes.innerHTML = '';
    }

    _openTutorialCategory(catIndex, parentMenuView = 'root') {
        this._tutorialCatIndex = catIndex;
        this._tutorialIndex = 0;
        this._tutorialParentMenuView = parentMenuView;
        const cat = this._tutorialCategories[catIndex];
        this._tutorialSlides = cat.slides;
        this._tutorialTotal = cat.slides.length;

        // Build dots
        const dots = this.els.tutorialDots;
        dots.innerHTML = '';
        for (let i = 0; i < this._tutorialTotal; i++) {
            const dot = document.createElement('button');
            dot.className = 'tutorial-dot' + (i === 0 ? ' active' : '');
            dot.addEventListener('click', () => this._goToTutorialSlide(i));
            dots.appendChild(dot);
        }

        // Build all slide panels in the strip
        const strip = this.els.tutorialSlideStrip;
        strip.innerHTML = '';
        strip.style.transform = 'translateX(0)';
        this._tutorialCanvases = [];
        for (let i = 0; i < this._tutorialTotal; i++) {
            const slide = this._tutorialSlides[i];
            const panel = document.createElement('div');
            panel.className = 'tutorial-slide-panel';

            if (slide.img) {
                const img = document.createElement('img');
                img.src = slide.img;
                img.alt = slide.title;
                panel.appendChild(img);
                this._tutorialCanvases.push(null);
            } else {
                const canvas = document.createElement('canvas');
                canvas.width = 360;
                canvas.height = 360;
                panel.appendChild(canvas);
                this._tutorialCanvases.push(canvas);
            }

            const title = document.createElement('h3');
            title.textContent = slide.title;
            panel.appendChild(title);

            const desc = document.createElement('p');
            desc.textContent = slide.desc;
            panel.appendChild(desc);

            strip.appendChild(panel);
        }

        this.els.tutorialMenu.style.display = 'none';
        this.els.tutorialSlides.classList.remove('hidden');
        this._updateTutorialNav();
        this._startTutorialAnim();
        this._bindTutorialSwipe();
    }

    _tutorialBackToMenu() {
        this._stopTutorialAnim();
        this._unbindTutorialSwipe();
        this.els.tutorialSlides.classList.add('hidden');
        this._tutorialMenuView = this._tutorialParentMenuView || 'root';
        this._renderTutorialMenu();
        this.els.tutorialMenu.style.display = '';
    }

    _closeTutorial() {
        this._stopTutorialAnim();
        this._unbindTutorialSwipe();
        this._tutorialMenuView = 'root';
        this._tutorialParentMenuView = 'root';
        this.els.tutorialOverlay.classList.remove('active');

        // Return to pause menu if tutorial was opened from one
        if (this._tutorialReturnToPauseMenu === 'main') {
            this.els.pauseOverlay.classList.add('active');
        } else if (this._tutorialReturnToPauseMenu === 'ws') {
            if (this.els.wsPauseOverlay) this.els.wsPauseOverlay.classList.add('active');
        } else if (this._tutorialReturnToPauseMenu === 'wr') {
            this.els.wrPauseOverlay.classList.add('active');
        }
        this._tutorialReturnToPauseMenu = null;
    }

    _goToTutorialSlide(index) {
        this._tutorialIndex = Math.max(0, Math.min(index, this._tutorialTotal - 1));
        const strip = this.els.tutorialSlideStrip;
        strip.classList.remove('swiping');
        strip.style.transform = `translateX(-${this._tutorialIndex * 100}%)`;
        this._updateTutorialNav();
    }

    _updateTutorialNav() {
        this.els.tutorialCounter.textContent = `${this._tutorialIndex + 1} / ${this._tutorialTotal}`;
        const dots = this.els.tutorialDots.querySelectorAll('.tutorial-dot');
        dots.forEach((d, i) => d.classList.toggle('active', i === this._tutorialIndex));
        this.els.tutorialPrevBtn.disabled = this._tutorialIndex === 0;
        this.els.tutorialNextBtn.disabled = this._tutorialIndex === this._tutorialTotal - 1;
    }

    _startTutorialAnim() {
        this._stopTutorialAnim();
        this._tutorialAnimStart = performance.now();

        // Set up all canvases
        this._tutorialCanvasContexts = [];
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let i = 0; i < this._tutorialTotal; i++) {
            const canvas = this._tutorialCanvases[i];
            if (!canvas) { this._tutorialCanvasContexts.push(null); continue; }
            const ctx = canvas.getContext('2d');
            const rect = canvas.getBoundingClientRect();
            if (rect.width > 0) {
                canvas.width = rect.width * dpr;
                canvas.height = rect.height * dpr;
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                this._tutorialCanvasContexts.push({ ctx, w: rect.width, h: rect.height });
            } else {
                this._tutorialCanvasContexts.push(null);
            }
        }

        const tick = () => {
            if (!this._tutorialAnimId) return;
            const t = (performance.now() - this._tutorialAnimStart) / 1000;
            // Only draw the current slide's canvas (and neighbors for mid-swipe)
            for (let i = Math.max(0, this._tutorialIndex - 1); i <= Math.min(this._tutorialTotal - 1, this._tutorialIndex + 1); i++) {
                const info = this._tutorialCanvasContexts[i];
                const slide = this._tutorialSlides[i];
                if (info && slide && slide.draw) {
                    info.ctx.clearRect(0, 0, info.w, info.h);
                    slide.draw(info.ctx, info.w, info.h, t);
                }
            }
            this._tutorialAnimId = requestAnimationFrame(tick);
        };
        // Delay first frame slightly so canvas getBoundingClientRect has valid dimensions
        requestAnimationFrame(() => {
            // Re-measure any canvases that had 0 dimensions
            for (let i = 0; i < this._tutorialTotal; i++) {
                if (this._tutorialCanvasContexts[i]) continue;
                const canvas = this._tutorialCanvases[i];
                if (!canvas) continue;
                const ctx = canvas.getContext('2d');
                const rect = canvas.getBoundingClientRect();
                if (rect.width > 0) {
                    canvas.width = rect.width * dpr;
                    canvas.height = rect.height * dpr;
                    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                    this._tutorialCanvasContexts[i] = { ctx, w: rect.width, h: rect.height };
                }
            }
            this._tutorialAnimId = requestAnimationFrame(tick);
        });
    }

    _stopTutorialAnim() {
        if (this._tutorialAnimId) {
            cancelAnimationFrame(this._tutorialAnimId);
            this._tutorialAnimId = null;
        }
    }

    _bindTutorialSwipe() {
        const view = this.els.tutorialSlides;
        const strip = this.els.tutorialSlideStrip;
        let startX = 0, startY = 0, dragging = false, moved = false;

        this._tutorialPointerDown = (e) => {
            dragging = true; moved = false;
            startX = e.touches ? e.touches[0].clientX : e.clientX;
            startY = e.touches ? e.touches[0].clientY : e.clientY;
            strip.classList.add('swiping');
        };

        this._tutorialPointerMove = (e) => {
            if (!dragging) return;
            const x = e.touches ? e.touches[0].clientX : e.clientX;
            const y = e.touches ? e.touches[0].clientY : e.clientY;
            const dx = x - startX, dy = y - startY;
            if (!moved && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
                dragging = false;
                strip.classList.remove('swiping');
                strip.style.transform = `translateX(-${this._tutorialIndex * 100}%)`;
                return;
            }
            if (Math.abs(dx) > 10) moved = true;
            if (moved && e.cancelable) e.preventDefault();
            if (moved) {
                const viewW = this.els.tutorialSlideView.offsetWidth || 300;
                const baseOffset = -this._tutorialIndex * viewW;
                const atStart = this._tutorialIndex === 0 && dx > 0;
                const atEnd = this._tutorialIndex === this._tutorialTotal - 1 && dx < 0;
                const dampened = (atStart || atEnd) ? dx * 0.25 : dx;
                strip.style.transform = `translateX(${baseOffset + dampened}px)`;
            }
        };

        this._tutorialPointerUp = (e) => {
            if (!dragging) return;
            dragging = false;
            strip.classList.remove('swiping');
            const x = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
            const dx = x - startX;
            const viewW = this.els.tutorialSlideView.offsetWidth || 300;
            const threshold = viewW * 0.15;

            if (Math.abs(dx) > threshold) {
                if (dx < 0 && this._tutorialIndex < this._tutorialTotal - 1) {
                    this._tutorialIndex++;
                } else if (dx > 0 && this._tutorialIndex > 0) {
                    this._tutorialIndex--;
                }
            }
            strip.style.transform = `translateX(-${this._tutorialIndex * 100}%)`;
            this._updateTutorialNav();
        };

        view.addEventListener('touchstart', this._tutorialPointerDown, { passive: true });
        view.addEventListener('touchmove', this._tutorialPointerMove, { passive: false });
        view.addEventListener('touchend', this._tutorialPointerUp);
        view.addEventListener('mousedown', this._tutorialPointerDown);
        view.addEventListener('mousemove', this._tutorialPointerMove);
        view.addEventListener('mouseup', this._tutorialPointerUp);
        view.addEventListener('mouseleave', this._tutorialPointerUp);
    }

    _unbindTutorialSwipe() {
        const view = this.els.tutorialSlides;
        if (this._tutorialPointerDown) {
            view.removeEventListener('touchstart', this._tutorialPointerDown);
            view.removeEventListener('touchmove', this._tutorialPointerMove);
            view.removeEventListener('touchend', this._tutorialPointerUp);
            view.removeEventListener('mousedown', this._tutorialPointerDown);
            view.removeEventListener('mousemove', this._tutorialPointerMove);
            view.removeEventListener('mouseup', this._tutorialPointerUp);
            view.removeEventListener('mouseleave', this._tutorialPointerUp);
        }
    }

    _renderMusicScreen() {
        this._renderPlaylistTabs();
        this._renderTrackList();
        this._updateMusicUI();
        // Show/hide playlist actions for custom playlists only
        const isCustom = this.activePlaylistTab !== "__default" && this.activePlaylistTab !== "__favorites";
        this.els.playlistActions.classList.toggle("hidden", !isCustom);
    }

    _renderPlaylistTabs() {
        // Remove old custom tabs (keep __default, __favorites, and add-tab)
        this.els.playlistTabs.querySelectorAll(".playlist-tab:not(.add-tab)").forEach(el => {
            if (el.dataset.playlist !== "__default" && el.dataset.playlist !== "__favorites") el.remove();
        });
        // Update default tab active state
        const defaultTab = this.els.playlistTabs.querySelector('[data-playlist="__default"]');
        if (defaultTab) defaultTab.classList.toggle("active", this.activePlaylistTab === "__default");

        // Update favorites tab active state
        const favTab = this.els.playlistTabs.querySelector('[data-playlist="__favorites"]');
        if (favTab) {
            favTab.classList.toggle("active", this.activePlaylistTab === "__favorites");
            favTab.onclick = () => {
                this.activePlaylistTab = "__favorites";
                this._renderMusicScreen();
            };
        }

        // Add custom playlist tabs before the "+ New" button
        for (const pl of this.plMgr.getCustomPlaylists()) {
            const tab = document.createElement("button");
            tab.className = "playlist-tab" + (this.activePlaylistTab === pl.name ? " active" : "");
            tab.dataset.playlist = pl.name;
            tab.textContent = pl.name;
            tab.addEventListener("click", () => {
                this.activePlaylistTab = pl.name;
                this._renderMusicScreen();
            });
            this.els.playlistTabs.insertBefore(tab, this.els.newPlaylistTab);
        }

        // Default tab click
        if (defaultTab) {
            defaultTab.onclick = () => {
                this.activePlaylistTab = "__default";
                this._renderMusicScreen();
            };
        }
    }

    _renderTrackList() {
        const container = this.els.trackList;
        container.innerHTML = "";
        const isCustom = this.activePlaylistTab !== "__default" && this.activePlaylistTab !== "__favorites";
        let tracks = this.plMgr.getPlaylistTracks(this.activePlaylistTab);

        // Search filtering
        const searchTerm = (this.els.musicSearch.value || "").trim().toLowerCase();
        if (searchTerm) {
            tracks = tracks.filter(t =>
                t.title.toLowerCase().includes(searchTerm) ||
                t.artist.toLowerCase().includes(searchTerm)
            );
        }

        if (tracks.length === 0) {
            const msg = searchTerm ? "No matching tracks." : "No tracks in this playlist.";
            container.innerHTML = `<p style="color:#666;text-align:center;padding:20px;">${msg}</p>`;
            return;
        }

        tracks.forEach((track, index) => {
            const item = document.createElement("div");
            const isCurrentTrack = track.id === this.music.currentTrackId;
            const isPlaying = isCurrentTrack && this.music.playing;
            item.className = "track-item" + (isCurrentTrack ? " playing" : "") + (isCurrentTrack && !this.music.playing ? " paused" : "");
            item.dataset.trackId = track.id;

            const isFav = this.plMgr.isFavorite(track.id);

            const eid = this._escapeHtml(track.id);
            const etitle = this._escapeHtml(track.title);
            const eartist = this._escapeHtml(track.artist);
            item.innerHTML = `
                <button class="track-play-btn">
                    ${isPlaying ? "⏸" : "▶"}
                    <span class="track-eq-bars"><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span></span>
                </button>
                <div class="track-info">
                    <div class="track-name">${etitle}</div>
                    <div class="track-artist">${eartist}</div>
                </div>
                <span class="track-duration" data-track-id="${eid}"></span>
                <button class="track-fav-btn${isFav ? " active" : ""}" title="Favorite" aria-label="Toggle Favorite">${isFav ? "♦" : "◇"}</button>
                ${!searchTerm ? '<span class="track-drag-handle" title="Drag to reorder">☰</span>' : ""}
                ${isCustom && !searchTerm ? '<button class="track-remove-btn" title="Remove from playlist">✕</button>' : ""}
            `;

            // Play button
            item.querySelector(".track-play-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                if (track.id === this.music.currentTrackId && this.music.playing) {
                    this.music.pause();
                } else {
                    this.music.setActivePlaylist(this.activePlaylistTab);
                    this.music.playTrackById(track.id);
                }
            });

            // Favorite button
            item.querySelector(".track-fav-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                const nowFav = this.plMgr.toggleFavorite(track.id);
                const btn = e.currentTarget;
                btn.classList.toggle("active", nowFav);
                btn.textContent = nowFav ? "♦" : "◇";
                // If on favorites tab and un-favorited, re-render
                if (this.activePlaylistTab === "__favorites" && !nowFav) {
                    this._renderTrackList();
                }
            });

            // Drag handle for reorder (only when not searching)
            if (!searchTerm) {
                const handle = item.querySelector(".track-drag-handle");
                if (handle) {
                    handle.addEventListener("pointerdown", (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this._startTrackDrag(e, item, index, container);
                    });
                }
            }

            // Remove from custom playlist
            const removeBtn = item.querySelector(".track-remove-btn");
            if (removeBtn) {
                removeBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.plMgr.removeTrackFromPlaylist(this.activePlaylistTab, track.id);
                    this.music.refreshQueue();
                    this._renderTrackList();
                });
            }

            // Click row to play
            item.addEventListener("click", () => {
                this.music.setActivePlaylist(this.activePlaylistTab);
                this.music.playTrackById(track.id);
            });

            container.appendChild(item);

            // Load duration for display
            this._loadTrackDuration(track, item.querySelector(".track-duration"));
        });
    }

    _startTrackDrag(e, dragItem, fromIndex, container) {
        const items = [...container.querySelectorAll(".track-item")];
        if (items.length <= 1) return;

        const rect = dragItem.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;

        // Create placeholder
        const placeholder = document.createElement("div");
        placeholder.className = "track-drag-placeholder";
        placeholder.style.height = rect.height + "px";

        // Style dragged item as floating
        dragItem.classList.add("dragging");
        dragItem.style.width = rect.width + "px";
        dragItem.style.position = "fixed";
        dragItem.style.left = rect.left + "px";
        dragItem.style.top = rect.top + "px";
        dragItem.style.zIndex = "9999";
        dragItem.style.pointerEvents = "none";

        // Insert placeholder where dragged item was
        dragItem.parentNode.insertBefore(placeholder, dragItem);

        let currentIndex = fromIndex;

        const onMove = (ev) => {
            const y = (ev.touches ? ev.touches[0].clientY : ev.clientY);
            dragItem.style.top = (y - offsetY) + "px";

            // Auto-scroll the container
            const scrollMargin = 40;
            const relY = y - containerRect.top;
            if (relY < scrollMargin) {
                container.scrollTop -= 8;
            } else if (relY > containerRect.height - scrollMargin) {
                container.scrollTop += 8;
            }

            // Find which item we're hovering over
            const siblings = [...container.querySelectorAll(".track-item:not(.dragging)")];
            for (let i = 0; i < siblings.length; i++) {
                const sib = siblings[i];
                const sibRect = sib.getBoundingClientRect();
                const sibMid = sibRect.top + sibRect.height / 2;
                if (y < sibMid) {
                    if (sib !== placeholder.nextElementSibling) {
                        container.insertBefore(placeholder, sib);
                    }
                    return;
                }
            }
            // Past all items — move placeholder to end
            const lastSib = siblings[siblings.length - 1];
            if (lastSib && placeholder.nextElementSibling !== dragItem) {
                container.insertBefore(placeholder, lastSib.nextSibling);
            }
        };

        const onEnd = () => {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onEnd);
            document.removeEventListener("pointercancel", onEnd);

            // Determine new index from placeholder position
            const allChildren = [...container.children].filter(
                el => el.classList.contains("track-item") || el.classList.contains("track-drag-placeholder")
            );
            let toIndex = allChildren.indexOf(placeholder);
            // Adjust: items after the dragged one shift up
            if (toIndex > fromIndex) toIndex--;
            if (toIndex < 0) toIndex = fromIndex;

            // Reset styles
            dragItem.classList.remove("dragging");
            dragItem.style.position = "";
            dragItem.style.left = "";
            dragItem.style.top = "";
            dragItem.style.width = "";
            dragItem.style.zIndex = "";
            dragItem.style.pointerEvents = "";

            // Remove placeholder
            if (placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);

            // Apply the move if changed
            if (toIndex !== fromIndex) {
                this.plMgr.moveTrack(this.activePlaylistTab, fromIndex, toIndex);
                this.music.refreshQueue();
            }
            this._renderTrackList();
        };

        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onEnd);
        document.addEventListener("pointercancel", onEnd);
    }

    _loadTrackDuration(track, el) {
        if (!el) return;
        // Cache durations
        if (!this._trackDurations) this._trackDurations = {};
        if (this._trackDurations[track.id]) {
            el.textContent = this._trackDurations[track.id];
            return;
        }
        const audio = new Audio();
        audio.preload = "metadata";
        audio.src = track.file;
        audio.addEventListener("loadedmetadata", () => {
            const dur = this._formatTrackTime(audio.duration);
            this._trackDurations[track.id] = dur;
            el.textContent = dur;
            audio.src = "";
        }, { once: true });
    }

    _openPlaylistModal(editName) {
        this._editingPlaylist = editName;
        this.els.playlistModalTitle.textContent = editName ? `Edit: ${editName}` : "New Playlist";
        this.els.playlistNameInput.value = editName || "";

        const existing = editName ? new Set(this.plMgr.getPlaylistTrackIds(editName)) : new Set();
        const picker = this.els.playlistTrackPicker;
        picker.innerHTML = "";

        for (const track of this.plMgr.allTracks) {
            const div = document.createElement("div");
            div.className = "picker-item";
            const eid = this._escapeHtml(track.id);
            const etitle = this._escapeHtml(track.title);
            const eartist = this._escapeHtml(track.artist);
            div.innerHTML = `
                <input type="checkbox" value="${eid}" ${existing.has(track.id) ? "checked" : ""}>
                <div>
                    <div class="picker-track-name">${etitle}</div>
                    <div class="picker-track-artist">${eartist}</div>
                </div>
            `;
            div.addEventListener("click", (e) => {
                if (e.target.tagName !== "INPUT") {
                    const cb = div.querySelector("input");
                    cb.checked = !cb.checked;
                }
            });
            picker.appendChild(div);
        }

        this.els.playlistModal.classList.add("active");
        this.els.playlistNameInput.focus();
    }

    _savePlaylistModal() {
        const name = this.els.playlistNameInput.value.trim();
        if (!name) { this.els.playlistNameInput.focus(); return; }

        const checked = [...this.els.playlistTrackPicker.querySelectorAll("input:checked")];
        const trackIds = checked.map(cb => cb.value);

        if (this._editingPlaylist) {
            // Rename if name changed
            if (this._editingPlaylist !== name) {
                this.plMgr.renamePlaylist(this._editingPlaylist, name);
            }
            // Update tracks: delete and recreate
            this.plMgr.deletePlaylist(name);
            this.plMgr.createPlaylist(name, trackIds);
        } else {
            if (!this.plMgr.createPlaylist(name, trackIds)) {
                alert("A playlist with that name already exists.");
                return;
            }
        }

        this.els.playlistModal.classList.remove("active");
        this.activePlaylistTab = name;
        this.music.refreshQueue();
        this._renderMusicScreen();
    }

    // ── Target Word: tap-to-claim ──

    // Verify that the letters at the given cells still exist on the grid
    // AND that those letters match the word (accounting for wildcards).
    _verifyGroupOnGrid(group) {
        const letters = [];
        for (const key of group.cells) {
            const [r, c] = key.split(",").map(Number);
            const ch = this.grid.get(r, c);
            if (!ch || !isWordLetter(ch)) return false;
            letters.push(ch);
        }
        // If any cell is a wildcard, do per-position check instead of sorted multiset
        if (letters.includes(WILDCARD_SYMBOL)) {
            if (letters.length !== group.word.length) return false;
            for (let i = 0; i < letters.length; i++) {
                if (letters[i] === WILDCARD_SYMBOL) continue; // wildcard matches any letter
                if (letters[i] !== group.word[i]) return false;
            }
            return true;
        }
        return letters.sort().join("") === group.word.split("").sort().join("");
    }

    // Remove any validated groups whose cells no longer contain letters.
    _pruneInvalidGroups() {
        const before = this._validatedWordGroups.length;
        this._validatedWordGroups = this._validatedWordGroups.filter(g => this._verifyGroupOnGrid(g));
        if (this._validatedWordGroups.length < before) {
            console.log(`[WORD-VAL] Pruned ${before - this._validatedWordGroups.length} stale groups`);
            this._rebuildValidatedCells();
        }
    }

    _addValidatedWords(result, words) {
        // Use per-word cell mapping from the detection result.
        // Process longest words first so shorter subsets are always caught.
        const newWordSet = new Set(words);
        const incoming = result.wordCellMap
            .filter(wc => newWordSet.has(wc.word))
            .sort((a, b) => b.word.length - a.word.length);

        for (const wc of incoming) {
            const newCells = new Set(wc.cells);

            // ── Grid verification: read the actual letters at these cells ──
            const cellArr = [...newCells].map(k => {
                const [r, c] = k.split(",").map(Number);
                return { r, c, letter: this.grid.get(r, c) };
            });
            const actualLetters = cellArr.map(c => c.letter || "?").join("");
            // Log every candidate for diagnostics
            console.log(`[WORD-VAL] Candidate "${wc.word}" cells=[${[...newCells].join(";")}] actual="${actualLetters}" reverse=${!!wc.isReverse}`);

            // Reject if any cell is empty (stale reference)
            if (cellArr.some(c => !isWordLetter(c.letter))) {
                console.warn(`[WORD-VAL] REJECTED "${wc.word}" — cell(s) empty on grid`);
                continue;
            }

            // Reject if the actual letters don't match the word (accounting for wildcards)
            const actualLetters2 = cellArr.map(c => c.letter);
            const expectedLetters = wc.word.split("");
            if (actualLetters2.length !== expectedLetters.length) {
                console.warn(`[WORD-VAL] REJECTED "${wc.word}" — length mismatch`);
                continue;
            }
            let letterMismatch = false;
            for (let i = 0; i < actualLetters2.length; i++) {
                if (actualLetters2[i] === WILDCARD_SYMBOL) continue; // wildcard matches anything
                if (actualLetters2[i] !== expectedLetters[i]) { letterMismatch = true; break; }
            }
            if (letterMismatch) {
                console.warn(`[WORD-VAL] REJECTED "${wc.word}" — letters mismatch: grid="${actualLetters2.join("")}" expected="${expectedLetters.join("")}"`);
                continue;
            }

            // Skip if these exact cells + word are already validated
            const alreadyValidated = this._validatedWordGroups.some(g => {
                if (g.word !== wc.word) return false;
                if (g.cells.size !== newCells.size) return false;
                for (const k of g.cells) if (!newCells.has(k)) return false;
                return true;
            });
            if (alreadyValidated) continue;

            // If a longer (or equal-length) existing word already covers all these cells, skip
            // But allow reverse-direction bonus words on the same cells
            const coveredByLonger = !wc.isReverse && this._validatedWordGroups.some(g =>
                g.word.length >= wc.word.length && [...newCells].every(k => g.cells.has(k))
            );
            if (coveredByLonger) continue;

            // Remove any existing shorter words whose cells are entirely within this new longer word
            // But don't remove reverse bonus words
            this._validatedWordGroups = this._validatedWordGroups.filter(g => {
                if (g.isReverse || wc.isReverse) return true;
                if (g.word.length >= wc.word.length) return true;
                return ![...g.cells].every(k => newCells.has(k));
            });

            let pts = wc.word.length * 10 * wc.word.length;

            // Word complexity bonus: longer words get progressively more
            // 3-letter base, 4→+15%, 5→+35%, 6→+60%, 7→+90%, 8+→+125%
            const len = wc.word.length;
            if (len >= 4) {
                const complexityMult = 1 + 0.15 * Math.pow(len - 3, 1.4);
                pts = Math.floor(pts * complexityMult);
            }

            // Tough letter bonus: sum letter difficulty values for all letters
            // Only letters worth >1 contribute bonus (common letters don't add extra)
            let letterBonus = 0;
            for (const ch of wc.word) {
                const val = LETTER_VALUES[ch] || 1;
                if (val > 1) letterBonus += val * 3;
            }
            pts += letterBonus;

            // Reverse-direction bonus word gets half points
            if (wc.isReverse) {
                pts = Math.floor(pts / 2);
            }

            // In Target Word / Category challenges, reduce base pts for non-matching words
            const isBonusChallenge = this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD
                || this.activeChallenge === CHALLENGE_TYPES.WORD_CATEGORY;
            if (isBonusChallenge) {
                const isMatch = this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD
                    ? (this.targetWord && (wc.word === this.targetWord || wc.word.includes(this.targetWord)))
                    : (this.activeCategorySet && this.activeCategorySet.has(wc.word));
                if (isMatch) {
                    // Bonus match: 2× base, scaled by category tier
                    const tier = CATEGORY_TIERS[this.activeCategoryKey];
                    const tierMult = tier ? tier.ptsMult : 1.0;
                    pts = Math.floor(pts * 2 * tierMult);
                } else {
                    pts = Math.floor(pts * 0.25);
                }
            }

            // Sandbox mode penalty
            if (this.gameMode === GAME_MODES.SANDBOX) pts = Math.floor(pts * SANDBOX_SCORE_MULT);

            console.log(`[WORD-VAL] ADDED "${wc.word}" cells=[${[...newCells].join(";")}] pts=${pts} reverse=${!!wc.isReverse}`);
            this._validatedWordGroups.push({ word: wc.word, cells: newCells, pts, isReverse: !!wc.isReverse });
        }
        this._rebuildValidatedCells();
    }

    _rebuildValidatedCells() {
        const allCells = new Set();
        for (const group of this._validatedWordGroups) {
            for (const key of group.cells) allCells.add(key);
        }
        this.renderer.validatedCells = allCells;
    }

    _handleCanvasTap(clientX, clientY) {
        if (this._validatedWordGroups.length === 0) return;
        if (this.state !== State.PLAYING) return;
        if (this.rowDragActive) return;

        // Convert client coordinates to canvas-relative coordinates
        const rect = this.renderer.canvas.getBoundingClientRect();
        const scaleX = this.renderer.canvas.width / (window.devicePixelRatio || 1) / rect.width;
        const scaleY = this.renderer.canvas.height / (window.devicePixelRatio || 1) / rect.height;
        const px = (clientX - rect.left) * scaleX;
        const py = (clientY - rect.top) * scaleY;

        const { row, col } = this.renderer.pixelToCell(px, py);
        if (row < 0 || row >= this.gridSize || col < 0 || col >= this.gridSize) return;

        const key = `${row},${col}`;
        if (!this.renderer.validatedCells.has(key)) return;

        // Found a green cell tap — claim all word groups containing this cell
        this._claimValidatedAt(key);
    }

    _claimValidatedAt(tappedKey) {
        // If a clear animation is in progress, force-finish it immediately
        if (this.clearing && this._pendingClearCells) {
            this.grid.removeCells(this._pendingClearCells);
            this.grid.applyGravity();
            this.renderer.flashCells.clear();
            this.renderer.flashTimer = 0;
            this.renderer.blastCells.clear();
            this.renderer.blastCenterKey = null;
            this.renderer.blastProgress = 0;
            this.renderer.gravityAnims = [];
            this.pendingGravityMoves = [];
            this.clearing = false;
            this._claimAnimating = false;
            this._pendingClearCells = null;
        }

        // Find all validated word groups that include the tapped cell
        const toClaim = [];
        const remaining = [];
        for (const group of this._validatedWordGroups) {
            if (group.cells.has(tappedKey)) {
                toClaim.push(group);
            } else {
                remaining.push(group);
            }
        }
        if (toClaim.length === 0) return;

        // Diagnostic: log what we're about to claim
        console.log(`[CLAIM] Tapped "${tappedKey}" — claiming ${toClaim.length} groups:`,
            toClaim.map(g => `"${g.word}" cells=[${[...g.cells].join(";")}] pts=${g.pts}`));
        if (toClaim.length > 1) {
            console.warn(`[CLAIM] MULTI-CLAIM: ${toClaim.length} groups share cell "${tappedKey}":`,
                toClaim.map(g => g.word));
        }

        // Score claimed words
        const prevScore = this.score;
        const claimedWords = [];
        for (const group of toClaim) {
            let pts = group.pts;
            let wasMultiplied = false;
            if (this.scoreMultiplier > 1) {
                console.log(`[2X] Applying ${this.scoreMultiplier}× to "${group.word}": ${pts} → ${pts * this.scoreMultiplier}`);
                pts *= this.scoreMultiplier;
                wasMultiplied = true;
                this.scoreMultiplier = 1;
                this.els.score2xIndicator.classList.add("hidden");
            }
            this.score += pts;
            this.totalWordsInChain++;
            const isBonus = this._isChallengeBonusWord(group.word);
            this.wordsFound.push({ word: group.word, pts, bonus: isBonus });
            claimedWords.push({ word: group.word, pts, multiplied: wasMultiplied });
            if (!this._chainWords) this._chainWords = [];
            this._chainWords.push({ word: group.word, pts });

            // ── Earn coins per word ──
            const wordCoins = coinsForWord(group.word.length) + (this.comboCount >= 2 ? Math.min(this.comboCount, 10) * COIN_COMBO_BONUS : 0);
            this._coinsThisGame = (this._coinsThisGame || 0) + wordCoins;

            // 🥚 Easter egg: spelling the game's own name gives a secret jackpot
            if (group.word === 'PLUMMET') {
                this.score += 10000;
                this._coinsThisGame += 1000;
                this._showEasterEggBanner();
            }

            // Check for target word match (exact or contains as substring)
            if (this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD
                && this.targetWord
                && (group.word === this.targetWord || group.word.includes(this.targetWord))) {
                this.targetWordsCompleted++;
                this.score += 200;
                // Advance level and pick next word from the new level's pool
                this._targetWordLevel = this.profileMgr.advanceTargetWordLevel();
                this._pickTargetWord();
                // Immediately persist challenge progress so fast refresh/end-game cannot roll back levels.
                this._syncChallengeStatsToCloud(CHALLENGE_TYPES.TARGET_WORD);
            }

            // Track category word matches
            if (this.activeChallenge === CHALLENGE_TYPES.WORD_CATEGORY && isBonus) {
                if (!this.categoryWordsFound) this.categoryWordsFound = [];
                this.categoryWordsFound.push(group.word);
            }
        }
        this._checkBonusUnlock(prevScore, this.score);
        this._updateScoreDisplay();
        this._updateSpeedRound();
        this._showChainBanner(this.totalWordsInChain);

        // ── Combo / Streak tracking ──
        this.comboCount += toClaim.length;
        this._totalWordsThisGame += toClaim.length;
        if (this.comboCount > this.bestCombo) this.bestCombo = this.comboCount;
        this.comboTimer = COMBO_WINDOW_SECONDS + (this._activePerks && this._activePerks.comboext ? 4 : 0); // reset combo timer

        // PixiJS: star burst for combo streaks
        if (this.comboCount >= 3) {
            pixiStarBurst(this.canvas.width / 2, this.canvas.height / 2, this.comboCount * 4);
        }
        // Kaboom: emit combo event
        kEmit('combo', { count: this.comboCount, words: toClaim.length });

        // ── Difficulty progression ──
        const newDiffLevel = Math.min(DIFFICULTY_MAX_LEVEL, 1 + Math.floor(this._totalWordsThisGame / DIFFICULTY_WORDS_PER_LEVEL));
        if (newDiffLevel > this._difficultyLevel) {
            this._difficultyLevel = newDiffLevel;
            // Speed up slightly (only in non-challenge, non-speed modes)
            if (this.activeChallenge !== CHALLENGE_TYPES.SPEED_ROUND) {
                this.fallInterval = Math.max(0.25, this._baseFallInterval - (this._difficultyLevel - 1) * DIFFICULTY_SPEED_STEP);
            }
        }

        // ── Dynamic difficulty: record word-finding performance ──
        if (this._dynamicDifficulty) {
            for (const group of toClaim) {
                const perf = DynamicDifficulty.scoreWordFound(group.word.length, 5, 60);
                this._dynamicDifficulty.recordPerformance(perf);
            }
            // Modulate fall speed by dynamic difficulty tier's fallSpeedMult
            const tier = this._dynamicDifficulty.getTier();
            if (this.activeChallenge !== CHALLENGE_TYPES.SPEED_ROUND) {
                const base = Math.max(0.25, this._baseFallInterval - (this._difficultyLevel - 1) * DIFFICULTY_SPEED_STEP);
                this.fallInterval = Math.max(0.20, base / tier.fallSpeedMult);
            }
        }

        // Apply combo multiplier to score
        if (this.comboCount >= 2) {
            const comboMult = Math.min(COMBO_MAX_MULTIPLIER, 1 + (this.comboCount - 1) * COMBO_MULTIPLIER_STEP);
            const comboBonus = Math.floor(toClaim.reduce((s, g) => s + g.pts, 0) * (comboMult - 1));
            if (comboBonus > 0) {
                const prevScoreCombo = this.score;
                this.score += comboBonus;
                this._checkBonusUnlock(prevScoreCombo, this.score);
                this._updateScoreDisplay();
            }
        }

        // Collect all cells from claimed groups
        const cellsToClear = new Set();
        for (const group of toClaim) {
            for (const key of group.cells) cellsToClear.add(key);
        }

        // Remove claimed groups; also remove remaining groups whose cells overlap
        // (since those cells are about to be cleared)
        this._validatedWordGroups = remaining.filter(g => {
            for (const key of cellsToClear) {
                if (g.cells.has(key)) return false;
            }
            return true;
        });
        this._rebuildValidatedCells();

        // Show word popup for each claimed word immediately
        if (claimedWords.length > 0) {
            this._showWordPopup(claimedWords);
        }

        // Flash and clear the claimed cells
        const longestWord = Math.max(...toClaim.map(g => g.word.length));
        if (this.totalWordsInChain > 1) {
            this.audio.chain(this.totalWordsInChain);
            this.renderer.triggerShake(2.5 + this.totalWordsInChain * 0.8);
        } else {
            this.audio.clear(longestWord);
            this.renderer.triggerShake(1.5 + longestWord * 0.4);
        }
        this._claimAnimating = true;
        this.clearing = true;
        this.clearPhase = "flash";
        this.clearTimer = 0;
        this.clearFlashDuration = STANDARD_CLEAR_FLASH_DURATION;
        this.pendingClearMode = "words";
        this.renderer.flashCells = new Set(cellsToClear);
        this.renderer.blastCells.clear();
        this.renderer.blastCenterKey = null;
        this.renderer.blastProgress = 0;
        this.renderer.spawnParticles(cellsToClear);
        this._pendingClearCells = cellsToClear;

        // Reset the falling block back to the top so the player has time to think
        if (this.block) {
            this.block.row = -BUFFER_ROWS;
            this.block.visualRow = -BUFFER_ROWS;
            this.block.dropAnimating = false;
            this.fallTimer = 0;
            this.spawnFreezeTimer = this.activeChallenge === CHALLENGE_TYPES.SPEED_ROUND ? 0 : 2.0;
        }
    }

    _bindCanvasTap() {
        const canvas = this.renderer.canvas;

        // Click for desktop
        canvas.addEventListener("click", (e) => {
            this._handleCanvasTap(e.clientX, e.clientY);
        });

        // For touch: we need to detect taps (not swipes) on green cells
        // Use a short-distance threshold to distinguish tap from swipe
        let tapStart = null;
        canvas.addEventListener("touchstart", (e) => {
            if (this._validatedWordGroups.length === 0) return;
            const touch = e.changedTouches[0];
            if (!touch) return;
            tapStart = { x: touch.clientX, y: touch.clientY, id: touch.identifier };
        }, { passive: true });

        canvas.addEventListener("touchend", (e) => {
            if (!tapStart) return;
            const touch = [...e.changedTouches].find(t => t.identifier === tapStart.id);
            if (!touch) { tapStart = null; return; }
            const dx = touch.clientX - tapStart.x;
            const dy = touch.clientY - tapStart.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 20) {
                // Short enough to be a tap
                this._handleCanvasTap(touch.clientX, touch.clientY);
            }
            tapStart = null;
        }, { passive: true });
    }

    _bindRowDrag() {
        const canvas = this.renderer.canvas;

        // ── Tap/click to select cells ──
        canvas.addEventListener("mousedown", (e) => {
            if (!this.rowDragActive || this.state !== State.PLAYING) return;
            e.preventDefault();
            this._handleLineClearTap(e.clientX, e.clientY);
        });

        canvas.addEventListener("touchstart", (e) => {
            if (!this.rowDragActive || this.state !== State.PLAYING) return;
            const touch = e.changedTouches[0];
            if (!touch) return;
            e.preventDefault();
            this._handleLineClearTap(touch.clientX, touch.clientY);
        }, { passive: false });

        // ── Clear button ──
        this.els.lineClearBtn.addEventListener("click", () => {
            this._completeLineClear();
        });

        // ── Cancel button (resets selection, stays in mode) ──
        this.els.lineCancelBtn.addEventListener("click", () => {
            this._resetLineClearSelection();
        });

        // Escape cancels line clear mode entirely
        document.addEventListener("keydown", (e) => {
            if (!this.rowDragActive) return;
            if (e.code === "Escape") {
                e.preventDefault();
                this._cancelRowDragMode();
            }
        });
    }

    // ── Challenge methods ──

    _openChallengeSetup(key) {
        const meta = CHALLENGE_META[key];
        if (!meta) return;
        this.activeChallenge = key;
        this.els.challengeSetupName.textContent = `${meta.icon} ${meta.title}`;
        this._setupCategorySelector(key);
        const gridSizeSel = document.getElementById("challenge-grid-size-selector");
        if (gridSizeSel) gridSizeSel.classList.toggle("hidden", key === CHALLENGE_TYPES.WORD_SEARCH || key === CHALLENGE_TYPES.WORD_RUNNER);

        // For Target Word: replace "START CHALLENGE" with "CONTINUE" once players are past level 1,
        // since progress always carries over and there is no concept of starting fresh.
        if (key === CHALLENGE_TYPES.TARGET_WORD) {
            const level = this.profileMgr.getTargetWordLevel();
            if (level > 1) {
                this.els.challengeStartBtn.textContent = `▶ CONTINUE (Lv. ${level})`;
            } else {
                this.els.challengeStartBtn.textContent = 'START CHALLENGE';
            }
        } else {
            this.els.challengeStartBtn.textContent = 'START CHALLENGE';
        }

        this._showScreen("challengesetup");
    }

    _renderChallengesGrid() {
        const grid = this.els.challengesGrid;
        grid.innerHTML = "";
        this._stopChallengePreviewAnimations();

        for (const [key, meta] of Object.entries(CHALLENGE_META)) {
            const stats = this.profileMgr.getChallengeStats(key);
            const card = document.createElement("div");
            card.className = "challenge-card";
            card.dataset.challenge = key;
            const levelInfo = (key === CHALLENGE_TYPES.TARGET_WORD || key === CHALLENGE_TYPES.WORD_SEARCH)
                ? `<span class="challenge-level-badge">Lv.${(key === CHALLENGE_TYPES.WORD_SEARCH ? this.profileMgr.getWordSearchLevel() : stats.targetWordLevel) || 1}</span>` : '';
            card.innerHTML = `
                <div class="challenge-preview"><canvas></canvas></div>
                <div class="challenge-card-title">${meta.icon} ${meta.title} ${levelInfo}</div>
                <div class="challenge-card-desc">${meta.description}</div>
                <div class="challenge-card-stats">
                    <span>◎ ${stats.highScore}</span>
                    <span>▷ ${stats.gamesPlayed}</span>
                    <span>≡ ${(stats.uniqueWordsFound || []).length}</span>
                </div>
            `;
            card.addEventListener("click", () => {
                this._stopChallengePreviewAnimations();
                this._openChallengeSetup(key);
            });
            grid.appendChild(card);

            // GSAP overlay effect for challenge card preview
            const previewOvl = challengePreviewOverlay(card, key);
            if (previewOvl) this._challengePreviewAnimations.push(previewOvl);

            // Start animated preview on the card's canvas
            const canvas = card.querySelector("canvas");
            this._startChallengePreview(canvas, key);
        }

        // GSAP staggered entrance for all challenge cards
        challengeGridEntrance(grid.querySelectorAll('.challenge-card'));
    }

    /**
     * Refresh challenge card levels after cloud sync completes.
     * Re-renders the challenges grid if the menu screen is visible.
     */
    _refreshChallengeCards() {
        if (this._activeScreen === 'menu') {
            this._renderChallengesGrid();
        }
        // Also update challenge setup screen level if it's showing
        if (this._activeScreen === 'challengesetup' && this.activeChallenge) {
            const levelEl = this.els.challengeSetupScreen?.querySelector('.challenge-level-badge');
            if (levelEl) {
                const stats = this.profileMgr.getChallengeStats(this.activeChallenge);
                const level = this.activeChallenge === CHALLENGE_TYPES.WORD_SEARCH
                    ? this.profileMgr.getWordSearchLevel()
                    : (stats.targetWordLevel || 1);
                levelEl.textContent = `Lv.${level}`;
            }
            // Keep the start button label in sync after a cloud sync
            if (this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD) {
                const level = this.profileMgr.getTargetWordLevel();
                this.els.challengeStartBtn.textContent = level > 1
                    ? `▶ CONTINUE (Lv. ${level})`
                    : 'START CHALLENGE';
            }
        }
    }

    _setupCategorySelector(challengeKey) {
        const sel = this.els.challengeCategorySelector;
        const wrap = this.els.challengeCategoryButtons;
        if (challengeKey !== CHALLENGE_TYPES.WORD_CATEGORY) {
            sel.classList.add("hidden");
            this._selectedCategoryKey = null;
            return;
        }
        sel.classList.remove("hidden");
        wrap.innerHTML = "";

        const playable = ["adjectives", "animals", "sports", "food", "nature", "technology"];
        let first = true;
        for (const catKey of playable) {
            const cat = WORD_CATEGORIES[catKey];
            if (!cat) continue;
            const tier = CATEGORY_TIERS[catKey] || { tier: 1, label: "" };
            const btn = document.createElement("button");
            btn.className = "category-pick-btn" + (first ? " selected" : "");
            btn.dataset.cat = catKey;
            const tierStars = "★".repeat(tier.tier) + "☆".repeat(3 - tier.tier);
            const tierText = tier.label ? `${tierStars} ${tier.label}` : tierStars;
            btn.innerHTML = `
                <span class="cat-icon">${cat.icon}</span>
                <span class="cat-label">${cat.label}</span>
                <span class="cat-tier">${tierText}</span>
            `;
            btn.addEventListener("click", () => {
                wrap.querySelectorAll(".category-pick-btn").forEach(b => b.classList.remove("selected"));
                btn.classList.add("selected");
                this._selectedCategoryKey = catKey;
            });
            wrap.appendChild(btn);
            if (first) {
                this._selectedCategoryKey = catKey;
                first = false;
            }
        }
    }

    _startChallengePreview(canvas, challengeType) {
        const size = 160;
        canvas.width = size;
        canvas.height = size;
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        const ctx = canvas.getContext("2d");
        const gridSize = 5;
        const cellSize = size / gridSize;

        // ─── TARGET WORD preview ───────────────────────────────────
        if (challengeType === CHALLENGE_TYPES.TARGET_WORD) {
            const target = "CAT";
            // Falling letters: each has col, y, letter, speed, settled row, glow phase
            const letters = [];
            const settled = Array.from({ length: gridSize }, () => Array(gridSize).fill(null));
            let nextDrop = 0;
            const dropQueue = [];
            // Pre-fill some random background letters
            for (let i = 0; i < 6; i++) {
                const r = 2 + Math.floor(Math.random() * 3);
                const c = Math.floor(Math.random() * gridSize);
                if (!settled[r][c]) settled[r][c] = { letter: String.fromCharCode(65 + Math.floor(Math.random() * 26)), glow: 0 };
            }
            // Schedule target letters dropping then random letters
            const targetCols = [1, 2, 3];
            for (let i = 0; i < target.length; i++) {
                dropQueue.push({ letter: target[i], col: targetCols[i], isTarget: true, delay: 20 + i * 25 });
            }
            for (let i = 0; i < 8; i++) {
                dropQueue.push({ letter: String.fromCharCode(65 + Math.floor(Math.random() * 26)), col: Math.floor(Math.random() * gridSize), isTarget: false, delay: 110 + i * 18 });
            }

            let tick = 0, cycle = 0;
            const draw = () => {
                tick++;
                const localTick = tick - cycle * 220;

                // Reset cycle
                if (localTick > 220) {
                    cycle++;
                    for (let r = 0; r < gridSize; r++) for (let c = 0; c < gridSize; c++) settled[r][c] = null;
                    letters.length = 0;
                    for (let i = 0; i < 6; i++) {
                        const r = 2 + Math.floor(Math.random() * 3);
                        const c = Math.floor(Math.random() * gridSize);
                        if (!settled[r][c]) settled[r][c] = { letter: String.fromCharCode(65 + Math.floor(Math.random() * 26)), glow: 0 };
                    }
                }

                // Spawn drops
                for (const dq of dropQueue) {
                    if (localTick === dq.delay) {
                        letters.push({ letter: dq.letter, col: dq.col, y: -cellSize, isTarget: dq.isTarget, speed: 2.5 });
                    }
                }

                // Update falling letters
                for (let i = letters.length - 1; i >= 0; i--) {
                    const fl = letters[i];
                    // Find landing row
                    let landRow = gridSize - 1;
                    for (let r = 0; r < gridSize; r++) {
                        if (settled[r][fl.col]) { landRow = r - 1; break; }
                    }
                    const landY = landRow * cellSize;
                    fl.y += fl.speed;
                    if (fl.y >= landY) {
                        fl.y = landY;
                        if (landRow >= 0) settled[landRow][fl.col] = { letter: fl.letter, glow: fl.isTarget ? 1 : 0 };
                        letters.splice(i, 1);
                    }
                }

                // Draw
                ctx.fillStyle = "#2f3029";
                ctx.fillRect(0, 0, size, size);

                for (let r = 0; r < gridSize; r++) {
                    for (let c = 0; c < gridSize; c++) {
                        const x = c * cellSize, y = r * cellSize;
                        ctx.fillStyle = "#3a3933";
                        ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
                        const s = settled[r][c];
                        if (s) {
                            if (s.glow) {
                                const pulse = 0.4 + 0.3 * Math.sin(tick * 0.1);
                                ctx.fillStyle = `rgba(226, 216, 166, ${pulse * 0.3})`;
                                ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
                                ctx.fillStyle = "#e2d8a6";
                            } else {
                                ctx.fillStyle = "#9a9680";
                            }
                            ctx.font = `bold ${Math.floor(cellSize * 0.5)}px monospace`;
                            ctx.textAlign = "center";
                            ctx.textBaseline = "middle";
                            ctx.fillText(s.letter, x + cellSize / 2, y + cellSize / 2);
                        }
                    }
                }

                // Draw falling letters
                for (const fl of letters) {
                    const x = fl.col * cellSize;
                    ctx.fillStyle = fl.isTarget ? "#3a3933" : "#3a3933";
                    ctx.fillRect(x + 1, fl.y + 1, cellSize - 2, cellSize - 2);
                    if (fl.isTarget) {
                        ctx.strokeStyle = "#e2d8a6";
                        ctx.lineWidth = 1.5;
                        ctx.strokeRect(x + 2, fl.y + 2, cellSize - 4, cellSize - 4);
                    }
                    ctx.fillStyle = fl.isTarget ? "#e2d8a6" : "#fff";
                    ctx.font = `bold ${Math.floor(cellSize * 0.5)}px monospace`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(fl.letter, x + cellSize / 2, fl.y + cellSize / 2);
                }

                // Target label at top
                const alpha = 0.6 + 0.3 * Math.sin(tick * 0.08);
                ctx.fillStyle = `rgba(226, 216, 166, ${alpha})`;
                ctx.font = `bold ${Math.floor(size * 0.1)}px monospace`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("◎ " + target, size / 2, size * 0.08);

                // Grid lines
                ctx.strokeStyle = "#4a493e";
                ctx.lineWidth = 0.5;
                for (let r = 0; r <= gridSize; r++) { ctx.beginPath(); ctx.moveTo(0, r * cellSize); ctx.lineTo(size, r * cellSize); ctx.stroke(); }
                for (let c = 0; c <= gridSize; c++) { ctx.beginPath(); ctx.moveTo(c * cellSize, 0); ctx.lineTo(c * cellSize, size); ctx.stroke(); }
            };
            draw();
            const id = setInterval(draw, 60);
            this._challengePreviewAnimations.push(id);
            return;
        }

        // ─── SPEED ROUND preview ──────────────────────────────────
        if (challengeType === CHALLENGE_TYPES.SPEED_ROUND) {
            const settled = Array.from({ length: gridSize }, () => Array(gridSize).fill(null));
            // Pre-fill bottom rows
            for (let r = 3; r < gridSize; r++) for (let c = 0; c < gridSize; c++) {
                if (Math.random() < 0.6) settled[r][c] = String.fromCharCode(65 + Math.floor(Math.random() * 26));
            }
            const fallers = [];
            let tick = 0, speed = 1.5, spawnTimer = 0, spawnInterval = 22;

            const draw = () => {
                tick++;

                // Gradually speed up
                speed = 1.5 + tick * 0.008;
                if (spawnInterval > 6) spawnInterval = Math.max(6, 22 - Math.floor(tick / 30));

                // Spawn new fallers
                spawnTimer++;
                if (spawnTimer >= spawnInterval) {
                    spawnTimer = 0;
                    const col = Math.floor(Math.random() * gridSize);
                    fallers.push({ col, y: -cellSize, letter: String.fromCharCode(65 + Math.floor(Math.random() * 26)) });
                }

                // Update fallers
                for (let i = fallers.length - 1; i >= 0; i--) {
                    fallers[i].y += speed;
                    if (fallers[i].y > size) fallers.splice(i, 1);
                }

                // Draw
                ctx.fillStyle = "#2f3029";
                ctx.fillRect(0, 0, size, size);

                for (let r = 0; r < gridSize; r++) {
                    for (let c = 0; c < gridSize; c++) {
                        const x = c * cellSize, y = r * cellSize;
                        ctx.fillStyle = "#3a3933";
                        ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
                        if (settled[r][c]) {
                            ctx.fillStyle = "#9a9680";
                            ctx.font = `bold ${Math.floor(cellSize * 0.5)}px monospace`;
                            ctx.textAlign = "center";
                            ctx.textBaseline = "middle";
                            ctx.fillText(settled[r][c], x + cellSize / 2, y + cellSize / 2);
                        }
                    }
                }

                // Draw fallers with speed trails
                for (const f of fallers) {
                    const x = f.col * cellSize;
                    // Motion trail
                    const trailLen = Math.min(speed * 4, cellSize);
                    const grad = ctx.createLinearGradient(x + cellSize / 2, f.y - trailLen, x + cellSize / 2, f.y);
                    grad.addColorStop(0, "rgba(226, 216, 166, 0)");
                    grad.addColorStop(1, "rgba(226, 216, 166, 0.3)");
                    ctx.fillStyle = grad;
                    ctx.fillRect(x + 4, f.y - trailLen, cellSize - 8, trailLen);

                    ctx.fillStyle = "#3a3933";
                    ctx.fillRect(x + 1, f.y + 1, cellSize - 2, cellSize - 2);
                    ctx.strokeStyle = "#e2d8a6";
                    ctx.lineWidth = 1.5;
                    ctx.strokeRect(x + 2, f.y + 2, cellSize - 4, cellSize - 4);
                    ctx.fillStyle = "#e2d8a6";
                    ctx.font = `bold ${Math.floor(cellSize * 0.5)}px monospace`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(f.letter, x + cellSize / 2, f.y + cellSize / 2);
                }

                // Speed indicator
                const barW = size * 0.6;
                const barH = 6;
                const barX = (size - barW) / 2;
                const barY = size - 10;
                const pct = Math.min(1, (speed - 1.5) / 5);
                ctx.fillStyle = "#4a493e";
                ctx.fillRect(barX, barY, barW, barH);
                const barGrad = ctx.createLinearGradient(barX, 0, barX + barW * pct, 0);
                barGrad.addColorStop(0, "#e2d8a6");
                barGrad.addColorStop(1, "#c45c4a");
                ctx.fillStyle = barGrad;
                ctx.fillRect(barX, barY, barW * pct, barH);

                // Grid lines
                ctx.strokeStyle = "#4a493e";
                ctx.lineWidth = 0.5;
                for (let r = 0; r <= gridSize; r++) { ctx.beginPath(); ctx.moveTo(0, r * cellSize); ctx.lineTo(size, r * cellSize); ctx.stroke(); }
                for (let c = 0; c <= gridSize; c++) { ctx.beginPath(); ctx.moveTo(c * cellSize, 0); ctx.lineTo(c * cellSize, size); ctx.stroke(); }

                // Reset cycle
                if (tick > 300) {
                    tick = 0; speed = 1.5; spawnInterval = 22; spawnTimer = 0;
                    fallers.length = 0;
                }
            };
            draw();
            const id = setInterval(draw, 60);
            this._challengePreviewAnimations.push(id);
            return;
        }

        // ─── WORD CATEGORY preview ────────────────────────────────
        if (challengeType === CHALLENGE_TYPES.WORD_CATEGORY) {
            const categories = [
                { icon: "○", label: "Food", words: ["CAKE", "RICE", "SOUP", "FISH"] },
                { icon: "○", label: "Animals", words: ["BEAR", "FROG", "HAWK", "DUCK"] },
                { icon: "○", label: "Sports", words: ["GOLF", "SWIM", "KICK", "RACE"] },
                { icon: "○", label: "Nature", words: ["TREE", "RAIN", "LAKE", "LEAF"] },
            ];
            let catIdx = 0, tick = 0, wordSlots = [], phase = "reveal"; // reveal → glow → fade

            const setupCategory = () => {
                const cat = categories[catIdx];
                wordSlots = cat.words.map((w, i) => ({
                    word: w,
                    row: 1 + i,
                    col: Math.floor((gridSize - w.length) / 2),
                    revealedCount: 0,
                    glowing: false,
                    alpha: 1,
                }));
                phase = "reveal";
            };
            setupCategory();

            const draw = () => {
                tick++;
                const cat = categories[catIdx];

                // Phase timing
                if (phase === "reveal") {
                    // Reveal letters one by one across all words
                    const revealTick = Math.floor(tick / 4);
                    let allDone = true;
                    for (const ws of wordSlots) {
                        const target = Math.min(ws.word.length, revealTick - ws.row * 2);
                        ws.revealedCount = Math.max(0, Math.min(ws.word.length, target));
                        if (ws.revealedCount < ws.word.length) allDone = false;
                    }
                    if (allDone) { phase = "glow"; tick = 0; }
                } else if (phase === "glow") {
                    for (const ws of wordSlots) ws.glowing = true;
                    if (tick > 60) { phase = "fade"; tick = 0; }
                } else if (phase === "fade") {
                    for (const ws of wordSlots) ws.alpha = Math.max(0, 1 - tick / 20);
                    if (tick > 25) {
                        catIdx = (catIdx + 1) % categories.length;
                        setupCategory();
                        tick = 0;
                    }
                }

                // Draw
                ctx.fillStyle = "#2f3029";
                ctx.fillRect(0, 0, size, size);

                for (let r = 0; r < gridSize; r++) {
                    for (let c = 0; c < gridSize; c++) {
                        const x = c * cellSize, y = r * cellSize;
                        ctx.fillStyle = "#3a3933";
                        ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
                    }
                }

                // Draw word slots
                for (const ws of wordSlots) {
                    for (let i = 0; i < ws.revealedCount; i++) {
                        const c = ws.col + i;
                        const x = c * cellSize, y = ws.row * cellSize;
                        if (ws.glowing) {
                            const pulse = 0.3 + 0.2 * Math.sin(tick * 0.12 + i);
                            ctx.fillStyle = `rgba(76, 175, 80, ${pulse * ws.alpha})`;
                            ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
                        }
                        ctx.globalAlpha = ws.alpha;
                        ctx.fillStyle = ws.glowing ? "#4caf50" : "#fff";
                        ctx.font = `bold ${Math.floor(cellSize * 0.45)}px monospace`;
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.fillText(ws.word[i], x + cellSize / 2, y + cellSize / 2);
                        ctx.globalAlpha = 1;
                    }
                }

                // Category label at top
                const labelAlpha = phase === "fade" ? Math.max(0, 1 - tick / 15) : Math.min(1, tick / 10);
                ctx.globalAlpha = labelAlpha;
                ctx.fillStyle = "#4caf50";
                ctx.font = `bold ${Math.floor(size * 0.1)}px monospace`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(`${cat.icon} ${cat.label}`, size / 2, size * 0.08);
                ctx.globalAlpha = 1;

                // Grid lines
                ctx.strokeStyle = "#4a493e";
                ctx.lineWidth = 0.5;
                for (let r = 0; r <= gridSize; r++) { ctx.beginPath(); ctx.moveTo(0, r * cellSize); ctx.lineTo(size, r * cellSize); ctx.stroke(); }
                for (let c = 0; c <= gridSize; c++) { ctx.beginPath(); ctx.moveTo(c * cellSize, 0); ctx.lineTo(c * cellSize, size); ctx.stroke(); }
            };
            draw();
            const id = setInterval(draw, 60);
            this._challengePreviewAnimations.push(id);
            return;
        }

        // ─── WORD SEARCH preview ──────────────────────────────────
        if (challengeType === CHALLENGE_TYPES.WORD_SEARCH) {
            const previewGrid = [];
            const word = "FIND";
            const miniSize = 6;
            const miniCell = size / miniSize;
            for (let r = 0; r < miniSize; r++) {
                previewGrid[r] = [];
                for (let c = 0; c < miniSize; c++) {
                    previewGrid[r][c] = String.fromCharCode(65 + Math.floor(Math.random() * 26));
                }
            }
            // Place "FIND" horizontally at row 2
            for (let i = 0; i < word.length; i++) previewGrid[2][1 + i] = word[i];
            // Place "FUN" vertically at col 1
            const vword = "FUN";
            for (let i = 0; i < vword.length; i++) previewGrid[2 + i][1] = vword[i];

            let tick = 0;
            let highlightIdx = -1;
            const draw = () => {
                tick++;
                ctx.fillStyle = "#2f3029";
                ctx.fillRect(0, 0, size, size);

                // Highlight the found word ("FIND") with sliding animation
                const highlightPhase = Math.floor(tick / 15) % 3;
                if (highlightPhase === 1) {
                    const progress = Math.min(1, (tick % 15) / 10);
                    const endC = Math.floor(1 + progress * (word.length - 1));
                    ctx.fillStyle = "rgba(100, 200, 100, 0.25)";
                    for (let c = 1; c <= endC; c++) {
                        ctx.fillRect(c * miniCell, 2 * miniCell, miniCell, miniCell);
                    }
                } else if (highlightPhase === 2) {
                    ctx.fillStyle = "rgba(100, 200, 100, 0.25)";
                    for (let c = 1; c <= word.length; c++) {
                        ctx.fillRect(c * miniCell, 2 * miniCell, miniCell, miniCell);
                    }
                }

                // Grid lines
                ctx.strokeStyle = "#4a493e";
                ctx.lineWidth = 0.5;
                for (let r = 0; r <= miniSize; r++) { ctx.beginPath(); ctx.moveTo(0, r * miniCell); ctx.lineTo(size, r * miniCell); ctx.stroke(); }
                for (let c = 0; c <= miniSize; c++) { ctx.beginPath(); ctx.moveTo(c * miniCell, 0); ctx.lineTo(c * miniCell, size); ctx.stroke(); }

                // Letters
                const fs = Math.floor(miniCell * 0.55);
                ctx.font = `bold ${fs}px 'Segoe UI', sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                for (let r = 0; r < miniSize; r++) {
                    for (let c = 0; c < miniSize; c++) {
                        const isWordCell = (r === 2 && c >= 1 && c < 1 + word.length);
                        ctx.fillStyle = (isWordCell && highlightPhase === 2) ? "#80d080" : "#e2d8a6";
                        ctx.fillText(previewGrid[r][c], c * miniCell + miniCell / 2, r * miniCell + miniCell / 2);
                    }
                }

                // Search icon
                ctx.fillStyle = "rgba(226, 216, 166, 0.3)";
                ctx.font = "bold 20px sans-serif";
                ctx.textAlign = "right";
                ctx.fillText("🔍", size - 4, size - 6);
            };
            draw();
            const id = setInterval(draw, 60);
            this._challengePreviewAnimations.push(id);
            return;
        }

        // ─── WORD RUNNER preview ──────────────────────────────────
        if (challengeType === CHALLENGE_TYPES.WORD_RUNNER) {
            const groundY = size * 0.78;
            let tick = 0;
            let runnerX = size * 0.25;
            let runnerY = groundY;
            let vy = 0;
            const rocks = [
                { x: size * 0.6, w: 8, h: 14 },
                { x: size * 1.1, w: 10, h: 16 },
            ];
            const letters = [
                { x: size * 0.45, y: groundY - 28, ch: "W" },
                { x: size * 0.85, y: groundY - 32, ch: "O" },
                { x: size * 1.25, y: groundY - 26, ch: "R" },
            ];
            let scrollX = 0;

            const draw = () => {
                tick++;
                scrollX += 1.2;

                // Auto-jump near rocks
                const onGround = runnerY >= groundY;
                for (const r of rocks) {
                    const rx = ((r.x - scrollX) % (size * 1.0) + size * 1.3) % (size * 1.0) - size * 0.1;
                    if (rx > runnerX && rx < runnerX + 35 && onGround) {
                        vy = -6.5;
                    }
                }
                // Gravity
                if (!onGround || vy < 0) {
                    vy += 0.45;
                    runnerY += vy;
                    if (runnerY >= groundY) {
                        runnerY = groundY;
                        vy = 0;
                    }
                }

                // Deep navy background (matches WR game)
                ctx.fillStyle = "#0a0e1a";
                ctx.fillRect(0, 0, size, size);

                // Distant stars
                if (tick === 1) {
                    canvas._stars = [];
                    for (let i = 0; i < 15; i++) {
                        canvas._stars.push({
                            x: Math.random() * size,
                            y: Math.random() * groundY * 0.7,
                            r: 0.3 + Math.random() * 1,
                            a: 0.1 + Math.random() * 0.3,
                        });
                    }
                }
                if (canvas._stars) {
                    for (const s of canvas._stars) {
                        ctx.fillStyle = `rgba(51,68,102,${s.a})`;
                        ctx.beginPath();
                        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }

                // Ground — teal edge line + dark fill
                ctx.fillStyle = "#1a3040";
                ctx.fillRect(0, groundY, size, size - groundY);
                ctx.strokeStyle = "#00ccaa";
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(0, groundY);
                ctx.lineTo(size, groundY);
                ctx.stroke();

                // Ground detail pebbles
                ctx.fillStyle = "rgba(0,204,170,0.1)";
                for (let x = (tick * 0.6) % 18; x < size; x += 18 + 5) {
                    ctx.fillRect(x, groundY + 3, 1, 1);
                }

                // Spike obstacles (red, matching WR spikes)
                ctx.fillStyle = "#cc2244";
                for (const r of rocks) {
                    const rx = ((r.x - scrollX) % (size * 1.0) + size * 1.3) % (size * 1.0) - size * 0.1;
                    // Triangle spike
                    ctx.beginPath();
                    ctx.moveTo(rx, groundY);
                    ctx.lineTo(rx + r.w / 2, groundY - r.h);
                    ctx.lineTo(rx + r.w, groundY);
                    ctx.closePath();
                    ctx.fill();
                    // Dark base
                    ctx.fillStyle = "#661122";
                    ctx.fillRect(rx, groundY - 2, r.w, 2);
                    ctx.fillStyle = "#cc2244";
                }

                // Floating letters — cyan glow circles + gold text
                ctx.font = "bold 13px 'SF Mono', Consolas, monospace";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                for (const l of letters) {
                    const lx = ((l.x - scrollX) % (size * 1.0) + size * 1.3) % (size * 1.0) - size * 0.1;
                    const ly = l.y + Math.sin(tick * 0.06 + l.x) * 2;
                    // Cyan glow
                    ctx.fillStyle = "rgba(0,221,255,0.15)";
                    ctx.beginPath();
                    ctx.arc(lx, ly, 9, 0, Math.PI * 2);
                    ctx.fill();
                    // Letter
                    ctx.fillStyle = "#00ddff";
                    ctx.fillText(l.ch, lx, ly);
                }

                // Runner — orange player with glow
                const phase = tick * 0.15;
                const feetY = runnerY;
                const hipY = feetY - 12;
                const shoulderY = hipY - 10;
                const headY = shoulderY - 5;

                ctx.strokeStyle = "#ffaa00";
                ctx.lineWidth = 1.5;
                ctx.lineCap = "round";

                // Head
                ctx.beginPath();
                ctx.arc(runnerX, headY, 4, 0, Math.PI * 2);
                ctx.stroke();
                // Eye
                ctx.fillStyle = "#ffdd44";
                ctx.fillRect(runnerX + 1.5, headY - 1, 1, 1);

                // Torso
                ctx.beginPath();
                ctx.moveTo(runnerX, shoulderY);
                ctx.lineTo(runnerX, hipY);
                ctx.stroke();

                if (runnerY < groundY) {
                    // Jump pose — arms up, legs tucked
                    ctx.beginPath();
                    ctx.moveTo(runnerX, shoulderY + 1);
                    ctx.lineTo(runnerX - 4, shoulderY - 3);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(runnerX, shoulderY + 1);
                    ctx.lineTo(runnerX + 4, shoulderY - 3);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(runnerX, hipY);
                    ctx.lineTo(runnerX - 3, hipY + 4);
                    ctx.lineTo(runnerX - 1, hipY + 1);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(runnerX, hipY);
                    ctx.lineTo(runnerX + 3, hipY + 4);
                    ctx.lineTo(runnerX + 1, hipY + 1);
                    ctx.stroke();
                } else {
                    // Run cycle
                    const armS = Math.sin(phase) * 0.6;
                    const legS = Math.sin(phase) * 0.55;
                    ctx.beginPath();
                    ctx.moveTo(runnerX, shoulderY + 1);
                    ctx.lineTo(runnerX + Math.sin(armS) * 6, shoulderY + 1 + Math.cos(armS) * 6);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(runnerX, shoulderY + 1);
                    ctx.lineTo(runnerX + Math.sin(-armS) * 6, shoulderY + 1 + Math.cos(-armS) * 6);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(runnerX, hipY);
                    ctx.lineTo(runnerX + Math.sin(-legS) * 5, hipY + Math.cos(-legS) * 6);
                    ctx.lineTo(runnerX + Math.sin(-legS * 0.3) * 3, feetY);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(runnerX, hipY);
                    ctx.lineTo(runnerX + Math.sin(legS) * 5, hipY + Math.cos(legS) * 6);
                    ctx.lineTo(runnerX + Math.sin(legS * 0.3) * 3, feetY);
                    ctx.stroke();
                }

                // Score counter (teal)
                ctx.fillStyle = "rgba(0,204,170,0.5)";
                ctx.font = "bold 9px monospace";
                ctx.textAlign = "right";
                ctx.fillText(String(Math.floor(scrollX)).padStart(5, '0'), size - 4, 12);
            };
            draw();
            const id = setInterval(draw, 40);
            this._challengePreviewAnimations.push(id);
            return;
        }
    }

    _stopChallengePreviewAnimations() {
        for (const item of this._challengePreviewAnimations) {
            if (typeof item === 'number') clearInterval(item);
            else if (item && typeof item.destroy === 'function') item.destroy();
        }
        this._challengePreviewAnimations = [];
    }

    _startChallengeGame() {
        // Check if there's a saved game for this challenge - if so, confirm before starting new
        if (this._hasSavedGame(this.activeChallenge)) {
            this._openConfirmNewGameModal("challenge", this.activeChallenge);
            return;
        }
        this._startChallengeGameDirect();
    }

    /** Direct challenge start without saved game check (called after confirmation) */
    _startChallengeGameDirect() {
        this._stopChallengePreviewAnimations();

        // Word Search uses its own screen and game flow
        if (this.activeChallenge === CHALLENGE_TYPES.WORD_SEARCH) {
            this._wsStartGame();
            return;
        }

        // Word Runner uses its own screen and game flow
        if (this.activeChallenge === CHALLENGE_TYPES.WORD_RUNNER) {
            this._wrStartGame();
            return;
        }

        this.gridSize = this.challengeGridSize;
        this.difficulty = "casual";

        const timeLimit = this.activeChallenge === CHALLENGE_TYPES.SPEED_ROUND
            ? 3 * 60 : CHALLENGE_TIME_LIMIT;
        this._beginNewGame(timeLimit);

        // After _beginNewGame sets up state, apply challenge specifics
        if (this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD) {
            this.targetWordsCompleted = 0;
            this._targetWordLevel = this.profileMgr.getTargetWordLevel();
            this._targetWordLevelAtStart = this._targetWordLevel;
            this._pickTargetWord();
            this.els.targetWordDisplay.classList.remove("hidden");
        } else if (this.activeChallenge === CHALLENGE_TYPES.SPEED_ROUND) {
            this.fallInterval = 0.9;
            this.speedRoundBaseInterval = this.fallInterval;
            this.els.targetWordDisplay.classList.add("hidden");
        } else if (this.activeChallenge === CHALLENGE_TYPES.WORD_CATEGORY) {
            this.categoryWordsFound = [];
            this._pickCategory(this._selectedCategoryKey);
            this.els.targetWordDisplay.classList.remove("hidden");
        }
    }

    _isChallengeBonusWord(word) {
        if (this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD) {
            return this.targetWord && (word === this.targetWord || word.includes(this.targetWord));
        }
        if (this.activeChallenge === CHALLENGE_TYPES.WORD_CATEGORY) {
            return this.activeCategorySet && this.activeCategorySet.has(word);
        }
        return false;
    }

    _pickTargetWord() {
        _buildTargetWordPools();
        const level = this._targetWordLevel || 1;
        const band = _targetLevelBand(level);

        // Max word length per level tier — early levels are strictly short words
        let maxLen;
        if (level <= 20)       maxLen = 3;
        else if (level <= 50)  maxLen = 4;
        else if (level <= 100) maxLen = 5;
        else if (level <= 180) maxLen = 6;
        else                   maxLen = 7;

        if (!_targetWordPools || _targetWordPools.length === 0) {
            // Fallback: pick any 3-5 letter word
            const candidates = [];
            for (const word of DICTIONARY) {
                if (word.length >= 3 && word.length <= Math.min(maxLen, 5)) candidates.push(word);
            }
            if (candidates.length === 0) return;
            this.targetWord = candidates[Math.floor(Math.random() * candidates.length)];
        } else {
            // Filter the difficulty band by max word length for this level
            const pool = _targetWordPools.slice(band.start, band.end)
                .filter(entry => entry.len <= maxLen);
            if (pool.length === 0) {
                // Fallback: find any word within length cap from the full pool
                const fallback = _targetWordPools.filter(e => e.len <= maxLen);
                this.targetWord = fallback.length > 0
                    ? fallback[Math.floor(Math.random() * fallback.length)].word
                    : _targetWordPools[0].word;
            } else {
                // Pick randomly from the band, avoid repeating the same word
                let pick;
                let tries = 0;
                do {
                    pick = pool[Math.floor(Math.random() * pool.length)].word;
                    tries++;
                } while (pick === this.targetWord && pool.length > 1 && tries < 10);
                this.targetWord = pick;
            }
        }
        this.els.targetWordText.textContent = this.targetWord;
        this._updateTargetLevelDisplay();
    }

    _updateTargetLevelDisplay() {
        const level = this._targetWordLevel || 1;
        const display = this.els.targetWordDisplay;
        if (!display) return;
        let levelTag = display.querySelector('.target-level-tag');
        if (!levelTag) {
            levelTag = document.createElement('span');
            levelTag.className = 'target-level-tag';
            display.insertBefore(levelTag, display.firstChild);
        }
        levelTag.textContent = `Lv.${level}`;
    }

    _pickCategory(specificKey) {
        let pick;
        if (specificKey && WORD_CATEGORIES[specificKey]) {
            pick = specificKey;
        } else {
            const keys = Object.keys(WORD_CATEGORIES);
            if (keys.length === 0) return;
            do {
                pick = keys[Math.floor(Math.random() * keys.length)];
            } while (keys.length > 1 && pick === this.activeCategoryKey);
        }
        this.activeCategoryKey = pick;
        this.activeCategorySet = WORD_CATEGORIES[pick].words;
        const cat = WORD_CATEGORIES[pick];
        this.els.targetWordText.textContent = `${cat.icon} ${cat.label}`;
        // Update the label from "TARGET:" to "CATEGORY:"
        this.els.targetWordDisplay.querySelector(".target-label").textContent = "CATEGORY:";
    }

    _updateSpeedRound() {
        // Increase speed every 500 points
        if (this.activeChallenge !== CHALLENGE_TYPES.SPEED_ROUND) return;
        const speedUps = Math.floor(this.score / 500);
        this.fallInterval = Math.max(0.2, this.speedRoundBaseInterval - speedUps * 0.08);
    }

    _openChallengeTutorial() {
        if (!this.activeChallenge) return;
        const meta = CHALLENGE_META[this.activeChallenge];
        if (!meta) return;
        this.els.challengeTutorialTitle.textContent = `${meta.icon} ${meta.title}`;

        let tutorialText = "";
        if (this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD) {
            tutorialText = "A target word appears at the top of the screen. Spelling the target word earns 2× points and a 200-point bonus! Non-target words earn reduced points. Finding no target words slashes your XP. Game lasts 7 minutes.";
        } else if (this.activeChallenge === CHALLENGE_TYPES.SPEED_ROUND) {
            tutorialText = "Blocks start falling at normal speed but get faster every 500 points! The fall speed keeps increasing until you can barely keep up. Game lasts 3 minutes — score as high as you can!";
        } else if (this.activeChallenge === CHALLENGE_TYPES.WORD_CATEGORY) {
            tutorialText = "Choose a category before starting. Words matching your category earn bonus points! Harder categories (Technology, Nature) earn even more points and XP. Longer, more complex words also score higher. Other words earn reduced points. Game lasts 7 minutes.";
        } else if (this.activeChallenge === CHALLENGE_TYPES.WORD_SEARCH) {
            tutorialText = "Find hidden words in the grid by swiping across letters! No word list is shown — you must discover valid words yourself. Words can go in any direction. Each level is timed at 7 minutes. Levels get progressively harder with larger grids and harder words. Earn points and coins for every word you find!";
        } else if (this.activeChallenge === CHALLENGE_TYPES.WORD_RUNNER) {
            tutorialText = "Run through a neon-lit procedural world! TAP or SPACE to jump — you get up to 5 jumps (1 ground + 4 air). Dodge spike obstacles and leap over gaps — falling into a hole or hitting spikes ends the game! Collect floating letters to fill your word boxes. Press the ✓ button to submit your word when ready. Valid words earn big points and coins; invalid words shake red and clear. Choose your word length (3-8) before starting. Speed ramps up the further you go!";
        }
        this.els.challengeTutorialText.textContent = tutorialText;

        // Draw a small preview
        const canvas = this.els.challengeTutorialCanvas;
        canvas.width = 150;
        canvas.height = 150;
        const ctx = canvas.getContext("2d");

        // Use Spine animated character for Word Runner; static icon for others
        if (this._challengeTutorialSpine) {
            this._challengeTutorialSpine.destroy();
            this._challengeTutorialSpine = null;
        }
        if (this.activeChallenge === CHALLENGE_TYPES.WORD_RUNNER) {
            // Animated WR scene with stick figure (same as tutorial page)
            const w = 150, h = 150;
            const gy = 118;
            const scrollSpeed = 40; // px per second
            const neonLettersDef = [
                { ch: 'P', baseX: 200, y: 75, color: '#00ddff' },
                { ch: 'L', baseX: 260, y: 63, color: '#00ddff' },
                { ch: 'U', baseX: 330, y: 70, color: '#ffaa00' },
                { ch: 'M', baseX: 400, y: 60, color: '#00ddff' },
            ];
            const spikeBaseXs = [280, 290, 300];
            const gapBaseX = 360;
            const gapW = 20;
            let startTime = null;
            let rafId = 0;
            let collected = 0;

            const drawFrame = (timestamp) => {
                if (!startTime) startTime = timestamp;
                const t = (timestamp - startTime) / 1000;
                const scroll = (t * scrollSpeed) % 500; // wrap every 500px

                ctx.clearRect(0, 0, w, h);

                // Background
                const grd = ctx.createLinearGradient(0, 0, 0, h);
                grd.addColorStop(0, '#0a0e1a');
                grd.addColorStop(1, '#111830');
                ctx.fillStyle = grd;
                ctx.fillRect(0, 0, w, h);

                // Ground (scrolling segments with gap)
                ctx.fillStyle = '#1a3040';
                ctx.fillRect(0, gy, w, h - gy);
                // Neon ground edge
                ctx.strokeStyle = '#00ccaa'; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();

                // Scrolling gap
                const gapX = ((gapBaseX - scroll) % 500 + 500) % 500 - 50;
                if (gapX > -gapW && gapX < w) {
                    ctx.fillStyle = '#0a0e1a';
                    ctx.fillRect(gapX, gy, gapW, h - gy);
                    // Redraw ground edge with gap
                    ctx.strokeStyle = '#00ccaa'; ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(0, gy); ctx.lineTo(gapX, gy);
                    ctx.moveTo(gapX + gapW, gy); ctx.lineTo(w, gy);
                    ctx.stroke();
                }

                // Scrolling spikes
                ctx.fillStyle = '#ff4444';
                for (const sbx of spikeBaseXs) {
                    const sx = ((sbx - scroll) % 500 + 500) % 500 - 50;
                    if (sx > -10 && sx < w + 10) {
                        ctx.beginPath();
                        ctx.moveTo(sx - 4, gy);
                        ctx.lineTo(sx, gy - 10);
                        ctx.lineTo(sx + 4, gy);
                        ctx.closePath();
                        ctx.fill();
                    }
                }

                // Scrolling floating letters
                collected = Math.floor(t / 2.5) % 5; // cycle 0-4 collected
                const ltrs = ['P', 'L', 'U', 'M'];
                ctx.font = 'bold 13px sans-serif';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                for (let i = 0; i < neonLettersDef.length; i++) {
                    if (i < collected) continue; // "collected" letters disappear
                    const lt = neonLettersDef[i];
                    const lx = ((lt.baseX - scroll) % 500 + 500) % 500 - 50;
                    if (lx > -10 && lx < w + 10) {
                        const bobY = lt.y + Math.sin(t * 3 + i) * 4;
                        ctx.shadowColor = lt.color; ctx.shadowBlur = 8;
                        ctx.fillStyle = lt.color;
                        ctx.fillText(lt.ch, lx, bobY);
                    }
                }
                ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;

                // Word boxes at top
                const boxW = 22, boxH = 17;
                const startX = (w - 4 * (boxW + 3)) / 2;
                for (let i = 0; i < 4; i++) {
                    const bx = startX + i * (boxW + 3), by = 8;
                    ctx.fillStyle = i < collected ? 'rgba(0,204,170,0.2)' : 'rgba(255,255,255,0.05)';
                    ctx.fillRect(bx, by, boxW, boxH);
                    ctx.strokeStyle = i < collected ? '#00ccaa' : '#334';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(bx, by, boxW, boxH);
                    if (i < collected) {
                        ctx.fillStyle = '#fff';
                        ctx.font = 'bold 10px sans-serif';
                        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                        ctx.fillText(ltrs[i], bx + boxW / 2, by + boxH / 2);
                    }
                }

                // Animated neon stick figure
                const charX = w * 0.2;
                const jumpCyc = t % 3;
                const charY = jumpCyc > 1.5 && jumpCyc < 2.3
                    ? gy - Math.sin((jumpCyc - 1.5) / 0.8 * Math.PI) * 22
                    : gy;
                const airborne = charY < gy;

                {
                    const phase = airborne ? 0 : t * 8;
                    const headR = 5;
                    const headY = charY - 23;
                    const neckY = headY + headR;
                    const shoulderY = neckY + 2;
                    const hipY = charY - 6;

                    ctx.strokeStyle = '#ffaa00'; ctx.lineWidth = 2; ctx.lineCap = 'round';
                    ctx.shadowColor = '#ffaa00'; ctx.shadowBlur = 6;

                    // Head
                    ctx.beginPath();
                    ctx.arc(charX, headY, headR, 0, Math.PI * 2);
                    ctx.fillStyle = '#ffaa00';
                    ctx.fill();
                    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1.5;
                    ctx.stroke();

                    // Torso
                    ctx.strokeStyle = '#ffaa00'; ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(charX, neckY);
                    ctx.lineTo(charX, hipY);
                    ctx.stroke();

                    // Arms
                    const armLen = 8;
                    if (airborne) {
                        ctx.beginPath(); ctx.moveTo(charX, shoulderY);
                        ctx.lineTo(charX - 8, shoulderY - 6); ctx.stroke();
                        ctx.beginPath(); ctx.moveTo(charX, shoulderY);
                        ctx.lineTo(charX + 8, shoulderY - 6); ctx.stroke();
                    } else {
                        const armSwing = Math.sin(phase) * 0.8;
                        ctx.beginPath(); ctx.moveTo(charX, shoulderY);
                        ctx.lineTo(charX + Math.sin(armSwing) * armLen, shoulderY + Math.cos(armSwing) * 6);
                        ctx.stroke();
                        ctx.beginPath(); ctx.moveTo(charX, shoulderY);
                        ctx.lineTo(charX + Math.sin(-armSwing) * armLen, shoulderY + Math.cos(-armSwing) * 6);
                        ctx.stroke();
                    }

                    // Legs
                    const legLen = 8;
                    if (airborne) {
                        ctx.beginPath(); ctx.moveTo(charX, hipY);
                        ctx.lineTo(charX - 4, hipY + 5);
                        ctx.lineTo(charX - 2, hipY + legLen + 2); ctx.stroke();
                        ctx.beginPath(); ctx.moveTo(charX, hipY);
                        ctx.lineTo(charX + 4, hipY + 5);
                        ctx.lineTo(charX + 2, hipY + legLen + 2); ctx.stroke();
                    } else {
                        const legSwing = Math.sin(phase) * 0.9;
                        ctx.beginPath(); ctx.moveTo(charX, hipY);
                        ctx.lineTo(charX + Math.sin(-legSwing) * 6, hipY + Math.cos(-legSwing) * legLen);
                        ctx.stroke();
                        ctx.beginPath(); ctx.moveTo(charX, hipY);
                        ctx.lineTo(charX + Math.sin(legSwing) * 6, hipY + Math.cos(legSwing) * legLen);
                        ctx.stroke();
                    }

                    // Neon glow trail
                    ctx.globalAlpha = 0.3;
                    ctx.strokeStyle = '#ffaa00'; ctx.lineWidth = 1;
                    for (let trail = 1; trail <= 3; trail++) {
                        const tx = charX - trail * 4;
                        ctx.globalAlpha = 0.3 - trail * 0.08;
                        ctx.beginPath();
                        ctx.arc(tx, headY, headR - 1, 0, Math.PI * 2);
                        ctx.stroke();
                        ctx.beginPath(); ctx.moveTo(tx, neckY); ctx.lineTo(tx, hipY); ctx.stroke();
                    }
                    ctx.globalAlpha = 1;
                    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
                }

                rafId = requestAnimationFrame(drawFrame);
            };

            rafId = requestAnimationFrame(drawFrame);

            // Store cleanup handle (compatible with existing _closeChallengeTutorial)
            this._challengeTutorialSpine = {
                destroy() { cancelAnimationFrame(rafId); },
            };
        } else {
            ctx.fillStyle = "#2f3029";
            ctx.fillRect(0, 0, 150, 150);
            ctx.fillStyle = "#e2d8a6";
            ctx.font = "bold 50px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(meta.icon, 75, 75);
        }

        this.els.challengeTutorialOverlay.classList.add("active");
    }

    _closeChallengeTutorial() {
        if (this._challengeTutorialSpine) {
            this._challengeTutorialSpine.destroy();
            this._challengeTutorialSpine = null;
        }
        this.els.challengeTutorialOverlay.classList.remove("active");
    }

    // ── Main loop ──
    _loop(timestamp) {
        const dt = this.lastTime ? Math.min((timestamp - this.lastTime) / 1000, 0.1) : 0;
        this.lastTime = timestamp;

        if (this.state === State.PLAYING) {
            // Periodic auto-save every 5 seconds
            this._autoSaveTimer += dt;
            if (this._autoSaveTimer >= 5) {
                this._autoSaveTimer = 0;
                this._saveGameState();
            }

            // ── Combo timer countdown ──
            if (this.comboTimer > 0 && this.comboCount >= 2) {
                this.comboTimer -= dt;
                if (this.comboTimer <= 0) {
                    this.comboCount = 0;
                    this.comboTimer = 0;
                    gameStore.set({ comboCount: 0, comboActive: false, comboMultiplier: 1, comboTimer: 0 });
                } else {
                    gameStore.set({ comboTimer: this.comboTimer });
                }
            }

            if (this.timeLimitSeconds > 0) {
                // Pause the game clock while freeze bonus is active
                if (!this.freezeActive) {
                    this.timeRemainingSeconds = Math.max(0, this.timeRemainingSeconds - dt);
                }
                this._updateTimerDisplay();
                if (this.timeRemainingSeconds <= 0) {
                    this._gameOver("time");
                }
            }

            if (this.state !== State.PLAYING) {
                this.renderer.draw(this.grid, this.block, 0);
                requestAnimationFrame((t) => this._loop(t));
                return;
            }

            if (this.clearing) {
                this._processClearPhase(dt);
            } else if (this._shuffleAnimActive) {
                this._updateShuffleAnim(dt);
            } else if (this._wordPopupActive) {
                // Word popup is showing — freeze, don't fall or spawn
            } else if (this.freezeActive) {
                // Freeze bonus: count down timer, don't advance block falling
                this.freezeTimeRemaining -= dt;
                this.els.freezeTimer.textContent = Math.ceil(Math.max(0, this.freezeTimeRemaining));
                if (this.freezeTimeRemaining <= 0) {
                    this.freezeActive = false;
                    this.freezeTimeRemaining = 0;
                    this.els.freezeIndicator.classList.add("hidden");
                }
            } else if (this.rowDragActive) {
                // Row drag mode: freeze block falling while player selects a row
            } else if (this.block) {
                // Slow start perk countdown
                if (this._slowStartTimeLeft > 0) {
                    this._slowStartTimeLeft -= dt;
                    if (this._slowStartTimeLeft <= 0) {
                        this._slowStartTimeLeft = 0;
                        // Restore normal speed (recalculate based on current difficulty)
                        this.fallInterval = Math.max(0.25, this._baseFallInterval - (this._difficultyLevel - 1) * DIFFICULTY_SPEED_STEP);
                    }
                }
                if (this.spawnFreezeTimer > 0) {
                    // Block sits at top for 2s before falling
                    this.spawnFreezeTimer -= dt;
                    this.block.visualRow = this.block.row;
                } else if (this.block.dropAnimating) {
                    const swipeDropSpeed = 18;
                    this.block.visualRow += swipeDropSpeed * dt;
                    if (this.block.visualRow >= this.block.row) {
                        this.block.visualRow = this.block.row;
                        this.block.dropAnimating = false;
                        this._landBlock();
                    }
                } else {
                    this.fallTimer += dt;
                    if (this.fallTimer >= this.fallInterval) {
                        this.fallTimer -= this.fallInterval;
                        // Try to move block down
                        const nextRow = this.block.row + 1;
                        if (nextRow < 0) {
                            // Still in buffer zone, always move down
                            this.block.row = nextRow;
                        } else if (nextRow < this.gridSize && this.grid.isEmpty(nextRow, this.block.col)) {
                            this.block.row = nextRow;
                        } else if (this.block.row < 0) {
                            // Block is in buffer and column below is full — hover, don't land
                            // Game over only if every column is full and no validated words to claim
                            if (this.grid.isGridFull() && this._validatedWordGroups.length === 0) {
                                this._gameOver();
                            }
                            // Otherwise just stay hovering at current buffer row
                        } else {
                            // Block is inside the grid and can't move down — land it
                            this.block.visualRow = this.block.row;
                            this._landBlock();
                        }
                    }
                    // Smooth visual interpolation
                    if (this.block) {
                        const t = this.fallTimer / this.fallInterval;
                        this.block.visualRow = this.block.row - 1 + t;
                        // Clamp to top of buffer zone
                        if (this.block.visualRow < -BUFFER_ROWS) this.block.visualRow = -BUFFER_ROWS;
                        // Clamp: don't show below actual row
                        if (this.block.visualRow > this.block.row) this.block.visualRow = this.block.row;
                    }
                }
            }

            // Render
            if (this.grid) {
                this.renderer.draw(this.grid, this.block, dt);
                this._checkPlayBtnOverlaps();
            }

            // ── Matter.js physics particles overlay ──
            updatePhysics(dt);
        } else if (this.state === State.PAUSED) {
            // Still draw but don't update
            if (this.grid) {
                this.renderer.draw(this.grid, this.block, 0);
                this._checkPlayBtnOverlaps();
            }
        }

        if (!this._destroyed) requestAnimationFrame((t) => this._loop(t));
    }

    // ════════════════════════════════════════
    // AUTH SYSTEM
    // ════════════════════════════════════════

    _initStartScreen() {
        // In local mode (no Supabase), go straight to profiles
        // When Supabase is configured, check for existing session
        // Returns a promise so loading screen can wait for auth check
        this._authReady = import('./src/lib/supabase.js').then(async ({ isLocalMode, getSession, getUser, onAuthStateChange }) => {
            if (isLocalMode) {
                this._showScreen("profiles");
                return;
            }

            // Listen for PASSWORD_RECOVERY event from Supabase email link
            this._isPasswordRecovery = false;
            onAuthStateChange((event, session) => {
                if (event === 'PASSWORD_RECOVERY') {
                    this._isPasswordRecovery = true;
                    this._recoveryUser = session?.user || null;
                    this._showScreen("auth");
                    // Hide sign-in/sign-up, show reset password form
                    if (this.els.authSignin) this.els.authSignin.classList.add("hidden");
                    if (this.els.authSignup) this.els.authSignup.classList.add("hidden");
                    if (this.els.authResetPassword) this.els.authResetPassword.classList.remove("hidden");
                    if (this.els.authSubtitle) this.els.authSubtitle.textContent = "Reset your password";
                    this._clearAuthError();
                }
            });

            try {
                const session = await getSession();
                if (this._isPasswordRecovery) {
                    // PASSWORD_RECOVERY already fired — stay on reset form, don't navigate away
                } else if (session?.user) {
                    // Already authenticated — load profiles and go to profile select
                    await this._onAuthSuccess(session.user);
                    this._showScreen("profiles");
                } else {
                    this._showScreen("auth");
                }
            } catch (err) {
                console.error('[auth] session check failed:', err);
                this._showScreen("auth");
            }
        }).catch(() => {
            this._showScreen("profiles");
        });
        return this._authReady;
    }

    _bindAuth() {
        if (!this.els.authScreen) return;

        // Toggle between sign in / sign up
        this.els.authGotoSignup?.addEventListener("click", () => {
            this.els.authSignin.classList.add("hidden");
            this.els.authSignup.classList.remove("hidden");
            this.els.authSubtitle.textContent = "Create an account";
            this._clearAuthError();
        });
        this.els.authGotoSignin?.addEventListener("click", () => {
            this.els.authSignup.classList.add("hidden");
            this.els.authSignin.classList.remove("hidden");
            this.els.authSubtitle.textContent = "Sign in to play";
            this._clearAuthError();
            this._resetSignupSteps();
        });

        // Sign In
        this.els.authSigninBtn?.addEventListener("click", () => this._handleSignIn());
        this.els.authPassword?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") this._handleSignIn();
        });

        // Sign Up Step 1: Send verification code to email
        this.els.signupSendCodeBtn?.addEventListener("click", () => this._handleSignUpStep1());
        this.els.signupEmail?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") this._handleSignUpStep1();
        });

        // Sign Up Step 2: Code digit inputs
        this._bindCodeInputs();

        // Sign Up Step 2: Verify code button
        this.els.signupVerifyCodeBtn?.addEventListener("click", () => this._handleVerifyCode());

        // Sign Up Step 3: Create account with password
        this.els.signupCreateBtn?.addEventListener("click", () => this._handleSignUpStep3());
        this.els.signupPasswordConfirm?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") this._handleSignUpStep3();
        });

        // Resend verification
        this.els.signupResendBtn?.addEventListener("click", () => this._handleResendVerification());

        // Forgot password
        this.els.authForgotBtn?.addEventListener("click", () => this._handleForgotPassword());

        // Reset password (after clicking email link)
        this.els.resetPasswordBtn?.addEventListener("click", () => this._handleResetPassword());
        this.els.resetConfirmPassword?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") this._handleResetPassword();
        });

        // Logout
        this.els.authLogoutBtn?.addEventListener("click", async () => {
            try {
                const { unregisterPushToken } = await import('./src/lib/push-notifications.js');
                await unregisterPushToken();
            } catch (e) { /* ignore */ }
            try {
                const { signOut } = await import('./src/lib/supabase.js');
                await signOut();
            } catch (e) {
                console.error('[auth] logout error:', e);
            }
            this._unsubscribeProfileRealtime();
            this.profileMgr.profiles = [];
            this.profileMgr.activeId = null;
            this.profileMgr._save();
            this._authUser = null;
            localStorage.removeItem("wf_auth_user_id");
            this._showScreen("auth");
        });

        this.els.deleteAccountBtn?.addEventListener("click", async () => {
            if (!confirm("Are you sure you want to delete your account? This will permanently remove all your cloud data and cannot be undone.")) return;
            if (!confirm("This is irreversible. Type OK to confirm you want to delete your account.")) return;
            await this._deleteAccount();
        });
    }

    async _handleSignIn() {
        const email = this.els.authEmail?.value?.trim();
        const password = this.els.authPassword?.value;
        if (!email || !password) {
            this._showAuthError("Please enter your email and password.");
            return;
        }
        this._setAuthLoading(true);
        try {
            const { signIn } = await import('./src/lib/supabase.js');
            const result = await signIn(email, password);
            const user = result.session?.user || result.user;
            if (user) {
                await this._onAuthSuccess(user);
                this._showScreen("profiles");
            }
        } catch (err) {
            this._showAuthError(err.message || "Sign in failed. Please check your credentials.");
        } finally {
            this._setAuthLoading(false);
        }
    }

    async _handleSignUpStep1() {
        const email = this.els.signupEmail?.value?.trim();
        if (!email || !email.includes("@")) {
            this._showAuthError("Please enter a valid email address.");
            return;
        }
        this._setAuthLoading(true);
        try {
            this._signupEmail = email;
            const { generateVerificationCode } = await import('./src/lib/verification.js');
            const { sendVerificationCode } = await import('./src/lib/notifications.js');
            const code = generateVerificationCode(email);
            await sendVerificationCode(email, code);
            // Move to code entry step
            this.els.signupStepEmail.classList.add("hidden");
            this.els.signupStepVerify.classList.remove("hidden");
            this.els.signupEmailDisplay.textContent = email;
            this._clearAuthError();
            this._signupResendCooldown = 60;
            this._startCodeTimers();
            // Focus first digit
            const first = this.els.signupCodeInputs?.querySelector('.code-digit');
            if (first) setTimeout(() => first.focus(), 50);
        } catch (err) {
            this._showAuthError(err.message || "Could not send verification code.");
        } finally {
            this._setAuthLoading(false);
        }
    }

    _bindCodeInputs() {
        const container = this.els.signupCodeInputs;
        if (!container) return;
        const digits = container.querySelectorAll('.code-digit');

        digits.forEach((input, i) => {
            input.addEventListener("input", () => {
                const val = input.value.replace(/\D/g, '').slice(-1);
                input.value = val;
                if (val && i < 4) digits[i + 1]?.focus();
                this._updateVerifyBtnState();
                // Auto-submit when all 5 filled
                if (val && i === 4 && this._getCodeValue().length === 5) {
                    this._handleVerifyCode();
                }
            });
            input.addEventListener("keydown", (e) => {
                if (e.key === "Backspace" && !input.value && i > 0) {
                    digits[i - 1]?.focus();
                }
            });
            if (i === 0) {
                input.addEventListener("paste", (e) => {
                    e.preventDefault();
                    const pasted = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 5);
                    if (!pasted) return;
                    digits.forEach((d, j) => { d.value = pasted[j] || ''; });
                    const nextIdx = Math.min(pasted.length, 4);
                    digits[nextIdx]?.focus();
                    this._updateVerifyBtnState();
                    if (pasted.length === 5) this._handleVerifyCode();
                });
            }
        });
    }

    _getCodeValue() {
        const digits = this.els.signupCodeInputs?.querySelectorAll('.code-digit');
        if (!digits) return '';
        return Array.from(digits).map(d => d.value).join('');
    }

    _updateVerifyBtnState() {
        if (this.els.signupVerifyCodeBtn) {
            this.els.signupVerifyCodeBtn.disabled = this._getCodeValue().length < 5;
        }
    }

    _startCodeTimers() {
        // Clear any existing timers
        if (this._codeTimerId) clearInterval(this._codeTimerId);
        if (this._resendTimerId) clearInterval(this._resendTimerId);

        // Code expiry countdown
        this._codeTimerId = setInterval(async () => {
            const { getCodeTTL } = await import('./src/lib/verification.js');
            const ttl = getCodeTTL(this._signupEmail);
            if (this.els.signupCodeTimer) {
                if (ttl > 0) {
                    const m = Math.floor(ttl / 60);
                    const s = String(ttl % 60).padStart(2, '0');
                    this.els.signupCodeTimer.textContent = `Code expires in ${m}:${s}`;
                } else {
                    this.els.signupCodeTimer.textContent = 'Code expired. Request a new one.';
                    if (this.els.signupVerifyCodeBtn) this.els.signupVerifyCodeBtn.disabled = true;
                    clearInterval(this._codeTimerId);
                }
            }
        }, 1000);

        // Resend cooldown
        this._resendTimerId = setInterval(() => {
            if (this._signupResendCooldown > 0) {
                this._signupResendCooldown--;
                if (this.els.signupResendBtn) {
                    this.els.signupResendBtn.textContent = `Resend in ${this._signupResendCooldown}s`;
                    this.els.signupResendBtn.disabled = true;
                }
            } else {
                if (this.els.signupResendBtn) {
                    this.els.signupResendBtn.textContent = 'Resend Code';
                    this.els.signupResendBtn.disabled = false;
                }
                clearInterval(this._resendTimerId);
            }
        }, 1000);
    }

    _stopCodeTimers() {
        if (this._codeTimerId) { clearInterval(this._codeTimerId); this._codeTimerId = null; }
        if (this._resendTimerId) { clearInterval(this._resendTimerId); this._resendTimerId = null; }
    }

    async _handleVerifyCode() {
        const code = this._getCodeValue();
        if (code.length < 5) return;
        try {
            const { verifyCode } = await import('./src/lib/verification.js');
            const result = verifyCode(this._signupEmail, code);
            if (!result.valid) {
                this._showAuthError(result.error);
                return;
            }
            // Move to password step
            this._stopCodeTimers();
            this.els.signupStepVerify.classList.add("hidden");
            this.els.signupStepPassword.classList.remove("hidden");
            this._clearAuthError();
            this.els.signupPassword?.focus();
        } catch (err) {
            this._showAuthError(err.message || "Verification failed.");
        }
    }

    async _handleSignUpStep3() {
        const password = this.els.signupPassword?.value;
        const confirm = this.els.signupPasswordConfirm?.value;
        if (!password || password.length < 8) {
            this._showAuthError("Password must be at least 8 characters.");
            return;
        }
        if (password !== confirm) {
            this._showAuthError("Passwords don't match.");
            return;
        }
        this._setAuthLoading(true);
        try {
            const { signUp } = await import('./src/lib/supabase.js');
            const result = await signUp(this._signupEmail, password);
            // Supabase may auto-confirm since we already verified email client-side
            const user = result.session?.user || result.user;
            if (user) {
                await this._onAuthSuccess(user);
                this._showScreen("profiles");
                this._resetSignupSteps();
                return;
            }
            // If no session yet, try signing in (email already verified by code)
            const { signIn } = await import('./src/lib/supabase.js');
            const loginResult = await signIn(this._signupEmail, password);
            const loginUser = loginResult.session?.user || loginResult.user;
            if (loginUser) {
                await this._onAuthSuccess(loginUser);
                this._showScreen("profiles");
                this._resetSignupSteps();
            }
        } catch (err) {
            if (err.message?.toLowerCase().includes("already registered")) {
                this._showAuthError("This email is already registered. Try signing in instead.");
            } else {
                this._showAuthError(err.message || "Could not create account.");
            }
        } finally {
            this._setAuthLoading(false);
        }
    }

    async _handleResendVerification() {
        if (!this._signupEmail || this._signupResendCooldown > 0) return;
        this._setAuthLoading(true);
        try {
            const { generateVerificationCode } = await import('./src/lib/verification.js');
            const { sendVerificationCode } = await import('./src/lib/notifications.js');
            const code = generateVerificationCode(this._signupEmail);
            await sendVerificationCode(this._signupEmail, code);
            this._signupResendCooldown = 60;
            this._startCodeTimers();
            // Clear old digits
            this.els.signupCodeInputs?.querySelectorAll('.code-digit').forEach(d => { d.value = ''; });
            this._updateVerifyBtnState();
            const first = this.els.signupCodeInputs?.querySelector('.code-digit');
            if (first) first.focus();
            this._clearAuthError();
        } catch (err) {
            this._showAuthError(err.message || "Could not resend code.");
        } finally {
            this._setAuthLoading(false);
        }
    }

    async _handleForgotPassword() {
        const email = this.els.authEmail?.value?.trim();
        if (!email || !email.includes("@")) {
            this._showAuthError("Please enter your email address first, then tap Forgot password.");
            return;
        }
        this._setAuthLoading(true);
        try {
            const { resetPassword } = await import('./src/lib/supabase.js');
            await resetPassword(email);
            this._showAuthError("Password reset email sent! Check your inbox (and spam folder).");
        } catch (err) {
            this._showAuthError(err.message || "Failed to send reset email. Please try again.");
        } finally {
            this._setAuthLoading(false);
        }
    }

    async _handleResetPassword() {
        const pw = this.els.resetNewPassword?.value;
        const confirm = this.els.resetConfirmPassword?.value;
        if (!pw || pw.length < 8) {
            this._showAuthError("Password must be at least 8 characters.");
            return;
        }
        if (pw !== confirm) {
            this._showAuthError("Passwords do not match.");
            return;
        }
        this._setAuthLoading(true);
        try {
            const { updatePassword } = await import('./src/lib/supabase.js');
            await updatePassword(pw);
            // Clear the reset fields
            if (this.els.resetNewPassword) this.els.resetNewPassword.value = "";
            if (this.els.resetConfirmPassword) this.els.resetConfirmPassword.value = "";
            this._isPasswordRecovery = false;
            // User already has a valid session from the recovery link — go straight in
            const user = this._recoveryUser;
            if (user) {
                await this._onAuthSuccess(user);
                this._showScreen("profiles");
            } else {
                // Fallback: show sign-in form
                if (this.els.authResetPassword) this.els.authResetPassword.classList.add("hidden");
                if (this.els.authSignin) this.els.authSignin.classList.remove("hidden");
                if (this.els.authSubtitle) this.els.authSubtitle.textContent = "Sign in to play";
                this._showAuthError("Password updated! You can now sign in with your new password.");
            }
        } catch (err) {
            this._showAuthError(err.message || "Failed to update password. Please try again.");
        } finally {
            this._setAuthLoading(false);
        }
    }

    async _onAuthSuccess(user) {
        // If a different user logged in, clear local profiles from previous account
        const prevUserId = localStorage.getItem("wf_auth_user_id");
        if (prevUserId && prevUserId !== user.id) {
            this.profileMgr.profiles = [];
            this.profileMgr.activeId = null;
            this.profileMgr._save();
        }
        localStorage.setItem("wf_auth_user_id", user.id);

        this._authUser = user;
        this._initialSyncComplete = false; // Block cloud pushes until we've loaded cloud data
        // Load profiles from Supabase and sync with local ProfileManager
        try {
            const { getProfiles, getInventory, getChallengeStats, getWordSearchStats, getHighScores } = await import('./src/lib/supabase.js');
            const cloudProfiles = await getProfiles(user.id);
            // For each cloud profile, also fetch inventory, challenge stats, WS stats, and high scores
            for (const cp of cloudProfiles) {
                try {
                    const [inventory, challengeStats, wsStats, highScores] = await Promise.all([
                        getInventory(cp.id),
                        getChallengeStats(cp.id),
                        getWordSearchStats(cp.id),
                        getHighScores(cp.id),
                    ]);
                    cp._inventory = inventory;
                    cp._challengeStats = challengeStats;
                    cp._wsStats = wsStats;
                    cp._highScores = highScores;
                } catch (e) {
                    console.warn('[auth] failed to load extras for profile:', cp.id, e);
                }
            }
            this._syncCloudProfilesToLocal(cloudProfiles);
            this._initialSyncComplete = true; // Cloud data loaded, safe to push updates
            this._flushProgressRepairsToCloud();
            this._subscribeProfileRealtime();
            // Refresh challenge cards to show updated levels after sync
            this._refreshChallengeCards();
            // Load milestone timestamps after profiles are synced
            await this._loadMilestonesFromCloud();
            this._renderMilestonesPage();
            // Register for push notifications after successful auth (fire-and-forget, don't block auth)
            import('./src/lib/push-notifications.js')
                .then(({ registerPushNotifications }) => registerPushNotifications())
                .catch(e => console.warn('[push] registration skipped:', e));
        } catch (err) {
            console.error('[auth] failed to load cloud profiles:', err);
            this._initialSyncComplete = true; // Even on error, allow syncing (user may have new data)
        }
    }

    _syncCloudProfilesToLocal(cloudProfiles) {
        if (!cloudProfiles || cloudProfiles.length === 0) return;

        // Cloud is the source of truth when authenticated.
        // Build the new local profile list from cloud profiles only.
        const oldLocal = this.profileMgr.getAll();
        const cloudIds = new Set(cloudProfiles.map(cp => cp.id));

        for (const cloud of cloudProfiles) {
            // Check if a local profile is already linked to this cloud ID
            const linked = oldLocal.find(lp => lp.cloudId === cloud.id);
            if (linked) {
                this._mergeCloudIntoLocal(linked, cloud);
                continue;
            }

            // Check if a local profile matches by username (unlinked)
            const byName = oldLocal.find(lp => !lp.cloudId && lp.username === cloud.username);
            if (byName) {
                byName.cloudId = cloud.id;
                this._mergeCloudIntoLocal(byName, cloud);
                continue;
            }

            // No matching local profile — import from cloud
            const imported = this.profileMgr.create(cloud.username);
            imported.cloudId = cloud.id;
            this._mergeCloudIntoLocal(imported, cloud);
        }

        // Remove local-only profiles that don't exist in the cloud.
        // When authenticated, cloud is the authority on which profiles exist.
        const orphaned = this.profileMgr.profiles.filter(lp => lp.cloudId && !cloudIds.has(lp.cloudId));
        const unlinked = this.profileMgr.profiles.filter(lp => !lp.cloudId);
        if (orphaned.length > 0 || unlinked.length > 0) {
            const removed = [...orphaned, ...unlinked];
            this.profileMgr.profiles = this.profileMgr.profiles.filter(
                lp => !removed.includes(lp)
            );
            console.log(`[sync] Removed ${removed.length} local-only/orphaned profile(s):`,
                removed.map(p => p.username));
            // If active profile was removed, switch to first available
            if (this.profileMgr.activeId && !this.profileMgr.profiles.find(p => p.id === this.profileMgr.activeId)) {
                this.profileMgr.activeId = this.profileMgr.profiles[0]?.id || null;
            }
        }

        this.profileMgr._save();
        this._renderProfilesList();
    }

    /**
     * Load cloud profile data into the local profile cache.
     * Cloud is the SINGLE SOURCE OF TRUTH — local storage is just a cache.
     * Called on every login. No merging with local data.
     */
    _mergeCloudIntoLocal(local, cloud) {
        const localChallengeStats = local.challengeStats || {};

        // Core profile
        local.username = cloud.username;
        local.level = cloud.level || 1;
        local.xp = cloud.xp || 0;
        local.totalXp = cloud.total_xp || 0;
        local.highScore = cloud.high_score || 0;
        local.gamesPlayed = cloud.games_played || 0;
        local.totalWords = cloud.total_words || 0;
        local.totalCoinsEarned = cloud.total_coins_earned || 0;
        local.coins = cloud.coins ?? 0;

        // Preferences
        local.gridSize = cloud.preferred_grid_size || 5;
        local.difficulty = cloud.preferred_difficulty || 'casual';
        local.gameMode = cloud.preferred_game_mode || GAME_MODES.SANDBOX;

        // Cosmetics
        local.equipped = {
            gridTheme: cloud.equipped_theme || 'theme_default',
            blockStyle: cloud.equipped_block_style || 'block_default',
        };
        local.bonusSlotContents = cloud.bonus_slot_contents || [null, null, null];
        local.perks = cloud.perks || {};
        local.unlockedGrids = cloud.unlocked_grids || {};

        // Streak
        local.lastPlayDate = cloud.last_play_date || null;
        local.playStreak = cloud.play_streak || 0;

        // Milestones
        local.claimedMilestones = cloud.claimed_milestones || [];

        // Unique words
        local.uniqueWordsFound = cloud.unique_words_found || [];

        // Inventory
        local.inventory = cloud._inventory || [];

        // Per-dimension best scores (from profile_high_scores table)
        // Key scheme: `${gridSize}-${difficulty}-${gameMode}` for regular, `ch-${challengeType}` for challenges
        local.bestScores = {};
        if (cloud._highScores?.length) {
            for (const row of cloud._highScores) {
                const key = row.is_challenge && row.challenge_type
                    ? `ch-${row.challenge_type}`
                    : `${row.grid_size}-${row.difficulty}-${row.game_mode}`;
                // Keep the highest score if multiple rows map to the same key
                if (!local.bestScores[key] || row.high_score > local.bestScores[key]) {
                    local.bestScores[key] = row.high_score;
                }
            }
        }

        // Challenge stats (from profile_challenge_stats table)
        local.challengeStats = {};
        if (cloud._challengeStats?.length) {
            for (const cs of cloud._challengeStats) {
                const type = cs.challenge_type;
                local.challengeStats[type] = {
                    highScore: cs.high_score || 0,
                    gamesPlayed: cs.games_played || 0,
                    totalWords: cs.total_words || 0,
                    targetWordLevel: cs.target_word_level || 1,
                    uniqueWordsFound: cs.unique_words_found || [],
                };
                if (type === CHALLENGE_TYPES.WORD_SEARCH) {
                    local.challengeStats[type].wordSearchLevel = cs.target_word_level || 1;
                }
            }
        }

        // Preserve higher monotonic local challenge progression if the cloud write has not landed yet.
        // This avoids level regression after a refresh during in-flight syncs, then repairs the cloud copy.
        local._needsChallengeResync = [];
        for (const [type, prior] of Object.entries(localChallengeStats)) {
            if (!prior) continue;
            if (!local.challengeStats[type]) {
                local.challengeStats[type] = {
                    highScore: prior.highScore || 0,
                    gamesPlayed: prior.gamesPlayed || 0,
                    totalWords: prior.totalWords || 0,
                    targetWordLevel: prior.targetWordLevel || 1,
                    uniqueWordsFound: prior.uniqueWordsFound || [],
                };
                if (type === CHALLENGE_TYPES.WORD_SEARCH) {
                    local.challengeStats[type].wordSearchLevel = prior.wordSearchLevel || prior.targetWordLevel || 1;
                }
                local._needsChallengeResync.push(type);
                continue;
            }

            const merged = local.challengeStats[type];
            const localLevel = type === CHALLENGE_TYPES.WORD_SEARCH
                ? (prior.wordSearchLevel || prior.targetWordLevel || 1)
                : (prior.targetWordLevel || 1);
            const cloudLevel = type === CHALLENGE_TYPES.WORD_SEARCH
                ? (merged.wordSearchLevel || merged.targetWordLevel || 1)
                : (merged.targetWordLevel || 1);

            const before = JSON.stringify(merged);
            merged.highScore = Math.max(merged.highScore || 0, prior.highScore || 0);
            merged.gamesPlayed = Math.max(merged.gamesPlayed || 0, prior.gamesPlayed || 0);
            merged.totalWords = Math.max(merged.totalWords || 0, prior.totalWords || 0);
            merged.uniqueWordsFound = [...new Set([...(merged.uniqueWordsFound || []), ...(prior.uniqueWordsFound || [])])];

            if (type === CHALLENGE_TYPES.WORD_SEARCH) {
                merged.wordSearchLevel = Math.max(merged.wordSearchLevel || 1, localLevel);
                merged.targetWordLevel = Math.max(merged.targetWordLevel || 1, localLevel);
            } else {
                merged.targetWordLevel = Math.max(merged.targetWordLevel || 1, localLevel);
            }

            const after = JSON.stringify(merged);
            if (after !== before || localLevel > cloudLevel) {
                local._needsChallengeResync.push(type);
            }
        }

        // Word Search level fallback: profile_word_search_stats.highest_level_reached
        // is updated by database trigger on every game so it's the ground truth
        if (cloud._wsStats?.highest_level_reached) {
            if (!local.challengeStats[CHALLENGE_TYPES.WORD_SEARCH]) {
                local.challengeStats[CHALLENGE_TYPES.WORD_SEARCH] = {
                    highScore: 0, gamesPlayed: 0, totalWords: 0, uniqueWordsFound: [], wordSearchLevel: 1,
                };
            }
            const ls = local.challengeStats[CHALLENGE_TYPES.WORD_SEARCH];
            ls.wordSearchLevel = Math.max(ls.wordSearchLevel || 1, cloud._wsStats.highest_level_reached);
            ls.gamesPlayed = Math.max(ls.gamesPlayed || 0, cloud._wsStats.games_played || 0);
            ls.highScore = Math.max(ls.highScore || 0, cloud._wsStats.high_score || 0);
            ls.totalWords = Math.max(ls.totalWords || 0, cloud._wsStats.total_words_found || 0);
        }

        local._lastSyncedAt = new Date().toISOString();
    }

    _flushProgressRepairsToCloud() {
        for (const profile of this.profileMgr.getAll()) {
            if (!profile?.cloudId || !profile._needsChallengeResync?.length) continue;
            for (const challengeType of profile._needsChallengeResync) {
                this._syncSpecificChallengeStatsToCloud(profile, challengeType);
            }
            delete profile._needsChallengeResync;
        }
        this.profileMgr._save();
    }

    async _syncSpecificChallengeStatsToCloud(profile, challengeType) {
        // No-op: record_game() handles all challenge stat updates server-side.
    }

    _showAuthError(msg) {
        if (!this.els.authError) return;
        this.els.authError.textContent = msg;
        this.els.authError.classList.remove("hidden");
    }

    _clearAuthError() {
        if (!this.els.authError) return;
        this.els.authError.textContent = "";
        this.els.authError.classList.add("hidden");
    }

    _setAuthLoading(loading) {
        const btns = [this.els.authSigninBtn, this.els.signupSendCodeBtn, this.els.signupVerifyCodeBtn, this.els.signupCreateBtn];
        for (const btn of btns) {
            if (btn) btn.disabled = loading;
        }
    }

    _resetSignupSteps() {
        this._stopCodeTimers();
        this.els.signupStepEmail?.classList.remove("hidden");
        this.els.signupStepVerify?.classList.add("hidden");
        this.els.signupStepPassword?.classList.add("hidden");
        if (this.els.signupEmail) this.els.signupEmail.value = "";
        if (this.els.signupPassword) this.els.signupPassword.value = "";
        if (this.els.signupPasswordConfirm) this.els.signupPasswordConfirm.value = "";
        this.els.signupCodeInputs?.querySelectorAll('.code-digit').forEach(d => { d.value = ''; });
        this._updateVerifyBtnState();
        this._signupEmail = null;
        this._signupResendCooldown = 0;
    }

    // ════════════════════════════════════════
    // LEADERBOARD SYSTEM
    // ════════════════════════════════════════

    _bindLeaderboard() {
        // Main leaderboard button (on page 2 of home screen)
        this.els.leaderboardBtn?.addEventListener("click", () => {
            this._lbCurrentTab = "main";
            this._lbClassFilter = null;
            this._lbOffset = 0;
            this._showScreen("leaderboard");
        });

        // My Rank Card toggle (on page 2 of home screen — expand/collapse analysis)
        this.els.myRankCard?.addEventListener("click", () => {
            const statsEl = this.els.myRankStats;
            if (!statsEl) return;
            const isOpen = statsEl.classList.contains("open");
            statsEl.classList.toggle("open", !isOpen);
            statsEl.classList.toggle("hidden", false);
            this.els.myRankCard.classList.toggle("stats-open", !isOpen);
        });

        // Challenge-specific leaderboard buttons
        this.els.challengeLbBtns?.forEach(btn => {
            btn.addEventListener("click", () => {
                this._lbCurrentTab = btn.dataset.challenge;
                this._lbClassFilter = null;
                this._lbOffset = 0;
                this._showScreen("leaderboard");
            });
        });

        // Back button
        this.els.lbBackBtn?.addEventListener("click", () => {
            this._showScreen("menu");
            this._goToMenuPage(5); // Return to the rankings page
        });

        // Refresh button
        this.els.lbRefreshBtn?.addEventListener("click", () => {
            this._loadLeaderboard(true);
        });

        // My Stats toggle (personal stats dropdown)
        this.els.lbMyRank?.addEventListener("click", () => {
            const statsEl = this.els.lbMyStats;
            if (!statsEl) return;
            const isOpen = statsEl.classList.contains("open");
            statsEl.classList.toggle("open", !isOpen);
            statsEl.classList.toggle("hidden", false);
            this.els.lbMyRank.classList.toggle("stats-open", !isOpen);
        });

        // Tab switching
        this.els.lbTabs?.forEach(tab => {
            tab.addEventListener("click", () => {
                this._lbCurrentTab = tab.dataset.lb;
                this._lbOffset = 0;
                this._lbClassFilter = null;
                this.els.lbTabs.forEach(t => t.classList.toggle("active", t === tab));
                this.els.lbClassBtns?.forEach(b => b.classList.toggle("active", b.dataset.class === "all"));
                this._loadLeaderboard();
            });
        });

        // Class filter
        this.els.lbClassBtns?.forEach(btn => {
            btn.addEventListener("click", () => {
                this._lbClassFilter = btn.dataset.class === "all" ? null : btn.dataset.class;
                this._lbOffset = 0;
                this.els.lbClassBtns.forEach(b => b.classList.toggle("active", b === btn));
                this._loadLeaderboard();
            });
        });

        // Load more
        this.els.lbLoadMoreBtn?.addEventListener("click", () => {
            this._lbOffset += 50;
            this._loadLeaderboard(false, true);
        });

        // Swipeable tabs — swipe left/right on the leaderboard list to switch tabs
        this._bindLeaderboardSwipe();
    }

    _bindLeaderboardSwipe() {
        const swipeTarget = document.getElementById("leaderboard-screen");
        if (!swipeTarget) return;

        const tabOrder = ["main", "target-word", "speed-round", "word-category", "word-search", "word-runner"];
        let startX = 0;
        let startY = 0;
        let tracking = false;

        swipeTarget.addEventListener("touchstart", (e) => {
            if (e.touches.length !== 1) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            tracking = true;
        }, { passive: true });

        swipeTarget.addEventListener("touchend", (e) => {
            if (!tracking) return;
            tracking = false;
            const endX = e.changedTouches[0].clientX;
            const endY = e.changedTouches[0].clientY;
            const dx = endX - startX;
            const dy = endY - startY;

            // Must be primarily horizontal (|dx| > |dy|) and at least 50px
            if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.2) return;

            const currentTab = this._lbCurrentTab || "main";
            const idx = tabOrder.indexOf(currentTab);
            if (idx === -1) return;

            let newIdx;
            if (dx < 0) {
                // Swipe left → next tab
                newIdx = idx + 1;
            } else {
                // Swipe right → previous tab
                newIdx = idx - 1;
            }

            if (newIdx < 0 || newIdx >= tabOrder.length) return;

            const newTab = tabOrder[newIdx];
            this._lbCurrentTab = newTab;
            this._lbOffset = 0;
            this._lbClassFilter = null;
            this.els.lbTabs?.forEach(t => t.classList.toggle("active", t.dataset.lb === newTab));
            this.els.lbClassBtns?.forEach(b => b.classList.toggle("active", b.dataset.class === "all"));

            // Scroll the active tab into view
            const activeTab = document.querySelector(`.lb-tab[data-lb="${newTab}"]`);
            activeTab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });

            this._loadLeaderboard();
        }, { passive: true });
    }

    async _loadLeaderboard(forceRefresh = false, append = false) {
        const listEl = this.els.lbList;
        if (!listEl) return;

        // Sync tab highlight to current tab
        const currentTab = this._lbCurrentTab || "main";
        this.els.lbTabs?.forEach(t => t.classList.toggle("active", t.dataset.lb === currentTab));

        if (!append) {
            listEl.innerHTML = '<div class="lb-loading">Loading leaderboard...</div>';
        }

        try {
            const { isLocalMode } = await import('./src/lib/supabase.js');
            if (isLocalMode) {
                listEl.innerHTML = '<div class="lb-empty">Leaderboards require an online connection.<br>Sign in to see rankings!</div>';
                return;
            }

            const { fetchMainLeaderboard, fetchChallengeLeaderboard, fetchMyRank, fetchMyChallengeRank } = await import('./src/lib/leaderboard-service.js');

            let entries;
            const tab = this._lbCurrentTab || "main";

            if (tab === "main") {
                entries = await fetchMainLeaderboard({
                    limit: 50,
                    offset: this._lbOffset || 0,
                    classFilter: this._lbClassFilter || null,
                    forceRefresh,
                });
                this.els.lbTitle.textContent = "Leaderboards";
            } else {
                entries = await fetchChallengeLeaderboard(tab, {
                    limit: 50,
                    offset: this._lbOffset || 0,
                    classFilter: this._lbClassFilter || null,
                    forceRefresh,
                });
                const names = { 'target-word': 'Target Word', 'speed-round': 'Speed Round', 'word-category': 'Word Category', 'word-search': 'Word Search', 'word-runner': 'Word Runner' };
                this.els.lbTitle.textContent = names[tab] || "Leaderboard";
            }

            // Load my rank (main vs challenge-specific)
            const myRank = tab === "main"
                ? await fetchMyRank(forceRefresh)
                : await fetchMyChallengeRank(tab, forceRefresh);
            this._updateMyRankDisplay(myRank);

            // Render entries
            if (!append) listEl.innerHTML = "";

            if (entries.length === 0 && !append) {
                listEl.innerHTML = '<div class="lb-empty">No rankings yet. Play some games to get ranked!</div>';
                this.els.lbLoadMore?.classList.add("hidden");
                return;
            }

            for (const entry of entries) {
                listEl.appendChild(this._createLeaderboardEntry(entry));
            }

            // Show/hide load more
            this.els.lbLoadMore?.classList.toggle("hidden", entries.length < 50);

        } catch (err) {
            console.error('[leaderboard] load error:', err);
            if (!append) {
                listEl.innerHTML = '<div class="lb-empty">Could not load leaderboard. Try again later.</div>';
            }
        }
    }

    async _subscribeLeaderboardRealtime() {
        if (this._lbRealtimeChannel) return; // already subscribed
        try {
            const { supabase, isLocalMode } = await import('./src/lib/supabase.js');
            if (isLocalMode || !supabase) return;
            this._lbRealtimeChannel = supabase
                .channel('leaderboard-changes')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'leaderboard_rankings' }, () => {
                    // Reload leaderboard when any ranking changes
                    import('./src/lib/leaderboard-service.js').then(({ clearLeaderboardCache }) => {
                        clearLeaderboardCache();
                        this._loadLeaderboard(true);
                    });
                })
                .on('postgres_changes', { event: '*', schema: 'public', table: 'challenge_leaderboards' }, () => {
                    import('./src/lib/leaderboard-service.js').then(({ clearLeaderboardCache }) => {
                        clearLeaderboardCache();
                        this._loadLeaderboard(true);
                    });
                })
                .subscribe();
        } catch (e) {
            console.warn('[leaderboard] realtime subscription failed:', e);
        }
    }

    _unsubscribeLeaderboardRealtime() {
        if (this._lbRealtimeChannel) {
            import('./src/lib/supabase.js').then(({ supabase }) => {
                supabase?.removeChannel(this._lbRealtimeChannel);
                this._lbRealtimeChannel = null;
            }).catch(() => { this._lbRealtimeChannel = null; });
        }
    }

    async _subscribeProfileRealtime() {
        try {
            const profile = this.profileMgr.getActive();
            if (!this._authUser || !profile?.cloudId) {
                this._unsubscribeProfileRealtime();
                return;
            }

            // Recreate subscription if the active profile changed.
            if (this._profileRealtimeProfileId === profile.cloudId && this._profileRealtimeChannel) return;
            this._unsubscribeProfileRealtime();

            const { supabase, isLocalMode } = await import('./src/lib/supabase.js');
            if (isLocalMode || !supabase) return;

            this._profileRealtimeProfileId = profile.cloudId;
            this._profileRealtimeChannel = supabase
                .channel(`profile-live-${profile.cloudId}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'profiles',
                    filter: `id=eq.${profile.cloudId}`,
                }, (payload) => this._handleProfileRealtimeUpdate(payload))
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'profile_game_stats',
                    filter: `profile_id=eq.${profile.cloudId}`,
                }, (payload) => this._handleGameStatsRealtimeUpdate(payload))
                .subscribe();
        } catch (err) {
            console.warn('[realtime] profile subscription failed:', err);
        }
    }

    _unsubscribeProfileRealtime() {
        this._profileRealtimeProfileId = null;
        if (this._profileRealtimeChannel) {
            import('./src/lib/supabase.js').then(({ supabase }) => {
                supabase?.removeChannel(this._profileRealtimeChannel);
                this._profileRealtimeChannel = null;
            }).catch(() => { this._profileRealtimeChannel = null; });
        }
    }

    _handleProfileRealtimeUpdate(payload) {
        const row = payload?.new;
        if (!row) return;
        const p = this.profileMgr.getActive();
        if (!p || p.cloudId !== row.id) return;

        p.username = row.username;
        p.level = row.level || 1;
        p.xp = row.xp || 0;
        p.totalXp = row.total_xp || 0;
        // F5 fix: use Math.max to prevent profiles-table realtime events
        // from overwriting higher values synced from profile_game_stats
        p.highScore = Math.max(p.highScore || 0, row.high_score || 0);
        p.gamesPlayed = Math.max(p.gamesPlayed || 0, row.games_played || 0);
        p.totalWords = Math.max(p.totalWords || 0, row.total_words || 0);
        p.totalCoinsEarned = row.total_coins_earned || 0;
        p.coins = row.coins ?? 0;
        p.lastPlayDate = row.last_play_date || null;
        p.playStreak = row.play_streak || 0;
        p.claimedMilestones = row.claimed_milestones || [];
        p.uniqueWordsFound = row.unique_words_found || [];

        this.profileMgr._save();
        this.highScore = p.highScore || 0;
        this._updateHighScoreDisplay();
        this._updateMenuStats();
        this._updateLevelDisplay();
    }

    _handleGameStatsRealtimeUpdate(payload) {
        const row = payload?.new;
        if (!row) return;
        const p = this.profileMgr.getActive();
        if (!p) return;

        // Update overall stats from profile_game_stats
        if (row.games_played != null) p.gamesPlayed = Math.max(p.gamesPlayed || 0, row.games_played);
        if (row.high_score != null) p.highScore = Math.max(p.highScore || 0, row.high_score);
        if (row.total_words != null) p.totalWords = Math.max(p.totalWords || 0, row.total_words);

        this.profileMgr._save();
        this._updateHighScoreDisplay();
        this._updateMenuStats();
    }

    /**
     * Legacy handler kept for backward compatibility during migration transition.
     * Once profile_challenge_stats is fully archived, this is never called.
     */
    _handleChallengeRealtimeUpdate(payload) {
        const row = payload?.new;
        if (!row) return;
        const p = this.profileMgr.getActive();
        if (!p) return;

        if (!p.challengeStats) p.challengeStats = {};
        const type = row.challenge_type;
        const existing = p.challengeStats[type] || { highScore: 0, gamesPlayed: 0, totalWords: 0, uniqueWordsFound: [], targetWordLevel: 1 };

        existing.highScore = Math.max(existing.highScore || 0, row.high_score || 0);
        existing.gamesPlayed = Math.max(existing.gamesPlayed || 0, row.games_played || 0);
        existing.totalWords = Math.max(existing.totalWords || 0, row.total_words || 0);
        existing.targetWordLevel = Math.max(existing.targetWordLevel || 1, row.target_word_level || 1);
        existing.uniqueWordsFound = row.unique_words_found || existing.uniqueWordsFound || [];
        if (type === CHALLENGE_TYPES.WORD_SEARCH) {
            existing.wordSearchLevel = Math.max(existing.wordSearchLevel || 1, row.target_word_level || 1);
        }

        p.challengeStats[type] = existing;
        this.profileMgr._save();
        this._refreshChallengeCards();

        // Keep target-word HUD level in sync if that challenge is currently active.
        if (this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD && type === CHALLENGE_TYPES.TARGET_WORD) {
            this._targetWordLevel = existing.targetWordLevel || 1;
            this._updateTargetLevelDisplay();
        }
    }

    _createLeaderboardEntry(entry) {
        const div = document.createElement("div");
        div.className = "lb-entry";

        const classMap = { master: 'class-master', high: 'class-high', medium: 'class-medium', low: 'class-low' };
        const classLabels = { master: 'MASTER', high: 'HIGH', medium: 'MED', low: 'LOW' };
        const classCss = classMap[entry.skill_class] || 'class-low';
        const classLabel = classLabels[entry.skill_class] || 'LOW';

        let rankCss = '';
        if (entry.global_rank === 1) { rankCss = 'lb-rank-1'; div.classList.add('lb-top-1'); }
        else if (entry.global_rank === 2) { rankCss = 'lb-rank-2'; div.classList.add('lb-top-2'); }
        else if (entry.global_rank === 3) { rankCss = 'lb-rank-3'; div.classList.add('lb-top-3'); }

        const rating = (entry.skill_rating || 0).toFixed(1);
        const gamesCount = entry.games_played ? `${entry.games_played}g` : '';

        div.innerHTML = `
            <div class="lb-entry-row">
                <span class="lb-rank ${rankCss}">#${entry.global_rank}</span>
                <span class="lb-class-badge ${classCss}">${classLabel}</span>
                <span class="lb-username">${this._escapeHtml(entry.username)}</span>
                <span class="lb-games">${gamesCount}</span>
                <span class="lb-rating">${rating}</span>
                <span class="lb-entry-arrow">›</span>
            </div>
            <div class="lb-analysis">
                <div class="lb-analysis-inner">
                    <div class="lb-analysis-loading">Loading analysis...</div>
                </div>
            </div>
        `;

        // Click to expand/collapse analysis dropdown (JS-driven height for exact fit)
        const row = div.querySelector(".lb-entry-row");
        const analysisEl = div.querySelector(".lb-analysis");
        row.addEventListener("click", async () => {
            const wasExpanded = div.classList.contains("expanded");

            // Helper: collapse a single entry's analysis and destroy its chart
            const collapseEntry = (entryEl) => {
                const el = entryEl.querySelector(".lb-analysis");
                el.classList.remove("fully-open");
                // Snap to current height so transition has a start value
                el.style.maxHeight = el.scrollHeight + "px";
                // Force reflow then animate to 0
                el.offsetHeight; // eslint-disable-line no-unused-expressions
                el.style.maxHeight = "0";
                entryEl.classList.remove("expanded");
                // Destroy chart to free memory
                const canvas = el.querySelector('canvas');
                if (canvas?.id) {
                    import('./src/lib/chart-helpers.js').then(m => m.destroyChart(canvas.id)).catch(() => {});
                }
            };

            // Collapse all others
            div.closest(".lb-list")?.querySelectorAll(".lb-entry.expanded").forEach(e => {
                if (e !== div) collapseEntry(e);
            });

            if (wasExpanded) {
                collapseEntry(div);
            } else {
                div.classList.add("expanded");
                analysisEl.classList.remove("fully-open");
                analysisEl.style.maxHeight = analysisEl.scrollHeight + "px";

                // Load analysis if not already loaded
                const inner = div.querySelector(".lb-analysis-inner");
                if (inner.querySelector(".lb-analysis-loading")) {
                    try {
                        const { fetchPlayerAnalysis } = await import('./src/lib/leaderboard-service.js');
                        const currentTab = this._lbCurrentTab || "main";
                        const challengeType = currentTab !== "main" ? currentTab : null;
                        const html = await fetchPlayerAnalysis(entry, challengeType);
                        inner.innerHTML = '';

                        // Radar chart for main leaderboard entries
                        if (!challengeType && entry.raw_score_component != null) {
                            const chartWrap = document.createElement('div');
                            chartWrap.className = 'lb-entry-chart-wrap';
                            inner.appendChild(chartWrap);
                            try {
                                const { renderRadarInto } = await import('./src/lib/chart-helpers.js');
                                renderRadarInto(chartWrap, entry, {
                                    chartKey: `entry_radar_${entry.profile_id}`,
                                    skillClass: entry.skill_class,
                                    size: 180,
                                });
                            } catch { /* chart is optional enhancement */ }
                        }

                        // Challenge bar chart + score trend for challenge tabs
                        if (challengeType) {
                            try {
                                const { extractChallengeChartData, extractRecentScores } = await import('./src/lib/player-analysis.js');
                                const { renderBarInto, renderTrendInto } = await import('./src/lib/chart-helpers.js');
                                // Fetch full analysis data for charts
                                const { getChallengeAnalysisData } = await import('./src/lib/supabase.js');
                                const analysisData = await getChallengeAnalysisData(entry.profile_id, challengeType);
                                if (analysisData) {
                                    const chartData = extractChallengeChartData(analysisData);
                                    if (chartData) {
                                        const barWrap = document.createElement('div');
                                        barWrap.className = 'lb-entry-chart-wrap';
                                        inner.appendChild(barWrap);
                                        renderBarInto(barWrap, {
                                            ...chartData,
                                            chartKey: `entry_bar_${entry.profile_id}_${challengeType}`,
                                        });
                                    }
                                    const trendData = extractRecentScores(analysisData);
                                    if (trendData) {
                                        const trendWrap = document.createElement('div');
                                        trendWrap.className = 'lb-entry-trend-wrap';
                                        inner.appendChild(trendWrap);
                                        renderTrendInto(trendWrap, {
                                            ...trendData,
                                            chartKey: `entry_trend_${entry.profile_id}_${challengeType}`,
                                        });
                                    }
                                }
                            } catch { /* charts are optional */ }
                        }

                        // Analysis text
                        const textDiv = document.createElement('div');
                        textDiv.className = 'lb-entry-analysis-text';
                        textDiv.innerHTML = html || '<div class="lb-analysis-loading">No analysis available.</div>';
                        inner.appendChild(textDiv);
                    } catch {
                        inner.innerHTML = '<div class="lb-analysis-loading">Could not load analysis.</div>';
                    }
                    // Re-measure after content loaded
                    analysisEl.style.maxHeight = analysisEl.scrollHeight + "px";
                }

                // After transition ends, remove max-height cap so content is never clipped
                const onEnd = () => {
                    if (div.classList.contains("expanded")) {
                        analysisEl.classList.add("fully-open");
                    }
                    analysisEl.removeEventListener("transitionend", onEnd);
                };
                analysisEl.addEventListener("transitionend", onEnd);
            }
        });

        return div;
    }

    _updateMyRankDisplay(myRank) {
        // Update the rank card on the menu page 2
        if (myRank) {
            const classInfo = { master: { icon: '💎', label: 'Master Class' }, high: { icon: '👑', label: 'High Class' }, medium: { icon: '⚔️', label: 'Medium Class' }, low: { icon: '🛡️', label: 'Low Class' } };
            const info = classInfo[myRank.skill_class] || classInfo.low;

            if (this.els.myRankCard) {
                this.els.myRankCard.classList.remove("hidden");
                this.els.myRankIcon.textContent = info.icon;
                this.els.myRankClassLabel.textContent = info.label;
                this.els.myRankPosition.textContent = `#${myRank.global_rank}`;
                this.els.myRankRating.textContent = `Rating: ${(myRank.skill_rating || 0).toFixed(1)}`;
            }

            // Update the leaderboard screen mini rank bar
            if (this.els.lbMyRank) {
                this.els.lbMyRank.classList.remove("hidden");
                this.els.lbMyRankIcon.textContent = info.icon;
                this.els.lbMyRankClass.textContent = info.label;
                this.els.lbMyRankPos.textContent = `#${myRank.global_rank}`;
            }

            // Populate personal stats dropdown
            this._populateMyStats(myRank);
        } else {
            this.els.myRankCard?.classList.add("hidden");
            this.els.lbMyRank?.classList.add("hidden");
            this.els.lbMyStats?.classList.add("hidden");
        }
    }

    async _populateMyStats(myRank) {
        if (!myRank) return;

        // Store rank data for analysis loading
        this._myRankData = myRank;

        const currentTab = this._lbCurrentTab || 'main';
        const isChallenge = currentTab !== 'main';

        // Fetch ALL stats from the database — never use local profile for display
        let dbHighScore = 0;
        let dbGamesPlayed = 0;
        let dbTotalWords = 0;
        let dbLevel = 0;
        let dbStreak = 0;
        let challengeAnalysisData = null;
        let mainAnalysisData = null;

        try {
            // Resolve profile_id: prefer from rank RPC, fallback to local profile cloudId
            const profileId = myRank.profile_id || this.profileMgr.getActive()?.cloudId;

            if (isChallenge && profileId) {
                // Challenge tab: fetch challenge-specific stats from DB
                const { getChallengeAnalysisData } = await import('./src/lib/supabase.js');
                challengeAnalysisData = await getChallengeAnalysisData(profileId, currentTab);
                if (challengeAnalysisData) {
                    dbHighScore = challengeAnalysisData.high_score || 0;
                    dbGamesPlayed = challengeAnalysisData.games_played || 0;
                    dbTotalWords = challengeAnalysisData.total_words || 0;
                    dbLevel = challengeAnalysisData.level || 0;
                    dbStreak = 0;
                }
            }

            // Always fetch main analysis for the menu rank card + main tab
            if (profileId) {
                const { getPlayerAnalysisData } = await import('./src/lib/supabase.js');
                mainAnalysisData = await getPlayerAnalysisData(profileId);
                if (mainAnalysisData && !isChallenge) {
                    dbHighScore = mainAnalysisData.high_score || 0;
                    dbGamesPlayed = mainAnalysisData.games_played || 0;
                    dbTotalWords = mainAnalysisData.total_words || 0;
                    dbLevel = mainAnalysisData.level || 0;
                    dbStreak = mainAnalysisData.play_streak || 0;
                }
            }
        } catch (e) {
            console.warn('[leaderboard] stats fetch failed, using rank row:', e);
        }

        // Final fallback: rank row fields (still DB data, just less detailed)
        if (!dbGamesPlayed) dbGamesPlayed = myRank.games_played || 0;
        if (!dbHighScore) dbHighScore = myRank.high_score || 0;

        // Top stat cells (leaderboard screen — context-aware: main or challenge)
        if (this.els.lbsRating) this.els.lbsRating.textContent = (myRank.skill_rating || 0).toFixed(1);
        if (this.els.lbsHighScore) this.els.lbsHighScore.textContent = dbHighScore.toLocaleString();
        if (this.els.lbsGames) this.els.lbsGames.textContent = dbGamesPlayed.toLocaleString();
        if (this.els.lbsWords) this.els.lbsWords.textContent = dbTotalWords.toLocaleString();
        if (this.els.lbsLevel) this.els.lbsLevel.textContent = dbLevel || 1;
        if (this.els.lbsStreak) this.els.lbsStreak.textContent = isChallenge
            ? (challengeAnalysisData?.target_word_level ? `Lvl ${challengeAnalysisData.target_word_level}` : '—')
            : `${dbStreak}d`;

        // Top stat cells (menu rank card dropdown — always main stats from DB)
        const mHigh = mainAnalysisData?.high_score || 0;
        const mGames = mainAnalysisData?.games_played || 0;
        const mWords = mainAnalysisData?.total_words || 0;
        const mLevel = mainAnalysisData?.level || 1;
        const mStreak = mainAnalysisData?.play_streak || 0;
        if (this.els.mrsRating) this.els.mrsRating.textContent = (myRank.skill_rating || 0).toFixed(1);
        if (this.els.mrsHighScore) this.els.mrsHighScore.textContent = mHigh.toLocaleString();
        if (this.els.mrsGames) this.els.mrsGames.textContent = mGames.toLocaleString();
        if (this.els.mrsWords) this.els.mrsWords.textContent = mWords.toLocaleString();
        if (this.els.mrsLevel) this.els.mrsLevel.textContent = mLevel;
        if (this.els.mrsStreak) this.els.mrsStreak.textContent = `${mStreak}d`;

        // Component radar charts (replaces old horizontal bars)
        const container = this.els.lbsComponents;
        if (container) {
            try {
                const { renderRadarInto } = await import('./src/lib/chart-helpers.js');
                this._lbsRadarKey = renderRadarInto(container, myRank, {
                    chartKey: 'lbs_radar',
                    skillClass: myRank.skill_class,
                    size: 210,
                });
            } catch (e) {
                console.warn('[chart] radar render failed:', e);
                this._renderFallbackBars(container, myRank);
            }
        }

        // Menu rank card radar chart (same data)
        const mrsContainer = this.els.mrsComponents;
        if (mrsContainer) {
            try {
                const { renderRadarInto } = await import('./src/lib/chart-helpers.js');
                this._mrsRadarKey = renderRadarInto(mrsContainer, myRank, {
                    chartKey: 'mrs_radar',
                    skillClass: myRank.skill_class,
                    size: 190,
                });
            } catch (e) {
                console.warn('[chart] radar render failed:', e);
                this._renderFallbackBars(mrsContainer, myRank);
            }
        }

        // Load analysis text
        this._loadMyAnalysis(myRank);
    }

    async _loadMyAnalysis(myRank) {
        const targets = [
            this.els.lbsAnalysis,
            this.els.mrsAnalysis,
        ].filter(Boolean);
        if (targets.length === 0) return;
        for (const el of targets) {
            const inner = el.querySelector('.lb-analysis-inner');
            if (inner) inner.innerHTML = '<div class="lb-analysis-loading">Loading analysis...</div>';
        }
        try {
            const { fetchPlayerAnalysis } = await import('./src/lib/leaderboard-service.js');
            const currentTab = this._lbCurrentTab || 'main';
            const challengeType = currentTab !== 'main' ? currentTab : null;
            const html = await fetchPlayerAnalysis(myRank, challengeType);

            for (const el of targets) {
                const inner = el.querySelector('.lb-analysis-inner');
                if (!inner) continue;
                inner.innerHTML = '';

                // For challenge tabs, render charts above the analysis text
                if (challengeType) {
                    try {
                        const { extractChallengeChartData, extractRecentScores } = await import('./src/lib/player-analysis.js');
                        const { renderBarInto, renderTrendInto } = await import('./src/lib/chart-helpers.js');
                        const { getChallengeAnalysisData } = await import('./src/lib/supabase.js');
                        const analysisProfileId = myRank.profile_id || this.profileMgr.getActive()?.cloudId;
                        const analysisData = analysisProfileId ? await getChallengeAnalysisData(analysisProfileId, challengeType) : null;
                        if (analysisData) {
                            const chartData = extractChallengeChartData(analysisData);
                            if (chartData) {
                                const barWrap = document.createElement('div');
                                barWrap.className = 'lb-entry-chart-wrap';
                                inner.appendChild(barWrap);
                                const elId = el === this.els.lbsAnalysis ? 'lbs' : 'mrs';
                                renderBarInto(barWrap, {
                                    ...chartData,
                                    chartKey: `my_bar_${elId}_${challengeType}`,
                                });
                            }
                            const trendData = extractRecentScores(analysisData);
                            if (trendData) {
                                const trendWrap = document.createElement('div');
                                trendWrap.className = 'lb-entry-trend-wrap';
                                inner.appendChild(trendWrap);
                                const elId = el === this.els.lbsAnalysis ? 'lbs' : 'mrs';
                                renderTrendInto(trendWrap, {
                                    ...trendData,
                                    chartKey: `my_trend_${elId}_${challengeType}`,
                                });
                            }
                        }
                    } catch { /* charts are optional */ }
                }

                // Analysis text
                const textDiv = document.createElement('div');
                textDiv.className = 'lb-entry-analysis-text';
                textDiv.innerHTML = html || '<div class="lb-analysis-loading">No analysis available.</div>';
                inner.appendChild(textDiv);
            }
        } catch {
            for (const el of targets) {
                const inner = el.querySelector('.lb-analysis-inner');
                if (inner) inner.innerHTML = '<div class="lb-analysis-loading">Could not load analysis.</div>';
            }
        }
    }

    _renderFallbackBars(container, myRank) {
        const components = [
            { key: 'raw_score_component', label: 'Score' },
            { key: 'grid_mastery_component', label: 'Grids' },
            { key: 'difficulty_component', label: 'Difficulty' },
            { key: 'time_pressure_component', label: 'Speed' },
            { key: 'challenge_component', label: 'Challenge' },
            { key: 'consistency_component', label: 'Consistency' },
            { key: 'versatility_component', label: 'Versatility' },
            { key: 'progression_component', label: 'Growth' },
        ];
        container.innerHTML = '';
        for (const c of components) {
            const val = Math.round(myRank[c.key] || 0);
            const row = document.createElement('div');
            row.className = 'lb-stat-bar-row';
            row.innerHTML = `
                <span class="lb-stat-bar-label">${c.label}</span>
                <div class="lb-stat-bar-track"><div class="lb-stat-bar-fill" style="width:${val}%"></div></div>
                <span class="lb-stat-bar-val">${val}</span>
            `;
            container.appendChild(row);
        }
    }

    async _refreshMyRankOnMenu() {
        try {
            const { isLocalMode } = await import('./src/lib/supabase.js');
            if (isLocalMode || !this._authUser) return;
            const { fetchMyRank } = await import('./src/lib/leaderboard-service.js');
            const myRank = await fetchMyRank(true);
            this._updateMyRankDisplay(myRank);
        } catch (e) {
            console.warn('[leaderboard] rank refresh failed:', e.message || e);
        }
    }

    _escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    // ════════════════════════════════════════
    // SUPABASE GAME SCORE RECORDING
    // ════════════════════════════════════════

    async _recordGameToSupabase(scoreData) {
        try {
            const { isLocalMode, recordGame } = await import('./src/lib/supabase.js');
            if (isLocalMode) return;
            const profile = this.profileMgr.getActive();
            if (!profile || !profile.cloudId) {
                console.warn('[supabase] No active profile or cloudId — game not recorded');
                return;
            }

            // Ensure all integer fields are integers (PostgreSQL rejects floats for INT columns)
            const safeInt = v => v == null ? null : Math.round(v);

            const result = await recordGame({
                profileId: profile.cloudId,
                gameMode: scoreData.gameMode,
                isChallenge: scoreData.isChallenge || false,
                challengeType: scoreData.challengeType || null,
                categoryKey: scoreData.categoryKey || null,
                gridSize: safeInt(scoreData.gridSize),
                difficulty: scoreData.difficulty,
                timeLimitSeconds: safeInt(scoreData.timeLimitSeconds),
                score: safeInt(scoreData.score) ?? 0,
                wordsFound: safeInt(scoreData.wordsFound) ?? 0,
                longestWordLength: safeInt(scoreData.longestWordLength) ?? 0,
                bestCombo: safeInt(scoreData.bestCombo) ?? 0,
                targetWordsCompleted: safeInt(scoreData.targetWordsCompleted) ?? 0,
                bonusWordsCompleted: safeInt(scoreData.bonusWordsCompleted) ?? 0,
                timeRemainingSeconds: safeInt(scoreData.timeRemainingSeconds),
                xpEarned: safeInt(scoreData.xpEarned) ?? 0,
                coinsEarned: safeInt(scoreData.coinsEarned) ?? 0,
                gridFactor: scoreData.gridFactor ?? null,
                difficultyMultiplier: scoreData.difficultyMultiplier ?? null,
                modeMultiplier: scoreData.modeMultiplier ?? null,
                // Word Search specific fields
                wsPlacedWords: safeInt(scoreData.wsPlacedWords),
                wsLevel: safeInt(scoreData.wsLevel),
                wsIsPerfectClear: scoreData.wsIsPerfectClear || false,
                wsClearSeconds: scoreData.wsClearSeconds ?? null,
            });

            // Check if server reported failure
            if (result && result.success === false) {
                console.error('[supabase] record_game server error:', result.error);
                this._showSyncError('Game not saved: ' + (result.error || 'server error'));
            }

            // Sync local game count from server's authoritative value
            if (result && result.games_played && this.profileMgr) {
                const p = this.profileMgr.getActive();
                if (p && result.games_played > p.gamesPlayed) {
                    p.gamesPlayed = result.games_played;
                    this.profileMgr._save();
                }
            }

            // Clear leaderboard cache and refresh my rank display immediately
            // (record_game calls update_ranking_for_account internally)
            try {
                const { clearLeaderboardCache, fetchMyRank } = await import('./src/lib/leaderboard-service.js');
                clearLeaderboardCache();
                const myRank = await fetchMyRank(true);
                this._updateMyRankDisplay(myRank);
            } catch (e) {
                console.warn('[supabase] rank display refresh failed:', e);
            }
        } catch (err) {
            console.error('[supabase] Failed to record game score:', err);
            this._showSyncError('Game not saved: ' + (err.message || err));
        }
    }

    /** Show a non-blocking toast when cloud sync fails — tappable to dismiss */
    _showSyncError(msg) {
        const existing = document.querySelector('.sync-error-toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.className = 'sync-error-toast';
        toast.textContent = '⚠ ' + msg;
        toast.style.cssText = 'position:fixed;top:env(safe-area-inset-top,12px);left:50%;transform:translateX(-50%);background:#ff4444;color:#fff;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:600;z-index:99999;opacity:0;transition:opacity .3s;pointer-events:auto;cursor:pointer;max-width:90vw;word-break:break-word;text-align:center;';
        toast.addEventListener('click', () => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400); });
        document.body.appendChild(toast);
        requestAnimationFrame(() => toast.style.opacity = '1');
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400); }, 12000);
    }

    // ════════════════════════════════════════
    // WORD SEARCH CHALLENGE
    // ════════════════════════════════════════

    _bindWordSearch() {
        this.els.wsPauseBtn?.addEventListener("click", () => this._wsTogglePause());
        this.els.wsResumeBtn?.addEventListener("click", () => this._wsTogglePause());
        this.els.wsMusicBtn?.addEventListener("click", () => {
            if (this.els.wsPauseOverlay) this.els.wsPauseOverlay.classList.remove("active");
            this._musicBackTarget = "ws-pause";
            this._showScreen("music");
            this._renderMusicScreen();
        });
        this.els.wsQuitBtn?.addEventListener("click", () => {
            this._wsEndGame("save");
        });
        this.els.wsEndGameBtn?.addEventListener("click", () => {
            this._wsEndGame("endgame");
        });

        // Touch/mouse input on canvas
        const canvas = this.els.wsCanvas;
        if (!canvas) return;

        let selecting = false;
        let selectedCells = [];

        const getCellFromEvent = (e) => {
            if (!this._ws) return null;
            const rect = canvas.getBoundingClientRect();
            const touch = e.touches ? e.touches[0] : e;
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            const cellSize = this._ws.cellSize;
            const padding = this._ws.padding;
            const col = Math.floor((x - padding) / cellSize);
            const row = Math.floor((y - padding) / cellSize);
            const gs = this._ws.gridSize;
            if (row < 0 || row >= gs || col < 0 || col >= gs) return null;
            return { r: row, c: col };
        };

        // Prevent touch+mouse double-firing on mobile
        let lastTouchEnd = 0;

        const onStart = (e) => {
            if (!this._ws || this._ws.paused || this._ws.gameOver || this._ws.revealing) return;
            if (e.type === 'mousedown' && Date.now() - lastTouchEnd < 500) return;
            e.preventDefault();
            const cell = getCellFromEvent(e);
            if (!cell) return;
            selecting = true;
            selectedCells = [cell];
            this._ws.selecting = selectedCells;
            this._wsRender();
        };

        const onMove = (e) => {
            if (!selecting || !this._ws) return;
            if (e.type === 'mousemove' && Date.now() - lastTouchEnd < 500) return;
            e.preventDefault();
            const cell = getCellFromEvent(e);
            if (!cell) return;

            // Must form a straight line from first cell
            const first = selectedCells[0];
            const dr = Math.sign(cell.r - first.r);
            const dc = Math.sign(cell.c - first.c);
            if (dr === 0 && dc === 0) {
                selectedCells = [first];
            } else {
                // Rebuild line from first to current
                const newCells = [];
                let cr = first.r, cc = first.c;
                const gs = this._ws.gridSize;
                while (cr >= 0 && cr < gs && cc >= 0 && cc < gs) {
                    newCells.push({ r: cr, c: cc });
                    if (cr === cell.r && cc === cell.c) break;
                    // Check if we're moving towards the target
                    const nextR = cr + dr;
                    const nextC = cc + dc;
                    // Check we aren't going past the target
                    if ((dr > 0 && nextR > cell.r) || (dr < 0 && nextR < cell.r)) break;
                    if ((dc > 0 && nextC > cell.c) || (dc < 0 && nextC < cell.c)) break;
                    cr = nextR;
                    cc = nextC;
                }
                selectedCells = newCells;
            }
            this._ws.selecting = selectedCells;

            // ── Live swipe hint via trie-search ──
            // Show real-time feedback: is the current swipe a valid prefix or word?
            if (selectedCells.length >= 2 && this._ws.grid) {
                this._ws.swipeHint = getSwipeHint(
                    this._ws.grid, selectedCells, this._ws.allValidWords
                );
            } else {
                this._ws.swipeHint = null;
            }

            this._wsRender();
        };

        const onEnd = (e) => {
            if (!selecting || !this._ws) return;
            e.preventDefault();
            if (e.type === 'touchend' || e.type === 'touchcancel') lastTouchEnd = Date.now();
            selecting = false;

            // Validate selection against the board's known valid words
            // Use word search level's own minWordLen, NOT the main game's _getMinWordLength()
            const word = _wsValidateSelection(this._ws.grid, selectedCells, this._ws.allValidWords, this._ws.params.minWordLen || 3);
            if (word && !this._ws.foundWords.has(word)) {
                // Valid new word!
                this._wsWordFound(word, selectedCells);
            } else if (selectedCells.length >= 3) {
                // Invalid — flash red and shake
                this._wsFlashInvalid(selectedCells);
            }

            this._ws.selecting = null;
            this._ws.swipeHint = null;
            selectedCells = [];
            this._wsRender();
        };

        canvas.addEventListener("mousedown", onStart);
        canvas.addEventListener("mousemove", onMove);
        canvas.addEventListener("mouseup", onEnd);
        canvas.addEventListener("mouseleave", onEnd);
        canvas.addEventListener("touchstart", onStart, { passive: false });
        canvas.addEventListener("touchmove", onMove, { passive: false });
        canvas.addEventListener("touchend", onEnd, { passive: false });
        canvas.addEventListener("touchcancel", onEnd, { passive: false });
    }

    _wsStartGame() {
        // Clear any stale WS save when starting fresh
        this._clearGameState();

        const level = this.profileMgr.getWordSearchLevel();
        const params = _wsLevelParams(level);

        const words = _wsSelectWords(params);
        const { grid, placedWords } = _wsGenerateGrid(params.gridSize, words, params.allowedDirs);

        // Cross-validate with wordsearch-generator library
        const validation = crossValidateGrid(grid, words, params.gridSize);
        if (validation.confidence < 0.5) {
            console.warn(`[WS] Grid cross-validation low (${(validation.confidence * 100).toFixed(0)}%), disagreed:`, validation.disagreedWords);
        }

        // Build set of intentionally placed words (the completion target)
        const placedWordSet = new Set();
        for (const pw of placedWords) placedWordSet.add(pw.word);

        // Build set of all valid words on the board (placed + accidental) for validation
        // Scan ALL 8 directions — players can swipe any direction regardless of level
        const scanMinLen = params.minWordLen || 3;
        const allValidWords = new Set(placedWordSet);
        // Track cell positions for each valid word occurrence: word -> [{startR, startC, dr, dc, len}]
        const wordOccurrences = new Map();
        for (const pw of placedWords) {
            const dr = pw.dir[0], dc = pw.dir[1];
            const { r: sr, c: sc } = pw.cells[0];
            if (!wordOccurrences.has(pw.word)) wordOccurrences.set(pw.word, []);
            wordOccurrences.get(pw.word).push({ startR: sr, startC: sc, dr, dc, len: pw.word.length });
        }
        for (let r = 0; r < params.gridSize; r++) {
            for (let c = 0; c < params.gridSize; c++) {
                for (const [dr, dc] of WS_DIRECTIONS) {
                    for (let len = scanMinLen; len <= 7; len++) {
                        const endR = r + dr * (len - 1);
                        const endC = c + dc * (len - 1);
                        if (endR < 0 || endR >= params.gridSize || endC < 0 || endC >= params.gridSize) break;
                        let w = "";
                        for (let i = 0; i < len; i++) {
                            w += grid[r + dr * i][c + dc * i];
                        }
                        if (DICTIONARY.has(w)) {
                            allValidWords.add(w);
                            if (!wordOccurrences.has(w)) wordOccurrences.set(w, []);
                            wordOccurrences.get(w).push({ startR: r, startC: c, dr, dc, len });
                        }
                    }
                }
            }
        }

        // Remove "stacked" words: non-placed words whose cells are entirely
        // within a single placed word's footprint (e.g. EAT inside NEATS).
        // Only remove a word if ALL of its occurrences on the grid are embedded;
        // if any occurrence uses cells NOT belonging to one placed word, keep it.
        const placedCellSets = placedWords.map(pw => {
            const cs = new Set();
            for (const { r, c } of pw.cells) cs.add(`${r},${c}`);
            return cs;
        });
        const wordsToRemove = new Set();
        for (const [word, occs] of wordOccurrences) {
            if (placedWordSet.has(word)) continue;
            let allEmbedded = true;
            for (const occ of occs) {
                const occCells = [];
                for (let i = 0; i < occ.len; i++) {
                    occCells.push(`${occ.startR + occ.dr * i},${occ.startC + occ.dc * i}`);
                }
                let isEmbedded = false;
                for (const cs of placedCellSets) {
                    if (occCells.every(c => cs.has(c))) { isEmbedded = true; break; }
                }
                if (!isEmbedded) { allEmbedded = false; break; }
            }
            if (allEmbedded) wordsToRemove.add(word);
        }
        for (const w of wordsToRemove) allValidWords.delete(w);

        // Log accidental words for debugging
        const accidentalWords = [...allValidWords].filter(w => !placedWordSet.has(w));
        console.log(`[WS] Level ${level}: ${placedWordSet.size} placed words, ${accidentalWords.length} accidental words${accidentalWords.length ? ": " + accidentalWords.join(", ") : ""}`);
        // Words already added to history in _wsSelectWords() before grid generation

        this._ws = {
            level,
            params,
            grid,
            placedWords,
            placedWordSet,
            allValidWords,
            foundWords: new Set(),
            foundWordCells: [],  // [{word, cells}]
            score: 0,
            coins: 0,
            timeRemaining: WORD_SEARCH_TIME_LIMIT,
            paused: false,
            gameOver: false,
            selecting: null,
            invalidFlash: null, // {cells, timer}
            gridSize: params.gridSize,
            cellSize: 0,
            padding: 0,
            wordsFound: [], // [{word, pts}] for game over
        };

        this._showScreen("ws");
        this._wsUpdateMiniPlayer();

        // Delay canvas resize until layout is computed (screen must be visible first)
        requestAnimationFrame(() => {
            this._wsResizeCanvas();
            this._wsUpdateUI();
            this._wsRender();

            // Start game loop
            this._ws._lastTime = performance.now();
            this._ws._animId = requestAnimationFrame((t) => this._wsGameLoop(t));
        });
    }

    _wsResizeCanvas() {
        if (!this._ws) return;
        const canvas = this.els.wsCanvas;
        const container = this.els.wsGridContainer;
        if (!canvas || !container) return;

        const maxW = container.clientWidth;
        const maxH = container.clientHeight || window.innerHeight * 0.65;
        const availSize = Math.floor(Math.min(maxW, maxH));
        const padding = 2;
        const cellSize = Math.floor((availSize - padding * 2) / this._ws.gridSize);
        const totalSize = cellSize * this._ws.gridSize + padding * 2;

        canvas.width = totalSize * (window.devicePixelRatio || 1);
        canvas.height = totalSize * (window.devicePixelRatio || 1);
        canvas.style.width = totalSize + "px";
        canvas.style.height = totalSize + "px";

        this._ws.cellSize = cellSize;
        this._ws.padding = padding;
        this._ws.canvasSize = totalSize;
    }

    _wsGameLoop(now) {
        if (!this._ws || this._ws.gameOver) return;

        const dt = Math.min(0.1, (now - this._ws._lastTime) / 1000);
        this._ws._lastTime = now;

        if (!this._ws.paused) {
            // Countdown timer
            this._ws.timeRemaining -= dt;
            if (this._ws.timeRemaining <= 0) {
                this._ws.timeRemaining = 0;
                // Enter reveal phase — show unfound words before game over
                this._wsStartReveal();
                return;
            }

            // Update invalid flash
            if (this._ws.invalidFlash) {
                this._ws.invalidFlash.timer -= dt;
                if (this._ws.invalidFlash.timer <= 0) {
                    this._ws.invalidFlash = null;
                }
            }

            // Update timer display
            this.els.wsTimer.textContent = this._formatCountdownTime(this._ws.timeRemaining);
        }

        this._wsRender();
        this._ws._animId = requestAnimationFrame((t) => this._wsGameLoop(t));
    }

    _wsRender() {
        if (!this._ws) return;
        const canvas = this.els.wsCanvas;
        const ctx = canvas.getContext("2d");
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const { grid, gridSize, cellSize, padding, foundWordCells, selecting, invalidFlash } = this._ws;

        // Background
        ctx.fillStyle = "#2f3029";
        ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);

        // Draw found word highlights (green)
        for (const group of foundWordCells) {
            ctx.fillStyle = "rgba(100, 200, 100, 0.25)";
            for (const { r, c } of group.cells) {
                ctx.fillRect(padding + c * cellSize, padding + r * cellSize, cellSize, cellSize);
            }
        }

        // Draw revealed unfound words (yellow) during reveal phase
        if (this._ws.revealedWords) {
            for (const group of this._ws.revealedWords) {
                ctx.fillStyle = "rgba(255, 210, 60, 0.35)";
                for (const { r, c } of group.cells) {
                    ctx.fillRect(padding + c * cellSize, padding + r * cellSize, cellSize, cellSize);
                }
            }
        }

        // Draw current selection highlight (color-coded by trie hint)
        if (selecting && selecting.length > 0) {
            const hint = this._ws.swipeHint;
            let selColor = "rgba(226, 216, 166, 0.35)"; // default amber
            if (hint) {
                if (hint.isComplete) {
                    selColor = "rgba(100, 220, 100, 0.40)"; // green — valid word
                } else if (hint.couldBeValid) {
                    selColor = "rgba(226, 216, 166, 0.35)"; // amber — valid prefix
                } else {
                    selColor = "rgba(200, 100, 80, 0.30)"; // dim red — dead end
                }
            }
            ctx.fillStyle = selColor;
            for (const { r, c } of selecting) {
                ctx.fillRect(padding + c * cellSize, padding + r * cellSize, cellSize, cellSize);
            }
        }

        // Draw invalid flash (red)
        if (invalidFlash) {
            const alpha = Math.min(1, invalidFlash.timer * 3);
            ctx.fillStyle = `rgba(220, 50, 50, ${0.4 * alpha})`;
            for (const { r, c } of invalidFlash.cells) {
                ctx.fillRect(padding + c * cellSize, padding + r * cellSize, cellSize, cellSize);
            }
        }

        // Grid lines
        ctx.strokeStyle = "#4a493e";
        ctx.lineWidth = 0.5;
        for (let r = 0; r <= gridSize; r++) {
            ctx.beginPath();
            ctx.moveTo(padding, padding + r * cellSize);
            ctx.lineTo(padding + gridSize * cellSize, padding + r * cellSize);
            ctx.stroke();
        }
        for (let c = 0; c <= gridSize; c++) {
            ctx.beginPath();
            ctx.moveTo(padding + c * cellSize, padding);
            ctx.lineTo(padding + c * cellSize, padding + gridSize * cellSize);
            ctx.stroke();
        }

        // Letters
        const fontSize = Math.floor(cellSize * 0.55);
        ctx.font = `bold ${fontSize}px 'Segoe UI', sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        // Build set of found cells for styling
        const foundCellSet = new Set();
        for (const group of foundWordCells) {
            for (const { r, c } of group.cells) foundCellSet.add(`${r},${c}`);
        }
        // Build set of revealed cells for styling
        const revealedCellSet = new Set();
        if (this._ws.revealedWords) {
            for (const group of this._ws.revealedWords) {
                for (const { r, c } of group.cells) revealedCellSet.add(`${r},${c}`);
            }
        }

        for (let r = 0; r < gridSize; r++) {
            for (let c = 0; c < gridSize; c++) {
                const cx = padding + c * cellSize + cellSize / 2;
                const cy = padding + r * cellSize + cellSize / 2;
                const key = `${r},${c}`;

                if (foundCellSet.has(key)) {
                    ctx.fillStyle = "#80d080"; // green for found
                } else if (revealedCellSet.has(key)) {
                    ctx.fillStyle = "#ffd23c"; // yellow for revealed
                } else {
                    ctx.fillStyle = "#e2d8a6"; // default accent
                }
                ctx.fillText(grid[r][c], cx, cy);
            }
        }

        // Draw line through found words
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        for (const group of foundWordCells) {
            const cells = group.cells;
            if (cells.length < 2) continue;
            ctx.strokeStyle = "rgba(100, 200, 100, 0.6)";
            ctx.beginPath();
            const f = cells[0];
            ctx.moveTo(padding + f.c * cellSize + cellSize / 2, padding + f.r * cellSize + cellSize / 2);
            const l = cells[cells.length - 1];
            ctx.lineTo(padding + l.c * cellSize + cellSize / 2, padding + l.r * cellSize + cellSize / 2);
            ctx.stroke();
        }

        // Draw line through revealed unfound words (yellow)
        if (this._ws.revealedWords) {
            for (const group of this._ws.revealedWords) {
                const cells = group.cells;
                if (cells.length < 2) continue;
                ctx.strokeStyle = "rgba(255, 210, 60, 0.7)";
                ctx.beginPath();
                const f = cells[0];
                ctx.moveTo(padding + f.c * cellSize + cellSize / 2, padding + f.r * cellSize + cellSize / 2);
                const l = cells[cells.length - 1];
                ctx.lineTo(padding + l.c * cellSize + cellSize / 2, padding + l.r * cellSize + cellSize / 2);
                ctx.stroke();
            }
        }

        // Draw selection line
        if (selecting && selecting.length > 1) {
            ctx.strokeStyle = "rgba(226, 216, 166, 0.7)";
            ctx.lineWidth = 3;
            ctx.beginPath();
            const sf = selecting[0];
            ctx.moveTo(padding + sf.c * cellSize + cellSize / 2, padding + sf.r * cellSize + cellSize / 2);
            const sl = selecting[selecting.length - 1];
            ctx.lineTo(padding + sl.c * cellSize + cellSize / 2, padding + sl.r * cellSize + cellSize / 2);
            ctx.stroke();
        }
    }

    _wsWordFound(word, cells) {
        if (!this._ws) return;
        const isPlacedWord = this._ws.placedWordSet.has(word);
        const pts = _wsScoreWord(word, this._ws.level);
        const coins = _wsWordCoins(word);

        this._ws.foundWords.add(word);
        this._ws.foundWordCells.push({ word, cells: cells.map(c => ({ ...c })) });
        this._ws.score += pts;
        this._ws.coins += coins;
        this._ws.wordsFound.push({ word, pts });

        // Sound effect
        this.audio.clear(word.length);

        // Update UI
        this._wsUpdateUI();

        // Show word popup — mark bonus words
        this._wsShowPopup(word, pts, !isPlacedWord);

        // Check if all PLACED words have been found — early completion!
        const placedFound = [...this._ws.placedWordSet].filter(w => this._ws.foundWords.has(w)).length;
        if (placedFound >= this._ws.placedWordSet.size) {
            this._wsLevelComplete(true, true); // advanceLevel=true, earlyFinish=true
        }
    }

    _wsFlashInvalid(cells) {
        if (!this._ws) return;
        this._ws.invalidFlash = {
            cells: cells.map(c => ({ ...c })),
            timer: 0.5,
        };
        // Shake the grid container
        const container = this.els.wsGridContainer;
        if (container) {
            container.classList.add("ws-shake");
            setTimeout(() => container.classList.remove("ws-shake"), 400);
        }
        // Error sound
        this.audio.land(true);
    }

    _wsShowPopup(word, pts, isBonus = false) {
        const container = this.els.wsWordPopup;
        if (!container) return;
        const row = document.createElement("div");
        row.className = "ws-popup-row";
        const bonusTag = isBonus ? `<span class="ws-popup-bonus">BONUS</span>` : '';
        row.innerHTML = `<span class="ws-popup-word">${word}</span>${bonusTag}<span class="ws-popup-pts">+${pts}</span>`;
        container.appendChild(row);
        setTimeout(() => {
            row.classList.add("pop-out");
            setTimeout(() => row.remove(), 400);
        }, 1200);
    }

    _wsUpdateUI() {
        if (!this._ws) return;
        this.els.wsScore.textContent = this._ws.score;
        this.els.wsLevelNum.textContent = this._ws.level;
        this.els.wsCoins.textContent = this._ws.coins;
        this.els.wsWordsFoundCount.textContent = `Words Remaining: ${Math.max(0, this._ws.placedWordSet.size - [...this._ws.placedWordSet].filter(w => this._ws.foundWords.has(w)).length)}`;
        this.els.wsTimer.textContent = this._formatCountdownTime(this._ws.timeRemaining);

        // Update Level/XP bar
        const info = this.profileMgr.getLevelInfo();
        const pct = info.xpRequired > 0 ? Math.min(100, (info.xp / info.xpRequired) * 100) : 0;
        this.els.wsLevelText.textContent = `Lv. ${info.level}`;
        this.els.wsXpBarFill.style.width = pct + "%";
        this.els.wsXpText.textContent = `${info.xp} / ${info.xpRequired}`;
    }

    _wsUpdateMiniPlayer() {
        // Mini player removed — global music dropdown handles this now
        this._syncGlobalMusicPanel();
    }

    _wsTogglePause() {
        if (!this._ws) return;
        this._ws.paused = !this._ws.paused;
        this.els.wsPauseOverlay.classList.toggle("active", this._ws.paused);
    }

    /**
     * Reveal phase: when timer runs out, highlight unfound placed words
     * one by one with a staggered animation, then show "click to continue".
     */
    _wsStartReveal() {
        if (!this._ws) return;
        const ws = this._ws;

        // Stop the game loop
        ws.paused = true;
        if (ws._animId) cancelAnimationFrame(ws._animId);

        // Find unfound placed words
        const unfound = ws.placedWords.filter(pw => !ws.foundWords.has(pw.word));

        if (unfound.length === 0) {
            // All placed words were found — skip reveal, go to game over
            this._wsLevelComplete();
            return;
        }

        // Initialize reveal state
        ws.revealedWords = [];
        ws.revealing = true;

        // Update timer display to show 0:00
        this.els.wsTimer.textContent = "0:00";
        // Update words remaining
        this._wsUpdateUI();

        // Stagger reveal: one word every 600ms
        let revealIndex = 0;
        const revealNext = () => {
            if (revealIndex >= unfound.length || !this._ws) {
                // All words revealed — show "click to continue" prompt
                this._wsShowContinuePrompt();
                return;
            }

            const pw = unfound[revealIndex];
            ws.revealedWords.push({ word: pw.word, cells: pw.cells });
            revealIndex++;

            // Re-render to show the new highlight
            this._wsRender();

            // Play a subtle sound
            this.audio.land(false);

            setTimeout(revealNext, 600);
        };

        // Small pause before starting reveals
        setTimeout(revealNext, 400);
    }

    _wsShowContinuePrompt() {
        if (!this._ws) return;
        const wsScreen = this.els.wsScreen;

        // Create the "click to continue" banner at the bottom
        const banner = document.createElement("div");
        banner.className = "ws-continue-banner";
        banner.innerHTML = `<span>Tap to continue</span>`;
        wsScreen.appendChild(banner);

        // Animate in
        requestAnimationFrame(() => banner.classList.add("active"));

        // On click anywhere, remove banner and proceed to game over
        const handler = (e) => {
            e.preventDefault();
            wsScreen.removeEventListener("pointerdown", handler);
            banner.remove();
            this._ws.revealing = false;
            this._wsLevelComplete();
        };

        // Delay listener slightly to prevent accidental immediate taps
        setTimeout(() => {
            wsScreen.addEventListener("pointerdown", handler, { once: true });
        }, 300);
    }

    async _wsLevelComplete(advanceLevel = true, earlyFinish = false) {
        if (!this._ws || this._ws.gameOver) return;
        const ws = this._ws;
        const wordsFoundCount = ws.foundWords.size;
        const timeRemaining = Math.max(0, ws.timeRemaining);

        // Early finish bonus: reward remaining time as extra score & coins
        let timeBonusScore = 0;
        let timeBonusCoins = 0;
        if (earlyFinish && timeRemaining > 0) {
            // Flat 500 pt bonus + small time component (1 pt per second remaining, capped at 200)
            timeBonusScore = 500 + Math.min(200, Math.floor(timeRemaining));
            // Flat 5 coin bonus + 1 coin per 30 seconds remaining, capped at 150
            timeBonusCoins = Math.min(150, 5 + Math.floor(timeRemaining / 30));
            ws.score += timeBonusScore;
            ws.coins += timeBonusCoins;
        }

        // Clear saved state — level is done, no resume
        this._clearGameState();

        // Only advance level on natural completion (timer or all words found), not End Game
        if (advanceLevel && wordsFoundCount > 0) {
            this.profileMgr.advanceWordSearchLevel();
        }

        // Record this level's stats
        const wordEntries = ws.wordsFound.map(w => ({ word: w.word, length: w.word.length }));

        // Calculate XP
        const wasFirstGame = this.profileMgr.isFirstGameEver();
        const lvlInfo = this.profileMgr.getLevelInfo();
        const bsKey = this.profileMgr.bestScoreKey(
            ws.gridSize, "casual", GAME_MODES.SANDBOX,
            true, CHALLENGE_TYPES.WORD_SEARCH);
        const previousBest = this.profileMgr.getBestScore(bsKey);

        let xpEarned;
        if (wasFirstGame) {
            xpEarned = xpRequiredForLevel(1);
        } else {
            xpEarned = calculateGameXP({
                score: ws.score,
                wordsFound: wordEntries,
                gridSize: ws.gridSize,
                difficulty: "casual",
                gameMode: GAME_MODES.SANDBOX,
                isChallenge: true,
                challengeType: CHALLENGE_TYPES.WORD_SEARCH,
                previousBest,
                playerLevel: lvlInfo.level,
                timeLimitSeconds: WORD_SEARCH_TIME_LIMIT,
                timeRemainingSeconds: timeRemaining,
                targetWordsCompleted: wordsFoundCount,
                bonusWordsCompleted: 0,
                categoryKey: null,
                comboMax: 0,
            });
        }

        // Record to profile
        this.profileMgr.recordChallengeGame(CHALLENGE_TYPES.WORD_SEARCH, ws.score, wordEntries);
        this.profileMgr.updateBestScore(bsKey, ws.score);
        const xpResult = this.profileMgr.awardXP(xpEarned);

        // Calculate coins
        const gameCoins = calculateGameCoins({
            score: ws.score,
            wordsFound: wordEntries,
            isNewHighScore: ws.score > 0 && ws.score >= previousBest,
            isChallenge: true,
            challengeType: CHALLENGE_TYPES.WORD_SEARCH,
            comboMax: 0,
            playerLevel: lvlInfo.level,
            isFirstGameToday: false,
            playStreak: 0,
        });
        const totalCoins = ws.coins + gameCoins;
        let levelUpCoins = 0;
        if (xpResult.leveled) {
            for (let lv = xpResult.oldLevel + 1; lv <= xpResult.newLevel; lv++) {
                levelUpCoins += COIN_LEVEL_UP_BASE + lv * COIN_LEVEL_UP_PER_LEVEL;
            }
        }
        const finalCoins = totalCoins + levelUpCoins;
        this.profileMgr.addCoins(finalCoins);

        // Check milestones
        const wsNewMilestones = this.profileMgr.checkMilestones();
        if (wsNewMilestones.length > 0) this._syncMilestonesToCloud(wsNewMilestones);

        // Compute placed vs bonus words for analytics
        const placedWordsFound = [...ws.placedWordSet].filter(w => ws.foundWords.has(w)).length;
        const bonusWordsFound = wordsFoundCount - placedWordsFound;

        // Record to Supabase
        await this._recordGameToSupabase({
            gameMode: GAME_MODES.SANDBOX,
            isChallenge: true,
            challengeType: CHALLENGE_TYPES.WORD_SEARCH,
            categoryKey: null,
            gridSize: ws.gridSize,
            difficulty: "casual",
            timeLimitSeconds: WORD_SEARCH_TIME_LIMIT,
            score: ws.score,
            wordsFound: wordsFoundCount,
            longestWordLength: Math.max(0, ...ws.wordsFound.map(w => w.word.length)),
            bestCombo: 0,
            targetWordsCompleted: wordsFoundCount,
            bonusWordsCompleted: bonusWordsFound,
            timeRemainingSeconds: Math.round(timeRemaining),
            xpEarned,
            coinsEarned: finalCoins,
            gridFactor: ws.gridSize / 8,
            difficultyMultiplier: 1.0,
            modeMultiplier: 1.0,
            // Word Search specific fields for aggregate stats
            wsPlacedWords: ws.placedWordSet.size,
            wsLevel: this.profileMgr.getWordSearchLevel(),
            wsIsPerfectClear: earlyFinish,
            wsClearSeconds: earlyFinish ? (WORD_SEARCH_TIME_LIMIT - timeRemaining) : null,
        });
        await this._syncProfileToCloud();

        // Auto-advance to next level after a brief delay
        ws.gameOver = true;
        if (ws._animId) cancelAnimationFrame(ws._animId);

        // Show level complete overlay, then start next level
        this._wsShowLevelComplete(wordsFoundCount, ws.score, xpEarned, finalCoins, earlyFinish, timeBonusScore, timeBonusCoins, advanceLevel, xpResult);
    }

    _wsShowLevelComplete(wordsFound, score, xpEarned, coins, earlyFinish = false, timeBonusScore = 0, timeBonusCoins = 0, levelAdvanced = true, xpResult = null) {
        const overlay = document.createElement("div");
        overlay.className = "ws-level-complete-overlay";
        const currentLevel = this._ws ? this._ws.level : "?";
        const totalWords = this._ws ? this._ws.placedWordSet.size : wordsFound;
        const earlyBonusHtml = earlyFinish ? `
                    <div class="ws-early-bonus">🌟 All Words Found! 🌟</div>
                    <div>Time Bonus: <strong>+${timeBonusScore} pts, +${timeBonusCoins} coins</strong></div>
        ` : '';
        const title = levelAdvanced ? `Level ${currentLevel} Complete!` : `Game Over — Level ${currentLevel}`;
        const nextLevelBtn = levelAdvanced
            ? `<button class="primary-btn ws-next-level-btn">Next Level →</button>`
            : '';
        overlay.innerHTML = `
            <div class="ws-level-complete-card">
                <h2>${title}</h2>
                <div class="ws-level-stats">
                    ${earlyBonusHtml}
                    <div>Words Found: <strong>${wordsFound} / ${totalWords}</strong></div>
                    <div>Score: <strong>${score}</strong></div>
                    <div>XP Earned: <strong>+${xpEarned}</strong></div>
                    <div>Coins: <strong>+${coins}</strong></div>
                </div>
                ${nextLevelBtn}
                <button class="secondary-btn ws-quit-to-challenges-btn">Back to Challenges</button>
            </div>
        `;

        const wsScreen = this.els.wsScreen;
        wsScreen.appendChild(overlay);

        // Prevent phantom clicks from the touch event that triggered completion
        const card = overlay.querySelector(".ws-level-complete-card");
        if (card) card.style.pointerEvents = "none";
        setTimeout(() => {
            if (card) card.style.pointerEvents = "";
        }, 600);

        // Show level-up popup if player leveled up
        if (xpResult && xpResult.leveled) {
            setTimeout(() => {
                this._showLevelUpPopup(xpResult.newLevel, xpResult.newXp, xpResult.newXpReq);
            }, 800);
        }

        const nextBtn = overlay.querySelector(".ws-next-level-btn");
        if (nextBtn) {
            nextBtn.addEventListener("click", () => {
                overlay.remove();
                this._ws = null;
                this.activeChallenge = CHALLENGE_TYPES.WORD_SEARCH;
                this._wsStartGame();
            });
        }

        overlay.querySelector(".ws-quit-to-challenges-btn").addEventListener("click", () => {
            overlay.remove();
            this._ws = null;
            this._openChallengeSetup(CHALLENGE_TYPES.WORD_SEARCH);
        });
    }

    _wsSaveState() {
        const key = this._saveKey();
        if (!key || !this._ws || this._ws.gameOver) return;
        const ws = this._ws;
        const state = {
            version: 2,
            type: "word-search",
            level: ws.level,
            gridSize: ws.gridSize,
            grid: ws.grid,
            placedWords: ws.placedWords,
            placedWordSet: Array.from(ws.placedWordSet),
            allValidWords: Array.from(ws.allValidWords),
            foundWords: Array.from(ws.foundWords),
            foundWordCells: ws.foundWordCells,
            score: ws.score,
            coins: ws.coins,
            timeRemaining: ws.timeRemaining,
            wordsFound: ws.wordsFound,
        };
        localStorage.setItem(key, JSON.stringify(state));
    }

    _wsResumeFromSave(saved) {
        const level = saved.level;
        const params = _wsLevelParams(level);
        const grid = saved.grid;
        const gridSize = saved.gridSize || params.gridSize;

        // Rebuild allValidWords by scanning ALL 8 directions (not from save)
        const placedWordSet = new Set(saved.placedWordSet || saved.placedWords.map(pw => pw.word));
        const scanMinLen = params.minWordLen || 3;
        const allValidWords = new Set(placedWordSet);
        const wordOccs = new Map();
        for (const pw of (saved.placedWords || [])) {
            const dr = pw.dir[0], dc = pw.dir[1];
            const { r: sr, c: sc } = pw.cells[0];
            if (!wordOccs.has(pw.word)) wordOccs.set(pw.word, []);
            wordOccs.get(pw.word).push({ startR: sr, startC: sc, dr, dc, len: pw.word.length });
        }
        for (let r = 0; r < gridSize; r++) {
            for (let c = 0; c < gridSize; c++) {
                for (const [dr, dc] of WS_DIRECTIONS) {
                    for (let len = scanMinLen; len <= 7; len++) {
                        const endR = r + dr * (len - 1);
                        const endC = c + dc * (len - 1);
                        if (endR < 0 || endR >= gridSize || endC < 0 || endC >= gridSize) break;
                        let w = "";
                        for (let i = 0; i < len; i++) {
                            w += grid[r + dr * i][c + dc * i];
                        }
                        if (DICTIONARY.has(w)) {
                            allValidWords.add(w);
                            if (!wordOccs.has(w)) wordOccs.set(w, []);
                            wordOccs.get(w).push({ startR: r, startC: c, dr, dc, len });
                        }
                    }
                }
            }
        }

        // Remove stacked sub-words embedded within placed words (cell-subset approach)
        const placedCellSets = (saved.placedWords || []).map(pw => {
            const cs = new Set();
            for (const { r, c } of pw.cells) cs.add(`${r},${c}`);
            return cs;
        });
        const wordsToRemove = new Set();
        for (const [word, occs] of wordOccs) {
            if (placedWordSet.has(word)) continue;
            let allEmbedded = true;
            for (const occ of occs) {
                const occCells = [];
                for (let i = 0; i < occ.len; i++) {
                    occCells.push(`${occ.startR + occ.dr * i},${occ.startC + occ.dc * i}`);
                }
                let isEmbedded = false;
                for (const cs of placedCellSets) {
                    if (occCells.every(c => cs.has(c))) { isEmbedded = true; break; }
                }
                if (!isEmbedded) { allEmbedded = false; break; }
            }
            if (allEmbedded) wordsToRemove.add(word);
        }
        for (const w of wordsToRemove) allValidWords.delete(w);

        this._ws = {
            level,
            params,
            grid,
            placedWords: saved.placedWords,
            placedWordSet,
            allValidWords,
            foundWords: new Set(saved.foundWords),
            foundWordCells: saved.foundWordCells || [],
            score: saved.score || 0,
            coins: saved.coins || 0,
            timeRemaining: saved.timeRemaining || WORD_SEARCH_TIME_LIMIT,
            paused: false,
            gameOver: false,
            selecting: null,
            invalidFlash: null,
            gridSize: saved.gridSize || params.gridSize,
            cellSize: 0,
            padding: 0,
            wordsFound: saved.wordsFound || [],
        };

        this._showScreen("ws");
        this._wsUpdateMiniPlayer();

        requestAnimationFrame(() => {
            this._wsResizeCanvas();
            this._wsUpdateUI();
            this._wsRender();
            this._ws._lastTime = performance.now();
            this._ws._animId = requestAnimationFrame((t) => this._wsGameLoop(t));
        });
    }

    _wsEndGame(reason = "save") {
        if (!this._ws) return;
        const ws = this._ws;

        // Close pause if open
        this.els.wsPauseOverlay.classList.remove("active");

        if (reason === "endgame") {
            // Clear saved state — game is ending, no resume
            this._clearGameState();
            // Stop game loop first, then run scoring without level advancement
            if (ws._animId) cancelAnimationFrame(ws._animId);
            this._wsLevelComplete(false); // false = don't advance level
            return;
        }

        // Save & Quit: save WS state, stop game loop, return to setup
        this._wsSaveState();
        if (ws._animId) cancelAnimationFrame(ws._animId);

        this._ws = null;
        this._openChallengeSetup(CHALLENGE_TYPES.WORD_SEARCH);
    }

    // ════════════════════════════════════════════════════════
    // WORD RUNNER CHALLENGE – Phaser 3 powered platformer
    // ════════════════════════════════════════════════════════

    _bindWordRunner() {
        this.els.wrPauseBtn?.addEventListener("click", () => this._wrTogglePause());
        this.els.wrValidateBtn?.addEventListener("click", () => this._wrValidateWord());
        this.els.wrResumeBtn?.addEventListener("click", () => this._wrTogglePause());
        this.els.wrWordsFoundBtn?.addEventListener("click", () => {
            this.els.wrPauseOverlay.classList.remove("active");
            // Set wordsFound from current WR Phaser scene state
            const scene = this._wrGame?.getScene();
            if (scene) {
                this.wordsFound = scene.wordsFormed || [];
                this._wordsFoundData = scene.wordsFormed || [];
            }
            this._openWordsFound("wr-pause");
        });
        this.els.wrMusicBtn?.addEventListener("click", () => {
            this.els.wrPauseOverlay.classList.remove("active");
            this._musicBackTarget = "wr-pause";
            this._showScreen("music");
            this._renderMusicScreen();
        });
        this.els.wrShopBtn?.addEventListener("click", () => {
            this.els.wrPauseOverlay.classList.remove("active");
            this._shopBackTarget = "wr-pause";
            this._shopCurrentTab = "grid_themes";
            this._showScreen("shop");
        });
        this.els.wrEndGameBtn?.addEventListener("click", () => {
            this._wrEndGame("endgame");
        });
        this.els.wrSaveQuitBtn?.addEventListener("click", () => {
            this._wrEndGame("save");
        });

        // NOTE: Jump input is handled by Phaser's own input system.
    }

    /** Create a Phaser-backed WordRunnerGame with the given callbacks. */
    _wrCreatePhaserGame(savedState) {
        const container = this.els.wrCanvasContainer;
        if (!container) return;

        // Hide the raw canvas — Phaser creates its own
        if (this.els.wrCanvas) this.els.wrCanvas.style.display = "none";

        const self = this;

        this._wrGame = new WordRunnerGame(container, {
            highScore: this._wr.highScore,
            randomLetterFn: () => this._wrRandomLetter(),
            dictionaryRef: DICTIONARY,
            audioRef: this.audio,
            letterValuesRef: typeof LETTER_VALUES !== "undefined" ? LETTER_VALUES : {},
            coinsForWordFn: coinsForWordRunner,
            callbacks: {
                onLetterCollected(letters) {
                    self._wrUpdateBoxes(letters);
                    if (letters.length >= 3) {
                        const boxes = self.els.wrWordBoxes?.querySelectorAll(".wr-box");
                        boxes?.forEach((b, i) => {
                            if (i < letters.length) b.classList.add("complete-glow");
                        });
                    }
                },
                onStateUpdate(state) {
                    if (self._wr) {
                        self._wr.score = state.score;
                        self._wr.coins = state.coins || 0;
                        self._wr.highScore = state.highScore;
                    }
                    self._wrUpdateUI(state);
                },
                onPause() {
                    self.els.wrPauseOverlay?.classList.add("active");
                },
                onGameOver(result) {
                    if (self._wr) {
                        self._wr.wordsFormed = result.wordsFormed;
                        self._wr.coins = result.coins;
                        self._wr.score = result.score;
                        self._wr.wordStreak = result.wordStreak;
                        self._wr.maxWordStreak = result.maxWordStreak;
                        self._wr.distance = result.distance;
                    }
                    self._wrShowGameOver();
                },
                onResumed(collectedLetters) {
                    self._wrBuildBoxes();
                    self._wrUpdateBoxes(collectedLetters);
                },
            },
        });

        this._wrGame.start(savedState);
    }

    _wrStartGame() {
        // Clear any stale WR save when starting fresh
        this._clearGameState();

        // Lightweight _wr tracking object for compatibility with
        // game-over, save, and other shared systems
        this._wr = {
            wordsFormed: [],
            coins: 0,
            score: 0,
            wordStreak: 0,
            maxWordStreak: 0,
            distance: 0,
            highScore: this.profileMgr.getChallengeStats(CHALLENGE_TYPES.WORD_RUNNER).highScore || 0,
        };

        this._showScreen("wr");
        this._wrUpdateMiniPlayer();

        requestAnimationFrame(() => {
            this._wrCreatePhaserGame(null);
            this._wrBuildBoxes();
            this._wrUpdateUI({ score: 0, distance: 0, coins: 0, highScore: this._wr.highScore });
        });
    }

    _wrResizeCanvas() {
        if (this._wrGame && this.els.wrCanvasContainer) {
            const c = this.els.wrCanvasContainer;
            const w = Math.floor(c.clientWidth);
            const h = Math.floor(c.clientHeight || window.innerHeight * 0.45);
            this._wrGame.resize(w, h);
        }
    }

    _wrSaveState() {
        const key = this._saveKey(CHALLENGE_TYPES.WORD_RUNNER);
        if (!key) return;

        // Try to get full scene state from Phaser (includes world geometry)
        let sceneState = null;
        try {
            sceneState = this._wrGame ? this._wrGame.getState() : null;
        } catch (e) {
            console.warn("[WR] getState() failed, using fallback:", e);
        }

        if (sceneState) {
            localStorage.setItem(key, JSON.stringify(sceneState));
            return;
        }

        // Fallback: build save from _wr tracking object + any scene data we can grab
        const scene = this._wrGame?.getScene?.();
        const wr = this._wr;
        if (!wr) return;

        const state = {
            version: 2,
            type: "word-runner",
            score: wr.score || 0,
            coins: wr.coins || 0,
            wordsFormed: wr.wordsFormed || [],
            wordStreak: wr.wordStreak || 0,
            maxWordStreak: wr.maxWordStreak || 0,
            distance: wr.distance || 0,
            collectedLetters: scene?.collectedLetters || [],
            highScore: wr.highScore || 0,
            scrollSpeed: scene?.scrollSpeed || 200,
            nextSpawnX: scene?.nextSpawnX || 0,
            groundSegments: [],
            platforms: [],
            rocks: [],
            letters: [],
        };
        localStorage.setItem(key, JSON.stringify(state));
    }

    _wrResumeFromSave(saved) {
        this._wr = {
            wordsFormed: saved.wordsFormed || [],
            coins: saved.coins || 0,
            score: saved.score || 0,
            wordStreak: saved.wordStreak || 0,
            maxWordStreak: saved.maxWordStreak || 0,
            distance: saved.distance || 0,
            highScore: this.profileMgr.getChallengeStats(CHALLENGE_TYPES.WORD_RUNNER).highScore || 0,
        };

        this._showScreen("wr");
        this._wrUpdateMiniPlayer();

        requestAnimationFrame(() => {
            this._wrCreatePhaserGame(saved);
            this._wrBuildBoxes();
            this._wrUpdateBoxes(saved.collectedLetters || []);
            this._wrUpdateUI({
                score: saved.score || 0,
                distance: saved.distance || 0,
                coins: saved.coins || 0,
                highScore: this._wr.highScore,
            });
        });
    }

    _wrBuildBoxes() {
        const container = this.els.wrWordBoxes;
        if (!container) return;
        container.innerHTML = "";
        for (let i = 0; i < 8; i++) {
            const box = document.createElement("div");
            box.className = "wr-box";
            box.dataset.idx = i;
            box.addEventListener("pointerdown", (e) => {
                e.stopPropagation();
                this._wrValidateWord();
            });
            container.appendChild(box);
        }
    }

    _wrUpdateBoxes(letters) {
        const boxes = this.els.wrWordBoxes?.querySelectorAll(".wr-box");
        if (!boxes) return;
        const arr = letters || (this._wrGame ? this._wrGame.getCollectedLetters() : []);
        boxes.forEach((box, i) => {
            const letter = arr[i] || "";
            box.textContent = letter;
            box.classList.toggle("filled", !!letter);
            if (!letter) box.classList.remove("complete-glow");
        });
    }

    _wrValidateWord() {
        if (!this._wrGame) return;
        const result = this._wrGame.validateWord();
        if (result) {
            // Word was valid — flash matched boxes, then update
            const boxes = this.els.wrWordBoxes?.querySelectorAll(".wr-box");
            const start = result.startIndex || 0;
            boxes?.forEach((b, i) => {
                if (i >= start && i < start + result.word.length) {
                    b.classList.add("valid-flash");
                    setTimeout(() => b.classList.remove("valid-flash"), 500);
                }
            });
            // Update boxes after flash starts (letters now cleared)
            setTimeout(() => this._wrUpdateBoxes(), 350);
            // Show word popup
            this._wrShowWordPopup(result.word, result.coins);
        } else {
            // Invalid — shake and clear
            this._wrUpdateBoxes([]);
            const boxes = this.els.wrWordBoxes?.querySelectorAll(".wr-box");
            boxes?.forEach(b => {
                b.classList.add("invalid-shake");
                setTimeout(() => b.classList.remove("invalid-shake"), 400);
            });
        }
    }

    _wrShowWordPopup(word, coins) {
        const popup = document.getElementById("wr-word-popup");
        if (!popup) return;
        clearTimeout(this._wrWordPopupTimer);
        popup.classList.remove("show", "fade-out", "hidden");
        popup.textContent = `${word}  +${coins} 🪙`;
        // Force reflow for re-animation
        void popup.offsetWidth;
        popup.classList.add("show");
        this._wrWordPopupTimer = setTimeout(() => {
            popup.classList.remove("show");
            popup.classList.add("fade-out");
            setTimeout(() => { popup.classList.add("hidden"); popup.classList.remove("fade-out"); }, 400);
        }, 2000);
    }

    _wrTogglePause() {
        if (!this._wrGame) return;
        const scene = this._wrGame.getScene();
        if (!scene) return;
        // Don't allow pause toggle during countdown
        if (scene.countdownTimer > 0) return;
        if (scene.isPaused) {
            scene.resumeGame();
            this.els.wrPauseOverlay?.classList.remove("active");
        } else {
            scene.pauseGame();
            // pause overlay shown via onPause callback
        }
    }

    _wrResumePause() {
        if (!this._wrGame) return;
        this._showScreen("wr");
        const scene = this._wrGame.getScene();
        if (scene && !scene.isPaused) {
            scene.pauseGame();
        }
        this.els.wrPauseOverlay?.classList.add("active");
    }

    _wrRandomLetter() {
        // Track recently spawned letters to avoid repetition
        if (!this._wrRecentLetters) this._wrRecentLetters = [];
        const recent = this._wrRecentLetters;

        const scene = this._wrGame?.getScene();
        const collected = scene ? scene.collectedLetters : [];

        // Count letters currently visible on screen (not yet collected)
        const onScreen = {};
        if (scene) {
            for (const l of scene.letters) {
                if (!l.collected) onScreen[l.letter] = (onScreen[l.letter] || 0) + 1;
            }
        }

        // Helper: pick with anti-repeat filtering
        const antiRepeatPick = (letter) => {
            recent.push(letter);
            if (recent.length > 16) recent.shift();
            return letter;
        };

        // Helper: apply anti-repeat + on-screen penalties to a weight
        const penalize = (ch, w) => {
            // Penalize letters already visible on screen
            const screenCount = onScreen[ch] || 0;
            if (screenCount >= 2) w *= 0.02;
            else if (screenCount === 1) w *= 0.15;

            // Penalize recently spawned letters
            const lastIdx = recent.lastIndexOf(ch);
            if (lastIdx !== -1) {
                const age = recent.length - lastIdx;
                if (age <= 1) w *= 0.01;
                else if (age <= 2) w *= 0.04;
                else if (age <= 3) w *= 0.10;
                else if (age <= 5) w *= 0.25;
                else if (age <= 8) w *= 0.50;
            }
            return Math.max(w, 0.001);
        };

        // If we have 2+ letters collected, use trie for efficient completion lookup
        if (collected.length >= 2) {
            const prefix = collected.join("");
            if (randFloat(0, 1) < 0.45) {
                const candidates = [];
                for (let i = 0; i < 26; i++) {
                    const ch = String.fromCharCode(65 + i);
                    const test = prefix + ch;
                    if (test.length >= 3 && test.length <= 8 && DICTIONARY.has(test)) {
                        candidates.push({ ch, weight: 4 });
                    }
                    if (checkPrefix(test)) {
                        candidates.push({ ch, weight: 1 });
                    }
                }
                if (candidates.length > 0) {
                    for (const c of candidates) c.weight = penalize(c.ch, c.weight);
                    const items = candidates.map(c => c.ch);
                    const weights = candidates.map(c => c.weight);
                    return antiRepeatPick(weightedPick(items, weights));
                }
            }
        }

        // If 1 letter collected, boost common pairings
        if (collected.length === 1) {
            const first = collected[0];
            if (randFloat(0, 1) < 0.40) {
                const vowels = "AEIOU".split("");
                const consonants = "TNRSLCDGBMP".split("");
                const pool = !"AEIOU".includes(first) ? vowels : consonants;
                // Build weighted pool with penalties
                const items = pool;
                const weights = pool.map(ch => penalize(ch, 1));
                return antiRepeatPick(weightedPick(items, weights));
            }
        }

        // Weighted fallback with strong anti-repeat
        const FREQ = {
            A: 12, B: 3, C: 4, D: 4, E: 14, F: 3, G: 3, H: 3, I: 10, J: 1,
            K: 2, L: 6, M: 4, N: 7, O: 10, P: 4, Q: 1, R: 8, S: 8, T: 8,
            U: 6, V: 2, W: 3, X: 1, Y: 3, Z: 1
        };
        const letters = Object.keys(FREQ);
        const weights = letters.map(ch => penalize(ch, FREQ[ch]));
        return antiRepeatPick(weightedPick(letters, weights));
    }

    async _wrShowGameOver() {
      try {
        const wr = this._wr;
        if (!wr) return;

        // Clear saved state — game is over, no resume
        const saveKey = this._saveKey(CHALLENGE_TYPES.WORD_RUNNER);
        if (saveKey) localStorage.removeItem(saveKey);

        // Record stats
        const wordsFound = wr.wordsFormed;
        const score = wr.score;
        const coinsEarned = wr.coins;

        // End-of-game coins
        const endGameCoins = calculateGameCoins({
            score,
            wordsFound,
            isNewHighScore: score > (this.profileMgr.getChallengeStats(CHALLENGE_TYPES.WORD_RUNNER).highScore || 0),
            isChallenge: true,
            challengeType: CHALLENGE_TYPES.WORD_RUNNER,
            comboMax: wr.maxWordStreak || wr.wordStreak,
            playerLevel: this.profileMgr.getActive()?.level || 1,
            isFirstGameToday: false,
            playStreak: 0,
        });
        // Hard guard: 0 words found = 0 coins
        const totalCoins = wordsFound.length === 0 ? 0 : (coinsEarned + endGameCoins);

        // Check high score BEFORE recording
        const prevHigh = this.profileMgr.getChallengeStats(CHALLENGE_TYPES.WORD_RUNNER).highScore || 0;
        const isNewHigh = score > prevHigh;

        this.profileMgr.recordChallengeGame(CHALLENGE_TYPES.WORD_RUNNER, score, wordsFound);

        // XP award
        const xpBase = Math.floor(score / 10) + wordsFound.length * 150;
        const xpEarned = wordsFound.length > 0 ? Math.max(1, xpBase) : 0;
        const xpResult = this.profileMgr.awardXP(xpEarned);
        this.profileMgr.addCoins(totalCoins);

        // Update game over screen
        if (this.els.finalScore) this.els.finalScore.textContent = `Score: ${score}`;
        if (this.els.newHighScore) this.els.newHighScore.classList.toggle("hidden", !isNewHigh);

        const xpDisplay = document.getElementById("xp-earned-text");
        if (xpDisplay) {
            xpDisplay.textContent = `+${xpEarned} XP`;
            xpDisplay.classList.remove("visible");
        }
        const coinsDisplay = document.getElementById("coins-earned-text");
        if (coinsDisplay) coinsDisplay.textContent = `+${totalCoins} Coins`;

        const gameoverLevel = document.getElementById("gameover-level-text");
        if (gameoverLevel) gameoverLevel.textContent = `Level ${xpResult.newLevel}`;
        const gameoverXp = document.getElementById("gameover-xp-bar-fill");
        if (gameoverXp) gameoverXp.style.width = `${xpResult.newXpReq > 0 ? Math.min(100, (xpResult.newXp / xpResult.newXpReq) * 100) : 0}%`;

        this._gameOverChallenge = CHALLENGE_TYPES.WORD_RUNNER;
        this._gameOverCategoryKey = null;
        // Tag restart button for robust detection on Play Again
        this.els.restartBtn.dataset.challenge = CHALLENGE_TYPES.WORD_RUNNER;
        delete this.els.restartBtn.dataset.categoryKey;

        this.wordsFound = wordsFound;
        this._wordsFoundData = wordsFound;

        // Destroy Phaser game
        if (this._wrGame) {
            this._wrGame.destroy();
            this._wrGame = null;
        }
        // Unhide raw canvas
        if (this.els.wrCanvas) this.els.wrCanvas.style.display = "";
        this._wr = null;
        this._wrPrefixSet = null;
        this._wrRecentLetters = null;

        // Sync game-over state to Preact store so GameOverStats renders
        gameStore.set({
            gameState: State.GAMEOVER,
            finalScore: score,
            isNewHighScore: isNewHigh,
            xpEarned,
            bestCombo: wr?.maxWordStreak || wr?.wordStreak || 0,
            wordsFoundCount: wordsFound.length,
            wordsFound: wordsFound.slice(),
        });

        this._showScreen("gameover");

        // Record to Supabase and sync profile
        await this._recordGameToSupabase({
            gameMode: GAME_MODES.SANDBOX,
            isChallenge: true,
            challengeType: CHALLENGE_TYPES.WORD_RUNNER,
            categoryKey: null,
            gridSize: null,
            difficulty: "casual",
            timeLimitSeconds: null,
            score,
            wordsFound: wordsFound.length,
            longestWordLength: Math.max(0, ...wordsFound.map(w => (w.word || w).length)),
            bestCombo: wr.maxWordStreak || wr.wordStreak || 0,
            targetWordsCompleted: 0,
            bonusWordsCompleted: 0,
            timeRemainingSeconds: null,
            xpEarned,
            coinsEarned: totalCoins,
            gridFactor: 1.0,
            difficultyMultiplier: 1.0,
            modeMultiplier: 1.0,
        });
        await this._syncProfileToCloud();

        // Animate XP text in after a delay (matches main game flow)
        setTimeout(() => {
            const xpEl = document.getElementById("xp-earned-text");
            if (xpEl) xpEl.classList.add("visible");
        }, 300);

        if (xpResult.leveled) {
            setTimeout(() => this._showLevelUpPopup(xpResult.newLevel, xpResult.newXp, xpResult.newXpReq), 600);
        }
      } catch (err) {
        console.error('[WR GameOver] Error:', err);
        // Ensure game over screen still shows even if something fails
        try { this._showScreen("gameover"); } catch (_) { /* */ }
      }
    }

    _wrEndGame(reason = "endgame") {
        if (!this._wrGame && !this._wr) return;

        // Close pause if open
        this.els.wrPauseOverlay?.classList.remove("active");

        if (reason === "save") {
            // Save & Quit: save WR state, destroy Phaser, return to setup
            try { this._wrSaveState(); } catch (e) { console.warn("[WR] Save failed:", e); }
            try {
                if (this._wrGame) { this._wrGame.destroy(); this._wrGame = null; }
            } catch (e) { console.warn("[WR] Cleanup failed:", e); }
            this._wr = null;
            // Unhide the raw canvas if Phaser hid it
            if (this.els.wrCanvas) this.els.wrCanvas.style.display = "";
            this._openChallengeSetup(CHALLENGE_TYPES.WORD_RUNNER);
            return;
        }

        // End Game: clear saved state, trigger game over
        const key = this._saveKey(CHALLENGE_TYPES.WORD_RUNNER);
        if (key) localStorage.removeItem(key);
        if (this._wrGame) {
            this._wrGame.endGame();
        } else {
            this._wrShowGameOver();
        }
    }

    _wrUpdateUI(state) {
        if (!state) return;
        if (this.els.wrScore) this.els.wrScore.textContent = state.score;
        if (this.els.wrDistance) this.els.wrDistance.textContent = Math.floor((state.distance || 0) / 10) + "m";
        if (this.els.wrCoins) this.els.wrCoins.textContent = state.coins || 0;

        // Level/XP display
        const info = this.profileMgr.getLevelInfo();
        const pct = info.xpRequired > 0 ? Math.min(100, (info.xp / info.xpRequired) * 100) : 0;
        if (this.els.wrLevelText) this.els.wrLevelText.textContent = `Lv. ${info.level}`;
        if (this.els.wrXpBarFill) this.els.wrXpBarFill.style.width = pct + "%";
        if (this.els.wrXpText) this.els.wrXpText.textContent = `${info.xp} / ${info.xpRequired}`;
    }

    _wrUpdateMiniPlayer() {
        // Mini player removed — global music dropdown handles this now
        this._syncGlobalMusicPanel();
    }

    destroy() {
        this._destroyed = true;
        if (this._ws && this._ws._animId) cancelAnimationFrame(this._ws._animId);
        this._ws = null;
        if (this._wrGame) { try { this._wrGame.destroy(); } catch {} this._wrGame = null; }
        this._wr = null;
        if (this.music) {
            this.music.pause();
            this.music._cancelCrossfade();
            // Don't close _audioCtx — it's shared and can't be reopened
        }
        if (this.bgAnim && this.bgAnim._animId) cancelAnimationFrame(this.bgAnim._animId);
    }
}

// Handle window resize
let resizeTimeout;
window.addEventListener("resize", () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        const g = window._game;
        if (g && g.state !== State.MENU && g.state !== State.GAMEOVER && g.grid) {
            g.renderer.resize(g.grid.rows, g.grid.cols);
        }
        if (g && g._ws) g._wsResizeCanvas();
        if (g && g._wrGame) g._wrResizeCanvas();
        if (g && g.bgAnim) g.bgAnim._resize();
    }, 150);
});

// Prevent scrolling on touch devices
document.addEventListener("touchmove", (e) => {
    const target = e.target;
    const game = window._game;
    const isScrollablePanel = target.closest("#words-found-list, #track-list, #profiles-list, #playlist-tabs, #playlist-track-picker, .overlay-content, .modal-panel-body");
    if (isScrollablePanel) return;
    if (game?.state === State.PLAYING && target.closest("#play-screen")) {
        e.preventDefault();
    }
    if (game?._ws && !game._ws.gameOver && target.closest("#ws-screen")) {
        e.preventDefault();
    }
    if (game?._wr && !game._wr.gameOver && target.closest("#wr-screen")) {
        e.preventDefault();
    }
}, { passive: false });

// Auto-save when the user navigates away or closes the tab
document.addEventListener("visibilitychange", () => {
    const resumeOverlay = document.getElementById('resume-overlay');
    if (document.visibilityState === "hidden") {
        // Show Plummet overlay so iOS snapshots it instead of raw game state
        if (resumeOverlay) resumeOverlay.classList.remove('resume-overlay--hidden');
        const g = window._game;
        if (g && (g.state === State.PLAYING || g.state === State.PAUSED || g.state === State.CLEARING)) {
            g._saveGameState();
        }
        // Also save Word Search state if active
        if (g && g._ws && !g._ws.gameOver) {
            g._wsSaveState();
        }
        // Also save Word Runner state if active
        if (g && g._wrGame) {
            try { g._wrSaveState(); } catch(e) {}
        }
        if (g && g.music) g.music._saveMusicState();
    } else if (document.visibilityState === "visible") {
        // Fade out the resume overlay
        if (resumeOverlay) resumeOverlay.classList.add('resume-overlay--hidden');
        const g = window._game;
        if (g && g.music) g.music.resumePlayback();
        // Reconnect leaderboard realtime if it dropped while backgrounded
        if (g && g._lbRealtimeChannel) {
            g._unsubscribeLeaderboardRealtime();
            g._subscribeLeaderboardRealtime();
        }
    }
});

// ── Capacitor native app state listener (more reliable than visibilitychange on iOS) ──
(async () => {
    try {
        // Use variable to prevent Vite from statically resolving this import
        const mod = '@capaci' + 'tor/app';
        const { App } = await import(/* @vite-ignore */ mod);
        App.addListener('appStateChange', ({ isActive }) => {
            const g = window._game;
            if (!g) return;
            const resumeOverlay = document.getElementById('resume-overlay');
            if (isActive) {
                // Fade out the resume overlay
                if (resumeOverlay) resumeOverlay.classList.add('resume-overlay--hidden');
                if (g.music) g.music.resumePlayback();
            } else {
                // Show Plummet overlay so iOS snapshots it
                if (resumeOverlay) resumeOverlay.classList.remove('resume-overlay--hidden');
                if (g.music) g.music._saveMusicState();
            }
        });
    } catch (_) {
        // @capacitor/app not available (web) — visibilitychange is sufficient
    }
})();
window.addEventListener("beforeunload", () => {
    const g = window._game;
    if (g && (g.state === State.PLAYING || g.state === State.PAUSED || g.state === State.CLEARING)) {
        g._saveGameState();
    }
    // Also save Word Search state if active
    if (g && g._ws && !g._ws.gameOver) {
        g._wsSaveState();
    }
    // Also save Word Runner state if active
    if (g && g._wrGame) {
        try { g._wrSaveState(); } catch(e) {}
    }
    if (g && g.music) g.music._saveMusicState();
});

// ═══════════════════════════════════════════════════════════════════════════════
// LOADING SCREEN - Falling letters animation
// ═══════════════════════════════════════════════════════════════════════════════

const LoadingScreen = {
    progress: 0,
    
    init() {
        this.progressBar = document.getElementById('loading-bar-fill');
        this.loadingText = document.getElementById('loading-text');
        this.screen = document.getElementById('loading-screen');
        // Falling letters already started by inline script in HTML
    },
    
    stopFallingLetters() {
        // Stop the interval started by the inline script
        if (window._loadingLettersInterval) {
            clearInterval(window._loadingLettersInterval);
            window._loadingLettersInterval = null;
        }
    },
    
    setProgress(percent, text) {
        this.progress = Math.min(100, Math.max(0, percent));
        if (this.progressBar) {
            this.progressBar.style.width = this.progress + '%';
        }
        if (this.loadingText && text) {
            this.loadingText.textContent = text;
        }
    },
    
    hide() {
        this.setProgress(100, 'Ready!');
        
        // Short delay to show 100%, then fade out
        setTimeout(() => {
            this.stopFallingLetters();
            if (this.screen) {
                this.screen.classList.add('hidden');
            }
            // Remove from DOM after transition
            setTimeout(() => {
                if (this.screen) {
                    this.screen.remove();
                }
            }, 700);
        }, 400);
    }
};

// Initialize loading screen immediately
LoadingScreen.init();

// ── Bootstrap ──
// Load track list + dictionary, then start the game
LoadingScreen.setProgress(5, 'Loading assets...');

Promise.all([
    loadTrackList().then(() => {
        LoadingScreen.setProgress(30, 'Loading music...');
    }),
    loadDictionary().then(() => {
        LoadingScreen.setProgress(60, 'Loading dictionary...');
    }).catch((err) => {
        console.error("Dictionary initialization failed.", err);
        DICTIONARY = new Set();
        _buildHintSets();
        LoadingScreen.setProgress(60, 'Loading dictionary...');
    }),
    loadEnrichedDict().then(() => {
        LoadingScreen.setProgress(85, 'Loading definitions...');
    })
]).then(async () => {
    LoadingScreen.setProgress(90, 'Initializing game...');
    
    // Clean up previous instance (HMR reload) to prevent double audio / double game loops
    const prev = window._game;
    if (prev && prev.destroy) prev.destroy();
    window._game = new Game();
    // Mount Preact UI layer after game initializes
    mountPreactUI();
    
    LoadingScreen.setProgress(95, 'Setting up notifications...');
    
    // Word of the Day notifications - initialize on first launch or reschedule if enabled
    try {
        const { initializeOnFirstLaunch, rescheduleIfNeeded, setupNotificationListeners } = await import('./src/lib/word-of-day.js');
        
        // For new users, auto-enable (will prompt for permission)
        await initializeOnFirstLaunch(ENRICHED_DICT);
        
        // For returning users, reschedule if still enabled
        await rescheduleIfNeeded(ENRICHED_DICT);
        
        setupNotificationListeners((word) => {
            // User tapped notification - show dictionary with this word
            if (window._game && window._game._showDictionaryWord) {
                window._game._showDictionaryWord(word);
            }
        });
    } catch (e) {
        // Word of Day module not available or not on native platform
        console.log('[WOTD] Not initialized:', e.message);
    }
    
    // Fun Message notifications - random daily fun messages/jokes
    try {
        const { 
            initializeFunMessagesOnFirstLaunch, 
            rescheduleFunMessageIfNeeded,
            scheduleFunMessage,
            isFunMessagesEnabled
        } = await import('./src/lib/fun-messages.js');
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        const { Capacitor } = await import('@capacitor/core');
        
        // For new users, auto-enable
        await initializeFunMessagesOnFirstLaunch();
        
        // For returning users, reschedule if still enabled
        await rescheduleFunMessageIfNeeded();
        
        // Listen for fun message notifications to reschedule the next one
        if (Capacitor.isNativePlatform()) {
            LocalNotifications.addListener('localNotificationActionPerformed', async (action) => {
                const { notification } = action;
                if (notification.extra?.type === 'fun-message') {
                    // User tapped fun message - schedule the next one
                    if (isFunMessagesEnabled()) {
                        await scheduleFunMessage();
                    }
                }
            });
        }
    } catch (e) {
        console.log('[FUN-MSG] Not initialized:', e.message);
    }
    
    // Wait for auth check to complete before hiding loading screen
    LoadingScreen.setProgress(98, 'Checking account...');
    if (window._game && window._game._authReady) {
        await window._game._authReady;
    }
    
    // Hide loading screen
    LoadingScreen.hide();

    // Notify Capgo OTA updater that the app loaded successfully.
    // Without this call, Capgo assumes the update is broken and rolls back.
    try {
        const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
        await CapacitorUpdater.notifyAppReady();
    } catch (e) {
        // Not on a native platform or plugin not available — safe to ignore
    }
});
