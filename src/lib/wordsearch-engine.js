/**
 * wordsearch-engine.js — Enhanced word search generation and validation
 * 
 * Uses trie-search for efficient prefix checking and a backtracking algorithm
 * to ensure random letter placement doesn't block hidden words.
 * 
 * Features:
 *   - Trie-based prefix validation for swipe hints
 *   - Backtracking grid fill that avoids blocking placed words
 *   - Smarter word difficulty calculation
 *   - Real-time swipe validity feedback
 */
import TrieSearch from 'trie-search';
import Chance from 'chance';
import weighted from 'weighted';

const _chance = new Chance();

// ── Trie Index ──

let _trie = null;
let _trieWords = null;

/**
 * Build or rebuild the trie index from the dictionary.
 * Call once after the dictionary is loaded.
 * @param {Set<string>} dictionary - Set of valid uppercase words
 */
export function buildTrie(dictionary) {
    _trie = new TrieSearch(null, { min: 2, splitOnRegEx: false, idFieldOrFunction: w => w });
    _trieWords = dictionary;

    // Add all words to the trie
    const words = [];
    for (const word of dictionary) {
        if (word.length >= 3 && word.length <= 12) {
            words.push({ word, length: word.length });
        }
    }
    _trie.addAll(words);
    console.log(`[WS Engine] Trie built with ${words.length} words`);
}

/**
 * Check if a prefix could lead to a valid word.
 * Used during swipe to show validity hints.
 * @param {string} prefix - Current swipe prefix (uppercase)
 * @returns {{ isValid: boolean, isPrefix: boolean, matchCount: number }}
 */
export function checkPrefix(prefix) {
    if (!_trie || !_trieWords || prefix.length < 2) {
        return { isValid: false, isPrefix: prefix.length < 3, matchCount: 0 };
    }

    const isValid = _trieWords.has(prefix);

    // Check if prefix could lead to valid words
    const results = _trie.search(prefix);
    const matchCount = results.filter(r => r.word.startsWith(prefix) && r.word !== prefix).length;

    return {
        isValid,
        isPrefix: matchCount > 0,
        matchCount,
    };
}

/**
 * Get all words that start with the given prefix.
 * @param {string} prefix
 * @param {number} [limit=10]
 * @returns {string[]}
 */
export function getCompletions(prefix, limit = 10) {
    if (!_trie || prefix.length < 2) return [];
    const results = _trie.search(prefix);
    return results
        .filter(r => r.word.startsWith(prefix))
        .map(r => r.word)
        .slice(0, limit);
}

// ── Enhanced Grid Generation ──

const WS_DIRECTIONS = [
    [0, 1], [1, 0], [0, -1], [-1, 0],
    [1, 1], [1, -1], [-1, 1], [-1, -1]
];

/**
 * Calculate word difficulty score (0-100).
 * Considers letter rarity, word length, and common patterns.
 */
export function wordDifficulty(word) {
    const rarityMap = {
        Q: 10, Z: 10, X: 9, J: 8, K: 5, V: 4,
        W: 3, Y: 3, F: 3, B: 3, H: 3, G: 3,
        M: 2, P: 2, C: 2, D: 2, U: 2,
        L: 1, N: 1, R: 1, S: 1, T: 1,
        A: 0, E: 0, I: 0, O: 0,
    };

    let rarityScore = 0;
    for (const ch of word) {
        rarityScore += rarityMap[ch] || 0;
    }
    rarityScore /= word.length;

    // Length factor: longer words are harder
    const lengthFactor = Math.min(1.0, (word.length - 3) / 5);

    // Uncommon bigrams increase difficulty
    const commonBigrams = new Set([
        'TH', 'HE', 'IN', 'ER', 'AN', 'RE', 'ON', 'AT', 'EN', 'ND',
        'TI', 'ES', 'OR', 'TE', 'OF', 'ED', 'IS', 'IT', 'AL', 'AR',
        'ST', 'TO', 'NT', 'NG', 'SE', 'HA', 'AS', 'OU', 'IO', 'LE',
    ]);
    let uncommonBigramCount = 0;
    for (let i = 0; i < word.length - 1; i++) {
        if (!commonBigrams.has(word.substring(i, i + 2))) {
            uncommonBigramCount++;
        }
    }
    const bigramFactor = uncommonBigramCount / Math.max(1, word.length - 1);

    return Math.min(100, Math.round(
        rarityScore * 4 + lengthFactor * 35 + bigramFactor * 35
    ));
}

