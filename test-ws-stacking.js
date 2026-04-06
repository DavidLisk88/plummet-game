#!/usr/bin/env node
/**
 * RED-TEAM TEST: Word Search stacking/substring detection
 *
 * Tests that the cell-subset stacking removal correctly:
 *  1. Removes words whose cells are ENTIRELY within a placed word's cells
 *  2. Keeps words that have at least one independent (non-embedded) occurrence
 *  3. Handles all 8 directions, reverse reads, diagonal overlaps
 *  4. Works with crossing placed words
 *
 * Run: node test-ws-stacking.js
 */

const fs = require('fs');

// ── Load dictionary ──
const wordsJson = JSON.parse(fs.readFileSync('./words.json', 'utf-8'));
const wordsList = Array.isArray(wordsJson)
    ? wordsJson
    : (Array.isArray(wordsJson.words) ? wordsJson.words : Object.keys(wordsJson));
const DICTIONARY = new Set(wordsList.map(w => w.toUpperCase()));

const WS_DIRECTIONS = [
    [0, 1], [1, 0], [1, 1], [1, -1],
    [0, -1], [-1, 0], [-1, -1], [-1, 1],
];

// ── Core functions (replicated from script.js for isolated testing) ──

function generateGrid(size, words) {
    const grid = Array.from({ length: size }, () => Array(size).fill(null));
    const placedWords = [];
    const sorted = [...words].sort((a, b) => b.length - a.length);

    for (const word of sorted) {
        let placed = false;
        for (let attempt = 0; attempt < 500 && !placed; attempt++) {
            const dir = WS_DIRECTIONS[Math.floor(Math.random() * WS_DIRECTIONS.length)];
            const [dr, dc] = dir;
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
            for (let i = 0; i < word.length; i++) grid[cells[i].r][cells[i].c] = word[i];
            placedWords.push({ word, cells, dir });
            placed = true;
        }
        if (!placed) console.warn(`  Failed to place "${word}"`);
    }

    // Smart fill (simplified — pick random letter, prefer 0-conflict)
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (grid[r][c] === null) {
                let best = 'X', bestConf = Infinity;
                for (let attempt = 0; attempt < 26; attempt++) {
                    const letter = String.fromCharCode(65 + attempt);
                    grid[r][c] = letter;
                    let conflicts = 0;
                    for (const [dr, dc] of WS_DIRECTIONS) {
                        for (let len = 3; len <= 7; len++) {
                            for (let offset = 0; offset < len; offset++) {
                                const sr = r - dr * offset, sc = c - dc * offset;
                                const er = sr + dr * (len - 1), ec = sc + dc * (len - 1);
                                if (sr < 0 || sr >= size || sc < 0 || sc >= size) continue;
                                if (er < 0 || er >= size || ec < 0 || ec >= size) continue;
                                let w = '', hasNull = false;
                                for (let i = 0; i < len; i++) {
                                    const ch = grid[sr + dr * i][sc + dc * i];
                                    if (ch === null) { hasNull = true; break; }
                                    w += ch;
                                }
                                if (hasNull) continue;
                                if (DICTIONARY.has(w) && !placedWords.some(pw => pw.word === w)) conflicts++;
                            }
                        }
                    }
                    if (conflicts === 0) { best = letter; break; }
                    if (conflicts < bestConf) { bestConf = conflicts; best = letter; }
                }
                grid[r][c] = best;
            }
        }
    }

    return { grid, placedWords };
}

function scanGridForWords(grid, size, placedWords, placedWordSet, minLen = 3) {
    const allValidWords = new Set(placedWordSet);
    const wordOccurrences = new Map();

    // Pre-populate placed word occurrences
    for (const pw of placedWords) {
        const dr = pw.dir[0], dc = pw.dir[1];
        const { r: sr, c: sc } = pw.cells[0];
        if (!wordOccurrences.has(pw.word)) wordOccurrences.set(pw.word, []);
        wordOccurrences.get(pw.word).push({ startR: sr, startC: sc, dr, dc, len: pw.word.length });
    }

    // Scan
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            for (const [dr, dc] of WS_DIRECTIONS) {
                for (let len = minLen; len <= 7; len++) {
                    const endR = r + dr * (len - 1);
                    const endC = c + dc * (len - 1);
                    if (endR < 0 || endR >= size || endC < 0 || endC >= size) break;
                    let w = '';
                    for (let i = 0; i < len; i++) w += grid[r + dr * i][c + dc * i];
                    if (DICTIONARY.has(w)) {
                        allValidWords.add(w);
                        if (!wordOccurrences.has(w)) wordOccurrences.set(w, []);
                        wordOccurrences.get(w).push({ startR: r, startC: c, dr, dc, len });
                    }
                }
            }
        }
    }

    return { allValidWords, wordOccurrences };
}

