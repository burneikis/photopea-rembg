// app.js — UI logic + Photopea messaging
"use strict";

// ── Photopea communication layer ──────────────────────────
// From inside a plugin iframe, window.parent is the Photopea window.
// postMessage(scriptString) runs a script; Photopea replies with zero or
// more data messages followed by a final "done" string.
// postMessage(ArrayBuffer) loads a file and replies "done" when finished.

function isFromPea(e) {
  try {
    if (/(^|\.)photopea\.com$/.test(new URL(e.origin).hostname)) return true;
  } catch (_) {}
  return e.source === window.parent || e.source === window.top;
}

function postToPea(msg) {
  window.parent.postMessage(msg, "*");
  if (window.top !== window.parent) {
    try { window.top.postMessage(msg, "*"); } catch (_) {}
  }
}

function pause(ms = 30) {
  return new Promise(r => setTimeout(r, ms));
}

function runScript(script, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const outputs = [];
    const timer = setTimeout(() => {
      window.removeEventListener("message", handler);
      reject(new Error("Timed out waiting for Photopea to respond"));
    }, timeoutMs);
    function handler(e) {
      if (!isFromPea(e)) return;
      if (e.data === "done") {
        clearTimeout(timer);
        window.removeEventListener("message", handler);
        resolve(outputs);
      } else {
        outputs.push(e.data);
      }
    }
    window.addEventListener("message", handler);
    postToPea(script);
  });
}

function loadAsset(arrayBuffer, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", handler);
      reject(new Error("Timed out waiting for Photopea to load asset"));
    }, timeoutMs);
    function handler(e) {
      if (!isFromPea(e)) return;
      if (e.data === "done") {
        clearTimeout(timer);
        window.removeEventListener("message", handler);
        resolve();
      }
    }
    window.addEventListener("message", handler);
    postToPea(arrayBuffer);
  });
}

async function exportPNG() {
  let buffer = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    await pause();
    const data = await runScript('app.activeDocument.saveToOE("png");');
    buffer = data.find(d => d instanceof ArrayBuffer);
    if (buffer) return buffer;
    await pause(200);
  }
  throw new Error("Failed to export image from Photopea");
}

// ── Config persistence via localStorage ─────────────────
const CONFIG_KEY = "rembg_config_v2";

function $(id) { return document.getElementById(id); }

function saveConfig() {
  const config = {
    model: $("model").value,
    mode: $("mode").value,
    maskMode: $("mask-mode").checked,
    postProcess: $("post-process").checked,
    bgcolorEnabled: $("bgcolor-enable").checked,
    bgcolorHex: $("bgcolor-picker").value,
  };
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch (e) {}
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return;
    const c = JSON.parse(raw);
    if (c.model && MODELS[c.model]) $("model").value = c.model;
    if (c.mode) $("mode").value = c.mode;
    if (c.maskMode !== undefined) $("mask-mode").checked = c.maskMode;
    if (c.postProcess !== undefined) $("post-process").checked = c.postProcess;
    if (c.bgcolorEnabled !== undefined) {
      $("bgcolor-enable").checked = c.bgcolorEnabled;
      $("bgcolor-options").classList.toggle("open", c.bgcolorEnabled);
    }
    if (c.bgcolorHex) $("bgcolor-picker").value = c.bgcolorHex;
  } catch (e) {}
}

// ── Model dropdown + cache status ────────────────────────
async function populateModels() {
  const sel = $("model");
  const prev = sel.value;
  sel.innerHTML = "";
  for (const [name, m] of Object.entries(MODELS)) {
    const cached = await isModelCached(name);
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = `${m.label} — ${cached ? "cached" : m.size}`;
    sel.appendChild(opt);
  }
  if (prev && MODELS[prev]) sel.value = prev;
}

async function updateEPIndicator() {
  const el = $("ep-indicator");
  el.textContent = (await webgpuAvailable()) ? "WebGPU" : "WASM (CPU)";
}

async function clearCache() {
  await clearModelCache();
  await populateModels();
  const status = $("status");
  status.className = "";
  status.textContent = "Model cache cleared.";
}

// ── Init ────────────────────────────────────────────────
(async () => {
  await populateModels();
  loadConfig();
  updateEPIndicator();
  document.querySelectorAll("select, input").forEach(el => {
    el.addEventListener("change", saveConfig);
    el.addEventListener("input", saveConfig);
  });
})();

function fmtMB(b) { return (b / 1024 / 1024).toFixed(1); }

