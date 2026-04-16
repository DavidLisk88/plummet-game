import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',
  plugins: [preact({ devToolsEnabled: false })],
  build: {
    outDir: 'www',
    emptyOutDir: true,
    target: 'safari15',
  },
  server: {
    fs: {
      // Allow serving files from project root
      allow: ['.'],
    },
  },
  optimizeDeps: {
    entries: ['index.html'],
  },
});
