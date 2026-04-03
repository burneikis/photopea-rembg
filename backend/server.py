"""
rembg background removal server with CORS support for Photopea plugin.
Also serves the plugin UI so only a single server is needed.
"""

import io
import os
import sys
from typing import Optional

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from rembg import remove, new_session
from PIL import Image

app = FastAPI(title="rembg server for Photopea")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Support PyInstaller bundled mode
_BASE_DIR = getattr(sys, '_MEIPASS', os.path.dirname(__file__))
PLUGIN_DIR = os.path.join(_BASE_DIR, "plugin") if hasattr(sys, '_MEIPASS') else os.path.join(os.path.dirname(__file__), "..", "plugin")


# Cache sessions so models aren't reloaded on every request
_session_cache: dict[str, object] = {}


def _get_session(model: str):
    if model not in _session_cache:
        _session_cache[model] = new_session(model)
    return _session_cache[model]


@app.post("/api/remove")
async def remove_background(
    file: UploadFile = File(...),
    model: str = Form("u2net"),
    alpha_matting: bool = Form(False),
    alpha_matting_foreground_threshold: int = Form(240),
    alpha_matting_background_threshold: int = Form(10),
    alpha_matting_erode_size: int = Form(10),
    post_process_mask: bool = Form(False),
    bgcolor: Optional[str] = Form(None),
):
    """Accept an image, remove its background, return transparent PNG."""
    input_bytes = await file.read()
    input_image = Image.open(io.BytesIO(input_bytes)).convert("RGBA")

    # Parse bgcolor string "r,g,b,a" into tuple if provided
    bg = None
    if bgcolor:
        parts = [int(x.strip()) for x in bgcolor.split(",")]
        bg = tuple(parts[:4]) if len(parts) >= 4 else None

    session = _get_session(model)
    output_image = remove(
        input_image,
        session=session,
        alpha_matting=alpha_matting,
        alpha_matting_foreground_threshold=alpha_matting_foreground_threshold,
        alpha_matting_background_threshold=alpha_matting_background_threshold,
        alpha_matting_erode_size=alpha_matting_erode_size,
        post_process_mask=post_process_mask,
        bgcolor=bg,
    )

    buf = io.BytesIO()
    output_image.save(buf, format="PNG")
    buf.seek(0)

    return Response(content=buf.getvalue(), media_type="image/png")


@app.post("/api/mask")
async def generate_mask(
    file: UploadFile = File(...),
    model: str = Form("u2net"),
    post_process_mask: bool = Form(False),
):
    """Accept an image, return only the foreground mask as a grayscale PNG."""
    input_bytes = await file.read()
    input_image = Image.open(io.BytesIO(input_bytes)).convert("RGBA")

    session = _get_session(model)
    mask_image = remove(
        input_image,
        session=session,
        only_mask=True,
        post_process_mask=post_process_mask,
    )

    buf = io.BytesIO()
    mask_image.save(buf, format="PNG")
    buf.seek(0)

    return Response(content=buf.getvalue(), media_type="image/png")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/")
async def serve_plugin():
    """Serve the plugin UI at the root."""
    return FileResponse(os.path.join(PLUGIN_DIR, "index.html"), media_type="text/html")


@app.get("/icon.svg")
async def serve_icon():
    """Serve the plugin icon."""
    return FileResponse(os.path.join(PLUGIN_DIR, "icon.svg"), media_type="image/svg+xml")


if __name__ == "__main__":
    import argparse
    import json
    import subprocess
    import urllib.parse
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=7001)
    args = parser.parse_args()

    # Support env vars for packaged (Electron/PyInstaller) mode
    cert_dir = os.environ.get("SSL_CERT_DIR") or os.path.join(os.path.dirname(__file__), "..", ".certs")
    os.makedirs(cert_dir, exist_ok=True)
    cert_file = os.environ.get("SSL_CERTFILE") or os.path.join(cert_dir, "cert.pem")
    key_file = os.environ.get("SSL_KEYFILE") or os.path.join(cert_dir, "key.pem")

    if not (os.path.exists(cert_file) and os.path.exists(key_file)):
        print("Generating self-signed certificate…")
        subprocess.run(
            [
                "openssl", "req", "-x509", "-newkey", "rsa:2048",
                "-keyout", key_file, "-out", cert_file,
                "-days", "365", "-nodes",
                "-subj", "/CN=localhost",
            ],
            check=True,
            capture_output=True,
        )

    base_url = f"https://localhost:{args.port}"
    config = {
        "environment": {
            "plugins": [{
                "name": "rembg – Remove Background",
                "url": base_url,
                "icon": f"{base_url}/icon.svg",
            }]
        }
    }
    photopea_url = f"https://www.photopea.com#{urllib.parse.quote(json.dumps(config, separators=(',', ':')))}" 

    print(f"\n🚀 rembg server + plugin running at {base_url}")
    print(f"\n⚠️  First, visit {base_url}/health and accept the self-signed cert.")
    print(f"\n🔗 Then open Photopea with the plugin:")
    print(f"   {photopea_url}")
    print(f"\n   Go to Window → Plugins → rembg – Remove Background\n")

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=args.port,
        ssl_certfile=cert_file,
        ssl_keyfile=key_file,
    )
