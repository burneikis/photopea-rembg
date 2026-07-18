# photopea-rembg (v2) - fully in-browser background removal plugin

Rewrite of `~/Code/photopea-rembg-old`, removing the Python backend entirely.
All inference runs client-side in the plugin iframe via **onnxruntime-web**.

## Goal

A single static Photopea plugin (HTML/JS) that:
- exports the active layer / document from Photopea,
- runs a background-segmentation ONNX model in-browser (WASM, WebGPU when available),
- applies the result back as a transparent layer or a layer mask.

No server-side compute. Only a static file server (or static hosting) is needed.

## Architecture

```
photopea-rembg/
├── plan.md
├── README.md
├── launch.sh            # start static server (if not running) + open Photopea URL with plugin config
├── serve.py or similar  # tiny static server (python -m http.server wrapper) — maybe not needed if launch.sh inlines it
└── plugin/
    ├── index.html       # UI (reuse styling/UX from old plugin)
    ├── app.js           # UI logic + Photopea messaging (ported from old index.html)
    ├── inference.js     # model loading, pre/post-processing, onnxruntime-web session handling
    ├── icon.svg
    └── vendor/          # onnxruntime-web dist files (ort.min.js + .wasm), vendored for offline use
```

Models are NOT bundled. They are fetched on first use from rembg's GitHub
release URLs and cached in the browser (Cache API), so it's offline after
the first run per model.

## Key pieces

### 1. Photopea messaging layer
Port unchanged from old plugin (`runScript`, `loadAsset`, `exportPNG`,
mask-apply ActionDescriptor flow). This logic is proven, keep it.

### 2. Inference (replaces backend/server.py)
- `ort.InferenceSession.create(modelBuffer, { executionProviders: ['webgpu', 'wasm'] })`
- Preprocessing per model family:
  - u2net/u2netp/silueta/human_seg: resize to 320x320, normalize (mean 0.485/0.456/0.406, std 0.229/0.224/0.225), NCHW float32
  - isnet-general-use / isnet-anime: 1024x1024, mean 0.5, std 1.0
  - rmbg-1.4 (bria): 1024x1024, mean 0.5, std 1.0
  - (birefnet: large + slow in-browser; defer, add later if feasible)
- Postprocessing: take output mask, min-max normalize, bilinear upscale to
  original size (canvas drawImage), then:
  - normal mode: multiply into alpha channel, export PNG
  - mask mode: grayscale PNG of the mask
- Post-process option: threshold/blur approximation of rembg's
  `post_process_mask` (morphological smoothing via canvas blur + levels).
- Alpha matting: dropped (pymatting has no JS equivalent). Remove from UI.

### 3. Model management
- Model registry: name -> { url, inputSize, normalization, outputName }
- Download with progress bar (fetch + streaming), store via Cache API.
- Show cached/not-cached status per model in the dropdown; "clear cache" button.
- Default model: u2net (~170 MB is isnet; u2net is ~170MB too — show sizes in UI).

### 4. UI (plugin/index.html)
Reuse old UI wholesale, minus backend-specific options:
- keep: model select, apply-to (layer/document), mask mode toggle, post-process toggle, bgcolor replace, status line, config persistence in localStorage
- remove: alpha matting section
- add: model download progress + cache status, WebGPU/WASM indicator

### 5. Launcher
- `launch.sh`: start a tiny static HTTP server on localhost (plain HTTP is fine
  for localhost — no cert dance needed; verify Photopea accepts http plugin
  URLs, otherwise reuse the self-signed HTTPS approach from old version),
  then open `https://www.photopea.com#<json config>` with plugin registered.
- Update `.desktop` entry accordingly (goes in `~/.config/applications/` per conventions).

## Implementation order

1. Skeleton: plugin/index.html served statically, loads in Photopea, echo test works.
2. Vendored onnxruntime-web; load u2net, run inference on a test image in the iframe. Confirm WASM works inside the plugin iframe (no SharedArrayBuffer — use single-threaded WASM; try WebGPU EP first at runtime, fall back).
3. Wire full pipeline: export from Photopea -> infer -> re-import as layer.
4. Mask mode (port ActionDescriptor flow).
5. Model registry + caching + progress UI; add isnet/rmbg models.
6. Post-process + bgcolor options.
7. launch.sh, README, desktop entry.

## Open questions / risks

- Does Photopea allow `http://localhost` plugin URLs (mixed content)? If not, keep the old self-signed HTTPS server trick, but serving static files only.
- WASM performance: u2net at 320x320 should be fine (~1-3 s); 1024x1024 isnet models may be slow without WebGPU.
- Cross-origin model downloads: GitHub release URLs send CORS headers (`*`), should be fine; verify per model source.
- Memory: 1024x1024 float32 models + large canvases; watch for iframe memory limits on big documents.
