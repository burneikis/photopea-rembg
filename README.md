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

## Production Deployment

For real (non-local) use:

1. Deploy `backend/server.py` behind a reverse proxy with a real SSL cert
2. Host `plugin/index.html` on any HTTPS static host, or let the server serve it
3. Share the Photopea URL with the `#environment` config, or submit to Photopea's plugin catalog

## Files

```
├── run.py                     # One-command launcher (start here)
├── backend/
│   ├── server.py              # FastAPI server (API + plugin UI)
│   └── requirements.txt
├── plugin/
│   └── index.html             # Plugin UI (runs inside Photopea iframe)
└── README.md
```