/**
 * NEW cell-subset stacking removal (matches the fix in script.js)
 */
function removeStackedWords(allValidWords, wordOccurrences, placedWords, placedWordSet) {
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
    return wordsToRemove;
}

/**
 * OLD direction-math stacking removal (the buggy version, for comparison)
 */
function removeStackedWordsOld(allValidWords, wordOccurrences, placedWords, placedWordSet) {
    const removed = new Set();
    for (const pw of placedWords) {
        const { r: pr, c: pc } = pw.cells[0];
        const pdr = pw.dir[0], pdc = pw.dir[1];
        const pLen = pw.word.length;
        for (const [word, occs] of wordOccurrences) {
            if (word === pw.word) continue;
            if (word.length >= pLen) continue;
            for (const occ of occs) {
                const sameDir = (occ.dr === pdr && occ.dc === pdc);
                const reverseDir = (occ.dr === -pdr && occ.dc === -pdc);
                if (!sameDir && !reverseDir) continue;
                if (sameDir) {
                    const stepR = pdr !== 0 ? (occ.startR - pr) / pdr : 0;
                    const stepC = pdc !== 0 ? (occ.startC - pc) / pdc : 0;
                    const step = pdr !== 0 ? stepR : stepC;
                    if (step >= 0 && step === Math.floor(step) && step + occ.len <= pLen) {
                        if ((pdr === 0 || stepR === step) && (pdc === 0 || stepC === step)) {
                            if (!placedWordSet.has(word)) {
                                allValidWords.delete(word);
                                removed.add(word);
                            }
                        }
                    }
                } else {
                    const oEndR = occ.startR + occ.dr * (occ.len - 1);
                    const oEndC = occ.startC + occ.dc * (occ.len - 1);
                    const stepR = pdr !== 0 ? (oEndR - pr) / pdr : 0;
                    const stepC = pdc !== 0 ? (oEndC - pc) / pdc : 0;
                    const step = pdr !== 0 ? stepR : stepC;
                    if (step >= 0 && step === Math.floor(step) && step + occ.len <= pLen) {
                        if ((pdr === 0 || stepR === step) && (pdc === 0 || stepC === step)) {
                            if (!placedWordSet.has(word)) {
                                allValidWords.delete(word);
                                removed.add(word);
                            }
                        }
                    }
                }
            }
        }
    }
    return removed;
}

// ── Helper: check if a word is a cell-subset of any placed word ──
function isWordEmbeddedInPlacedWord(word, occ, placedWords) {
    const occCells = new Set();
    for (let i = 0; i < occ.len; i++) {
        occCells.add(`${occ.startR + occ.dr * i},${occ.startC + occ.dc * i}`);
    }
    for (const pw of placedWords) {
        const pwCells = new Set();
        for (const { r, c } of pw.cells) pwCells.add(`${r},${c}`);
        if ([...occCells].every(c => pwCells.has(c))) return pw.word;
    }
    return null;
}

// ── Print grid ──
function printGrid(grid, size) {
    for (let r = 0; r < size; r++) {
        console.log('  ' + grid[r].join(' '));
    }
}

// ═══════════════════════════════════════════════════════════════════
// TEST CASES
// ═══════════════════════════════════════════════════════════════════

let totalTests = 0;
let totalPassed = 0;
let totalFailed = 0;

function assert(condition, msg) {
    totalTests++;
    if (condition) { totalPassed++; }
    else { totalFailed++; console.log(`  ❌ FAIL: ${msg}`); }
}

