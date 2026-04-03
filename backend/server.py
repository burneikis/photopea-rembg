"""
rembg background removal server with CORS support for Photopea plugin.
"""

import io
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
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


if __name__ == "__main__":
    import argparse
    import os
    import subprocess
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=7001)
    args = parser.parse_args()

    # Reuse the same self-signed cert as the plugin server
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

    print(f"rembg server running at https://localhost:{args.port}")
    print(f"⚠️  Visit https://localhost:{args.port}/health in your browser and accept the self-signed cert!")
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=args.port,
        ssl_certfile=cert_file,
        ssl_keyfile=key_file,
    )
