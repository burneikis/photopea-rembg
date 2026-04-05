#!/usr/bin/env python3
"""
System tray launcher for the Photopea rembg plugin.
Starts the backend server, opens Photopea, and sits in the tray.
"""

import json
import os
import signal
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import pystray
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
PIDFILE = os.path.join(ROOT, ".server.pid")
LOGFILE = os.path.join(ROOT, ".server.log")
PYTHON = os.path.join(ROOT, ".venv", "bin", "python")
SERVER = os.path.join(ROOT, "backend", "server.py")
REQUIREMENTS = os.path.join(ROOT, "backend", "requirements.txt")
ICON_FILE = os.path.join(ROOT, "photopea.png")

PORT = 7001
BASE_URL = f"https://localhost:{PORT}"
CONFIG = {
    "environment": {
        "plugins": [{
            "name": "rembg \u2013 Remove Background",
            "url": BASE_URL,
            "icon": f"{BASE_URL}/icon.svg",
        }]
    }
}
PHOTOPEA_URL = f"https://www.photopea.com#{urllib.parse.quote(json.dumps(CONFIG, separators=(',', ':')))}"


def is_running():
    if not os.path.exists(PIDFILE):
        return False
    try:
        pid = int(open(PIDFILE).read().strip())
        os.kill(pid, 0)
        return True
    except (ValueError, ProcessLookupError, OSError):
        os.unlink(PIDFILE)
        return False


def ensure_deps():
    marker = os.path.join(ROOT, ".venv", ".deps-installed")
    req_mtime = os.path.getmtime(REQUIREMENTS)
    if os.path.exists(marker) and os.path.getmtime(marker) >= req_mtime:
        return
    subprocess.run([PYTHON, "-m", "pip", "install", "-q", "-r", REQUIREMENTS], check=True)
    open(marker, "w").write("ok")


def start_server():
    ensure_deps()
    log = open(LOGFILE, "a")
    proc = subprocess.Popen(
        [PYTHON, SERVER, "--port", str(PORT)],
        stdout=log, stderr=log,
        cwd=ROOT,
    )
    open(PIDFILE, "w").write(str(proc.pid))

    # Wait up to 15 s for the server to be ready
    for _ in range(30):
        try:
            urllib.request.urlopen(f"{BASE_URL}/health", context=_ssl_ctx(), timeout=1)
            return True
        except Exception:
            time.sleep(0.5)
    return False  # timed out, but keep going


def stop_server():
    if not os.path.exists(PIDFILE):
        return
    try:
        pid = int(open(PIDFILE).read().strip())
        os.kill(pid, signal.SIGTERM)
    except (ValueError, ProcessLookupError, OSError):
        pass
    finally:
        if os.path.exists(PIDFILE):
            os.unlink(PIDFILE)


def _ssl_ctx():
    import ssl
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def open_photopea(_icon=None, _item=None):
    subprocess.Popen(["xdg-open", PHOTOPEA_URL])


def quit_app(icon, _item=None):
    stop_server()
    icon.stop()


def main():
    if not is_running():
        start_server()

    open_photopea()

    icon_image = Image.open(ICON_FILE)
    menu = pystray.Menu(
        pystray.MenuItem("Open Photopea", open_photopea, default=True),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Stop Server & Quit", quit_app),
    )
    icon = pystray.Icon("rembg-photopea", icon_image, "Rembg for Photopea", menu)
    icon.run()


if __name__ == "__main__":
    main()
