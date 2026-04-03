"""
rembg background removal server with CORS support for Photopea plugin.
Also serves the plugin UI so only a single server is needed.
"""

import io
import os
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from rembg import remove
from PIL import Image

app = FastAPI(title="rembg server for Photopea")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PLUGIN_DIR = os.path.join(os.path.dirname(__file__), "..", "plugin")


@app.post("/api/remove")
async def remove_background(file: UploadFile = File(...)):
    """Accept an image, remove its background, return transparent PNG."""
    input_bytes = await file.read()
    input_image = Image.open(io.BytesIO(input_bytes)).convert("RGBA")

    output_image = remove(input_image)

    buf = io.BytesIO()
    output_image.save(buf, format="PNG")
    buf.seek(0)

    return Response(content=buf.getvalue(), media_type="image/png")


@app.post("/api/mask")
async def generate_mask(file: UploadFile = File(...)):
    """Accept an image, return only the foreground mask as a grayscale PNG."""
    input_bytes = await file.read()
    input_image = Image.open(io.BytesIO(input_bytes)).convert("RGBA")

    mask_image = remove(input_image, only_mask=True)

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


if __name__ == "__main__":
    import argparse
    import json
    import subprocess
    import urllib.parse
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=7001)
    args = parser.parse_args()

    cert_dir = os.path.join(os.path.dirname(__file__), "..", ".certs")
    os.makedirs(cert_dir, exist_ok=True)
    cert_file = os.path.join(cert_dir, "cert.pem")
    key_file = os.path.join(cert_dir, "key.pem")

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