// ── Main action ─────────────────────────────────────────
async function removeBackground() {
  const btn = $("btn-remove");
  const status = $("status");
  const progressWrap = $("progress-wrap");
  const progressBar = $("progress-bar");
  const mode = $("mode").value;
  const maskMode = $("mask-mode").checked;
  const model = $("model").value;
  const postProcess = $("post-process").checked;
  const bgcolorEnabled = $("bgcolor-enable").checked;
  const bgcolorHex = $("bgcolor-picker").value;

  btn.disabled = true;
  status.className = "";
  status.innerHTML = '<span class="spinner"></span> Exporting image from Photopea…';

  const onProgress = (loaded, total) => {
    progressWrap.style.display = "block";
    if (total) {
      progressBar.style.width = `${(loaded / total) * 100}%`;
      status.innerHTML = `<span class="spinner"></span> Downloading model… ${fmtMB(loaded)} / ${fmtMB(total)} MB`;
    } else {
      progressBar.style.width = "100%";
      status.innerHTML = `<span class="spinner"></span> Downloading model… ${fmtMB(loaded)} MB`;
    }
  };
  const onStatus = (msg) => {
    progressWrap.style.display = "none";
    status.innerHTML = `<span class="spinner"></span> ${msg}`;
  };

  try {
    // ── Step 1: Remember the original document name ──
    const nameResult = await runScript('app.echoToOE(app.activeDocument.name);');
    const origDocName = nameResult[0];

    let origLayerName = null;
    if (maskMode) {
      const layerResult = await runScript('app.echoToOE(app.activeDocument.activeLayer.name);');
      origLayerName = layerResult[0];
    }

    // ── Step 2: Build the working document to export ──
    // Non-mask modes work on a temporary copy with "Reveal All" applied so
    // off-canvas pixels are included; the offset is remembered to re-align.
    let revealOffsetX = 0, revealOffsetY = 0;
    let usingWorkingDoc = false;

    if (mode === "layer") {
      await runScript(`
        var doc = app.activeDocument;
        var layer = doc.activeLayer;
        var tmpDoc = app.documents.add(doc.width, doc.height, doc.resolution, "rembg_tmp");
        app.activeDocument = tmpDoc;
        tmpDoc.activeLayer.remove();
        app.activeDocument = doc;
        layer.duplicate(tmpDoc, ElementPlacement.INSIDE);
        app.activeDocument = tmpDoc;
      `);
      usingWorkingDoc = true;
    } else if (!maskMode) {
      await runScript('app.activeDocument.duplicate("rembg_tmp");');
      usingWorkingDoc = true;
    }

    if (usingWorkingDoc && !maskMode) {
      const off = await runScript(`
        var doc = app.activeDocument;
        function bv(b, i) { return (b[i] && b[i].value !== undefined) ? b[i].value : b[i]; }
        var before = doc.activeLayer.bounds;
        var bL = bv(before, 0), bT = bv(before, 1);
        try {
          executeAction(stringIDToTypeID("revealAll"), new ActionDescriptor(), DialogModes.NO);
        } catch (e) {}
        var after = doc.activeLayer.bounds;
        var aL = bv(after, 0), aT = bv(after, 1);
        app.echoToOE((aL - bL) + "," + (aT - bT));
      `);
      const parts = String(off.find(d => typeof d === "string") || "0,0").split(",");
      revealOffsetX = parseFloat(parts[0]) || 0;
      revealOffsetY = parseFloat(parts[1]) || 0;
    }

    // ── Step 3: Export as PNG ──
    const pngBuffer = await exportPNG();

    if (usingWorkingDoc) {
      await runScript('app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);');
    }

    // ── Step 4: Local inference ──
    onStatus("Loading model…");
    let bgcolor = null;
    if (!maskMode && bgcolorEnabled) {
      bgcolor = [
        parseInt(bgcolorHex.slice(1, 3), 16),
        parseInt(bgcolorHex.slice(3, 5), 16),
        parseInt(bgcolorHex.slice(5, 7), 16),
      ];
    }
    const { buffer: resultBuffer } = await removeBackgroundLocal(
      pngBuffer,
      { model, maskMode, postProcess, bgcolor },
      onProgress,
      onStatus
    );
    progressWrap.style.display = "none";
    await populateModels(); // refresh cached status
    saveConfig();
    $("model").value = model;

    status.innerHTML = '<span class="spinner"></span> Loading result into Photopea…';

    if (maskMode) {
      await applyAsMask(resultBuffer, origDocName, origLayerName);
      status.className = "success";
      status.textContent = `Layer mask applied (${currentEP()}).`;
    } else {
      await loadAsset(resultBuffer);
      await pause(200);
      await runScript(`
        var newDoc = app.activeDocument;
        var origDoc = null;
        for (var i = 0; i < app.documents.length; i++) {
          if (app.documents[i].name === "${origDocName.replace(/"/g, '\\"')}") {
            origDoc = app.documents[i];
            break;
          }
        }
        if (origDoc && newDoc !== origDoc) {
          newDoc.activeLayer.name = "rembg result";
          var dup = newDoc.activeLayer.duplicate(origDoc, ElementPlacement.PLACEATBEGINNING);
          newDoc.close(SaveOptions.DONOTSAVECHANGES);
          app.activeDocument = origDoc;
          if (dup) {
            origDoc.activeLayer = dup;
            if (${revealOffsetX} || ${revealOffsetY}) {
              dup.translate(${-revealOffsetX}, ${-revealOffsetY});
            }
            dup.name = "rembg result";
          }
        } else {
          app.activeDocument.activeLayer.name = "rembg result";
        }
      `);
      status.className = "success";
      status.textContent = `Background removed. New layer added (${currentEP()}).`;
    }
  } catch (err) {
    console.error(err);
    progressWrap.style.display = "none";
    status.className = "error";
    status.textContent = "Error: " + err.message;
  } finally {
    btn.disabled = false;
  }
}

