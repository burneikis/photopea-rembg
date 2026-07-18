// inference.js — model registry, downloading/caching, and ONNX inference
// Runs fully in-browser via onnxruntime-web (WebGPU with WASM fallback).

"use strict";

// ── Model registry ───────────────────────────────────────────
// Sources: rembg's GitHub release assets (CORS-enabled).
const REMBG_BASE = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/";

const MODELS = {
  "u2net": {
    label: "u2net (general purpose)",
    url: REMBG_BASE + "u2net.onnx",
    size: "168 MB",
    inputSize: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
  },
  "u2netp": {
    label: "u2netp (lightweight)",
    url: REMBG_BASE + "u2netp.onnx",
    size: "4 MB",
    inputSize: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
  },
  "u2net_human_seg": {
    label: "u2net_human_seg (people)",
    url: REMBG_BASE + "u2net_human_seg.onnx",
    size: "168 MB",
    inputSize: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
  },
  "silueta": {
    label: "silueta (small u2net)",
    url: REMBG_BASE + "silueta.onnx",
    size: "43 MB",
    inputSize: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
  },
  "isnet-general-use": {
    label: "isnet-general-use",
    url: REMBG_BASE + "isnet-general-use.onnx",
    size: "170 MB",
    inputSize: 1024,
    mean: [0.5, 0.5, 0.5],
    std: [1.0, 1.0, 1.0],
  },
  "isnet-anime": {
    label: "isnet-anime",
    url: REMBG_BASE + "isnet-anime.onnx",
    size: "168 MB",
    inputSize: 1024,
    mean: [0.5, 0.5, 0.5],
    std: [1.0, 1.0, 1.0],
  },
  "bria-rmbg": {
    label: "bria-rmbg 1.4",
    url: "https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model.onnx",
    size: "176 MB",
    inputSize: 1024,
    mean: [0.5, 0.5, 0.5],
    std: [1.0, 1.0, 1.0],
  },
};

// ── ORT environment setup ────────────────────────────────────
ort.env.wasm.wasmPaths = "vendor/";
// Plugin iframe has no cross-origin isolation -> no SharedArrayBuffer.
ort.env.wasm.numThreads = 1;

let _webgpuAvailable = null;
async function webgpuAvailable() {
  if (_webgpuAvailable !== null) return _webgpuAvailable;
  try {
    _webgpuAvailable = !!(navigator.gpu && (await navigator.gpu.requestAdapter()));
  } catch (_) {
    _webgpuAvailable = false;
  }
  return _webgpuAvailable;
}

// ── Model download + Cache API storage ───────────────────────
const MODEL_CACHE = "rembg-models-v1";

async function isModelCached(name) {
  try {
    const cache = await caches.open(MODEL_CACHE);
    return !!(await cache.match(MODELS[name].url));
  } catch (_) {
    return false;
  }
}

async function clearModelCache() {
  await caches.delete(MODEL_CACHE);
}

/**
 * Fetch a model with streaming progress, storing it via Cache API.
 * onProgress(loadedBytes, totalBytes|0)
 * Returns an ArrayBuffer.
 */
