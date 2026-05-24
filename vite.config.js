import { defineConfig } from 'vite';
import path from 'path';

// Relative base works on GitHub Pages for any repo name (project sites use a subpath).
// import.meta.env.BASE_URL resolves asset paths in src/.
export default defineConfig({
  base: './',
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: { port: 5173, strictPort: true },
});