/**
 * Apply a grayscale mask image as a layer mask on the active layer.
 */
async function applyAsMask(maskBuffer, origDocName, origLayerName) {
  // 1. Open the mask image in Photopea
  await loadAsset(maskBuffer);
  await pause(300);

  // 2. Select All and Copy
  await runScript(`
    app.activeDocument.selection.selectAll();
    app.activeDocument.activeLayer.copy();
  `);
  await pause(100);

  // 3. Close the mask document
  await runScript('app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);');
  await pause(100);

  // 4. Ensure we're on the correct document and layer
  await runScript(`
    var origDoc = null;
    for (var i = 0; i < app.documents.length; i++) {
      if (app.documents[i].name === "${origDocName.replace(/"/g, '\\"')}") {
        origDoc = app.documents[i];
        break;
      }
    }
    if (origDoc) {
      app.activeDocument = origDoc;
    }
    var doc = app.activeDocument;
    function findLayer(layers, name) {
      for (var j = 0; j < layers.length; j++) {
        if (layers[j].name === "${(origLayerName || '').replace(/"/g, '\\"')}") return layers[j];
        if (layers[j].layers) {
          var found = findLayer(layers[j].layers, name);
          if (found) return found;
        }
      }
      return null;
    }
    var targetLayer = findLayer(doc.layers, "${(origLayerName || '').replace(/"/g, '\\"')}");
    if (targetLayer) doc.activeLayer = targetLayer;
  `);
  await pause(100);

  // 5. Add a "Reveal All" layer mask
  await runScript(`
    var desc = new ActionDescriptor();
    desc.putClass(charIDToTypeID("Nw  "), charIDToTypeID("Chnl"));
    var ref = new ActionReference();
    ref.putEnumerated(charIDToTypeID("Chnl"), charIDToTypeID("Chnl"), charIDToTypeID("Msk "));
    desc.putReference(charIDToTypeID("At  "), ref);
    desc.putEnumerated(charIDToTypeID("Usng"), charIDToTypeID("UsrM"), charIDToTypeID("RvlA"));
    executeAction(charIDToTypeID("Mk  "), desc, DialogModes.NO);
  `);
  await pause(100);

  // 6. Target the mask channel
  await runScript(`
    var ref = new ActionReference();
    ref.putEnumerated(charIDToTypeID("Chnl"), charIDToTypeID("Chnl"), charIDToTypeID("Msk "));
    var desc = new ActionDescriptor();
    desc.putReference(charIDToTypeID("null"), ref);
    desc.putBoolean(charIDToTypeID("MkVs"), false);
    executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
  `);
  await pause(100);

  // 7. Paste the mask content
  await runScript('app.activeDocument.paste();');
  await pause(100);

  // 8. Deselect and switch back to RGB composite
  await runScript(`
    app.activeDocument.selection.deselect();
    var ref = new ActionReference();
    ref.putEnumerated(charIDToTypeID("Chnl"), charIDToTypeID("Chnl"), charIDToTypeID("RGB "));
    var desc = new ActionDescriptor();
    desc.putReference(charIDToTypeID("null"), ref);
    executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
  `);
  await pause(100);
}
