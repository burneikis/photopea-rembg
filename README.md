# Photopea rembg Plugin

Remove image backgrounds directly inside [Photopea](https://www.photopea.com) using [rembg](https://github.com/danielgatis/rembg).

## Architecture

```
┌─────────────────────────────────────────────┐
│  Photopea (browser)                         │
│  ┌──────────────────────┐                   │
│  │  Plugin iframe        │ ── POST PNG ──▶ rembg server (localhost:7001)
│  │  (localhost:8443)     │ ◀── PNG result ──│
│  └──────────────────────┘                   │
│       ▲ postMessage ▼                       │
│  ┌──────────────────────┐                   │
│  │  Photopea editor      │                  │
│  └──────────────────────┘                   │
└─────────────────────────────────────────────┘
```

## Setup

### 1. Install Python dependencies

```bash
cd backend
pip install -r requirements.txt
```

> First run will download the ML model (~170 MB).

### 2. Start the rembg server

```bash
python backend/server.py
```

This runs at `https://localhost:7001`. Test it:
```bash
curl -sk -F file=@photo.jpg https://localhost:7001/api/remove -o result.png
```

### 3. Start the plugin dev server (HTTPS)

In a second terminal:
```bash
python serve_plugin.py
```

This:
- Generates a self-signed cert (first run only)
- Serves the plugin at `https://localhost:8443/index.html`
- Prints a **Photopea launch URL** with the plugin pre-configured

### 4. Accept the self-signed certs

Before opening Photopea, visit **both** URLs in your browser and accept the security warnings:

1. `https://localhost:8443/index.html` (plugin)
2. `https://localhost:7001/health` (rembg server)

Both servers must be HTTPS because the plugin runs inside Photopea's HTTPS origin — the browser blocks mixed HTTP/HTTPS requests.

### 5. Open Photopea with the plugin

Use the URL printed by `serve_plugin.py`, which looks like:

```
https://www.photopea.com#{"environment":{"plugins":[{"name":"rembg – Remove Background","url":"https://localhost:8443/index.html"}]}}
```

Then go to **Window → Plugins → rembg – Remove Background**.

## Usage

1. Open an image in Photopea
2. Open the plugin panel (Window → Plugins → rembg)
3. Choose "Active Layer" or "Entire Document"
4. Click **Remove Background**
5. A new layer called "rembg result" appears with the background removed

## Production Deployment

For real (non-local) use:

1. Deploy `backend/server.py` behind a reverse proxy with a real SSL cert
2. Host `plugin/index.html` on any HTTPS static host (GitHub Pages, Netlify, etc.)
3. Update the server URL in the plugin UI (or hardcode it in `index.html`)
4. Share the Photopea URL with the `#environment` config, or submit to Photopea's plugin catalog

## Files

```
├── backend/
│   ├── server.py              # FastAPI rembg server
│   └── requirements.txt
├── plugin/
│   └── index.html             # Plugin UI (runs inside Photopea iframe)
├── serve_plugin.py            # HTTPS dev server + Photopea URL generator
└── README.md
```
