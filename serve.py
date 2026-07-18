#!/usr/bin/env python3
"""Tiny static HTTPS server for the Photopea rembg plugin.

Photopea itself is served over HTTPS, so the plugin iframe must be too
(mixed content). Uses a self-signed cert for localhost.
"""

import argparse
import http.server
import os
import ssl
import subprocess
import sys
import urllib.request

# Upstream model URLs, proxied via /model/<name> because GitHub release
# assets do not send CORS headers.
MODEL_URLS = {
    "u2net": "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx",
    "u2netp": "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx",
    "u2net_human_seg": "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx",
    "silueta": "https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx",
    "isnet-general-use": "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx",
    "isnet-anime": "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-anime.onnx",
    "bria-rmbg": "https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model.onnx",
}

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PLUGIN_DIR = os.path.join(BASE_DIR, "plugin")
CERT_DIR = os.path.join(BASE_DIR, ".certs")
CERT_FILE = os.path.join(CERT_DIR, "cert.pem")
KEY_FILE = os.path.join(CERT_DIR, "key.pem")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PLUGIN_DIR, **kwargs)

    def end_headers(self):
        # CORS so Photopea can load the icon; correct types for wasm/mjs
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".mjs": "text/javascript",
        ".svg": "image/svg+xml",
    }

    def log_message(self, fmt, *args):
        pass  # quiet

    def do_GET(self):
        if self.path.startswith("/model/"):
            return self.proxy_model(self.path[len("/model/"):])
        return super().do_GET()

    def proxy_model(self, name):
        url = MODEL_URLS.get(name)
        if not url:
            self.send_error(404, "Unknown model")
            return
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "photopea-rembg"})
            with urllib.request.urlopen(req, timeout=60) as upstream:
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                length = upstream.headers.get("Content-Length")
                if length:
                    self.send_header("Content-Length", length)
                self.end_headers()
                while True:
                    chunk = upstream.read(256 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except BrokenPipeError:
            pass
        except Exception as e:
            try:
                self.send_error(502, f"Upstream fetch failed: {e}")
            except Exception:
                pass


def ensure_cert():
    os.makedirs(CERT_DIR, exist_ok=True)
    if os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE):
        return
    print("Generating self-signed certificate...")
    san = "DNS:localhost,IP:127.0.0.1"
    extra = os.environ.get("CERT_SAN_EXTRA", "").strip()
    if extra:
        san += "," + extra
    subprocess.run(
        [
            "openssl", "req", "-x509", "-newkey", "rsa:2048",
            "-keyout", KEY_FILE, "-out", CERT_FILE,
            "-days", "3650", "-nodes",
            "-subj", "/CN=localhost",
            "-addext", f"subjectAltName={san}",
        ],
        check=True,
        capture_output=True,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=7001)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    ensure_cert()

    httpd = http.server.ThreadingHTTPServer((args.host, args.port), Handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(CERT_FILE, KEY_FILE)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    print(f"Serving plugin at https://localhost:{args.port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
