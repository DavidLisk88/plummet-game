/**
 * Generate Android notification icons for Plummet
 * Creates white silhouette icons with transparency at all required densities
 */

import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// Android density folders and their corresponding icon sizes (24dp base)
const DENSITIES = [
    { folder: 'drawable-mdpi', size: 24 },
    { folder: 'drawable-hdpi', size: 36 },
    { folder: 'drawable-xhdpi', size: 48 },
    { folder: 'drawable-xxhdpi', size: 72 },
    { folder: 'drawable-xxxhdpi', size: 96 },
];

const ANDROID_RES_PATH = './android/app/src/main/res';

/**
 * Create an SVG icon that can be rendered at any size
 * This is a minimalist book with "P" for Plummet Word of the Day
 */
function createIconSVG(size) {
    const s = size / 24; // Scale factor from 24dp base
    
    return `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <!-- Book shape -->
  <rect x="${4*s}" y="${3*s}" width="${16*s}" height="${18*s}" rx="${2*s}" fill="white"/>
  
  <!-- Book spine -->
  <rect x="${7*s}" y="${3*s}" width="${1*s}" height="${18*s}" fill="black"/>
  
  <!-- Letter P -->
  <text x="${13*s}" y="${14*s}" 
        font-family="Arial, sans-serif" 
        font-size="${11*s}px" 
        font-weight="bold" 
        text-anchor="middle" 
        fill="black">P</text>
</svg>`;
}

/**
 * Alternative: Simple "P" in a circle (cleaner at small sizes)
 */
function createSimpleIconSVG(size) {
    const s = size / 24;
    const cx = 12 * s;
    const cy = 12 * s;
    const r = 10 * s;
    
    return `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <!-- Circle background -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="white"/>
  
  <!-- Letter P (cutout) -->
  <text x="${cx}" y="${cy + 4*s}" 
        font-family="Arial, sans-serif" 
        font-size="${13*s}px" 
        font-weight="bold" 
        text-anchor="middle" 
        fill="black">P</text>
</svg>`;
}

/**
 * Modern speech bubble with text lines (represents "word of the day")
 */
function createBubbleIconSVG(size) {
    const s = size / 24;
    
    return `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <!-- Speech bubble -->
  <path d="M${4*s},${4*s} 
           L${20*s},${4*s} 
           Q${22*s},${4*s} ${22*s},${6*s}
           L${22*s},${15*s}
           Q${22*s},${17*s} ${20*s},${17*s}
           L${10*s},${17*s}
           L${6*s},${21*s}
           L${6*s},${17*s}
           L${4*s},${17*s}
           Q${2*s},${17*s} ${2*s},${15*s}
           L${2*s},${6*s}
           Q${2*s},${4*s} ${4*s},${4*s}
           Z" 
        fill="white"/>
  
  <!-- Text lines -->
  <rect x="${5*s}" y="${7*s}" width="${14*s}" height="${2*s}" rx="${1*s}" fill="black"/>
  <rect x="${5*s}" y="${11*s}" width="${10*s}" height="${2*s}" rx="${1*s}" fill="black"/>
</svg>`;
}

async function generateIcons() {
    console.log('🎨 Generating Plummet notification icons...\n');
    
    for (const { folder, size } of DENSITIES) {
        const folderPath = join(ANDROID_RES_PATH, folder);
        
        // Create folder if it doesn't exist
        if (!existsSync(folderPath)) {
            await mkdir(folderPath, { recursive: true });
            console.log(`📁 Created ${folder}/`);
        }
        
        // Generate the icon using the bubble design (clearest at small sizes)
        const svg = createBubbleIconSVG(size);
        const outputPath = join(folderPath, 'ic_notification.png');
        
        await sharp(Buffer.from(svg))
            .png()
            .toFile(outputPath);
        
        console.log(`✅ ${folder}/ic_notification.png (${size}×${size}px)`);
    }
    
    console.log('\n✨ All notification icons generated!');
    console.log('\nNext steps:');
    console.log('1. Run: npx cap sync android');
    console.log('2. The icons will be used for Word of the Day notifications');
}

generateIcons().catch(console.error);
