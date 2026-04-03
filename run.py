#!/usr/bin/env python3
"""
One-command launcher for the Photopea rembg plugin.

  python run.py [--port 7001]

This will:
  1. Create a virtual environment (if needed)
  2. Install Python dependencies (if needed)
  3. Generate a self-signed HTTPS cert (if needed)
  4. Start the server and print the Photopea URL
"""

import argparse
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
VENV_DIR = os.path.join(ROOT, ".venv")
REQUIREMENTS = os.path.join(ROOT, "backend", "requirements.txt")


def ensure_venv():
    """Create the virtual environment if it doesn't exist."""
    venv_python = os.path.join(VENV_DIR, "bin", "python")
    if os.path.exists(venv_python):
        return venv_python

    print("📦 Creating virtual environment…")
    subprocess.run([sys.executable, "-m", "venv", VENV_DIR], check=True)
    return venv_python


def ensure_deps(python):
    """Install requirements if the marker file is stale."""
    marker = os.path.join(VENV_DIR, ".deps-installed")
    req_mtime = os.path.getmtime(REQUIREMENTS)

    if os.path.exists(marker) and os.path.getmtime(marker) >= req_mtime:
        return  # already up to date

    print("📦 Installing dependencies (first run may take a minute)…")
    subprocess.run(
        [python, "-m", "pip", "install", "-q", "-r", REQUIREMENTS],
        check=True,
    )
    # Touch marker
    with open(marker, "w") as f:
        f.write("ok")


def main():
    parser = argparse.ArgumentParser(description="Launch rembg Photopea plugin")
    parser.add_argument("--port", type=int, default=7001, help="Server port (default: 7001)")
    args = parser.parse_args()

    python = ensure_venv()
    ensure_deps(python)

    server_script = os.path.join(ROOT, "backend", "server.py")
    os.execv(python, [python, server_script, "--port", str(args.port)])


if __name__ == "__main__":
    main()
