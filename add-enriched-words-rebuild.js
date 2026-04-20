#!/usr/bin/env node
/**
 * add-enriched-words-rebuild.js
 * 
 * Adds all words from words-enriched.json as a new constant to rebuild-words.js
 * and updates the main() function to include them.
 */

const fs = require('fs');
const path = require('path');

// Load enriched words
const enrichedPath = path.join(__dirname, 'public', 'words-enriched.json');
const enrichedData = JSON.parse(fs.readFileSync(enrichedPath, 'utf8'));

const enrichedWords = Object.keys(enrichedData)
    .map(w => w.toLowerCase())
    .filter(w => /^[a-z]+$/.test(w) && w.length >= 3)
    .sort();

console.log(`📚 Loaded ${enrichedWords.length} valid words from words-enriched.json\n`);

// Read rebuild-words.js
const rebuildPath = path.join(__dirname, 'rebuild-words.js');
const rebuildContent = fs.readFileSync(rebuildPath, 'utf8');

// Create the new ENRICHED_WORDS constant
const enrichedWordsString = enrichedWords.join(' ');
const newConstant = `
// ─── Enriched dictionary words ─────────────────────────────────────
// ${enrichedWords.length} words from words-enriched.json with full definitions
const ENRICHED_WORDS = \`${enrichedWordsString}\`.split(/\\s+/).filter(w => w.length >= 3);
`;

// Find where to insert it (right before "// ─── Main build process")
const insertPoint = rebuildContent.indexOf('// ─── Main build process');
if (insertPoint === -1) {
    console.error('ERROR: Could not find insertion point in rebuild-words.js');
    process.exit(1);
}

// Insert the new constant
const updatedContent = 
    rebuildContent.substring(0, insertPoint) + 
    newConstant + '\n' +
    rebuildContent.substring(insertPoint);

// Write the updated file
fs.writeFileSync(rebuildPath, updatedContent, 'utf8');
console.log(`✅ Added ENRICHED_WORDS constant to rebuild-words.js\n`);

// Now update the main() function to include ENRICHED_WORDS
let finalContent = fs.readFileSync(rebuildPath, 'utf8');

// Find and update the section where words are added
const oldAddition = '    for (const w of WORDNET_EXTRAS) allWords.add(w.toUpperCase());';
const newAddition = `    for (const w of WORDNET_EXTRAS) allWords.add(w.toUpperCase());
    for (const w of ENRICHED_WORDS) allWords.add(w.toUpperCase());`;

if (finalContent.includes(oldAddition)) {
    finalContent = finalContent.replace(oldAddition, newAddition);
    fs.writeFileSync(rebuildPath, finalContent, 'utf8');
    console.log(`✅ Updated main() function to use ENRICHED_WORDS\n`);
} else {
    console.log(`⚠️  Warning: Could not find manual word addition in main(). Manual update may be needed.\n`);
}

// Run rebuild-words.js
console.log(`🔄 Running rebuild-words.js...\n`);

const { execSync } = require('child_process');
try {
    const output = execSync('node rebuild-words.js', { encoding: 'utf8' });
    console.log(output);
    console.log(`\n✅ Complete! words.json has been regenerated`);
} catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
}
