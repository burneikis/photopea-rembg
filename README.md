# photopea-rembg

Photopea plugin for background removal, running **fully in the browser** via
[onnxruntime-web](https://onnxruntime.ai/) (WebGPU when available, WASM
fallback). No Python backend — only a tiny static file server.

Rewrite of `photopea-rembg-old`, which used a rembg/FastAPI backend.

## Usage

```sh
./launch.sh        # start the static server + open Photopea with the plugin
./launch.sh stop   # stop the server
```

On first run, visit `https://localhost:7001` once and accept the self-signed
certificate (Photopea is HTTPS, so the plugin iframe must be too).

In Photopea: Window -> Plugins -> "rembg – Remove Background".

## Features

- Models: u2net, u2netp, u2net_human_seg, silueta, isnet-general-use,
  isnet-anime, bria-rmbg (1.4)
- Apply to active layer or entire document
- Mask mode: applies the result as a layer mask instead of a new layer
- Post-process mask (edge smoothing), background color replacement
- Models download on first use from rembg's GitHub releases and are cached
  in the browser (Cache API) — offline afterwards
- Settings persisted in localStorage

## Layout

```
plugin/           static plugin (index.html, app.js, inference.js, vendor/)
serve.py          static HTTPS server (self-signed cert in .certs/)
launch.sh         server + Photopea launcher
```

## Notes

- WASM is single-threaded (no SharedArrayBuffer in the plugin iframe);
  320x320 u2net models run in a few seconds, 1024x1024 isnet/bria models are
  slow without WebGPU.
- Alpha matting from the old version was dropped (no JS pymatting equivalent).
- BiRefNet models are not included (too large/slow in-browser for now).
