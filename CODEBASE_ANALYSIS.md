# Plummet Game Codebase Analysis

## 1. Synonym Display in UI

### File Locations Where Synonyms Are Rendered

| Location | File | Function | Purpose |
|----------|------|----------|---------|
| [7476](script.js#L7476) | `script.js` | `_dictBuildCardForContext(w, onSynonymJump)` | Creates word card with clickable synonym support |
| [7506-7509](script.js#L7506-L7509) | `script.js` | Synonym click handler | Detects clicks on synonym chips and triggers jump |
| [7545-7557](script.js#L7545-L7557) | `script.js` | `_dictBuildDetail(w)` | Renders definitions + synonyms section |
| [7550](script.js#L7550) | `script.js` | Synonym rendering loop | Creates clickable chip elements for each synonym |
| [7590-7595](script.js#L7590-L7595) | `script.js` | `_buildWordFinderHTML()` | Displays up to 6 synonyms in word finder UI |
| [8782](style.css#L8782) | `style.css` | `.dict-syn-chip` | Styling for synonym chips UI |

### Synonym Display Implementation Details

```javascript
// From script.js lines 7545-7557
// Synonyms section with up to 6 visible synonyms
if (w.synonyms.length) {
    html += `<div class="dict-syn-section">
        <div class="dict-section-label">Synonyms</div>
        <div class="dict-syn-wrap">`;
    for (const syn of w.synonyms) {
        const inDict = ENRICHED_DICT && ENRICHED_DICT[syn.toLowerCase()];
        html += `<span class="dict-syn-chip${inDict ? " in-dict" : ""}" 
                        data-syn="${this._escapeHtml(syn)}">${syn}</span>`;
    }
    html += `</div></div>`;
}
```

**Key Features:**
- Synonyms are clickable chips
- Tapping a synonym jumps to that word's definition in the dictionary
- Synonyms in the dictionary are marked with `.in-dict` class for visual distinction
- Limited to 6 most relevant synonyms in finder view
- Full list available in detail view

---

## 2. JSON Schema: words-enriched.json

### Complete Word Entry Structure

```json
{
  "abandon": {
    "word": "abandon",
    "definitions": [
      {
        "pos": "noun",
        "definition": "the trait of lacking restraint or control; reckless freedom from inhibition or worry"
      },
      {
        "pos": "verb",
        "definition": "stop maintaining or insisting on; of ideas or claims"
      }
    ],
    "synonyms": [
      "wantonness",
      "unconstraint",
      "wildness",
      "forsake",
      "desolate",
      "desert",
      "vacate",
      "empty"
    ],
    "partsOfSpeech": [
      "noun",
      "verb"
    ]
  }
}
```

### Field Specifications

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| `word` | string | The word itself in lowercase | Always present |
| `definitions` | array | List of definitions grouped by part of speech | Max 5 per word |
| `definitions[].pos` | string | Part of speech code: `noun`, `verb`, `adjective`, `adjective satellite`, `adverb` | From WordNet POS_MAP |
| `definitions[].definition` | string | The actual definition text | From WordNet glosses, cleaned |
| `synonyms` | array | List of related words | Max 15 per word |
| `partsOfSpeech` | array | Unique POS values present in this entry | Derived from definitions |

### Dictionary Size

- **Total Words in words-enriched.json: 33,578**
- Each word must have either:
  - At least 1 definition from WordNet, OR
  - At least 1 synonym from WordNet/Datamuse

---

## 3. Word Selection & Randomization (Word-of-the-Day + Random Words)

### Primary Word Randomizer Function

**Location:** [script.js:729](script.js#L729) in `_wsSelectWords()`

```javascript
// Lines 728-730
const word = pool[Math.floor(Math.random() * pool.length)];
```

### Complete Word Selection Flow

**Function:** `_wsSelectWords(params)` [Lines 656-750]

```javascript
function _wsSelectWords(params) {
    const { minWords, maxWords, minWordLen, maxWordLen, difficultyPct } = params;
    
    // 1. Calculate random count
    const count = minWords + Math.floor(Math.random() * (maxWords - minWords + 1));
    
    // 2. Load recently used words (avoid repeats)
    const recentWords = new Set(_wsGetWordHistory());
    
    // 3. Build candidate pool filtered by length
    const candidates = [];
    for (const word of DICTIONARY) {
        if (word.length >= minWordLen && word.length <= maxWordLen) {
            candidates.push(word);
        }
    }
    
    // 4. Sort by difficulty and create window
    candidates.sort((a, b) => _wordDifficulty(a) - _wordDifficulty(b));
    const halfWidth = 0.1 + difficultyPct * 0.2;
    const center = difficultyPct * 0.85 + 0.05;
    const windowStart = Math.floor(total * Math.max(0, center - halfWidth));
    const windowEnd = Math.min(total, Math.floor(total * Math.min(1, center + halfWidth)));
    const pool = candidates.slice(windowStart, Math.max(windowEnd, windowStart + 20));
    
    // 5. Pick random words avoiding:
    //    - Recently used words
    //    - Related word forms (plurals, verb tenses, etc.)
    //    - Words already selected in this round
    while (result.length < count && attempts < count * 50) {
        const word = pool[Math.floor(Math.random() * pool.length)];
        if (selected.has(word)) continue;
        if (recentWords.has(word)) continue;
        const hasRelated = result.some(existing => areWordsRelated(word, existing));
        if (hasRelated) continue;
        result.push(word);
    }
}
```

### Related Word Detection

Words are considered "related" if they meet ANY of these criteria:
- Exact match: `RUN` = `RUN`
- Substring: `RUN` ⊂ `RUNNING`
- Plural: `PARTY` → `PARTIES` (Y→IES)
- Verb forms: `WALK` → `WALKED`, `RUNNING`
- Comparatives: `FAST` → `FASTER` → `FASTEST`

### Word History Tracking

**Keys:** `_wsGetWordHistory()` / `_wsAddToWordHistory()`
- Last 200 words are tracked in localStorage
- Recently used words are heavily penalized in selection (but not eliminated)
- Automatically cleared after 200 selections to allow repeats

---

## 4. rebuild-words.js Processing Flow

### Purpose
Converts curated word lists into inflected forms with proper morphology rules.

### Key Functions

#### 1. Pluralization Rules [Lines 26-43]
```javascript
function pluralize(noun) {
    const w = noun.toLowerCase();
    if (w.endsWith('s') || w.endsWith('x') || w.endsWith('z') || w.endsWith('sh') || w.endsWith('ch')) {
        return [noun + 'es'];
    } else if (w.endsWith('y') && !VOWELS.has(w[w.length - 2])) {
        return [noun.slice(0, -1) + 'ies'];
    } else if (w.endsWith('f')) {
        return [noun.slice(0, -1) + 'ves', noun + 's'];  // Both forms
    } else if (w.endsWith('fe')) {
        return [noun.slice(0, -2) + 'ves'];
    }
    return [noun + 's'];
}
```

#### 2. Verb Forms [Lines 45-85]
- **-s** (3rd person): `run` → `runs`
- **-ing** (gerund/present participle): `run` → `running`, `make` → `making`
- **-ed** (past tense): `walk` → `walked`, `move` → `moved`
- **-er** (agent noun): `run` → `runner`
- **Consonant doubling**: Short CVC words → `fit` → `fitting`, `big` → `bigger`

#### 3. Adjective Forms [Lines 87-140]
- **-er** (comparative): `fast` → `faster`, `big` → `bigger`
- **-est** (superlative): `fast` → `fastest`, `big` → `biggest`
- **-ly** (adverb): `quick` → `quickly`, `happy` → `happily`
- **-ness** (noun): `happy` → `happiness`, `quick` → `quickness`

### Base Word Lists
Multiple curated lists feed into the system:
- `NOUNS`, `VERBS`, `ADJECTIVES`, `OTHER_WORDS`
- `TWO_LETTER_WORDS`
- `CONTRACTIONS`
- `CATEGORY_*` lists (FOOD, ANIMALS, SPORTS, etc.)
- `WORDNET_EXTRAS`

### Output
Generates `words.json` with all base forms + inflections

---

## 5. Enrichment Pipeline: enrich-words.js

### Sources for Enrichment

#### Source 1: WordNet 3.0 (Local)
- **Function:** `parseWordNetData()` [Lines 52-148]
- **Data Files:** `data.noun`, `data.verb`, `data.adj`, `data.adv`
- **Extracts:**
  - Synsets (synonym sets)
  - Definitions (glosses)
  - Parts of speech

**POS Mapping:**
- `n` → `noun`
- `v` → `verb`
- `a` → `adjective`
- `s` → `adjective satellite`
- `r` → `adverb`

Example parsing:
```
Synset line format:
  offset lex_filenum ss_type w_cnt word1 lex_id1 ... | gloss
  
Extracts all words in synset as synonyms for each word
Groups by part of speech
```

#### Source 2: Datamuse API (Supplemental)
- **Function:** `fetchDatamuse(word)` [Lines 211-223]
- **Endpoint:** `https://api.datamuse.com/words?rel_syn={word}&max=10`
- **Used When:** WordNet provides < 3 synonyms
- **Rate Limiting:** ~50ms delay between API calls to respect rate limits
- **Only for words needing enrichment**

### Enrichment Steps

**Full Flow:**
```
1. Extract base words from rebuild-words.js
2. Parse WordNet 3.0 database
3. For each base word:
   a. Lookup in WordNet → collect definitions + synonyms
   b. If synonyms < 3: call Datamuse API for more
   c. Deduplicate synonyms across sources
   d. Limit definitions to top 5
   e. Limit synonyms to top 15
4. Only include words with definitions OR synonyms
5. Write words-enriched.json
```

### Statistics from Enrichment

Typical output statistics:
- **Total enriched entries:** ~8,000-12,000 (depends on which base words match WordNet)
- **Average definitions per word:** ~1.8 (avg)
- **Average synonyms per word:** ~6.5 (avg)
- **Words with no enrichment:** Included if found via rebuild-words.js inflection

---

## 6. Other Word Definition/Synonym Scripts

### Script Purpose Summary

| Script | Purpose | Dependencies |
|--------|---------|--------------|
| [enrich-words.js](enrich-words.js) | Main enrichment: WordNet + Datamuse | `wordnet-db`, `https` (Datamuse) |
| [rebuild-words.js](rebuild-words.js) | Generate inflected base word list | Node.js `fs` module |
| [wordnet-integration.js](wordnet-integration.js) | WordNet database integration | `wordnet-db` npm package |
| [find-missing-wordnet.js](find-missing-wordnet.js) | Identify words in DICTIONARY not in WordNet | `wordnet-db` |
| [enrich-missing.js](enrich-missing.js) | Attempt to enrich previously "missing" words | `wordnet-db`, `https` (Datamuse) |
| [dedupe-words.js](dedupe-words.js) | Remove duplicate entries from word lists | `fs` module only |

### Key Data Processing Scripts

**enrich-words.js** - The main pipeline:
- Reads base words from rebuild-words.js
- Tries WordNet lookup first
- Falls back to Datamuse API for thin entries
- Deduplicates across sources
- Validates output before writing

**Key Command:** 
```bash
node enrich-words.js                   # Full enrichment
node enrich-words.js --offline          # WordNet only
node enrich-words.js --word HELLO       # Single word test
node enrich-words.js --stats            # Stats only
node enrich-words.js --merge            # Merge with existing
```

---

## Summary Table

| Aspect | Details |
|--------|---------|
| **Total Words** | 33,578 in words-enriched.json |
| **Synonym Display Locations** | Dictionary detail view, Word Finder cards |
| **Synonym Interaction** | Tappable chips that jump to definition |
| **Max Synonyms Per Word** | 15 (limited to reduce file size) |
| **Definitions Per Word** | Max 5 (limited to reduce file size) |
| **Randomization Strategy** | Difficulty-windowed selection + recency avoidance + related word filtering |
| **Enrichment Sources** | WordNet 3.0 (primary) + Datamuse API (supplemental) |
| **File Size** | ~864,043 lines (~25 MB compressed) |
| **Word Selection Method** | `Math.random()` with weighted difficulty pools |
| **Word History Tracking** | 200-entry rolling localStorage buffer |

