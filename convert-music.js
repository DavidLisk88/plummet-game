// Convert all WAV tracks to MP3 (192kbps) for faster dev server streaming.
// Run: node convert-music.js
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ffmpegPath = require("ffmpeg-static");
const musicDir = path.join(__dirname, "Music");

const wavFiles = fs.readdirSync(musicDir).filter(f => f.endsWith(".wav"));

console.log(`Found ${wavFiles.length} WAV files to convert. Using: ${ffmpegPath}`);

for (const wav of wavFiles) {
    const mp3 = wav.replace(/\.wav$/, ".mp3");
    const wavPath = path.join(musicDir, wav);
    const mp3Path = path.join(musicDir, mp3);

    if (fs.existsSync(mp3Path)) {
        console.log(`  SKIP ${mp3} (already exists)`);
        continue;
    }

    const sizeMB = (fs.statSync(wavPath).size / 1024 / 1024).toFixed(1);
    console.log(`  Converting ${wav} (${sizeMB} MB) → ${mp3} ...`);

    try {
        execSync(`"${ffmpegPath}" -i "${wavPath}" -codec:a libmp3lame -b:a 192k -y "${mp3Path}"`, {
            stdio: "pipe",
        });
        const newSize = (fs.statSync(mp3Path).size / 1024 / 1024).toFixed(1);
        console.log(`    ✓ ${mp3} (${newSize} MB)`);
    } catch (err) {
        console.error(`    ✗ Failed: ${err.message}`);
    }
}

console.log("\nDone! Now update Music/tracks.json to use .mp3 files.");
