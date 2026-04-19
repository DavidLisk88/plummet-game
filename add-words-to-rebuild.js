#!/usr/bin/env node
/**
 * add-words-to-rebuild.js
 *
 * Extracts words from words-enriched.json and adds them to rebuild-words.js
 */

const fs = require('fs');
const path = require('path');

// Load enriched words
const enrichedPath = path.join(__dirname, 'public', 'words-enriched.json');
const enrichedData = JSON.parse(fs.readFileSync(enrichedPath, 'utf8'));
const enrichedWords = Object.keys(enrichedData).map(w => w.toLowerCase());

console.log(`📚 Loaded ${enrichedWords.length} words from words-enriched.json\n`);

// Read rebuild-words.js to find existing words
const rebuildPath = path.join(__dirname, 'rebuild-words.js');
const rebuildContent = fs.readFileSync(rebuildPath, 'utf8');

// Extract all existing words from the file
const existingWords = new Set();

// Get words from word lists
const listNames = [
    'NOUNS', 'VERBS', 'ADJECTIVES', 'ADJECTIVES_SHORT', 'ADVERBS',
    'CATEGORY_FOOD', 'CATEGORY_ANIMALS', 'CATEGORY_SPORTS', 'CATEGORY_NATURE',
    'CATEGORY_TECHNOLOGY', 'CATEGORY_BODY', 'CATEGORY_MUSIC', 'CATEGORY_HOME',
    'CATEGORY_CLOTHING', 'CATEGORY_SCIENCE', 'TWO_LETTER_WORDS', 'CONTRACTIONS',
    'MANUAL_EXTRAS'
];

for (const name of listNames) {
    const regex = new RegExp(`const\\s+${name}\\s*=\\s*\`([\\s\\S]*?)\``, 'm');
    const match = rebuildContent.match(regex);
    if (match) {
        const words = match[1].split(/\s+/).filter(w => w.length >= 2);
        words.forEach(w => existingWords.add(w.toLowerCase()));
    }
}

// Extract from MANUAL_EXTRAS more carefully
const manualMatch = rebuildContent.match(/const MANUAL_EXTRAS = `([\s\S]*?)`/);
if (manualMatch) {
    const manualWords = manualMatch[1].split(/\s+/).filter(w => w.length >= 1);
    manualWords.forEach(w => existingWords.add(w.toLowerCase().trim()));
}

console.log(`🔍 Found ${existingWords.size} existing words in rebuild-words.js\n`);

// Find new words
const newWords = enrichedWords.filter(w => {
    // Skip if already in rebuild-words
    if (existingWords.has(w)) return false;
    // Skip compound words with hyphens
    if (w.includes('-')) return false;
    // Skip if too short (< 3 chars, except for 2-letter words already handled)
    if (w.length < 3) return false;
    // Skip if contains non-alphabetic characters
    if (!/^[a-z]+$/.test(w)) return false;
    return true;
});

console.log(`✨ Found ${newWords.length} new words to add\n`);

// Show some examples
console.log(`Examples of new words:\n`);
newWords.slice(0, 30).forEach(w => console.log(`   - ${w}`));
if (newWords.length > 30) {
    console.log(`   ... and ${newWords.length - 30} more\n`);
}

// Update MANUAL_EXTRAS in rebuild-words.js
console.log(`\n📝 Adding to MANUAL_EXTRAS...\n`);

// Find the MANUAL_EXTRAS constant
const manualStartIdx = rebuildContent.indexOf('const MANUAL_EXTRAS = `');
if (manualStartIdx === -1) {
    console.error('ERROR: Could not find MANUAL_EXTRAS in rebuild-words.js');
    process.exit(1);
}

// Find the closing backtick
const afterStart = rebuildContent.indexOf('`', manualStartIdx + 23);
const manualEndIdx = rebuildContent.indexOf('`;', afterStart);

if (manualEndIdx === -1) {
    console.error('ERROR: Could not find closing of MANUAL_EXTRAS');
    process.exit(1);
}

// Extract existing manual extras content
const manualContent = rebuildContent.substring(afterStart + 1, manualEndIdx).trim();
const existingManualWords = manualContent.split(/\s+/).filter(w => w.length >= 1);

console.log(`Current MANUAL_EXTRAS has ${existingManualWords.length} words`);

// Combine and deduplicate
const allManualWords = [...new Set([...existingManualWords, ...newWords])];
const newCount = allManualWords.length - existingManualWords.length;

console.log(`Will add ${newCount} new words to MANUAL_EXTRAS`);
console.log(`Total MANUAL_EXTRAS will have: ${allManualWords.length} words\n`);

// Sort alphabetically for consistency
allManualWords.sort();

// Format the new MANUAL_EXTRAS section
const newManualContent = allManualWords.join(' ');
const newManualLine = `const MANUAL_EXTRAS = \`${newManualContent}\`;`;

// Replace in the file
const updatedContent = rebuildContent.substring(0, manualStartIdx) + 
                       newManualLine + 
                       rebuildContent.substring(manualEndIdx + 2);

// Write back
fs.writeFileSync(rebuildPath, updatedContent, 'utf8');

console.log(`✅ Updated rebuild-words.js`);
console.log(`📝 Original MANUAL_EXTRAS: ${existingManualWords.length} words`);
console.log(`📝 New MANUAL_EXTRAS: ${allManualWords.length} words`);
console.log(`📝 Added: ${newCount} words\n`);

// Now run rebuild-words.js
console.log(`🔄 Running rebuild-words.js...\n`);

const { execSync } = require('child_process');
try {
    const output = execSync('node rebuild-words.js', { encoding: 'utf8' });
    console.log(output);
    console.log(`\n✅ Complete! words.json has been updated with all ${enrichedWords.length} words`);
} catch (err) {
    console.error('ERROR running rebuild-words.js:', err.message);
    process.exit(1);
}