// ── TEST 1: Synthetic grid — NEATS placed, EAT/NEAT/EATS must be removed ──
console.log('\n═══ TEST 1: NEATS substring removal (horizontal) ═══');
{
    const size = 8;
    const grid = Array.from({ length: size }, () => Array(size).fill('X'));
    // Place NEATS at row 2, columns 1-5, going right
    const word = 'NEATS';
    const cells = [];
    for (let i = 0; i < word.length; i++) {
        grid[2][1 + i] = word[i];
        cells.push({ r: 2, c: 1 + i });
    }
    const placedWords = [{ word, cells, dir: [0, 1] }];
    const placedWordSet = new Set(['NEATS']);

    const { allValidWords, wordOccurrences } = scanGridForWords(grid, size, placedWords, placedWordSet);

    // Before removal — substrings should exist
    const subsBeforeRemoval = ['NEAT', 'EAT', 'EATS', 'ATE', 'AT'].filter(w => allValidWords.has(w));
    console.log(`  Substrings found before removal: ${subsBeforeRemoval.join(', ') || 'none'}`);

    const removed = removeStackedWords(allValidWords, wordOccurrences, placedWords, placedWordSet);
    console.log(`  Removed: ${[...removed].join(', ') || 'none'}`);

    // After removal — all substrings must be gone
    for (const sub of ['NEAT', 'EAT', 'EATS']) {
        if (DICTIONARY.has(sub)) {
            assert(!allValidWords.has(sub), `${sub} should be removed (embedded in NEATS)`);
        }
    }
    assert(allValidWords.has('NEATS'), 'NEATS itself must remain');
}

// ── TEST 2: Synthetic grid — STREAM placed, check embedded words ──
console.log('\n═══ TEST 2: STREAM substring removal (horizontal) ═══');
{
    const size = 10;
    const grid = Array.from({ length: size }, () => Array(size).fill('X'));
    const word = 'STREAM';
    const cells = [];
    for (let i = 0; i < word.length; i++) {
        grid[3][2 + i] = word[i];
        cells.push({ r: 3, c: 2 + i });
    }
    const placedWords = [{ word, cells, dir: [0, 1] }];
    const placedWordSet = new Set(['STREAM']);

    const { allValidWords, wordOccurrences } = scanGridForWords(grid, size, placedWords, placedWordSet);

    const subsBefore = [...allValidWords].filter(w => !placedWordSet.has(w));
    console.log(`  Accidental words before removal: ${subsBefore.join(', ') || 'none'}`);

    const removed = removeStackedWords(allValidWords, wordOccurrences, placedWords, placedWordSet);
    console.log(`  Removed: ${[...removed].join(', ') || 'none'}`);

    // Check known substrings
    for (const sub of ['REAM', 'TREAM', 'STRE', 'STREA', 'REA', 'EAM']) {
        if (DICTIONARY.has(sub)) {
            assert(!allValidWords.has(sub), `${sub} should be removed (embedded in STREAM)`);
        }
    }
    assert(allValidWords.has('STREAM'), 'STREAM itself must remain');
}

// ── TEST 3: Diagonal placement ──
console.log('\n═══ TEST 3: Diagonal placement — BEATS ═══');
{
    const size = 8;
    const grid = Array.from({ length: size }, () => Array(size).fill('X'));
    const word = 'BEATS';
    const cells = [];
    for (let i = 0; i < word.length; i++) {
        grid[1 + i][1 + i] = word[i];
        cells.push({ r: 1 + i, c: 1 + i });
    }
    const placedWords = [{ word, cells, dir: [1, 1] }];
    const placedWordSet = new Set(['BEATS']);

    const { allValidWords, wordOccurrences } = scanGridForWords(grid, size, placedWords, placedWordSet);

    const subsBefore = [...allValidWords].filter(w => !placedWordSet.has(w));
    console.log(`  Accidental words before removal: ${subsBefore.join(', ') || 'none'}`);

    const removed = removeStackedWords(allValidWords, wordOccurrences, placedWords, placedWordSet);
    console.log(`  Removed: ${[...removed].join(', ') || 'none'}`);

    for (const sub of ['BEAT', 'EAT', 'EATS', 'ATE', 'BEA', 'ATS']) {
        if (DICTIONARY.has(sub) && subsBefore.includes(sub)) {
            assert(!allValidWords.has(sub), `${sub} should be removed (embedded in BEATS diag)`);
        }
    }
}

