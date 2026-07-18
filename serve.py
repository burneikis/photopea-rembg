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


def ensure_cert():
    os.makedirs(CERT_DIR, exist_ok=True)
    if os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE):
        return
    print("Generating self-signed certificate...")
    subprocess.run(
        [
            "openssl", "req", "-x509", "-newkey", "rsa:2048",
            "-keyout", KEY_FILE, "-out", CERT_FILE,
            "-days", "3650", "-nodes",
            "-subj", "/CN=localhost",
            "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
        ],
        check=True,
        capture_output=True,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=7001)
    args = parser.parse_args()

    ensure_cert()

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
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
