/**
 * generate-icons.js — Generate iOS app icon from logo.svg
 *
 * Creates the 1024x1024 PNG required by the App Store and places it
 * directly into the Xcode asset catalog.
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

async function generateIcon() {
  const svgBuffer = fs.readFileSync(SVG_PATH);

  // 1024x1024 for App Store (required)
  const outputPath = path.join(IOS_ICON_DIR, "AppIcon-512@2x.png");
  await sharp(svgBuffer)
    .resize(1024, 1024)
    .png()
    .toFile(outputPath);

  console.log(`✓  AppIcon-512@2x.png (1024×1024) → ${outputPath}`);
  console.log("\n✅ App icon generated successfully");
}

generateIcon().catch((err) => {
  console.error("Error generating icon:", err);
  process.exit(1);
});
