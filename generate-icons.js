/**
 * generate-icons.js — Generate iOS & Android app icons from logo.svg
 *
 * Creates the 1024x1024 PNG for iOS App Store and all required
 * Android mipmap sizes, placing them in the correct directories.
 */

const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const SVG_PATH = path.join(__dirname, "logo.svg");
const IOS_ICON_DIR = path.join(
  __dirname,
  "ios",
  "App",
  "App",
  "Assets.xcassets",
  "AppIcon.appiconset"
);
const ANDROID_RES_DIR = path.join(
  __dirname,
  "android",
  "app",
  "src",
  "main",
  "res"
);

// Android mipmap sizes: folder → size in px
const ANDROID_ICONS = [
  { folder: "mipmap-mdpi", size: 48 },
  { folder: "mipmap-hdpi", size: 72 },
  { folder: "mipmap-xhdpi", size: 96 },
  { folder: "mipmap-xxhdpi", size: 144 },
  { folder: "mipmap-xxxhdpi", size: 192 },
];

// Foreground for adaptive icons (needs padding — 108dp with 72dp safe zone)
const ANDROID_FOREGROUND = [
  { folder: "mipmap-mdpi", size: 108 },
  { folder: "mipmap-hdpi", size: 162 },
  { folder: "mipmap-xhdpi", size: 216 },
  { folder: "mipmap-xxhdpi", size: 324 },
  { folder: "mipmap-xxxhdpi", size: 432 },
];

async function generateIcons() {
  const svgBuffer = fs.readFileSync(SVG_PATH);

  // --- iOS ---
  if (fs.existsSync(IOS_ICON_DIR)) {
    const iosOutput = path.join(IOS_ICON_DIR, "AppIcon-512@2x.png");
    await sharp(svgBuffer).resize(1024, 1024).png().toFile(iosOutput);
    console.log(`✓  iOS: AppIcon-512@2x.png (1024×1024)`);
  }

  // --- Android ---
  if (fs.existsSync(ANDROID_RES_DIR)) {
    // Legacy launcher icons (ic_launcher.png and ic_launcher_round.png)
    for (const { folder, size } of ANDROID_ICONS) {
      const dir = path.join(ANDROID_RES_DIR, folder);
      if (!fs.existsSync(dir)) continue;

      // Square icon
      await sharp(svgBuffer)
        .resize(size, size)
        .png()
        .toFile(path.join(dir, "ic_launcher.png"));

      // Round icon (same image, Android clips it to circle)
      await sharp(svgBuffer)
        .resize(size, size)
        .png()
        .toFile(path.join(dir, "ic_launcher_round.png"));

      console.log(`✓  Android: ${folder}/ic_launcher.png (${size}×${size})`);
    }

    // Adaptive icon foreground
    for (const { folder, size } of ANDROID_FOREGROUND) {
      const dir = path.join(ANDROID_RES_DIR, folder);
      if (!fs.existsSync(dir)) continue;

      // Foreground with padding (logo occupies ~66% of the canvas)
      const logoSize = Math.round(size * 0.66);
      const padding = Math.round((size - logoSize) / 2);

      await sharp(svgBuffer)
        .resize(logoSize, logoSize)
        .extend({
          top: padding,
          bottom: size - logoSize - padding,
          left: padding,
          right: size - logoSize - padding,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toFile(path.join(dir, "ic_launcher_foreground.png"));

      console.log(`✓  Android: ${folder}/ic_launcher_foreground.png (${size}×${size})`);
    }

    // Play Store icon (512x512)
    await sharp(svgBuffer)
      .resize(512, 512)
      .png()
      .toFile(path.join(ANDROID_RES_DIR, "..", "playstore-icon.png"));
    console.log(`✓  Android: playstore-icon.png (512×512)`);
  }

  console.log("\n✅ All icons generated successfully");
}

generateIcons().catch((err) => {
  console.error("Error generating icons:", err);
  process.exit(1);
});