async function fetchModel(name, onProgress) {
  const url = MODELS[name].url;
  const cache = await caches.open(MODEL_CACHE);

  const cached = await cache.match(url);
  if (cached) return await cached.arrayBuffer();

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Model download failed: ${resp.status} ${resp.statusText}`);

  const total = parseInt(resp.headers.get("Content-Length") || "0", 10);
  const reader = resp.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (onProgress) onProgress(loaded, total);
  }
  const buffer = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { buffer.set(c, off); off += c.length; }

  try {
    await cache.put(url, new Response(buffer.buffer.slice(0), {
      headers: { "Content-Type": "application/octet-stream" },
    }));
  } catch (e) {
    console.warn("Failed to cache model:", e);
  }
  return buffer.buffer;
}

// ── Session management ───────────────────────────────────────
let _session = null;
let _sessionModel = null;
let _sessionEP = null;

async function getSession(name, onProgress, onStatus) {
  if (_session && _sessionModel === name) return _session;
  if (_session) { try { await _session.release(); } catch (_) {} _session = null; }

  const buf = await fetchModel(name, onProgress);
  if (onStatus) onStatus("Initializing model…");

  const eps = (await webgpuAvailable()) ? [["webgpu"], ["wasm"]] : [["wasm"]];
  let lastErr = null;
  for (const ep of eps) {
    try {
      _session = await ort.InferenceSession.create(buf, { executionProviders: ep });
      _sessionEP = ep[0];
      break;
    } catch (e) {
      console.warn(`EP ${ep[0]} failed:`, e);
      lastErr = e;
    }
  }
  if (!_session) throw lastErr || new Error("Failed to create inference session");
  _sessionModel = name;
  return _session;
}

function currentEP() { return _sessionEP; }

// ── Pre/post-processing ──────────────────────────────────────

/**
 * Run background segmentation on an image.
 * @param {ImageBitmap|HTMLImageElement} img source image
 * @param {string} modelName key into MODELS
 * @returns {Float32Array} mask values in [0,1], size inputSize*inputSize
 */
async function runModel(img, modelName, onProgress, onStatus) {
  const m = MODELS[modelName];
  const S = m.inputSize;

  const session = await getSession(modelName, onProgress, onStatus);
  if (onStatus) onStatus("Running inference…");

  // Draw resized image
  const canvas = document.createElement("canvas");
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  // Composite onto white like rembg does for RGBA inputs converted to RGB
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, S, S);
  ctx.drawImage(img, 0, 0, S, S);
  const { data } = ctx.getImageData(0, 0, S, S);

  // NCHW float32 normalize. rembg normalizes pixels to [0,1] by dividing by
  // the max pixel value of the image, then applies mean/std.
  let maxv = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > maxv) maxv = data[i];
    if (data[i + 1] > maxv) maxv = data[i + 1];
    if (data[i + 2] > maxv) maxv = data[i + 2];
  }
  if (maxv === 0) maxv = 255;

  const n = S * S;
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    input[i]         = (data[i * 4]     / maxv - m.mean[0]) / m.std[0];
    input[n + i]     = (data[i * 4 + 1] / maxv - m.mean[1]) / m.std[1];
    input[2 * n + i] = (data[i * 4 + 2] / maxv - m.mean[2]) / m.std[2];
  }

  const tensor = new ort.Tensor("float32", input, [1, 3, S, S]);
  const feeds = {};
  feeds[session.inputNames[0]] = tensor;
  const results = await session.run(feeds);
  const out = results[session.outputNames[0]];
  const raw = out.data;

  // First channel of first output; min-max normalize.
  const mask = new Float32Array(n);
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = raw[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const range = mx - mn || 1;
  for (let i = 0; i < n; i++) mask[i] = (raw[i] - mn) / range;
  return mask;
}

/**
 * Convert a square float mask to a grayscale canvas at target size
 * (bilinear upscale via drawImage).
 */
function maskToCanvas(mask, maskSize, width, height) {
  const small = document.createElement("canvas");
  small.width = maskSize; small.height = maskSize;
  const sctx = small.getContext("2d");
  const id = sctx.createImageData(maskSize, maskSize);
  for (let i = 0; i < mask.length; i++) {
    const v = Math.max(0, Math.min(255, Math.round(mask[i] * 255)));
    id.data[i * 4] = v;
    id.data[i * 4 + 1] = v;
    id.data[i * 4 + 2] = v;
    id.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(id, 0, 0);

  const big = document.createElement("canvas");
  big.width = width; big.height = height;
  const bctx = big.getContext("2d", { willReadFrequently: true });
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = "high";
  bctx.drawImage(small, 0, 0, width, height);
  return big;
}

/**
 * Approximate rembg's post_process_mask: slight blur + threshold-ish
 * levels to smooth jagged edges.
 */
function postProcessMaskCanvas(maskCanvas) {
  const w = maskCanvas.width, h = maskCanvas.height;
  const tmp = document.createElement("canvas");
  tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext("2d", { willReadFrequently: true });
  tctx.filter = "blur(2px)";
  tctx.drawImage(maskCanvas, 0, 0);
  tctx.filter = "none";

  // Levels: steepen the curve around 0.5 to re-harden edges after blur
  const id = tctx.getImageData(0, 0, w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    let v = d[i] / 255;
    v = Math.max(0, Math.min(1, (v - 0.35) / 0.3));
    const o = Math.round(v * 255);
    d[i] = o; d[i + 1] = o; d[i + 2] = o;
  }
  tctx.putImageData(id, 0, 0);
  return tmp;
}

/**
 * Full pipeline: PNG ArrayBuffer in -> PNG ArrayBuffer out.
 * opts: { model, maskMode, postProcess, bgcolor: null | [r,g,b] }
 * Returns { buffer, width, height }
 */
async function removeBackgroundLocal(pngBuffer, opts, onProgress, onStatus) {
  const blob = new Blob([pngBuffer], { type: "image/png" });
  const img = await createImageBitmap(blob);
  const w = img.width, h = img.height;

  const m = MODELS[opts.model];
  const mask = await runModel(img, opts.model, onProgress, onStatus);

  if (onStatus) onStatus("Compositing result…");
  let maskCanvas = maskToCanvas(mask, m.inputSize, w, h);
  if (opts.postProcess) maskCanvas = postProcessMaskCanvas(maskCanvas);

  let outCanvas;
  if (opts.maskMode) {
    outCanvas = maskCanvas;
  } else {
    outCanvas = document.createElement("canvas");
    outCanvas.width = w; outCanvas.height = h;
    const ctx = outCanvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, w, h);
    const mctx = maskCanvas.getContext("2d", { willReadFrequently: true });
    const md = mctx.getImageData(0, 0, w, h).data;
    const d = id.data;
    if (opts.bgcolor) {
      const [br, bg, bb] = opts.bgcolor;
      for (let i = 0, p = 0; i < d.length; i += 4, p += 4) {
        const a = md[p] / 255;
        d[i]     = Math.round(d[i]     * a + br * (1 - a));
        d[i + 1] = Math.round(d[i + 1] * a + bg * (1 - a));
        d[i + 2] = Math.round(d[i + 2] * a + bb * (1 - a));
        d[i + 3] = 255;
      }
    } else {
      for (let i = 0, p = 0; i < d.length; i += 4, p += 4) {
        d[i + 3] = Math.round(d[i + 3] * (md[p] / 255));
      }
    }
    ctx.putImageData(id, 0, 0);
  }

  img.close && img.close();

  const outBlob = await new Promise((res) => outCanvas.toBlob(res, "image/png"));
  return { buffer: await outBlob.arrayBuffer(), width: w, height: h };
}
