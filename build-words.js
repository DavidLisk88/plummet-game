// One-time script: extract words from popular-english-words and write words.json
const fs = require('fs');
const text = fs.readFileSync('./node_modules/popular-english-words/words.js', 'utf8');
const start = text.indexOf('[');
const end = text.lastIndexOf(']');
const inner = text.substring(start + 1, end);
const seen = new Set();
const re = /"([^"]*)"|'([^']*)'/g;
let m;
while ((m = re.exec(inner)) !== null) {
    const raw = m[1] !== undefined ? m[1] : m[2];
    const upper = raw.toUpperCase().replace(/[^A-Z]/g, '');
    if (upper.length >= 3) seen.add(upper);
}

// Remove profanity / slurs / offensive words
const BANNED = new Set([
    'FAGGOT','VAGINA','RETARD','RETARDED','BITCH','FUCK','FUCKER','HITLER','NAZI',
    'NIGGER','NIGGA','MIDGET','WHORE','CUM','PENIS','BITCHES','HOES','HOE','JIZZ',
    'WEEWEE','DICK','DICKS','PENISES','WHORES','SLUTTY','PUSSY','PUSSIES','KIKE',
    'SHIT','SHITTER','SHITTY','SLUT','CUNT','CUNTS','ARSE','ARSES','WANKER','TWAT',
    'BOLLOCKS','COCKSUCKER','MOTHERFUCKER','ASSHOLE','ASS','DAMN','BASTARD','PISS',
    'CRAP','TITS','BOOBS','HOOKER','PIMP','DILDO','ORGASM','ANAL','RAPE','RAPED',
    'RAPING','RAPIST','MOLEST','PEDOPHILE','INCEST','FAG','FAGS','DYKE','HOMO',
    'QUEER','LESBO','PERVERT','PEDO','NEGRO','SPIC','CHINK','GOOK','WETBACK',
    'BEANER','COON','DARKIE','HONKY','GRINGO','JAP','TRANNY','HEIL',
]);
for (const w of BANNED) seen.delete(w);

const sorted = [...seen].sort();
fs.writeFileSync('./words.json', JSON.stringify(sorted));
console.log(`Wrote words.json: ${sorted.length} words (${fs.statSync('./words.json').size} bytes)`);

// Quick verification
const set = new Set(sorted);
for (const w of ['CAT', 'DOG', 'THE', 'ABLE', 'ABOUT', 'ACTION']) {
    console.log(`  ${w}: ${set.has(w) ? 'YES' : 'NO'}`);
}
for (const w of ['PTS', 'NOS', 'ZUR', 'DEA', 'FUCK', 'SHIT']) {
    console.log(`  ${w}: ${set.has(w) ? 'YES (BAD!)' : 'NO (good)'}`);
}
