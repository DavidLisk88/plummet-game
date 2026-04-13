#!/usr/bin/env node
/**
 * enrich-words.js — Smart Thesaurus / Word Enrichment Script
 *
 * Reads all base words from rebuild-words.js and enriches each with:
 *   - Definitions (from WordNet glosses)
 *   - Synonyms (from WordNet synsets + Datamuse API)
 *   - Part of speech
 *   - Related words (hypernyms, similar-to)
 *
 * Uses:
 *   1. WordNet 3.0 (local, via wordnet-db) — definitions + synonym sets
 *   2. Datamuse API (free, no key) — supplemental synonyms & related words
 *
 * Output: words-enriched.json
 *
 * Usage:
 *   node enrich-words.js                   # Full enrichment (WordNet + Datamuse)
 *   node enrich-words.js --offline          # WordNet only (no API calls)
 *   node enrich-words.js --word hello       # Enrich a single word (for testing)
 *   node enrich-words.js --stats            # Print stats only, don't write file
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ── Parse CLI flags ─────────────────────────────────────────────────
const args = process.argv.slice(2);
const OFFLINE = args.includes('--offline');
const STATS_ONLY = args.includes('--stats');
const MERGE = args.includes('--merge');
const SINGLE_WORD = args.includes('--word') ? args[args.indexOf('--word') + 1] : null;

// ── Load WordNet DB ─────────────────────────────────────────────────
const wordnetPath = require('wordnet-db').path;

const POS_MAP = {
    'n': 'noun',
    'v': 'verb',
    'a': 'adjective',
    's': 'adjective satellite',
    'r': 'adverb',
};

// ── Parse WordNet data files ────────────────────────────────────────
// Each line: synset_offset lex_filenum ss_type w_cnt word1 lex_id1 ... | gloss
function parseWordNetData() {
    const dataFiles = {
        'data.noun': 'n',
        'data.verb': 'v',
        'data.adj': 'a',
        'data.adv': 'r',
    };

    // word → [{ pos, definition, synonyms[], pointers[] }]
    const wordData = new Map();

    for (const [file, posCode] of Object.entries(dataFiles)) {
        const filePath = path.join(wordnetPath, file);
        if (!fs.existsSync(filePath)) {
            console.warn(`  Warning: ${file} not found at ${filePath}`);
            continue;
        }

        const lines = fs.readFileSync(filePath, 'utf8').split('\n');
        let synsetCount = 0;

        for (const line of lines) {
            // Skip comment lines (start with spaces)
            if (line.startsWith(' ') || line.length === 0) continue;

            const parts = line.split(' ');
            // synset_offset = parts[0], lex_filenum = parts[1], ss_type = parts[2]
            const ssType = parts[2]; // n, v, a, s, r
            const wCnt = parseInt(parts[3], 16); // hex word count

            // Extract words in this synset
            const synsetWords = [];
            let idx = 4;
            for (let i = 0; i < wCnt; i++) {
                const word = parts[idx].toLowerCase().replace(/_/g, ' ');
                idx += 2; // skip lex_id
                if (/^[a-z]+$/.test(word)) { // single alpha words only
                    synsetWords.push(word);
                }
            }

            // Extract gloss (definition) — everything after |
            const pipeIdx = line.indexOf('|');
            const gloss = pipeIdx >= 0 ? line.substring(pipeIdx + 1).trim() : '';

            // Clean up the gloss: take just the definition, not example sentences
            // Definitions end at the first ";" usually, examples are in quotes
            let definition = gloss;
            // Split on ; and take parts that aren't example sentences (in quotes)
            const glossParts = gloss.split(';').map(s => s.trim());
            const defParts = glossParts.filter(p => !p.startsWith('"'));
            if (defParts.length > 0) {
                definition = defParts.join('; ');
            }

            // For each word, store synset data
            for (const word of synsetWords) {
                if (!wordData.has(word)) {
                    wordData.set(word, []);
                }
                const synonyms = synsetWords.filter(w => w !== word);
                wordData.get(word).push({
                    pos: POS_MAP[ssType] || ssType,
                    definition,
                    synonyms,
                });
            }

            synsetCount++;
        }

        console.log(`  Parsed ${file}: ${synsetCount} synsets`);
    }

    return wordData;
}

// ── Extract base words from rebuild-words.js ────────────────────────
function extractBaseWords() {
    const src = fs.readFileSync(path.join(__dirname, 'rebuild-words.js'), 'utf8');

    // Match all the template literal word lists
    const listNames = [
        'NOUNS', 'VERBS', 'ADJECTIVES', 'OTHER_WORDS', 'MANUAL_EXTRAS',
        'CATEGORY_FOOD', 'CATEGORY_ANIMALS', 'CATEGORY_SPORTS', 'CATEGORY_NATURE',
        'CATEGORY_TECHNOLOGY', 'CATEGORY_BODY', 'CATEGORY_MUSIC', 'CATEGORY_HOME',
        'CATEGORY_CLOTHING', 'CATEGORY_SCIENCE', 'WORDNET_EXTRAS',
    ];

    const allWords = new Set();

    // Generic approach: find all `const NAME = \`...\`` blocks
    for (const name of listNames) {
        const regex = new RegExp(`const\\s+${name}\\s*=\\s*\`([\\s\\S]*?)\``, 'm');
        const match = src.match(regex);
        if (match) {
            const words = match[1].split(/\s+/).filter(w => /^[a-z]{2,}$/i.test(w));
            words.forEach(w => allWords.add(w.toLowerCase()));
        }
    }

    // Also grab TWO_LETTER_WORDS
    const twoLetterMatch = src.match(/const\s+TWO_LETTER_WORDS\s*=\s*`([\s\S]*?)`/m);
    if (twoLetterMatch) {
        const words = twoLetterMatch[1].split(/\s+/).filter(w => /^[a-z]{2}$/i.test(w));
        words.forEach(w => allWords.add(w.toLowerCase()));
    }

    // Grab CONTRACTIONS
    const contractMatch = src.match(/const\s+CONTRACTIONS\s*=\s*`([\s\S]*?)`/m);
    if (contractMatch) {
        const words = contractMatch[1].split(/\s+/).filter(w => /^[a-z]{2,}$/i.test(w));
        words.forEach(w => allWords.add(w.toLowerCase()));
    }

    return [...allWords].sort();
}

// ── Datamuse API (free, no key) ─────────────────────────────────────
// Rate limit: ~100k/day, but we'll be polite with delays
function fetchDatamuse(word) {
    return new Promise((resolve, reject) => {
        const url = `https://api.datamuse.com/words?rel_syn=${encodeURIComponent(word)}&max=10`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const results = JSON.parse(data);
                    resolve(results.map(r => r.word).filter(w => /^[a-z]+$/.test(w)));
                } catch {
                    resolve([]);
                }
            });
        }).on('error', () => resolve([]));
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
    console.log('=== Word Enrichment ===\n');

    // 1. Extract base words
    console.log('Extracting base words from rebuild-words.js...');
    let baseWords = extractBaseWords();
    console.log(`  Found ${baseWords.length} unique base words\n`);

    // Load existing enriched data for merge mode
    let existingEnriched = {};
    if (MERGE) {
        const enrichedPath = path.join(__dirname, 'words-enriched.json');
        if (fs.existsSync(enrichedPath)) {
            existingEnriched = JSON.parse(fs.readFileSync(enrichedPath, 'utf8'));
            const existingCount = Object.keys(existingEnriched).length;
            const before = baseWords.length;
            baseWords = baseWords.filter(w => !existingEnriched[w]);
            console.log(`  --merge: Loaded ${existingCount} existing entries`);
            console.log(`  --merge: Skipping ${before - baseWords.length} already-enriched words`);
            console.log(`  --merge: ${baseWords.length} words to process\n`);
        }
    }

    if (SINGLE_WORD) {
        baseWords = [SINGLE_WORD.toLowerCase()];
        console.log(`  (Single word mode: "${SINGLE_WORD}")\n`);
    }

    // 2. Parse WordNet
    console.log('Parsing WordNet 3.0 database...');
    const wordnetData = parseWordNetData();
    console.log(`  WordNet has data for ${wordnetData.size} unique words\n`);

    // 3. Enrich each word
    console.log('Enriching words...');
    const enriched = {};
    let found = 0;
    let notFound = 0;
    let apiCalls = 0;

    for (let i = 0; i < baseWords.length; i++) {
        const word = baseWords[i];
        const entry = {
            word,
            definitions: [],
            synonyms: [],
            partsOfSpeech: [],
        };

        // WordNet data
        const wnEntries = wordnetData.get(word);
        if (wnEntries && wnEntries.length > 0) {
            found++;
            const posSet = new Set();
            const synSet = new Set();
            const defsSeen = new Set();

            for (const wn of wnEntries) {
                posSet.add(wn.pos);
                wn.synonyms.forEach(s => synSet.add(s));

                // Deduplicate definitions
                const defKey = wn.definition.substring(0, 80);
                if (!defsSeen.has(defKey)) {
                    defsSeen.add(defKey);
                    entry.definitions.push({
                        pos: wn.pos,
                        definition: wn.definition,
                    });
                }
            }

            entry.partsOfSpeech = [...posSet];
            entry.synonyms = [...synSet];
        } else {
            notFound++;
        }

        // Datamuse API for additional synonyms (unless offline mode)
        if (!OFFLINE && !STATS_ONLY) {
            // Only call API for words that have few synonyms from WordNet
            if (entry.synonyms.length < 3) {
                try {
                    const apiSyns = await fetchDatamuse(word);
                    apiCalls++;
                    // Merge with existing, deduplicate
                    const synSet = new Set(entry.synonyms);
                    apiSyns.forEach(s => synSet.add(s));
                    entry.synonyms = [...synSet];
                } catch { /* skip */ }

                // Be polite: ~50ms between API calls
                if (apiCalls % 10 === 0) await delay(50);
            }
        }

        // Limit definitions to top 5 to keep file size reasonable
        if (entry.definitions.length > 5) {
            entry.definitions = entry.definitions.slice(0, 5);
        }

        // Limit synonyms to top 15
        if (entry.synonyms.length > 15) {
            entry.synonyms = entry.synonyms.slice(0, 15);
        }

        // Only include words that have at least some data
        if (entry.definitions.length > 0 || entry.synonyms.length > 0) {
            enriched[word] = entry;
        }

        // Progress
        if ((i + 1) % 500 === 0 || i === baseWords.length - 1) {
            process.stdout.write(`\r  Processed ${i + 1}/${baseWords.length} words`);
        }
    }

    console.log('\n');

    // 4. Stats
    const enrichedCount = Object.keys(enriched).length;
    const totalDefs = Object.values(enriched).reduce((sum, e) => sum + e.definitions.length, 0);
    const totalSyns = Object.values(enriched).reduce((sum, e) => sum + e.synonyms.length, 0);
    const avgDefs = enrichedCount > 0 ? (totalDefs / enrichedCount).toFixed(1) : 0;
    const avgSyns = enrichedCount > 0 ? (totalSyns / enrichedCount).toFixed(1) : 0;

    console.log('=== Results ===');
    console.log(`  Base words:        ${baseWords.length}`);
    console.log(`  WordNet matches:   ${found}`);
    console.log(`  Not in WordNet:    ${notFound}`);
    console.log(`  Enriched entries:  ${enrichedCount}`);
    console.log(`  Total definitions: ${totalDefs} (avg ${avgDefs}/word)`);
    console.log(`  Total synonyms:    ${totalSyns} (avg ${avgSyns}/word)`);
    if (!OFFLINE) console.log(`  Datamuse API calls: ${apiCalls}`);

    if (SINGLE_WORD && enriched[SINGLE_WORD.toLowerCase()]) {
        console.log(`\n--- "${SINGLE_WORD}" ---`);
        const e = enriched[SINGLE_WORD.toLowerCase()];
        console.log(`  POS: ${e.partsOfSpeech.join(', ')}`);
        console.log(`  Synonyms: ${e.synonyms.join(', ') || '(none)'}`);
        for (const d of e.definitions) {
            console.log(`  [${d.pos}] ${d.definition}`);
        }
        return;
    }

    // 5. Write output
    if (!STATS_ONLY) {
        // Merge with existing entries if --merge mode
        const finalEnriched = MERGE ? { ...existingEnriched, ...enriched } : enriched;
        const outPath = path.join(__dirname, 'words-enriched.json');
        fs.writeFileSync(outPath, JSON.stringify(finalEnriched, null, 2));
        const totalEntries = Object.keys(finalEnriched).length;
        console.log(`\n  Written to: ${outPath}`);
        console.log(`  Total entries: ${totalEntries}${MERGE ? ` (${Object.keys(existingEnriched).length} existing + ${Object.keys(enriched).length} new)` : ''}`);
        const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
        console.log(`  File size: ${sizeMB} MB`);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
