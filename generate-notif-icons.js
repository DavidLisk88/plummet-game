/**
 * Generate Plummet notification icons with #e2d8a6 tint
 * Creates properly sized PNGs for all Android densities
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const TINT_COLOR = '#e2d8a6';

const SIZES = [
    { density: 'mdpi', size: 24 },
    { density: 'hdpi', size: 36 },
    { density: 'xhdpi', size: 48 },
    { density: 'xxhdpi', size: 72 },
    { density: 'xxxhdpi', size: 96 }
];

function drawPIcon(ctx, size) {
    const fontSize = size * 0.7;
    
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = TINT_COLOR;
    ctx.font = `bold ${fontSize}px -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P', size / 2, size / 2);
}

function generateIcons() {
    const baseDir = path.join(__dirname, 'android', 'app', 'src', 'main', 'res');
    
    for (const { density, size } of SIZES) {
        const canvas = createCanvas(size, size);
        const ctx = canvas.getContext('2d');
        
        drawPIcon(ctx, size);
        
        const folder = path.join(baseDir, `drawable-${density}`);
        const filePath = path.join(folder, 'ic_notification.png');
        
        // Ensure folder exists
        if (!fs.existsSync(folder)) {
            fs.mkdirSync(folder, { recursive: true });
        }
        
        // Save PNG
        const buffer = canvas.toBuffer('image/png');
        fs.writeFileSync(filePath, buffer);
        
        console.log(`✓ Created ${density} (${size}x${size}): ${filePath}`);
    }
    
    console.log('\n✅ All notification icons generated with #e2d8a6 tint!');
}

generateIcons();
