/**
 * build-web.js — Copies static assets into www/ after Vite build
 *
 * Vite handles index.html, script.js, and style.css.
 * This script copies the remaining runtime assets (words.json,
 * Music, TUTORIAL, logo.svg) into the www/ directory.
 */

const fs = require("fs");
const path = require("path");

const SRC = __dirname;
const DEST = path.join(__dirname, "www");

// Static assets that Vite doesn't process (loaded at runtime)
const assets = [
  "words.json",
  "logo.svg",
  "Music",
  "TUTORIAL",
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const child of fs.readdirSync(src)) {
      // Skip .wav files — only bundle .mp3 for mobile builds
      if (child.toLowerCase().endsWith('.wav')) continue;
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

ensureDir(DEST);

for (const name of assets) {
  const src = path.join(SRC, name);
  if (!fs.existsSync(src)) {
    console.warn(`⚠  Skipping ${name} (not found)`);
    continue;
  }
  copyRecursive(src, path.join(DEST, name));
  console.log(`✓  ${name}`);
}

console.log("\n✅ Static assets copied to www/");
