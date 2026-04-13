// find-missing-wordnet.js — Identify words not in WordNet
const fs = require('fs');
const path = require('path');
const wordnetPath = require('wordnet-db').path;

// Parse all words that appear in WordNet data files
const knownWords = new Set();
for (const file of ['data.noun', 'data.verb', 'data.adj', 'data.adv']) {
    const lines = fs.readFileSync(path.join(wordnetPath, file), 'utf8').split('\n');
    for (const line of lines) {
        if (line.startsWith(' ') || !line.length) continue;
        const parts = line.split(' ');
        const wCnt = parseInt(parts[3], 16);
        let idx = 4;
        for (let i = 0; i < wCnt; i++) {
            const w = parts[idx].toLowerCase();
            if (/^[a-z]+$/.test(w)) knownWords.add(w);
            idx += 2;
        }
    }
}
console.log(`WordNet knows ${knownWords.size} unique words`);

// Extract base words from rebuild-words.js
const src = fs.readFileSync(path.join(__dirname, 'rebuild-words.js'), 'utf8');
const allWords = new Set();
const listNames = [
    'NOUNS', 'VERBS', 'ADJECTIVES', 'OTHER_WORDS', 'MANUAL_EXTRAS',
    'CATEGORY_FOOD', 'CATEGORY_ANIMALS', 'TWO_LETTER_WORDS', 'CONTRACTIONS',
];
for (const name of listNames) {
    const re = new RegExp(`const\\s+${name}\\s*=\\s*\`([\\s\\S]*?)\``, 'm');
    const m = src.match(re);
    if (m) {
        m[1].split(/\s+/).filter(w => /^[a-z]+$/i.test(w)).forEach(w => allWords.add(w.toLowerCase()));
    }
}
console.log(`Base words: ${allWords.size}`);

// Find missing
const missing = [...allWords].filter(w => !knownWords.has(w)).sort();
console.log(`Missing from WordNet: ${missing.length}\n`);
console.log(missing.join('\n'));
fs.writeFileSync(path.join(__dirname, '_missing_from_wordnet.txt'), missing.join('\n'));
