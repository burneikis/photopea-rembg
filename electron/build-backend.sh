#!/bin/bash
# Build the Python backend into a standalone binary using PyInstaller.
# Run from the electron/ directory.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="$PROJECT_DIR/.venv"
VENV_PYTHON="$VENV_DIR/bin/python"
OUTPUT_DIR="$(dirname "$0")/backend-dist"

echo "==> Ensuring venv and dependencies…"
if [ ! -f "$VENV_PYTHON" ]; then
  python3 -m venv "$VENV_DIR"
fi

"$VENV_PYTHON" -m pip install -q -r "$PROJECT_DIR/backend/requirements.txt"
"$VENV_PYTHON" -m pip install -q pyinstaller

echo "==> Building backend binary with PyInstaller…"

# Find the rembg package data directory (contains model configs etc.)
REMBG_DIR=$("$VENV_PYTHON" -c "import rembg, os; print(os.path.dirname(rembg.__file__))")

# Find onnxruntime shared libs
ONNX_DIR=$("$VENV_PYTHON" -c "import onnxruntime, os; print(os.path.dirname(onnxruntime.__file__))")

"$VENV_PYTHON" -m PyInstaller \
  --noconfirm \
  --onedir \
  --name rembg-server \
  --distpath "$OUTPUT_DIR" \
  --workpath "$PROJECT_DIR/.pyinstaller-build" \
  --specpath "$PROJECT_DIR/.pyinstaller-build" \
  --add-data "$REMBG_DIR:rembg" \
  --add-data "$PROJECT_DIR/plugin:plugin" \
  --collect-all rembg \
  --collect-all onnxruntime \
  --hidden-import uvicorn.logging \
  --hidden-import uvicorn.loops \
  --hidden-import uvicorn.loops.auto \
  --hidden-import uvicorn.protocols \
  --hidden-import uvicorn.protocols.http \
  --hidden-import uvicorn.protocols.http.auto \
  --hidden-import uvicorn.protocols.websockets \
  --hidden-import uvicorn.protocols.websockets.auto \
  --hidden-import uvicorn.lifespan \
  --hidden-import uvicorn.lifespan.on \
  --hidden-import uvicorn.lifespan.off \
  "$PROJECT_DIR/backend/server.py"

echo "==> Backend binary built at: $OUTPUT_DIR/rembg-server/"
echo "    Size: $(du -sh "$OUTPUT_DIR/rembg-server" | cut -f1)"
