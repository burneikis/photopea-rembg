# Photopea rembg Plugin

Remove image backgrounds directly inside [Photopea](https://www.photopea.com) using [rembg](https://github.com/danielgatis/rembg).

## Quick Start

```bash
python run.py
```

That's it. On first run this will:
1. Create a Python virtual environment
2. Install dependencies (+ download the ML model, ~170 MB)
3. Generate a self-signed HTTPS certificate
4. Start the server and print a Photopea launch URL

Then follow the two steps printed in the terminal:
1. **Accept the cert** — visit `https://localhost:7001/health` in your browser and click through the security warning
2. **Open the Photopea link** printed in the terminal — the plugin is pre-loaded

> Use `--port` to change the port: `python run.py --port 9000`

## Usage

1. Open an image in Photopea
2. Open the plugin panel (**Window → Plugins → rembg – Remove Background**)
3. Choose "Active Layer" or "Entire Document"
4. Click **Remove Background**
5. A new layer called "rembg result" appears with the background removed

Toggle **Mask mode** to apply the result as a layer mask instead.

## Architecture

A single HTTPS server serves both the plugin UI and the rembg API:

```
Photopea (browser)
  └─ Plugin iframe (localhost:7001)
       ├─ GET  /          → plugin UI
       ├─ POST /api/remove → remove background
       ├─ POST /api/mask   → generate mask
       └─ GET  /health     → health check
```

## One-Click Launcher (Linux)

Instead of running `python run.py` manually each time, use the included launcher:

### Option 1: Desktop shortcut

```bash
# Copy the .desktop file to your desktop or applications
cp rembg-photopea.desktop ~/.local/share/applications/
```

Then find **"Rembg for Photopea"** in your app launcher — it starts the backend and opens Photopea automatically.

### Option 2: Run the script directly

```bash
./launch.sh        # start server + open Photopea
./launch.sh stop   # stop the background server
```

The server runs in the background and is reused across launches. Logs are written to `.server.log`.

### Option 3: Auto-start on login (systemd)

To keep the server always running so a browser bookmark just works:

```bash
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/rembg-photopea.service << EOF
[Unit]
Description=rembg server for Photopea
After=network.target

[Service]
Type=simple
WorkingDirectory=$(pwd)
ExecStart=$(pwd)/.venv/bin/python $(pwd)/backend/server.py --port 7001
Restart=on-failure

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now rembg-photopea
```

Then just bookmark the Photopea URL (printed by `python run.py`) and click it anytime.

## Electron App (Desktop)

Run Photopea + rembg as a standalone desktop app — no terminal, no browser, no manual server start.

### Dev mode (quick test)

```bash
# Make sure the venv is set up first
python run.py &   # or let it stay running

cd electron
npm install
npm start
```

### Build distributable

```bash
cd electron
npm install
npm run dist:linux   # → AppImage + .deb in electron/dist/
# or: npm run dist:win / npm run dist:mac
```

This will:
1. Bundle the Python backend into a standalone binary with PyInstaller
2. Package everything into an Electron app (AppImage/deb/dmg/exe)

The resulting app:
- Shows a splash screen while the backend starts
- Automatically accepts the self-signed cert (no browser warning)
- Opens Photopea with the plugin pre-loaded
- Stops the backend when you close the window

## Production Deployment

For real (non-local) use:

1. Deploy `backend/server.py` behind a reverse proxy with a real SSL cert
2. Host `plugin/index.html` on any HTTPS static host, or let the server serve it
3. Share the Photopea URL with the `#environment` config, or submit to Photopea's plugin catalog

## Files

```
├── run.py                     # One-command launcher (start here)
├── launch.sh                  # Background launcher (start server + open browser)
├── rembg-photopea.desktop     # Linux .desktop shortcut
├── backend/
│   ├── server.py              # FastAPI server (API + plugin UI)
│   └── requirements.txt
├── plugin/
│   └── index.html             # Plugin UI (runs inside Photopea iframe)
├── electron/
│   ├── main.js                # Electron main process
│   ├── preload.js             # Preload (sandboxed)
│   ├── splash.html            # Loading screen
│   ├── build-backend.sh       # PyInstaller build script
│   └── package.json           # Electron + electron-builder config
└── README.md
```
