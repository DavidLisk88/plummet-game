import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [preact({ devToolsEnabled: false })],
  build: {
    outDir: 'www',
    emptyOutDir: true,
    target: 'safari15',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        musicVideo: path.resolve(__dirname, 'word-runner-music-video.html'),
        testTutorial: path.resolve(__dirname, 'test-tutorial.html'),
      },
    },
  },
  server: {
    fs: {
      // Allow serving files from project root
      allow: ['.'],
    },
  },
  optimizeDeps: {
    entries: ['index.html', 'word-runner-music-video.html', 'test-tutorial.html'],
  },
});
