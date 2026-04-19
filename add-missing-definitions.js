#!/usr/bin/env node
/**
 * add-missing-definitions.js
 *
 * Adds 95 manually-defined words that weren't found in WordNet.
 * These are modern terms, slang, and technical words.
 */

const fs = require('fs');
const path = require('path');

const enrichedPath = path.join(__dirname, 'public', 'words-enriched.json');
const enrichedData = JSON.parse(fs.readFileSync(enrichedPath, 'utf8'));

// ── Manual definitions for words not in WordNet ──────────────────────
const missingDefinitions = {
  'codebase': {
    word: 'codebase',
    definitions: [
      { pos: 'noun', definition: 'the entire collection of source code for a software project' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'signout': {
    word: 'signout',
    definitions: [
      { pos: 'noun', definition: 'the act of logging out from a system or application' }
    ],
    synonyms: ['logout'],
    partsOfSpeech: ['noun']
  },
  'louvers': {
    word: 'louvers',
    definitions: [
      { pos: 'noun', definition: 'horizontal overlapping slats that control the passage of light and air' }
    ],
    synonyms: ['slats', 'blinds'],
    partsOfSpeech: ['noun']
  },
  'dungarees': {
    word: 'dungarees',
    definitions: [
      { pos: 'noun', definition: 'heavy denim work pants or a bib-and-brace overall garment' }
    ],
    synonyms: ['overalls', 'work pants'],
    partsOfSpeech: ['noun']
  },
  'coveralls': {
    word: 'coveralls',
    definitions: [
      { pos: 'noun', definition: 'a one-piece protective garment worn over clothing' }
    ],
    synonyms: ['overalls', 'uniform'],
    partsOfSpeech: ['noun']
  },
  'flared': {
    word: 'flared',
    definitions: [
      { pos: 'adjective', definition: 'having sides that gradually widen outward' }
    ],
    synonyms: ['widened', 'expanded'],
    partsOfSpeech: ['adjective']
  },
  'aplenty': {
    word: 'aplenty',
    definitions: [
      { pos: 'adverb', definition: 'in abundance; plentiful or in great quantity' }
    ],
    synonyms: ['plenty', 'abundantly'],
    partsOfSpeech: ['adverb']
  },
  'obligated': {
    word: 'obligated',
    definitions: [
      { pos: 'adjective', definition: 'required or bound by legal, moral, or social duty' }
    ],
    synonyms: ['required', 'bound', 'duty-bound'],
    partsOfSpeech: ['adjective']
  },
  'beholden': {
    word: 'beholden',
    definitions: [
      { pos: 'adjective', definition: 'indebted to someone and grateful for their help or favor' }
    ],
    synonyms: ['grateful', 'indebted', 'obliged'],
    partsOfSpeech: ['adjective']
  },
  'compensating': {
    word: 'compensating',
    definitions: [
      { pos: 'verb', definition: 'paying someone for loss, damage, or inconvenience' },
      { pos: 'verb', definition: 'making up for something or counteracting its effects' }
    ],
    synonyms: ['rewarding', 'offsetting', 'balancing'],
    partsOfSpeech: ['verb']
  },
  'offsetting': {
    word: 'offsetting',
    definitions: [
      { pos: 'verb', definition: 'counteracting or balancing the effect of something' }
    ],
    synonyms: ['counteracting', 'compensating', 'balancing'],
    partsOfSpeech: ['verb']
  },
  'cactuses': {
    word: 'cactuses',
    definitions: [
      { pos: 'noun', definition: 'plural of cactus; plants adapted to arid regions with fleshy stems' }
    ],
    synonyms: ['cacti'],
    partsOfSpeech: ['noun']
  },
  'syllabi': {
    word: 'syllabi',
    definitions: [
      { pos: 'noun', definition: 'plural of syllabus; outlines or summaries of a course of study' }
    ],
    synonyms: ['outlines', 'curricula'],
    partsOfSpeech: ['noun']
  },
  'accelerating': {
    word: 'accelerating',
    definitions: [
      { pos: 'verb', definition: 'increasing in speed or velocity' },
      { pos: 'verb', definition: 'speeding up a process or making something happen faster' }
    ],
    synonyms: ['speeding', 'hastening', 'quickening'],
    partsOfSpeech: ['verb']
  },
  'sneaked': {
    word: 'sneaked',
    definitions: [
      { pos: 'verb', definition: 'moved quietly or stealthily without being noticed' }
    ],
    synonyms: ['crept', 'slipped', 'stole'],
    partsOfSpeech: ['verb']
  },
  'competing': {
    word: 'competing',
    definitions: [
      { pos: 'verb', definition: 'engaging in a contest or rivalry with others' }
    ],
    synonyms: ['rivaling', 'contending', 'racing'],
    partsOfSpeech: ['verb']
  },
  'contending': {
    word: 'contending',
    definitions: [
      { pos: 'verb', definition: 'engaging in conflict or struggle against opposition' },
      { pos: 'verb', definition: 'asserting or maintaining a claim or belief' }
    ],
    synonyms: ['competing', 'struggling', 'claiming'],
    partsOfSpeech: ['verb']
  },
  'stir-fried': {
    word: 'stir-fried',
    definitions: [
      { pos: 'adjective', definition: 'cooked quickly in a hot pan with minimal oil, typically with constant stirring' }
    ],
    synonyms: ['sauteed'],
    partsOfSpeech: ['adjective']
  },
  'stir-frying': {
    word: 'stir-frying',
    definitions: [
      { pos: 'verb', definition: 'cooking food rapidly in a hot pan or wok with oil and constant stirring' }
    ],
    synonyms: ['sauteing', 'frying'],
    partsOfSpeech: ['verb']
  },
  'bboy': {
    word: 'bboy',
    definitions: [
      { pos: 'noun', definition: 'a male breakdancer; practitioner of breakdancing dance style' }
    ],
    synonyms: ['breakdancer'],
    partsOfSpeech: ['noun']
  },
  'bro': {
    word: 'bro',
    definitions: [
      { pos: 'noun', definition: 'informal term for brother or a close male friend' }
    ],
    synonyms: ['brother', 'friend', 'buddy'],
    partsOfSpeech: ['noun']
  },
  'approached': {
    word: 'approached',
    definitions: [
      { pos: 'verb', definition: 'came near or closer to; went toward something' }
    ],
    synonyms: ['neared', 'advanced'],
    partsOfSpeech: ['verb']
  },
  'rideshare': {
    word: 'rideshare',
    definitions: [
      { pos: 'noun', definition: 'a service where multiple passengers share a vehicle for a journey' }
    ],
    synonyms: ['carpool'],
    partsOfSpeech: ['noun']
  },
  'carshare': {
    word: 'carshare',
    definitions: [
      { pos: 'noun', definition: 'a service where multiple people share access to a fleet of vehicles' }
    ],
    synonyms: ['carpool'],
    partsOfSpeech: ['noun']
  },
  'captured': {
    word: 'captured',
    definitions: [
      { pos: 'verb', definition: 'took prisoner or into custody' },
      { pos: 'verb', definition: 'recorded or represented something in an image or description' }
    ],
    synonyms: ['caught', 'seized', 'recorded'],
    partsOfSpeech: ['verb']
  },
  'seized': {
    word: 'seized',
    definitions: [
      { pos: 'verb', definition: 'took hold of forcibly or abruptly' }
    ],
    synonyms: ['grabbed', 'captured', 'took'],
    partsOfSpeech: ['verb']
  },
  'encoder': {
    word: 'encoder',
    definitions: [
      { pos: 'noun', definition: 'a device or person that converts information into a coded form' }
    ],
    synonyms: ['converter'],
    partsOfSpeech: ['noun']
  },
  'sunglow': {
    word: 'sunglow',
    definitions: [
      { pos: 'noun', definition: 'the glow or luminescence in the sky caused by the sun' }
    ],
    synonyms: ['afterglow', 'dusk'],
    partsOfSpeech: ['noun']
  },
  'sunbow': {
    word: 'sunbow',
    definitions: [
      { pos: 'noun', definition: 'a rainbow or arc of light caused by sunlight' }
    ],
    synonyms: ['rainbow'],
    partsOfSpeech: ['noun']
  },
  'unfitted': {
    word: 'unfitted',
    definitions: [
      { pos: 'adjective', definition: 'not suited or prepared for a particular purpose or role' }
    ],
    synonyms: ['unfit', 'unprepared'],
    partsOfSpeech: ['adjective']
  },
  'misfit': {
    word: 'misfit',
    definitions: [
      { pos: 'noun', definition: 'a person or thing that does not fit in or belong to a group' }
    ],
    synonyms: ['outsider', 'oddball'],
    partsOfSpeech: ['noun']
  },
  'gamelan': {
    word: 'gamelan',
    definitions: [
      { pos: 'noun', definition: 'an Indonesian musical ensemble of percussion instruments' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'sitar': {
    word: 'sitar',
    definitions: [
      { pos: 'noun', definition: 'a plucked string instrument used in Indian classical music' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'tsarina': {
    word: 'tsarina',
    definitions: [
      { pos: 'noun', definition: 'the wife or widow of a Russian tsar or emperor' }
    ],
    synonyms: ['empress'],
    partsOfSpeech: ['noun']
  },
  'vogueing': {
    word: 'vogueing',
    definitions: [
      { pos: 'verb', definition: 'style of dance performed to music with dramatic poses and movements' }
    ],
    synonyms: ['dancing'],
    partsOfSpeech: ['verb']
  },
  'zeitgeist': {
    word: 'zeitgeist',
    definitions: [
      { pos: 'noun', definition: 'the general intellectual, moral, and cultural climate of an era' }
    ],
    synonyms: ['spirit', 'essence'],
    partsOfSpeech: ['noun']
  },
  'schadenfreude': {
    word: 'schadenfreude',
    definitions: [
      { pos: 'noun', definition: 'pleasure derived from the misfortune of others' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'soulmate': {
    word: 'soulmate',
    definitions: [
      { pos: 'noun', definition: 'a person with whom one has a deep romantic or spiritual connection' }
    ],
    synonyms: ['partner', 'love'],
    partsOfSpeech: ['noun']
  },
  'curmudgeon': {
    word: 'curmudgeon',
    definitions: [
      { pos: 'noun', definition: 'a bad-tempered, cantankerous older person' }
    ],
    synonyms: ['grouch', 'grump'],
    partsOfSpeech: ['noun']
  },
  'googol': {
    word: 'googol',
    definitions: [
      { pos: 'noun', definition: 'a number equal to 10 raised to the power of 100' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'bitcoin': {
    word: 'bitcoin',
    definitions: [
      { pos: 'noun', definition: 'a decentralized digital currency based on blockchain technology' }
    ],
    synonyms: ['cryptocurrency'],
    partsOfSpeech: ['noun']
  },
  'emoji': {
    word: 'emoji',
    definitions: [
      { pos: 'noun', definition: 'a small digital image or icon used to express emotion or convey information' }
    ],
    synonyms: ['emoticon', 'icon'],
    partsOfSpeech: ['noun']
  },
  'hashtag': {
    word: 'hashtag',
    definitions: [
      { pos: 'noun', definition: 'a word or phrase prefixed with # used to categorize social media posts' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'selfie': {
    word: 'selfie',
    definitions: [
      { pos: 'noun', definition: 'a photograph taken by oneself, typically with a smartphone' }
    ],
    synonyms: ['self-portrait'],
    partsOfSpeech: ['noun']
  },
  'podcast': {
    word: 'podcast',
    definitions: [
      { pos: 'noun', definition: 'a series of audio or video episodes distributed over the internet' }
    ],
    synonyms: ['webcast'],
    partsOfSpeech: ['noun']
  },
  'vlog': {
    word: 'vlog',
    definitions: [
      { pos: 'noun', definition: 'a video blog; a series of video entries on the internet' }
    ],
    synonyms: ['video blog'],
    partsOfSpeech: ['noun']
  },
  'meme': {
    word: 'meme',
    definitions: [
      { pos: 'noun', definition: 'an idea, behavior, or cultural item transmitted from person to person' }
    ],
    synonyms: ['concept', 'idea'],
    partsOfSpeech: ['noun']
  },
  'influencer': {
    word: 'influencer',
    definitions: [
      { pos: 'noun', definition: 'a person with a significant social media following who promotes products' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'geek': {
    word: 'geek',
    definitions: [
      { pos: 'noun', definition: 'a person with an intense interest in technology or a specific subject' }
    ],
    synonyms: ['nerd', 'enthusiast'],
    partsOfSpeech: ['noun']
  },
  'webinar': {
    word: 'webinar',
    definitions: [
      { pos: 'noun', definition: 'a seminar or training session conducted over the internet' }
    ],
    synonyms: ['online seminar'],
    partsOfSpeech: ['noun']
  },
  'username': {
    word: 'username',
    definitions: [
      { pos: 'noun', definition: 'a unique identifier used to log into an online account' }
    ],
    synonyms: ['login', 'handle'],
    partsOfSpeech: ['noun']
  },
  'password': {
    word: 'password',
    definitions: [
      { pos: 'noun', definition: 'a secret word or string used for authentication and access control' }
    ],
    synonyms: ['passphrase', 'key'],
    partsOfSpeech: ['noun']
  },
  'download': {
    word: 'download',
    definitions: [
      { pos: 'verb', definition: 'transfer data or a file from a remote server to a local computer' }
    ],
    synonyms: ['pull', 'retrieve'],
    partsOfSpeech: ['verb']
  },
  'upload': {
    word: 'upload',
    definitions: [
      { pos: 'verb', definition: 'transfer data or a file from a local computer to a remote server' }
    ],
    synonyms: ['push', 'transmit'],
    partsOfSpeech: ['verb']
  },
  'streaming': {
    word: 'streaming',
    definitions: [
      { pos: 'verb', definition: 'transmitting audio or video over the internet in a continuous flow' }
    ],
    synonyms: ['broadcasting'],
    partsOfSpeech: ['verb']
  },
  'offline': {
    word: 'offline',
    definitions: [
      { pos: 'adjective', definition: 'not connected to the internet or a network' }
    ],
    synonyms: ['disconnected'],
    partsOfSpeech: ['adjective']
  },
  'online': {
    word: 'online',
    definitions: [
      { pos: 'adjective', definition: 'connected to or available via the internet' }
    ],
    synonyms: ['connected'],
    partsOfSpeech: ['adjective']
  },
  'firewall': {
    word: 'firewall',
    definitions: [
      { pos: 'noun', definition: 'a network security system that monitors and controls incoming and outgoing traffic' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'malware': {
    word: 'malware',
    definitions: [
      { pos: 'noun', definition: 'malicious software designed to damage or exploit a computer system' }
    ],
    synonyms: ['virus', 'spyware'],
    partsOfSpeech: ['noun']
  },
  'phishing': {
    word: 'phishing',
    definitions: [
      { pos: 'verb', definition: 'attempting to collect sensitive information through fraudulent messages' }
    ],
    synonyms: ['scamming'],
    partsOfSpeech: ['verb']
  },
  'spamming': {
    word: 'spamming',
    definitions: [
      { pos: 'verb', definition: 'sending unsolicited bulk messages over the internet' }
    ],
    synonyms: [],
    partsOfSpeech: ['verb']
  },
  'hacker': {
    word: 'hacker',
    definitions: [
      { pos: 'noun', definition: 'a person who uses programming skills to gain unauthorized access to computers' }
    ],
    synonyms: ['cybercriminal'],
    partsOfSpeech: ['noun']
  },
  'blockchain': {
    word: 'blockchain',
    definitions: [
      { pos: 'noun', definition: 'a distributed ledger technology that records transactions in encrypted blocks' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'algorithm': {
    word: 'algorithm',
    definitions: [
      { pos: 'noun', definition: 'a step-by-step procedure for solving a problem or completing a task' }
    ],
    synonyms: ['procedure', 'method'],
    partsOfSpeech: ['noun']
  },
  'database': {
    word: 'database',
    definitions: [
      { pos: 'noun', definition: 'an organized collection of structured data stored in a computer system' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'software': {
    word: 'software',
    definitions: [
      { pos: 'noun', definition: 'programs and applications that run on a computer or device' }
    ],
    synonyms: ['program'],
    partsOfSpeech: ['noun']
  },
  'hardware': {
    word: 'hardware',
    definitions: [
      { pos: 'noun', definition: 'the physical components of a computer or electronic device' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'networking': {
    word: 'networking',
    definitions: [
      { pos: 'verb', definition: 'connecting computers or people to share information or build relationships' }
    ],
    synonyms: ['connecting'],
    partsOfSpeech: ['verb']
  },
  'debugging': {
    word: 'debugging',
    definitions: [
      { pos: 'verb', definition: 'finding and fixing errors or bugs in computer code or software' }
    ],
    synonyms: ['troubleshooting'],
    partsOfSpeech: ['verb']
  },
  'backend': {
    word: 'backend',
    definitions: [
      { pos: 'noun', definition: 'the server-side code and infrastructure that powers an application' }
    ],
    synonyms: ['server', 'infrastructure'],
    partsOfSpeech: ['noun']
  },
  'frontend': {
    word: 'frontend',
    definitions: [
      { pos: 'noun', definition: 'the user-facing part of a software application or website' }
    ],
    synonyms: ['interface', 'client'],
    partsOfSpeech: ['noun']
  },
  'middleware': {
    word: 'middleware',
    definitions: [
      { pos: 'noun', definition: 'software that sits between an application and the operating system' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'api': {
    word: 'api',
    definitions: [
      { pos: 'noun', definition: 'an interface that allows different software applications to communicate' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'framework': {
    word: 'framework',
    definitions: [
      { pos: 'noun', definition: 'a structured platform or set of tools used for software development' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'library': {
    word: 'library',
    definitions: [
      { pos: 'noun', definition: 'a collection of pre-written code modules or functions for reuse' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'cloudcomputing': {
    word: 'cloudcomputing',
    definitions: [
      { pos: 'noun', definition: 'computing services delivered over the internet on a pay-per-use basis' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'virtualization': {
    word: 'virtualization',
    definitions: [
      { pos: 'noun', definition: 'technology for creating virtual instances of physical computer resources' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'encryption': {
    word: 'encryption',
    definitions: [
      { pos: 'noun', definition: 'the process of converting readable data into a coded form' }
    ],
    synonyms: ['encoding'],
    partsOfSpeech: ['noun']
  },
  'authentication': {
    word: 'authentication',
    definitions: [
      { pos: 'noun', definition: 'the process of verifying the identity of a user or system' }
    ],
    synonyms: ['verification'],
    partsOfSpeech: ['noun']
  },
  'bandwidth': {
    word: 'bandwidth',
    definitions: [
      { pos: 'noun', definition: 'the maximum amount of data that can be transmitted over a connection' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'latency': {
    word: 'latency',
    definitions: [
      { pos: 'noun', definition: 'the delay in data transmission between two points' }
    ],
    synonyms: ['delay'],
    partsOfSpeech: ['noun']
  },
  'serverless': {
    word: 'serverless',
    definitions: [
      { pos: 'adjective', definition: 'computing architecture where applications run without managing servers' }
    ],
    synonyms: [],
    partsOfSpeech: ['adjective']
  },
  'microservice': {
    word: 'microservice',
    definitions: [
      { pos: 'noun', definition: 'a small independent service that performs a specific business function' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'container': {
    word: 'container',
    definitions: [
      { pos: 'noun', definition: 'a lightweight standalone executable package of software and dependencies' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'kubernetes': {
    word: 'kubernetes',
    definitions: [
      { pos: 'noun', definition: 'an orchestration platform for managing containerized applications' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'devops': {
    word: 'devops',
    definitions: [
      { pos: 'noun', definition: 'a practice combining software development and IT operations' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'agile': {
    word: 'agile',
    definitions: [
      { pos: 'adjective', definition: 'an iterative software development approach emphasizing flexibility' }
    ],
    synonyms: [],
    partsOfSpeech: ['adjective']
  },
  'scrum': {
    word: 'scrum',
    definitions: [
      { pos: 'noun', definition: 'a framework for managing team collaboration and project delivery' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'stakeholder': {
    word: 'stakeholder',
    definitions: [
      { pos: 'noun', definition: 'a person with an interest or concern in a project or organization' }
    ],
    synonyms: ['investor', 'participant'],
    partsOfSpeech: ['noun']
  },
  'refactoring': {
    word: 'refactoring',
    definitions: [
      { pos: 'verb', definition: 'restructuring code without changing its functionality or behavior' }
    ],
    synonyms: [],
    partsOfSpeech: ['verb']
  },
  'testdriven': {
    word: 'testdriven',
    definitions: [
      { pos: 'adjective', definition: 'writing tests before implementing code features' }
    ],
    synonyms: [],
    partsOfSpeech: ['adjective']
  },
  'deployment': {
    word: 'deployment',
    definitions: [
      { pos: 'noun', definition: 'the process of putting software into production for use' }
    ],
    synonyms: ['release', 'launch'],
    partsOfSpeech: ['noun']
  },
  'rollback': {
    word: 'rollback',
    definitions: [
      { pos: 'noun', definition: 'reverting software to a previous version after a failed deployment' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'monitoring': {
    word: 'monitoring',
    definitions: [
      { pos: 'verb', definition: 'continuously observing and tracking system performance and health' }
    ],
    synonyms: ['tracking', 'observing'],
    partsOfSpeech: ['verb']
  },
  'analytics': {
    word: 'analytics',
    definitions: [
      { pos: 'noun', definition: 'the analysis of data to discover patterns and gain insights' }
    ],
    synonyms: ['analysis'],
    partsOfSpeech: ['noun']
  },
  'datasecurity': {
    word: 'datasecurity',
    definitions: [
      { pos: 'noun', definition: 'protection of data from unauthorized access and corruption' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'privacy': {
    word: 'privacy',
    definitions: [
      { pos: 'noun', definition: 'the right and protection of personal information from unauthorized use' }
    ],
    synonyms: ['confidentiality'],
    partsOfSpeech: ['noun']
  },
  'compliance': {
    word: 'compliance',
    definitions: [
      { pos: 'noun', definition: 'adherence to laws, regulations, and organizational policies' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'backup': {
    word: 'backup',
    definitions: [
      { pos: 'noun', definition: 'a copy of data stored in a separate location for disaster recovery' }
    ],
    synonyms: [],
    partsOfSpeech: ['noun']
  },
  'recovery': {
    word: 'recovery',
    definitions: [
      { pos: 'noun', definition: 'the process of restoring systems or data after failure or loss' }
    ],
    synonyms: ['restoration'],
    partsOfSpeech: ['noun']
  }
};

console.log(`\n📝 Adding ${Object.keys(missingDefinitions).length} manual definitions...\n`);

let addedCount = 0;
for (const [word, entry] of Object.entries(missingDefinitions)) {
  if (!enrichedData[word]) {
    enrichedData[word] = entry;
    addedCount++;
    console.log(`✓ Added: ${word}`);
  }
}

console.log(`\n✅ Added ${addedCount} new words with definitions\n`);

// ── Verify and save ─────────────────────────────────────────────────
const withDefinitions = Object.values(enrichedData).filter(w => w.definitions && w.definitions.length > 0).length;
const totalWords = Object.keys(enrichedData).length;

console.log(`📊 Final dictionary stats:`);
console.log(`   - Total words: ${totalWords}`);
console.log(`   - Words with definitions: ${withDefinitions}`);
console.log(`   - Coverage: ${((withDefinitions / totalWords) * 100).toFixed(1)}%\n`);

fs.writeFileSync(enrichedPath, JSON.stringify(enrichedData, null, 2), 'utf8');
console.log(`✅ Saved to ${enrichedPath}\n`);
