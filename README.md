# photopea-rembg

Remove image backgrounds directly inside [Photopea](https://www.photopea.com) using [rembg](https://github.com/danielgatis/rembg).

## How It Works

`launch.sh` starts the rembg backend in the background (if it isn't already running) and opens Photopea in your browser with the plugin pre-loaded. The backend runs as an HTTPS server on `localhost:7001` and is reused across launches.

## Setup

**Prerequisites:** Python 3, `openssl`, a browser

**First run** — sets up the venv, installs dependencies, and starts the server:
```bash
./launch.sh
```

This will:
1. Create a Python venv and install dependencies (+ download the ML model, ~170 MB)
2. Start the backend server
3. Open Photopea in your browser

**One-time cert step** — because the server is HTTPS with a self-signed cert, you need to accept it in your browser once:
- Visit `https://localhost:7001/health`
- Click through the security warning

After that, the Photopea URL `launch.sh` opens will work normally.

## Desktop Entry (Linux)

Install the launcher as an app:

```bash
DIR="$(cd "$(dirname "$0")" && pwd)"  # or just set this to your repo path
sed "s|/PATH/TO/photopea-rembg|$DIR|" rembg-photopea.desktop \
  > ~/.local/share/applications/rembg-photopea.desktop
```

Then find **Rembg for Photopea** in your app launcher.

To stop the background server:
```bash
./launch.sh stop
```

## Usage

1. Open an image in Photopea
2. Open the plugin panel: **Window → Plugins → rembg – Remove Background**
3. Choose a model and select "Active Layer" or "Entire Document"
4. Click **Remove Background**

Toggle **Mask mode** to apply the result as a layer mask instead of a new layer.

## Files

```
├── launch.sh               # Main launcher (start/stop the server + open browser)
├── rembg-photopea.desktop  # Desktop entry template (see Setup above)
├── photopea.png            # Icon for the desktop entry
├── backend/
│   ├── server.py           # FastAPI backend (rembg API + serves plugin UI)
│   └── requirements.txt
└── plugin/
    └── index.html          # Plugin UI (runs inside Photopea as an iframe)
```

## Architecture

```
launch.sh
  └─ spawns backend/server.py in background (.venv/bin/python)
       ├─ POST /api/remove  → remove background, return transparent PNG
       ├─ POST /api/mask    → return grayscale mask PNG
       ├─ GET  /            → plugin UI (plugin/index.html)
       └─ GET  /health      → health check
  └─ opens browser with Photopea URL (plugin pre-loaded via #environment config)
```

