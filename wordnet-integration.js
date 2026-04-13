#!/usr/bin/env node
/**
 * WordNet 3.0 Integration Script
 * 
 * Extracts 4+ letter words from WordNet 3.0 that are NOT already in the
 * current dictionary, and injects them into rebuild-words.js as WORDNET_EXTRAS.
 * 
 * Filters:
 *   - 4+ letters, alpha-only, single-word (no compounds/hyphens)
 *   - Must exist in an-array-of-english-words (275K known English words)
 *   - Must have 2+ WordNet senses (polysemy filter — removes obscure/technical junk)
 *   - Not in BANNED list
 *   - Not already in the current words.json dictionary
 * 
 * Usage: node wordnet-integration.js [--dry-run] [--stats]
 */

const fs = require('fs');
const path = require('path');

// ── Load data sources ───────────────────────────────────────────────
const wordnetPath = require('wordnet-db').path;
const englishWords = new Set(require('an-array-of-english-words'));

// ── Load current dictionary ─────────────────────────────────────────
const wordsJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'words.json'), 'utf8'));
const currentWords = new Set(
    (Array.isArray(wordsJson) ? wordsJson : wordsJson.words).map(w => w.toLowerCase())
);
console.log(`Current dictionary: ${currentWords.size} words`);

// ── Load banned words from rebuild-words.js ─────────────────────────
const BANNED = new Set([
    'faggot','vagina','retard','retarded','bitch','fuck','fucker','hitler','nazi',
    'nigger','nigga','midget','whore','cum','penis','bitches','hoes','hoe','jizz',
    'weewee','dick','dicks','penises','whores','slutty','pussy','pussies','kike',
    'shit','shitter','shitty','slut','cunt','cunts','arse','arses','wanker','twat',
    'bollocks','cocksucker','motherfucker','asshole','ass','damn','bastard','piss',
    'crap','tits','boobs','hooker','pimp','dildo','orgasm','anal','rape','raped',
    'raping','rapist','molest','pedophile','incest','fag','fags','dyke','homo',
    'queer','lesbo','pervert','pedo','negro','spic','chink','gook','wetback',
    'beaner','coon','darkie','honky','gringo','jap','tranny','heil','slits',
    'fucked','fucking','fucks','shits','shitting','bitching','cunting','rapes',
    'pissed','pissing','dicks','asses','sluts','whored','whoring',
]);

// ── Parse WordNet index files (with sense count) ────────────────────
function parseWordNetIndex(filename) {
    const filePath = path.join(wordnetPath, filename);
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const words = [];
    for (const line of lines) {
        if (line.startsWith(' ') || line.length === 0) continue;
        const lemma = line.split(' ')[0];
        if (lemma.includes('_') || lemma.includes('-') || lemma.includes('.')) continue;
        if (!/^[a-z]{4,}$/.test(lemma)) continue;
        // 3rd field = synset_cnt (number of senses for this POS)
        const senseCount = parseInt(line.split(' ')[2]) || 1;
        words.push({ word: lemma, senses: senseCount });
    }
    return words;
}

// Collect all words with their max sense count across POS
const wordSenses = new Map();
const posFiles = ['index.noun', 'index.verb', 'index.adj', 'index.adv'];
const posCounts = {};

for (const file of posFiles) {
    const words = parseWordNetIndex(file);
    const pos = file.replace('index.', '');
    posCounts[pos] = words.length;
    for (const { word, senses } of words) {
        wordSenses.set(word, Math.max(wordSenses.get(word) || 0, senses));
    }
}

console.log(`\nWordNet 3.0 (4+ letter, alpha-only, single-word):`);
for (const [pos, count] of Object.entries(posCounts)) {
    console.log(`  ${pos}: ${count}`);
}
console.log(`  unique: ${wordSenses.size}`);

// ── Filter to new words only ────────────────────────────────────────
const newWords = [];
let skipped = { alreadyHave: 0, obscure: 0, oneSense: 0, banned: 0 };

for (const [word, senses] of wordSenses) {
    if (BANNED.has(word))          { skipped.banned++;      continue; }
    if (currentWords.has(word))    { skipped.alreadyHave++; continue; }
    if (senses < 2)                { skipped.oneSense++;    continue; }
    if (!englishWords.has(word))   { skipped.obscure++;     continue; }
    newWords.push(word);
}

newWords.sort();

