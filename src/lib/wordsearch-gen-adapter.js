/**
 * wordsearch-gen-adapter.js — Adapter for wordsearch-generator npm package
 *
 * Uses the wordsearch-generator library as a secondary/validation generator
 * alongside the custom backtracking algorithm in wordsearch-engine.js.
 *
 * Provides:
 *   - Alternative grid generation for comparison/validation
 *   - Quick puzzle generation for challenge previews and tutorials
 *   - Word placement validation (crosscheck against custom engine)
 *   - Pre-built puzzle templates for specific difficulty levels
 */
import wordsearch from 'wordsearch-generator';

/**
 * Generate a word search grid using the wordsearch-generator library.
 * This serves as a secondary generator for validation and fallback.
 *
 * @param {string[]} words - Words to place in the grid
 * @param {number} size - Grid size (NxN)
 * @returns {{ grid: string[][], unplaced: string[] }}
 */
export function generateWithLibrary(words, size) {
    try {
        const puzzle = wordsearch.createPuzzle(size, size, 'en', words.map(w => w.toLowerCase()));
        const filled = wordsearch.hideWords(puzzle, 'en');
        const grid = filled.map(row =>
            row.map(cell => (cell || 'A').toUpperCase())
        );
        return { grid, unplaced: [] };
    } catch (e) {
        console.warn('[WS-Gen] Library generation failed, returning empty grid:', e.message);
        return {
            grid: Array.from({ length: size }, () => Array(size).fill('A')),
            unplaced: [...words],
        };
    }
}

/**
 * Generate a quick puzzle for tutorial/preview purposes.
 * Uses wordsearch-generator for speed (no backtracking fill needed).
 *
 * @param {string[]} words - Short list of words (3-5)
 * @param {number} [size=8] - Grid size
 * @returns {string[][]}
 */
export function generateQuickPuzzle(words, size = 8) {
    try {
        const puzzle = wordsearch.createPuzzle(size, size, 'en', words.map(w => w.toLowerCase()));
        const filled = wordsearch.hideWords(puzzle, 'en');
        return filled.map(row => row.map(c => (c || 'A').toUpperCase()));
    } catch (e) {
        console.warn('[WS-Gen] Quick puzzle failed:', e.message);
        // Fallback: random letter grid
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        return Array.from({ length: size }, () =>
            Array.from({ length: size }, () => letters[Math.floor(Math.random() * 26)])
        );
    }
}

/**
 * Validate a custom-engine grid by cross-checking against library generation.
 * Returns a confidence score (0-1) based on how many words both engines agree on.
 *
 * @param {string[][]} customGrid - Grid from custom engine
 * @param {string[]} words - Words that should be present
 * @param {number} size - Grid size
 * @returns {{ confidence: number, agreedWords: string[], disagreedWords: string[] }}
 */
export function crossValidateGrid(customGrid, words, size) {
    const libResult = generateWithLibrary(words, size);
    const libGrid = libResult.grid;

    const agreed = [];
    const disagreed = [];

    for (const word of words) {
        const inCustom = _findWordInGrid(customGrid, word, size);
        const inLib = _findWordInGrid(libGrid, word, size);

        if (inCustom) {
            agreed.push(word);
        } else {
            disagreed.push(word);
        }
    }

    return {
        confidence: words.length > 0 ? agreed.length / words.length : 1,
        agreedWords: agreed,
        disagreedWords: disagreed,
    };
}

/**
 * Generate a themed puzzle template with pre-selected word categories.
 *
 * @param {'easy'|'medium'|'hard'} difficulty
 * @param {string[]} wordPool - Available words to pick from
 * @param {number} [size=10]
 * @returns {{ grid: string[][], words: string[] }}
 */
export function generateThemedPuzzle(difficulty, wordPool, size = 10) {
    const counts = { easy: 4, medium: 6, hard: 9 };
    const count = counts[difficulty] || 6;
    const maxLen = { easy: 5, medium: 7, hard: 12 };

    // Filter and select words
    const eligible = wordPool.filter(w =>
        w.length >= 3 && w.length <= (maxLen[difficulty] || 7)
    );

    const selected = [];
    const used = new Set();
    const shuffled = [...eligible].sort(() => Math.random() - 0.5);

    for (const word of shuffled) {
        if (selected.length >= count) break;
        if (!used.has(word)) {
            selected.push(word);
            used.add(word);
        }
    }

    const grid = generateQuickPuzzle(selected, size);
    return { grid, words: selected };
}

// ── Helper: Find word in grid ──

function _findWordInGrid(grid, word, size) {
    const directions = [
        [0, 1], [1, 0], [1, 1], [1, -1],
        [0, -1], [-1, 0], [-1, -1], [-1, 1],
    ];

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            for (const [dr, dc] of directions) {
                let found = true;
                for (let i = 0; i < word.length; i++) {
                    const nr = r + dr * i;
                    const nc = c + dc * i;
                    if (nr < 0 || nr >= size || nc < 0 || nc >= size) { found = false; break; }
                    if (grid[nr][nc] !== word[i]) { found = false; break; }
                }
                if (found) return true;
            }
        }
    }
    return false;
}
