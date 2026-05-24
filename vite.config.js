import { defineConfig } from 'vite';
import path from 'path';

// GitHub Pages project sites: https://<user>.github.io/<repo>/
// Set in CI: VITE_BASE_PATH=/<repo-name>/
// Local / Electron: leave unset (uses relative "./")
const base = process.env.VITE_BASE_PATH || './';

export default defineConfig({
  base,
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
