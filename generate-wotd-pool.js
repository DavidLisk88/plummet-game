/**
 * Generate the canonical WOTD pool used by BOTH:
 *   - The iOS widget extension (PlummetWidget/wotd-pool.json)
 *   - The web/JS layer (public/wotd-pool.json)
 *
 * Both consumers MUST use this exact file with the exact same algorithm:
 *   1. Parse JSON → array of {word, pos, definition}
 *   2. Sort ASCII by word (already pre-sorted here, but consumers re-verify)
 *   3. hash = djb2-like int32 of "plummet-wotd-YYYY-MM-DD" (local date)
 *   4. index = abs(hash) % pool.length
 *
 * Selection criteria for inclusion:
 *   - 5-10 characters (good balance: not trivial, not obscure)
 *   - Has at least one definition with pos in {noun, verb, adjective, adverb}
 *   - Not in BASIC_WORDS exclusion set
 *   - Definition <= 140 chars (fits widget)
 *   - First definition only (deterministic)
 */

const fs = require('fs');
const path = require('path');

const BASIC_WORDS = new Set([
    'about','after','again','among','being','below','black','close','color','could',
    'doing','early','enjoy','every','first','found','given','going','great','green',
    'group','hello','house','large','later','maybe','might','money','music','never',
    'night','often','other','party','place','point','quite','right','since','small',
    'start','state','still','story','their','there','these','thing','think','those',
    'three','today','under','until','using','watch','water','where','which','while',
    'white','woman','women','world','would','write','years','young','adult','allow',
    'alone','along','beach','begin','below','build','catch','cause','child','clean',
    'clear','climb','dance','dream','drink','drive','enjoy','enter','event','field',
    'final','floor','focus','front','glass','green','heart','heavy','horse','hotel',
    'human','image','issue','learn','level','light','local','major','march','match',
    'media','metal','model','month','mouth','movie','north','offer','order','paper',
    'peace','phone','piece','plant','price','prove','quick','quiet','radio','reach',
    'ready','river','round','seven','share','sleep','smile','solid','sound','south',
    'space','speak','speed','spend','staff','stage','stand','stick','stone','story',
    'study','style','table','teach','thank','third','total','touch','train','treat',
    'truth','union','unite','value','video','visit','voice','whole','whose','woman',
    'world','worth','write','wrong','about','above','again','agree'
]);

const ALLOWED_POS = new Set(['noun', 'verb', 'adjective', 'adverb']);

function cleanPos(p) {
    return (p || '').replace(' satellite', '').trim();
}

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'words-enriched.json'), 'utf8'));
const entries = Array.isArray(raw) ? raw : Object.values(raw);

const pool = [];
for (const e of entries) {
    if (!e || !e.word) continue;
    const word = String(e.word).toLowerCase();
    if (word.length < 5 || word.length > 10) continue;
    if (!/^[a-z]+$/.test(word)) continue; // ascii-only, no hyphens/spaces
    if (BASIC_WORDS.has(word)) continue;
    if (!Array.isArray(e.definitions) || e.definitions.length === 0) continue;

    // Pick the first definition with an allowed POS
    let chosen = null;
    for (const d of e.definitions) {
        const pos = cleanPos(d.pos);
        if (!ALLOWED_POS.has(pos)) continue;
        if (!d.definition || d.definition.length > 140) continue;
        chosen = { pos, definition: d.definition.trim() };
        break;
    }
    if (!chosen) continue;

    pool.push({ word, pos: chosen.pos, definition: chosen.definition });
}

// Stable ASCII sort by word
pool.sort((a, b) => (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));

// Trim to a stable cap so the pool size is predictable.
// 1095 = 3 years' worth at one word/day with effectively no collisions for years more.
const CAP = 1095;
let finalPool = pool;
if (pool.length > CAP) {
    // Deterministic uniform sample: take every Nth so we keep word diversity
    const step = pool.length / CAP;
    finalPool = [];
    for (let i = 0; i < CAP; i++) {
        finalPool.push(pool[Math.floor(i * step)]);
    }
}

// Write to both consumers
const outPaths = [
    path.join(__dirname, 'public', 'wotd-pool.json'),
    path.join(__dirname, 'ios', 'App', 'PlummetWidget', 'wotd-pool.json'),
];

const json = JSON.stringify(finalPool); // compact, no whitespace — same bytes everywhere

for (const p of outPaths) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, json, 'utf8');
    console.log(`Wrote ${p} (${finalPool.length} words, ${json.length} bytes)`);
}

// Sanity: print first/last/sample
console.log('\nFirst 3:', finalPool.slice(0, 3).map(e => e.word).join(', '));
console.log('Last 3 :', finalPool.slice(-3).map(e => e.word).join(', '));
console.log('Sample :', finalPool[Math.floor(finalPool.length / 2)]);