// ── TEST 4: Reverse-direction reads ──
console.log('\n═══ TEST 4: Reverse direction — PARTS placed, check STRAP (reverse) ═══');
{
    const size = 8;
    const grid = Array.from({ length: size }, () => Array(size).fill('X'));
    const word = 'PARTS';
    const cells = [];
    for (let i = 0; i < word.length; i++) {
        grid[0][i] = word[i];
        cells.push({ r: 0, c: i });
    }
    const placedWords = [{ word, cells, dir: [0, 1] }];
    const placedWordSet = new Set(['PARTS']);

    const { allValidWords, wordOccurrences } = scanGridForWords(grid, size, placedWords, placedWordSet);

    // STRAP is PARTS reversed — check if it's found
    const reverseWord = 'STRAP';
    const hasReverse = allValidWords.has(reverseWord);
    console.log(`  STRAP (reverse of PARTS) found: ${hasReverse}`);

    const subsBefore = [...allValidWords].filter(w => !placedWordSet.has(w));
    console.log(`  Accidental words before removal: ${subsBefore.join(', ') || 'none'}`);

    const removed = removeStackedWords(allValidWords, wordOccurrences, placedWords, placedWordSet);
    console.log(`  Removed: ${[...removed].join(', ') || 'none'}`);

    // STRAP uses the same cells as PARTS in reverse — should be removed if it's not a placed word
    if (DICTIONARY.has('STRAP')) {
        assert(!allValidWords.has('STRAP'), 'STRAP should be removed (reverse of PARTS, same cells)');
    }
    // ART, PART, PAR etc embedded in PARTS
    for (const sub of ['ART', 'PART', 'PAR', 'RAP', 'TAR', 'TARP', 'TRAP', 'RAT', 'RATS', 'STAR', 'ARTS']) {
        if (DICTIONARY.has(sub) && subsBefore.includes(sub)) {
            assert(!allValidWords.has(sub), `${sub} should be removed (embedded in PARTS cells)`);
        }
    }
}

// ── TEST 5: Independent occurrence should SURVIVE ──
console.log('\n═══ TEST 5: Word with both embedded AND independent occurrences ═══');
{
    const size = 8;
    const grid = Array.from({ length: size }, () => Array(size).fill('X'));
    // Place EATS at row 0: E-A-T-S
    const word1 = 'EATS';
    const cells1 = [];
    for (let i = 0; i < word1.length; i++) {
        grid[0][i] = word1[i];
        cells1.push({ r: 0, c: i });
    }
    // Also place EAT independently at row 5: E-A-T
    grid[5][0] = 'E'; grid[5][1] = 'A'; grid[5][2] = 'T';

    const placedWords = [{ word: word1, cells: cells1, dir: [0, 1] }];
    const placedWordSet = new Set(['EATS']);

    const { allValidWords, wordOccurrences } = scanGridForWords(grid, size, placedWords, placedWordSet);

    // EAT should have 2 occurrences: one in EATS cells (embedded), one at row 5 (independent)
    const eatOccs = wordOccurrences.get('EAT') || [];
    console.log(`  EAT occurrences: ${eatOccs.length}`);
    for (const occ of eatOccs) {
        const embedded = isWordEmbeddedInPlacedWord('EAT', occ, placedWords);
        console.log(`    (${occ.startR},${occ.startC}) dir=(${occ.dr},${occ.dc}) len=${occ.len} → ${embedded ? `embedded in ${embedded}` : 'INDEPENDENT'}`);
    }

    const removed = removeStackedWords(allValidWords, wordOccurrences, placedWords, placedWordSet);
    console.log(`  Removed: ${[...removed].join(', ') || 'none'}`);

    if (DICTIONARY.has('EAT')) {
        assert(allValidWords.has('EAT'), 'EAT must SURVIVE (has independent occurrence at row 5)');
    }
}

