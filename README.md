# F-22 Raptor Command

Interactive 3D F-22 Raptor — hover to maneuver, afterburner effects, radar HUD, weather, and livery switching. Runs as a **desktop app** (Electron) or in the **browser**.

## Live demo

**https://pyastreboff.github.io/F-22_Raptor_Fanpage/**

## Run locally

```bash
npm install
npm run dev          # Electron + hot reload
```

Browser only (no Electron window):

```bash
npm run dev:web
```

Production build preview:

```bash
npm run build
npm run preview
```

## Desktop build

```bash
npm start            # build + launch Electron
npm run dist         # macOS .dmg / Windows installer → release/
```

## GitHub Pages deploy

This repo ships a workflow that builds with Vite and publishes the **`dist/`** folder (bundled JS/CSS + `public/` assets). The live site must **not** serve raw source from the repo root.

### One-time setup (required if the site is only plain text)

1. Open **https://github.com/PYastreboff/F-22_Raptor_Fanpage/settings/pages**
2. Under **Build and deployment → Source**, choose **GitHub Actions** (not “Deploy from a branch” with `/` or `/docs` on `main`).
3. Push to `main` and wait for the [**Deploy to GitHub Pages**](.github/workflows/deploy-pages.yml) workflow to finish (green check).

The workflow also updates the **`gh-pages`** branch. If you prefer branch deploy instead of Actions, set Source to **branch `gh-pages`** / **/ (root)**.

### How to tell it is fixed

View page source on the live URL. You should see:

```html
<script type="module" crossorigin src="./assets/index-xxxxx.js"></script>
```

If you still see `src="/src/main.js"`, Pages is serving **source** files — the 3D app cannot load (HUD shows as unstyled text). Switch the Pages source as above and redeploy.

### Troubleshooting

| Symptom | Fix |
|--------|-----|
| Plain text HUD, no jet / dark canvas | Pages source must be **GitHub Actions** or **`gh-pages`** branch, not `main` root |
| `assets/index-*.js` 404 in Network tab | Open the site with a trailing slash: `.../F-22_Raptor_Fanpage/` |
| “Failed to load” overlay | Check console; confirm `f22_raptor/` and `hdri/` exist under the deployed site |
| Blocky jet made of simple parts; HUD says **PLACEHOLDER MODEL** | The real GLTF did not load. Use `npm run dev` or `npm run dev:web` (not opening `index.html` in Finder). Confirm `public/f22_raptor/scene.gltf` exists. For desktop after `npm start`, rebuild so Electron serves `dist/` over HTTP. |

`node_modules/`, `dist/`, and `release/` are gitignored — only source and `public/` assets are committed (~70MB for the 3D model textures).

## Credits

- 3D model: [LinirZamir/F22_GLTF-3d-file](https://github.com/LinirZamir/F22_GLTF-3d-file) (`public/f22_raptor/`)
- HDR sky: [Poly Haven — Kloofendal](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) (`public/hdri/sky.hdr`)

## Controls

| Input | Action |
|-------|--------|
| Mouse over jet | Bank, pitch, roll toward cursor |
| Hover airframe | Hotspot intel (radar, engines, bays) |
| `1`–`6` | Camera presets (`4` tail, `5` top, `6` bottom) |
| `Space` | Afterburner burst |
| `G` or gear checkbox | Landing gear up / down |
| Weather buttons | Clear, Cloudy, Overcast, Rain, Storm, Night |
| Livery buttons | Stealth / Arctic / Aggressor paint |
| Afterburner slider | Engine glow & particles |
