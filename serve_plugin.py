"""
Simple HTTPS dev server for the plugin folder.
Photopea requires HTTPS for plugins, so we generate a self-signed cert on the fly.

Usage:  python serve_plugin.py [--port 8443]
Then:   https://localhost:8443/index.html
"""

import argparse
import http.server
import os
import ssl
import subprocess
import sys
import tempfile


def generate_self_signed_cert(cert_dir):
    cert_file = os.path.join(cert_dir, "cert.pem")
    key_file = os.path.join(cert_dir, "key.pem")

    if os.path.exists(cert_file) and os.path.exists(key_file):
        return cert_file, key_file

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
    return cert_file, key_file


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8443)
    args = parser.parse_args()

    plugin_dir = os.path.join(os.path.dirname(__file__), "plugin")
    cert_dir = os.path.join(os.path.dirname(__file__), ".certs")
    os.makedirs(cert_dir, exist_ok=True)

    cert_file, key_file = generate_self_signed_cert(cert_dir)

    os.chdir(plugin_dir)

    handler = http.server.SimpleHTTPRequestHandler
    httpd = http.server.HTTPServer(("0.0.0.0", args.port), handler)

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert_file, key_file)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    url = f"https://localhost:{args.port}/index.html"
    print(f"Plugin server running at {url}")
    print(f"⚠️  Visit {url} in your browser first and accept the self-signed cert!")
    print()

    # Print the Photopea launch URL
    import json
    import urllib.parse

    config = {
        "environment": {
            "plugins": [
                {
                    "name": "rembg – Remove Background",
                    "url": f"https://localhost:{args.port}/index.html",
                }
            ]
        }
    }
    encoded = urllib.parse.quote(json.dumps(config, separators=(",", ":")))
    photopea_url = f"https://www.photopea.com#{encoded}"

    print("Open Photopea with the plugin pre-loaded:")
    print(photopea_url)
    print()
    print("Then go to Window → Plugins → rembg – Remove Background")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        httpd.shutdown()


if __name__ == "__main__":
    main()