// ── TEST 6: OLD algorithm comparison — find bugs ──
console.log('\n═══ TEST 6: Compare OLD vs NEW algorithm on random grids ═══');
{
    const ITERATIONS = 200;
    let oldMisses = 0; // Words old algo failed to remove that new algo removes
    let oldOverRemoves = 0; // Words old algo removed that new algo keeps
    let oldMissExamples = [];
    let oldOverExamples = [];

    // Carefully crafted problematic word lists
    const problemWordLists = [
        ['NEATS', 'CLIMB', 'FROST'],
        ['STREAM', 'BLOCK', 'HUNTS'],
        ['BEATS', 'GLOW', 'FRINDS'],
        ['PARTS', 'GRIME', 'STUN'],
        ['CLEARS', 'BOND', 'WHISK'],
        ['TREATS', 'BLOWN', 'GUMPS'],
        ['BLEATS', 'CROWN', 'JUMPS'],
        ['COASTS', 'VIPER', 'BLEND'],
        ['STARTS', 'PLUME', 'GRIND'],
        ['HEARTS', 'SCOPE', 'BLIND'],
    ];

    for (let iter = 0; iter < ITERATIONS; iter++) {
        const wordList = iter < problemWordLists.length
            ? problemWordLists[iter]
            : problemWordLists[Math.floor(Math.random() * problemWordLists.length)];

        const validWords = wordList.filter(w => DICTIONARY.has(w));
        if (validWords.length === 0) continue;

        const size = 8;
        const { grid, placedWords } = generateGrid(size, validWords);
        const placedWordSet = new Set(placedWords.map(pw => pw.word));

        // Run NEW algorithm
        const { allValidWords: newValid, wordOccurrences: newOccs } =
            scanGridForWords(grid, size, placedWords, placedWordSet);
        const newRemoved = removeStackedWords(newValid, newOccs, placedWords, placedWordSet);

        // Run OLD algorithm on fresh scan
        const { allValidWords: oldValid, wordOccurrences: oldOccs } =
            scanGridForWords(grid, size, placedWords, placedWordSet);
        const oldRemoved = removeStackedWordsOld(oldValid, oldOccs, placedWords, placedWordSet);

        // Compare
        for (const w of newRemoved) {
            if (!oldRemoved.has(w)) {
                oldMisses++;
                if (oldMissExamples.length < 5) {
                    oldMissExamples.push({ word: w, placed: [...placedWordSet].join(', ') });
                }
            }
        }
        // Check: did old algo remove something that has an independent occurrence?
        // (This would be an over-removal bug)
        // We can detect this by checking if the word was removed by old but kept by new
        for (const w of oldRemoved) {
            if (!newRemoved.has(w) && newValid.has(w)) {
                oldOverRemoves++;
                if (oldOverExamples.length < 5) {
                    oldOverExamples.push({ word: w, placed: [...placedWordSet].join(', ') });
                }
            }
        }
    }

    console.log(`  Ran ${ITERATIONS} iterations`);
    console.log(`  OLD algo missed (new caught): ${oldMisses}`);
    if (oldMissExamples.length > 0) {
        for (const ex of oldMissExamples) {
            console.log(`    → "${ex.word}" (placed: ${ex.placed})`);
        }
    }
    console.log(`  OLD algo over-removed (new keeps): ${oldOverRemoves}`);
    if (oldOverExamples.length > 0) {
        for (const ex of oldOverExamples) {
            console.log(`    → "${ex.word}" (placed: ${ex.placed})`);
        }
    }
    assert(oldMisses > 0 || ITERATIONS < 10, 'Expected old algorithm to miss some stacked words vs new (confirms the bug)');
}

// ── TEST 7: Stress test — many random grids, verify NO stacking words survive ──
console.log('\n═══ TEST 7: Stress test — verify zero stacking words with NEW algorithm ═══');
{
    const ITERATIONS = 500;
    let failures = 0;
    let failExamples = [];

    // Build a pool of 5-7 letter words known to contain substrings
    const longWords = [...DICTIONARY].filter(w => w.length >= 5 && w.length <= 7);
    const subWords = [...DICTIONARY].filter(w => w.length >= 3 && w.length <= 4);

    for (let iter = 0; iter < ITERATIONS; iter++) {
        // Pick 3-5 random long words
        const count = 3 + Math.floor(Math.random() * 3);
        const words = [];
        for (let i = 0; i < count; i++) {
            words.push(longWords[Math.floor(Math.random() * longWords.length)]);
        }
        // Dedupe
        const unique = [...new Set(words)];
        if (unique.length < 2) continue;

        const size = 10;
        const { grid, placedWords } = generateGrid(size, unique);
        if (placedWords.length === 0) continue;
        const placedWordSet = new Set(placedWords.map(pw => pw.word));

        const { allValidWords, wordOccurrences } = scanGridForWords(grid, size, placedWords, placedWordSet);
        removeStackedWords(allValidWords, wordOccurrences, placedWords, placedWordSet);

        // Verify: no remaining accidental word should have ALL occurrences embedded
        const placedCellSets = placedWords.map(pw => {
            const cs = new Set();
            for (const { r, c } of pw.cells) cs.add(`${r},${c}`);
            return cs;
        });

        for (const [word, occs] of wordOccurrences) {
            if (placedWordSet.has(word)) continue;
            if (!allValidWords.has(word)) continue; // already removed

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

            if (allEmbedded) {
                failures++;
                if (failExamples.length < 5) {
                    failExamples.push({ word, placed: [...placedWordSet].join(', '), iter });
                }
            }
        }
    }

    console.log(`  Ran ${ITERATIONS} grids`);
    console.log(`  Stacking words that survived: ${failures}`);
    if (failExamples.length > 0) {
        for (const ex of failExamples) {
            console.log(`    → "${ex.word}" (placed: ${ex.placed}) [iter ${ex.iter}]`);
        }
    }
    assert(failures === 0, `No stacking words should survive — found ${failures}`);
}

