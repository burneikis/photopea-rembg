#!/usr/bin/env python3
"""
System tray icon for the Photopea rembg plugin.
Starts the backend server, opens Photopea, and sits in the tray.
Left-click: open Photopea. Right-click: menu.
"""

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, GLib

import json
import os
import signal
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import ssl

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
PHOTOPEA_URL = (
    "https://www.photopea.com#"
    + urllib.parse.quote(json.dumps(CONFIG, separators=(",", ":")))
)


def _ssl_ctx():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def is_running():
    if not os.path.exists(PIDFILE):
        return False
    try:
        pid = int(open(PIDFILE).read().strip())
        os.kill(pid, 0)
        return True
    except (ValueError, ProcessLookupError, OSError):
        try:
            os.unlink(PIDFILE)
        except OSError:
            pass
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
    for _ in range(30):
        try:
            urllib.request.urlopen(f"{BASE_URL}/health", context=_ssl_ctx(), timeout=1)
            return
        except Exception:
            time.sleep(0.5)


def stop_server():
    if not os.path.exists(PIDFILE):
        return
    try:
        pid = int(open(PIDFILE).read().strip())
        os.kill(pid, signal.SIGTERM)
    except (ValueError, ProcessLookupError, OSError):
        pass
    finally:
        try:
            os.unlink(PIDFILE)
        except OSError:
            pass


def open_photopea():
    subprocess.Popen(["xdg-open", PHOTOPEA_URL])


class TrayIcon:
    def __init__(self):
        self.icon = Gtk.StatusIcon()
        self.icon.set_from_file(ICON_FILE)
        self.icon.set_tooltip_text("Rembg for Photopea")
        self.icon.set_visible(True)
        self.icon.connect("activate", self._on_activate)
        self.icon.connect("popup-menu", self._on_popup_menu)

    def _on_activate(self, _icon):
        open_photopea()

    def _on_popup_menu(self, icon, button, timestamp):
        menu = Gtk.Menu()

        item_open = Gtk.MenuItem(label="Open Photopea")
        item_open.connect("activate", lambda _: open_photopea())
        menu.append(item_open)

        menu.append(Gtk.SeparatorMenuItem())

        item_quit = Gtk.MenuItem(label="Stop Server & Quit")
        item_quit.connect("activate", lambda _: self._quit())
        menu.append(item_quit)

        menu.show_all()
        menu.popup(None, None, Gtk.StatusIcon.position_menu, icon, button, timestamp)

    def _quit(self):
        stop_server()
        Gtk.main_quit()


def main():
    if not is_running():
        start_server()

    open_photopea()

    _tray = TrayIcon()
    Gtk.main()


if __name__ == "__main__":
    main()