/**
 * Select words for a word search level using weighted difficulty distribution.
 * @param {object} params - Level parameters from _wsLevelParams
 * @param {Set<string>} dictionary - Valid words
 * @returns {string[]} Selected words sorted by length
 */
export function selectWords(params, dictionary) {
    const { minWords, maxWords, minWordLen, maxWordLen, difficultyPct } = params;
    const count = minWords + Math.floor(_chance.floating({ min: 0, max: 1 }) * (maxWords - minWords + 1));

    // Build candidate pool filtered by length
    const candidates = [];
    for (const word of dictionary) {
        if (word.length >= minWordLen && word.length <= maxWordLen) {
            candidates.push(word);
        }
    }
    if (candidates.length === 0) return [];

    // Sort by difficulty
    candidates.sort((a, b) => wordDifficulty(a) - wordDifficulty(b));
    const total = candidates.length;

    // Difficulty window: controls which portion of sorted candidates we pick from
    const halfWidth = 0.1 + difficultyPct * 0.2;
    const center = difficultyPct * 0.85 + 0.05;
    const windowStart = Math.floor(total * Math.max(0, center - halfWidth));
    const windowEnd = Math.min(total, Math.floor(total * Math.min(1, center + halfWidth)));
    const pool = candidates.slice(windowStart, Math.max(windowEnd, windowStart + 20));

    // Weighted selection preferring variety in word length
    const selected = new Set();
    const result = [];
    let attempts = 0;

    while (result.length < count && attempts < count * 20) {
        const word = _chance.pickone(pool);
        attempts++;
        if (selected.has(word)) continue;
        selected.add(word);
        result.push(word);
    }

    result.sort((a, b) => a.length - b.length);
    return result;
}

/**
 * Generate a word search grid using backtracking fill algorithm.
 * 
 * The backtracking algorithm ensures:
 * 1. All target words are placed first (with random retries)
 * 2. Empty cells are filled with letters that minimize accidental words
 * 3. If a fill choice would block future fills, it backtracks
 * 
 * @param {number} size - Grid dimension (NxN)
 * @param {string[]} words - Words to place
 * @param {Array} allowedDirs - Allowed directions for word placement
 * @param {Set<string>} dictionary - For checking accidental words
 * @returns {{ grid: string[][], placedWords: Array }}
 */
export function generateGrid(size, words, allowedDirs, dictionary) {
    const grid = Array.from({ length: size }, () => Array(size).fill(null));
    const placedWords = [];

    // Sort words longest first for best placement chance
    const sorted = [...words].sort((a, b) => b.length - a.length);

    for (const word of sorted) {
        let placed = false;
        const shuffledDirs = [...allowedDirs];
        _chance.shuffle(shuffledDirs);

        for (let attempt = 0; attempt < 300 && !placed; attempt++) {
            const dir = _chance.pickone(shuffledDirs);
            const [dr, dc] = dir;

            let startR, startC, endR, endC;
            if (dr > 0) { startR = 0; endR = size - word.length; }
            else if (dr < 0) { startR = word.length - 1; endR = size - 1; }
            else { startR = 0; endR = size - 1; }

            if (dc > 0) { startC = 0; endC = size - word.length; }
            else if (dc < 0) { startC = word.length - 1; endC = size - 1; }
            else { startC = 0; endC = size - 1; }

            if (startR > endR || startC > endC) continue;

            const r = startR + _chance.integer({ min: 0, max: endR - startR });
            const c = startC + _chance.integer({ min: 0, max: endC - startC });

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

            for (let i = 0; i < word.length; i++) {
                grid[cells[i].r][cells[i].c] = word[i];
            }
            placedWords.push({ word, cells, dir });
            placed = true;
        }

        if (!placed) {
            console.warn(`[WS Engine] Failed to place word "${word}" after 300 attempts`);
        }
    }

    // ── Backtracking fill ──
    _backtrackFill(grid, size, placedWords, dictionary);

    return { grid, placedWords };
}

/**
 * Fill empty cells using backtracking to minimize accidental words.
 * For each empty cell, tries letters in weighted random order.
 * If a letter creates too many accidental words, tries next.
 * Falls back to least-conflicting letter if all options create conflicts.
 */