console.log(`\nResults:`);
console.log(`  Already in dictionary:  ${skipped.alreadyHave}`);
console.log(`  Only 1 sense (skip):    ${skipped.oneSense}`);
console.log(`  Not in English list:    ${skipped.obscure}`);
console.log(`  Banned:                 ${skipped.banned}`);
console.log(`  NEW WORDS TO ADD:       ${newWords.length}`);

// ── CLI flags ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const showStats = args.includes('--stats');

if (showStats) {
    console.log(`\n── Sample new words (first 80) ──`);
    console.log(newWords.slice(0, 80).join(', '));
    console.log(`\n── Sample new words (random middle 40) ──`);
    const mid = Math.floor(newWords.length / 2);
    console.log(newWords.slice(mid, mid + 40).join(', '));
}

if (dryRun) {
    console.log(`\n[DRY RUN] No files modified.`);
    process.exit(0);
}

// ── Write the WordNet extras into rebuild-words.js ──────────────────
const rebuildPath = path.join(__dirname, 'rebuild-words.js');
const rebuildSrc = fs.readFileSync(rebuildPath, 'utf8');

// Format words as wrapped lines (80 chars)
function formatWordBlock(words) {
    const lines = [];
    let currentLine = '';
    for (const word of words) {
        if (currentLine.length + word.length + 1 > 80) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = currentLine ? currentLine + ' ' + word : word;
        }
    }
    if (currentLine) lines.push(currentLine);
    return lines.join('\n');
}

const blockContent = `// ─── WordNet 3.0 extras (auto-generated by wordnet-integration.js) ────
// ${newWords.length} new words from WordNet 3.0 (4+ letters, 2+ senses, known English, not already in dict)
const WORDNET_EXTRAS = \`
${formatWordBlock(newWords)}
\`.split(/\\s+/).filter(w => w.length >= 4);
// ─── End WordNet 3.0 extras
`;

// Check if already integrated
if (rebuildSrc.includes('WORDNET_EXTRAS')) {
    console.log(`\nWORDNET_EXTRAS already exists — updating...`);
    const startMarker = '// ─── WordNet 3.0 extras';
    const endMarker = '// ─── End WordNet 3.0 extras';
    const startIdx = rebuildSrc.indexOf(startMarker);
    const endIdx = rebuildSrc.indexOf(endMarker);
    if (startIdx === -1 || endIdx === -1) {
        console.error('Could not find WordNet markers. Manual fix needed.');
        process.exit(1);
    }
    const endOfEndMarker = rebuildSrc.indexOf('\n', endIdx) + 1;
    const updated = rebuildSrc.substring(0, startIdx) + blockContent + rebuildSrc.substring(endOfEndMarker);
    fs.writeFileSync(rebuildPath, updated);
} else {
    // Insert before "// ─── Main build process"
    const insertBefore = '// ─── Main build process';
    const insertIdx = rebuildSrc.indexOf(insertBefore);
    if (insertIdx === -1) {
        console.error('Could not find "Main build process" marker in rebuild-words.js');
        process.exit(1);
    }
    const updated = rebuildSrc.substring(0, insertIdx) + blockContent + '\n' + rebuildSrc.substring(insertIdx);
    fs.writeFileSync(rebuildPath, updated);
}

// ── Also wire WORDNET_EXTRAS into main() if not already ─────────────
const updatedSrc = fs.readFileSync(rebuildPath, 'utf8');
if (!updatedSrc.includes('WORDNET_EXTRAS)')) {
    const contractionsLine = 'for (const w of CONTRACTIONS) allWords.add(w.toUpperCase());';
    const insertAfterIdx = updatedSrc.indexOf(contractionsLine);
    if (insertAfterIdx === -1) {
        console.error('Could not find CONTRACTIONS loop in main()');
        process.exit(1);
    }
    const endOfLine = updatedSrc.indexOf('\n', insertAfterIdx) + 1;
    const extraLine = '    for (const w of WORDNET_EXTRAS) allWords.add(w.toUpperCase());\n';
    const final = updatedSrc.substring(0, endOfLine) + extraLine + updatedSrc.substring(endOfLine);
    fs.writeFileSync(rebuildPath, final);
}

console.log(`\n✓ Updated rebuild-words.js with ${newWords.length} new WordNet words`);
console.log(`  Now run: node rebuild-words.js`);