// ── TEST 8: Crossing words ──
console.log('\n═══ TEST 8: Two placed words crossing — derivative check ═══');
{
    const size = 10;
    const grid = Array.from({ length: size }, () => Array(size).fill('X'));
    // CATS horizontal at row 3: C(3,2) A(3,3) T(3,4) S(3,5)
    const cells1 = [];
    for (let i = 0; i < 4; i++) { grid[3][2 + i] = 'CATS'[i]; cells1.push({ r: 3, c: 2 + i }); }
    // STEM vertical at col 5: S(1,5) T(2,5) E(3,5) M(4,5)
    // Wait, cell (3,5) is already S from CATS. STEM[2]='E' but CATS puts S at (3,5). Conflict.
    // Let me use a word that shares a letter.
    // CATS horizontal: C(3,2) A(3,3) T(3,4) S(3,5)
    // TASTE vertical at col 4: T(1,4) A(2,4) S(3,4) T(4,4) E(5,4)
    // But (3,4) is T from CATS and S from TASTE pos 2. Conflict.
    // Let me pick words that actually share a letter at the cross:
    // CATS at row 3: C(3,2) A(3,3) T(3,4) S(3,5)
    // ATLAS vertical at col 3: A(1,3) T(2,3) L(3,3)... but (3,3) is A from CATS, L conflicts.
    // Simple approach: CATS horizontal, MATS vertical sharing A
    // CATS: C(3,2) A(3,3) T(3,4) S(3,5)
    // BARN vertical: B(1,3) A(2,3)... no, (3,3) is A. We need col 3 with A at row 3.
    // BALL vertical: B(1,3) A(2,3) L(3,3) conflicts with A at (3,3)
    // Let's place something that crosses at A(3,3):
    // WAR vertical at col 3: W(2,3) A(3,3) R(4,3) — shares A
    grid[2][3] = 'W'; grid[4][3] = 'R';  // WAR shares A at (3,3) with CATS
    const cells2 = [{ r: 2, c: 3 }, { r: 3, c: 3 }, { r: 4, c: 3 }];

    const placedWords = [
        { word: 'CATS', cells: cells1, dir: [0, 1] },
        { word: 'WAR', cells: cells2, dir: [1, 0] },
    ];
    const placedWordSet = new Set(['CATS', 'WAR']);

    const { allValidWords, wordOccurrences } = scanGridForWords(grid, size, placedWords, placedWordSet);
    const subsBefore = [...allValidWords].filter(w => !placedWordSet.has(w));
    console.log(`  Accidental words before removal: ${subsBefore.join(', ') || 'none'}`);

    const removed = removeStackedWords(allValidWords, wordOccurrences, placedWords, placedWordSet);
    console.log(`  Removed: ${[...removed].join(', ') || 'none'}`);

    // CAT is embedded in CATS — should be removed
    if (DICTIONARY.has('CAT')) {
        assert(!allValidWords.has('CAT'), 'CAT should be removed (embedded in CATS)');
    }
    // AT is too short with minLen=3, but ATS might be found
    // WAR substrings would only be 2-letter (WA, AR) — too short
    assert(allValidWords.has('CATS'), 'CATS must remain');
    assert(allValidWords.has('WAR'), 'WAR must remain');
}

// ═══════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════
console.log('\n═══════════════════════════════════════════');
console.log(`  TOTAL: ${totalTests} tests | ✅ ${totalPassed} passed | ❌ ${totalFailed} failed`);
console.log('═══════════════════════════════════════════\n');

process.exit(totalFailed > 0 ? 1 : 0);