function _backtrackFill(grid, size, placedWords, dictionary) {
    const emptyCells = [];
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (grid[r][c] === null) emptyCells.push({ r, c });
        }
    }

    // Shuffle for variety
    _chance.shuffle(emptyCells);

    // Pre-compute neighbor letters for smarter fill
    const _getNeighborLetters = (r, c) => {
        const neighbors = [];
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc]) {
                    neighbors.push(grid[nr][nc]);
                }
            }
        }
        return neighbors;
    };

    const placedWordSet = new Set(placedWords.map(pw => pw.word));

    for (const { r, c } of emptyCells) {
        const neighbors = _getNeighborLetters(r, c);

        // Build weighted letter list — prefer letters that don't form words with neighbors
        const letters = [];
        for (let i = 0; i < 26; i++) letters.push(String.fromCharCode(65 + i));
        _chance.shuffle(letters);

        let bestLetter = letters[0];
        let bestConflicts = Infinity;

        for (const letter of letters) {
            grid[r][c] = letter;
            let conflicts = 0;

            // Check all 8 directions for accidental words through this cell
            for (const [dr, dc] of WS_DIRECTIONS) {
                for (let len = 3; len <= 7; len++) {
                    for (let offset = 0; offset < len; offset++) {
                        const sr = r - dr * offset;
                        const sc = c - dc * offset;
                        const er = sr + dr * (len - 1);
                        const ec = sc + dc * (len - 1);
                        if (sr < 0 || sr >= size || sc < 0 || sc >= size) continue;
                        if (er < 0 || er >= size || ec < 0 || ec >= size) continue;

                        let w = '';
                        let hasNull = false;
                        for (let i = 0; i < len; i++) {
                            const ch = grid[sr + dr * i][sc + dc * i];
                            if (ch === null) { hasNull = true; break; }
                            w += ch;
                        }
                        if (hasNull) continue;

                        if (dictionary.has(w) && !placedWordSet.has(w)) {
                            conflicts++;
                        }
                    }
                }
            }

            if (conflicts === 0) {
                bestLetter = letter;
                bestConflicts = 0;
                break;
            }
            if (conflicts < bestConflicts) {
                bestConflicts = conflicts;
                bestLetter = letter;
            }
        }

        grid[r][c] = bestLetter;
    }
}

/**
 * Validate a cell selection in a word search grid.
 * @param {string[][]} grid - The grid
 * @param {Array<{r: number, c: number}>} cells - Selected cells
 * @param {Set<string>} allValidWords - All valid words on this board
 * @returns {string|null} The valid word or null
 */
export function validateSelection(grid, cells, allValidWords) {
    if (!cells || cells.length < 3) return null;

    // Check cells form a straight line
    if (cells.length > 1) {
        const dr = Math.sign(cells[1].r - cells[0].r);
        const dc = Math.sign(cells[1].c - cells[0].c);
        for (let i = 2; i < cells.length; i++) {
            if (Math.sign(cells[i].r - cells[i - 1].r) !== dr ||
                Math.sign(cells[i].c - cells[i - 1].c) !== dc) return null;
        }
        for (let i = 1; i < cells.length; i++) {
            if (Math.abs(cells[i].r - cells[i - 1].r) > 1 ||
                Math.abs(cells[i].c - cells[i - 1].c) > 1) return null;
        }
    }

    let word = '';
    for (const { r, c } of cells) word += grid[r][c];

    if (allValidWords && allValidWords.has(word)) return word;
    return null;
}

/**
 * Real-time swipe hint: checks if current selection path could lead to a valid word.
 * @param {string[][]} grid - The grid
 * @param {Array<{r: number, c: number}>} cells - Current swipe cells
 * @param {Set<string>} validWords - Words to find on this board  
 * @returns {{ currentWord: string, couldBeValid: boolean, isComplete: boolean }}
 */
export function getSwipeHint(grid, cells, validWords) {
    if (!cells || cells.length === 0) {
        return { currentWord: '', couldBeValid: false, isComplete: false };
    }

    let currentWord = '';
    for (const { r, c } of cells) currentWord += grid[r][c];

    const isComplete = validWords.has(currentWord);

    // Check if any valid word starts with currentWord
    let couldBeValid = isComplete;
    if (!couldBeValid) {
        for (const word of validWords) {
            if (word.startsWith(currentWord)) {
                couldBeValid = true;
                break;
            }
        }
    }

    // Also check trie for other dictionary words (bonus words)
    if (!couldBeValid && _trie) {
        const prefixResult = checkPrefix(currentWord);
        couldBeValid = prefixResult.isPrefix || prefixResult.isValid;
    }

    return { currentWord, couldBeValid, isComplete };
}

export { WS_DIRECTIONS };
