/**
 * Batch render multiple TikTok variations.
 *
 * Usage:
 *   node remotion/render-batch.mjs
 *   node remotion/render-batch.mjs --comp PlummetTikTok60
 *
 * Outputs go to: out/tiktoks/
 */
import { execSync } from "child_process";
import { mkdirSync } from "fs";
import path from "path";

const captions = [
  "POV: You finally found a real word puzzle game with good music",
  "When Wordle isn't enough anymore",
  "The word game my brain actually needed",
  "This game has me solving words at 2am",
  "POV: You're addicted to a game that actually makes you smarter",
  "Why did nobody tell me about this game sooner",
  "Me pretending to be productive while playing this",
  "The puzzle game that replaced my doomscrolling",
  "When the music in a word game actually slaps",
  "POV: You found the game that word nerds dream about",
];

const comp = process.argv.includes("--comp")
  ? process.argv[process.argv.indexOf("--comp") + 1]
  : "PlummetTikTok";

const outDir = path.resolve("out", "tiktoks");
mkdirSync(outDir, { recursive: true });

// Only render specific indices if provided, otherwise all
const indexArg = process.argv.find((a) => a.startsWith("--index="));
const indices = indexArg
  ? indexArg.replace("--index=", "").split(",").map(Number)
  : captions.map((_, i) => i);

for (const i of indices) {
  const caption = captions[i];
  if (!caption) {
    console.warn(`⚠ No caption at index ${i}, skipping`);
    continue;
  }

  const slug = caption
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 50);

  const outFile = path.join(outDir, `${String(i).padStart(2, "0")}-${slug}.mp4`);

  console.log(`\n🎬 Rendering [${i}]: "${caption}"`);
  console.log(`   → ${outFile}\n`);

  const propsJson = JSON.stringify({
    caption,
    gameplayClip: "gameplay-clip.mp4",
    musicTrack: "track.mp3",
    ctaText: "PLUMMET — No Ads. iOS & Android",
  });

  const cmd = [
    "npx remotion render",
    `remotion/index.ts`,
    comp,
    `"${outFile}"`,
    `--props='${propsJson}'`,
  ].join(" ");

  try {
    execSync(cmd, { stdio: "inherit" });
    console.log(`✅ Done: ${outFile}`);
  } catch (err) {
    console.error(`❌ Failed to render caption ${i}:`, err.message);
  }
}

console.log(`\n🎉 Batch complete. Output: ${outDir}`);
