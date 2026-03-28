/**
 * build-web.js — Copies web assets into www/ for Capacitor
 *
 * Since Plummet is a vanilla HTML/CSS/JS project (no bundler),
 * this script copies the necessary files into the www/ directory
 * that Capacitor uses as its web root.
 */

const fs = require("fs");
const path = require("path");

const SRC = __dirname;
const DEST = path.join(__dirname, "www");

// Files and folders to copy
const assets = [
  "index.html",
  "script.js",
  "style.css",
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
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

// Clean & recreate www/
if (fs.existsSync(DEST)) {
  fs.rmSync(DEST, { recursive: true });
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

console.log("\n✅ www/ built successfully");
