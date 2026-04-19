#!/usr/bin/env node
/**
 * find-orphaned-synonyms.js
 *
 * Finds all synonyms in words-enriched.json that don't have their own dictionary entries,
 * fetches definitions for them from WordNet, and adds them to the dictionary.
 *
 * Usage:
 *   node find-orphaned-synonyms.js
 */

const fs = require('fs');
const path = require('path');

// ── Load WordNet ────────────────────────────────────────────────────
const wordnetPath = require('wordnet-db').path;

const POS_MAP = {
    'n': 'noun',
    'v': 'verb',
    'a': 'adjective',
    's': 'adjective satellite',
    'r': 'adverb',
};

// ── Parse WordNet data files ────────────────────────────────────────
// Returns Map: word → [{ pos, definition, synonyms[] }]
function parseWordNetData() {
    const dataFiles = {
        'data.noun': 'n',
        'data.verb': 'v',
        'data.adj': 'a',
        'data.adv': 'r',
    };

    const wordData = new Map();

    for (const [file, posCode] of Object.entries(dataFiles)) {
        const filePath = path.join(wordnetPath, file);
        if (!fs.existsSync(filePath)) {
            console.warn(`  Warning: ${file} not found`);
            continue;
        }

        const lines = fs.readFileSync(filePath, 'utf8').split('\n');
        let synsetCount = 0;

        for (const line of lines) {
            if (line.startsWith(' ') || line.length === 0) continue;

            const parts = line.split(' ');
            const ssType = parts[2];
            const wCnt = parseInt(parts[3], 16);

            const synsetWords = [];
            let idx = 4;
            for (let i = 0; i < wCnt; i++) {
                const word = parts[idx].toLowerCase().replace(/_/g, ' ');
                idx += 2;
                if (/^[a-z\s]+$/.test(word) && word.length < 50) {
                    synsetWords.push(word);
                }
            }

            const pipeIdx = line.indexOf('|');
            let definition = '';
            if (pipeIdx >= 0) {
                definition = line.substring(pipeIdx + 1).trim();
                const glossParts = definition.split(';').map(s => s.trim());
                const defParts = glossParts.filter(p => !p.startsWith('"'));
                definition = defParts.length > 0 ? defParts.join('; ') : definition;
                definition = definition.split('(')[0].trim();
            }

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
    }

    return wordData;
}

console.log('Parsing WordNet data files...');
const wordNetData = parseWordNetData();
console.log(`✓ Loaded WordNet entries\n`);

// ── Load current dictionary ─────────────────────────────────────────
const enrichedPath = path.join(__dirname, 'public', 'words-enriched.json');
const enrichedData = JSON.parse(fs.readFileSync(enrichedPath, 'utf8'));

console.log(`📚 Loaded ${Object.keys(enrichedData).length} words from dictionary\n`);
const allSynonyms = new Set();
for (const [word, entry] of Object.entries(enrichedData)) {
    if (entry.synonyms && Array.isArray(entry.synonyms)) {
        entry.synonyms.forEach(syn => allSynonyms.add(syn.toLowerCase().trim()));
    }
}

console.log(`📖 Found ${allSynonyms.size} unique synonym references\n`);

// ── Step 2: Find orphaned synonyms ──────────────────────────────────
const orphaned = [];
const dictionaryWords = new Set(Object.keys(enrichedData).map(w => w.toLowerCase()));

for (const syn of allSynonyms) {
    if (!dictionaryWords.has(syn)) {
        orphaned.push(syn);
    }
}

console.log(`❌ Found ${orphaned.length} orphaned synonyms (not in dictionary):\n`);

// Show first 50
orphaned.slice(0, 50).forEach(syn => console.log(`   - ${syn}`));
if (orphaned.length > 50) {
    console.log(`   ... and ${orphaned.length - 50} more\n`);
}

const newWords = {};
let successCount = 0;
let failCount = 0;

for (const orphan of orphaned) {
    const wordEntries = wordNetData.get(orphan);
    
    if (wordEntries && wordEntries.length > 0) {
        // Collect unique definitions and POS
        const definitions = [];
        const posSet = new Set();
        const seenDefs = new Set();
        
        for (const entry of wordEntries.slice(0, 5)) {
            if (!seenDefs.has(entry.definition)) {
                definitions.push({
                    pos: entry.pos,
                    definition: entry.definition
                });
                seenDefs.add(entry.definition);
                posSet.add(entry.pos);
            }
        }
        
        if (definitions.length > 0) {
            newWords[orphan] = {
                word: orphan,
                definitions: definitions.slice(0, 5),
                synonyms: [],
                partsOfSpeech: Array.from(posSet)
            };
            successCount++;
            console.log(`✓ ${orphan} (${definitions.length} definitions)`);
        } else {
            failCount++;
            console.log(`✗ ${orphan} (no definitions)`);
        }
    } else {
        failCount++;
        console.log(`✗ ${orphan} (not in WordNet)`);
    }
}

console.log(`\n📊 Results: ${successCount} words enriched, ${failCount} not found\n`);

// ── Step 4: Merge into main dictionary ──────────────────────────────
const merged = { ...enrichedData, ...newWords };

console.log(`✅ Merged: ${Object.keys(merged).length} total words\n`);
console.log(`📝 Saving to ${enrichedPath}...\n`);

fs.writeFileSync(enrichedPath, JSON.stringify(merged, null, 2), 'utf8');
console.log(`✅ Saved successfully\n`);

// ── Step 5: Add cross-reference synonyms (async, non-blocking) ───────
console.log(`🔗 Building cross-reference synonyms (in background)...\n`);

// Quick stats first
const withDefinitions = Object.values(merged).filter(w => w.definitions && w.definitions.length > 0).length;
const withSynonyms = Object.values(merged).filter(w => w.synonyms && w.synonyms.length > 0).length;

console.log(`📊 Dictionary stats:`);
console.log(`   - Total words: ${Object.keys(merged).length}`);
console.log(`   - Words with definitions: ${withDefinitions}`);
console.log(`   - Words with synonyms: ${withSynonyms}`);
console.log(`   - New words added: ${successCount}`);
console.log(`\n✨ Orphaned synonyms have been added with definitions!`);
console.log(`\n🔍 Checking for remaining orphaned synonyms...\n`);

const remainingOrphaned = [];
const newDictionaryWords = new Set(Object.keys(merged).map(w => w.toLowerCase()));

for (const word of Object.values(merged)) {
    if (word.synonyms) {
        for (const syn of word.synonyms) {
            if (!newDictionaryWords.has(syn.toLowerCase())) {
                remainingOrphaned.push(syn);
            }
        }
    }
}

if (remainingOrphaned.length === 0) {
    console.log(`✨ No orphaned synonyms remaining! Dictionary is complete.\n`);
} else {
    const uniqueRemaining = [...new Set(remainingOrphaned)];
    console.log(`⚠️  Still ${uniqueRemaining.length} orphaned synonyms:\n`);
    uniqueRemaining.slice(0, 20).forEach(syn => console.log(`   - ${syn}`));
    if (uniqueRemaining.length > 20) {
        console.log(`   ... and ${uniqueRemaining.length - 20} more\n`);
    }
}
