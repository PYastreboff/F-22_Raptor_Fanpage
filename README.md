# F-22 Raptor Command

Interactive 3D F-22 — hover to maneuver, afterburner effects, radar HUD, and livery switching. Runs as a **desktop app** (Electron) or in the **browser** (GitHub Pages).

## Run locally

```bash
npm install
npm run dev          # Electron + hot reload
```

Browser only (no Electron window):

```bash
npm run dev:web
```

## Desktop build

```bash
npm start            # build + launch Electron
npm run dist         # macOS .dmg / Windows installer → release/
```

## GitHub & GitHub Pages

### First-time push

```bash
cd "/Users/peter/Downloads/f22 fanpage"
git init
git add .
git commit -m "Initial commit: F-22 Raptor Command"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

`node_modules/`, `dist/`, and `release/` are gitignored — only source and `public/` assets are committed (~70MB for the 3D model textures).

### Enable Pages

1. On GitHub: **Settings → Pages**
2. **Build and deployment → Source**: choose **GitHub Actions**
3. Push to `main` — the workflow [deploy-pages.yml](.github/workflows/deploy-pages.yml) builds and deploys automatically

Your site will be live at:

**https://YOUR_USER.github.io/YOUR_REPO/**

The workflow sets `VITE_BASE_PATH` from the repository name, so asset and model paths work without manual config.

### Repo name note

If you rename the repo on GitHub, the public URL path changes to match the new name. Push again to redeploy.

## Credits

- 3D model: [LinirZamir/F22_GLTF-3d-file](https://github.com/LinirZamir/F22_GLTF-3d-file) (`public/f22_raptor/`)
- HDR sky: [Poly Haven — Kloofendal](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) (`public/hdri/sky.hdr`)

## Controls

| Input | Action |
|-------|--------|
| Mouse over jet | Bank, pitch, roll toward cursor |
| Hover airframe | Hotspot intel (radar, engines, bays) |
| `1` `2` `3` | Camera presets |
| `Space` | Afterburner burst |
| Livery buttons | Stealth / Arctic / Aggressor paint |
| Afterburner slider | Engine glow & particles |
