import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',
  plugins: [preact({ devToolsEnabled: false })],
  build: {
    outDir: 'www',
    emptyOutDir: true,
  },
});
