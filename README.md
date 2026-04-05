# photopea-rembg

Remove image backgrounds directly inside [Photopea](https://www.photopea.com) using [rembg](https://github.com/danielgatis/rembg).

An Electron window wraps Photopea and manages the rembg backend automatically.

## Setup

**Prerequisites:** Node.js, Python 3, `npm`, `openssl`

**1. Install Electron dependencies**
```bash
cd electron
npm install
```

**2. Set up the Python venv and install ML dependencies** (~170 MB model download on first run)
```bash
python run.py
# Ctrl+C once you see the server is ready — this just does first-time setup
```

**3. Launch**
```bash
cd electron
npm start
```

The app starts the backend, waits for it to be healthy, then opens Photopea with the plugin pre-loaded.

## Desktop Entry (Linux)

The included `rembg-photopea.desktop` is a template. Install it with the correct absolute path:

```bash
DIR="$(pwd)"
mkdir -p ~/.local/share/applications
cat > ~/.local/share/applications/rembg-photopea.desktop << EOF
[Desktop Entry]
Name=Rembg for Photopea
Comment=Remove backgrounds in Photopea using rembg
Exec=bash -c 'cd $DIR/electron && npm start'
Icon=$DIR/electron/icon.svg
Terminal=false
Type=Application
Categories=Graphics;
EOF
```

Then find **Rembg for Photopea** in your app launcher.

## Usage

1. Open an image in Photopea
2. Open the plugin panel (**Window → Plugins → rembg – Remove Background**)
3. Choose a model, select "Active Layer" or "Entire Document"
4. Click **Remove Background**

Toggle **Mask mode** to apply the result as a layer mask instead of a new layer.

## Architecture

```
electron/main.js
  └─ spawns backend/server.py (.venv/bin/python)
       ├─ POST /api/remove  → remove background, return transparent PNG
       ├─ POST /api/mask    → return grayscale mask PNG
       ├─ GET  /            → plugin UI (plugin/index.html)
       └─ GET  /health      → health check
  └─ opens Photopea in a frameless window
       └─ plugin iframe loads from https://localhost:7001
```

The backend runs HTTPS with a self-signed cert (generated automatically in `.certs/`). Electron is configured to trust it for `localhost`.

## Files

```
├── run.py                  # First-time setup (venv + deps)
├── rembg-photopea.desktop  # Desktop entry template (edit Exec path before use)
├── backend/
│   ├── server.py           # FastAPI backend (rembg API + serves plugin UI)
│   └── requirements.txt
├── plugin/
│   └── index.html          # Plugin UI (runs inside Photopea as an iframe)
└── electron/
    ├── main.js             # Electron entry point
    ├── preload.js
    ├── splash.html
    ├── build-backend.sh    # PyInstaller bundler (for standalone dist builds)
    └── package.json
```

## Notes

- The AppImage/deb builds (`electron/build-backend.sh` + `npm run dist:linux`) are buggy and not the recommended way to use this.
- `launch.sh` is an alternative browser-based launcher (no Electron); it's not the primary workflow.
- ML models are cached in `~/.u2net/` by rembg on first use per model.

## Potential Cleanup

- [ ] Remove or archive `launch.sh` — not the primary workflow
- [ ] Remove or clearly gate the dist/AppImage build path (`electron/build-backend.sh`, `dist:linux` script) since it's known-buggy
- [ ] Add a proper app icon (currently uses the generic `applications-graphics` system icon for the desktop entry)
