/**
 * scan-music.js — Run this whenever you add/remove songs from the music/ folder.
 *
 * Usage:   node scan-music.js
 *
 * What it does:
 *   1. Reads all audio files (.mp3, .ogg, .wav, .m4a, .flac, .webm) from music/
 *   2. Sorts them alphabetically by filename (prefix with 01-, 02- etc. to control order)
 *   3. Extracts a human-readable title from the filename
 *   4. Writes music/tracks.json which the game auto-loads on startup
 *
 * Naming convention for your files:
 *   "01 - My Cool Song.mp3"  →  title: "My Cool Song",  order: 1st
 *   "02 - Chill Vibes.mp3"   →  title: "Chill Vibes",   order: 2nd
 *   "Battle Theme.ogg"       →  title: "Battle Theme"
 *
 * You can also include artist in the filename with a double dash:
 *   "03 - Song Name -- Artist Name.mp3"  →  title: "Song Name", artist: "Artist Name"
 */

const fs = require("fs");
const path = require("path");

const MUSIC_DIR = path.join(__dirname, "Music");
const OUTPUT_FILE = path.join(MUSIC_DIR, "tracks.json");
const AUDIO_EXTENSIONS = new Set([".mp3", ".ogg", ".wav", ".m4a", ".flac", ".webm"]);

function parseTitleAndArtist(filename) {
    // Remove extension
    let name = path.parse(filename).name;

    // Strip leading number prefix like "01 - " or "01_" or "01. "
    name = name.replace(/^\d+[\s._-]+/, "");

    // Check for artist separator " -- "
    let title = name;
    let artist = "Freddy River";
    const artistSep = name.indexOf(" -- ");
    if (artistSep >= 0) {
        title = name.substring(0, artistSep).trim();
        artist = name.substring(artistSep + 4).trim();
    }

    // Clean up underscores/dashes as spaces
    title = title.replace(/[_]/g, " ").trim();
    artist = artist.replace(/[_]/g, " ").trim();

    return { title: title || filename, artist };
}

// Scan the music directory
if (!fs.existsSync(MUSIC_DIR)) {
    fs.mkdirSync(MUSIC_DIR, { recursive: true });
    console.log("Created music/ folder. Add your audio files and run this script again.");
    process.exit(0);
}

const files = fs.readdirSync(MUSIC_DIR)
    .filter(f => {
        const ext = path.extname(f).toLowerCase();
        return AUDIO_EXTENSIONS.has(ext) && !f.startsWith(".");
    })
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

if (files.length === 0) {
    console.log("No audio files found in music/ folder.");
    console.log("Supported formats: .mp3, .ogg, .wav, .m4a, .flac, .webm");
    console.log("Add some files and run this script again.");
    process.exit(0);
}

const tracks = files.map((filename, index) => {
    const { title, artist } = parseTitleAndArtist(filename);
    return {
        id: `track${String(index + 1).padStart(2, "0")}`,
        title,
        artist,
        file: `Music/${filename}`
    };
});

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(tracks, null, 2), "utf-8");

console.log(`✓ Found ${tracks.length} track(s). Written to music/tracks.json\n`);
console.log("  #  Title                          Artist");
console.log("  -  -----                          ------");
tracks.forEach((t, i) => {
    const num = String(i + 1).padStart(3);
    const title = t.title.padEnd(30).substring(0, 30);
    console.log(`  ${num}  ${title}  ${t.artist}`);
});
console.log("\nThe game will auto-load this tracklist on next refresh.");
