const https = require('https');
const fs = require('fs');

const files = [
  { name: 'trex.ts', url: 'https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/neterror/resources/dino_game/trex.ts?format=TEXT' },
  { name: 'constants.ts', url: 'https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/neterror/resources/dino_game/constants.ts?format=TEXT' },
];

for (const file of files) {
  https.get(file.url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      const decoded = Buffer.from(data, 'base64').toString('utf8');
      fs.writeFileSync(`TUTORIAL/chrome-dino-${file.name}`, decoded);
      console.log(`${file.name}: ${decoded.length} chars, ${decoded.split('\n').length} lines`);
    });
  }).on('error', (e) => {
    console.error(`Error fetching ${file.name}:`, e.message);
  });
}
