const { app, BrowserWindow, shell } = require("electron");
const { spawn, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");
const net = require("net");

const PORT = 7001;
const BASE_URL = `https://localhost:${PORT}`;

let backendProcess = null;
let mainWindow = null;

// ── Paths ────────────────────────────────────────────────────
function resourcePath(...parts) {
  // In packaged app: process.resourcesPath points to <app>/resources
  // In dev: use paths relative to the project root
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...parts);
  }
  return path.join(__dirname, "..", ...parts);
}

function getBackendBinary() {
  if (app.isPackaged) {
    const binName = process.platform === "win32" ? "rembg-server.exe" : "rembg-server";
    return path.join(process.resourcesPath, "backend", binName);
  }
  // Dev mode: use the venv Python directly
  return null;
}

function getCertPaths() {
  const certDir = app.isPackaged
    ? path.join(process.resourcesPath, "certs")
    : path.join(__dirname, "..", ".certs");

  return {
    cert: path.join(certDir, "cert.pem"),
    key: path.join(certDir, "key.pem"),
  };
}

function ensureCerts() {
  const { cert, key } = getCertPaths();
  const certDir = path.dirname(cert);

  if (fs.existsSync(cert) && fs.existsSync(key)) return;

  fs.mkdirSync(certDir, { recursive: true });
  console.log("Generating self-signed certificate…");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048",
    "-keyout", key, "-out", cert,
    "-days", "365", "-nodes",
    "-subj", "/CN=localhost",
  ]);
}

// ── Port check ───────────────────────────────────────────────
function isPortInUse(port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(500);
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("error", () => resolve(false));
    sock.once("timeout", () => { sock.destroy(); resolve(false); });
    sock.connect(port, "127.0.0.1");
  });
}

// ── Health check ─────────────────────────────────────────────
function waitForHealth(url, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error("Backend did not become healthy in time"));
      }
      const req = https.get(url, { rejectUnauthorized: false }, (res) => {
        if (res.statusCode === 200) return resolve();
        setTimeout(check, 500);
      });
      req.on("error", () => setTimeout(check, 500));
      req.end();
    }
    check();
  });
}

// ── Start backend ────────────────────────────────────────────
async function startBackend() {
  // If something is already on the port, assume it's our server
  if (await isPortInUse(PORT)) {
    console.log(`Port ${PORT} already in use — assuming backend is running`);
    return;
  }

  ensureCerts();
  const { cert, key } = getCertPaths();

  const binary = getBackendBinary();
  if (binary) {
    // Packaged mode: run PyInstaller binary
    console.log(`Starting backend: ${binary}`);
    backendProcess = spawn(binary, ["--port", String(PORT)], {
      env: {
        ...process.env,
        SSL_CERTFILE: cert,
        SSL_KEYFILE: key,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else {
    // Dev mode: use venv python
    const venvPython = path.join(__dirname, "..", ".venv", "bin", "python");
    const serverScript = path.join(__dirname, "..", "backend", "server.py");
    console.log(`Starting backend (dev): ${venvPython} ${serverScript}`);
    backendProcess = spawn(venvPython, [serverScript, "--port", String(PORT)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  backendProcess.stdout.on("data", (d) => process.stdout.write(`[backend] ${d}`));
  backendProcess.stderr.on("data", (d) => process.stderr.write(`[backend] ${d}`));
  backendProcess.on("exit", (code) => {
    console.log(`Backend exited with code ${code}`);
    backendProcess = null;
  });

  await waitForHealth(`${BASE_URL}/health`);
  console.log("Backend is healthy");
}

function stopBackend() {
  if (backendProcess) {
    console.log("Stopping backend…");
    backendProcess.kill("SIGTERM");
    // Force kill after 5 seconds
    setTimeout(() => {
      if (backendProcess) {
        backendProcess.kill("SIGKILL");
      }
    }, 5000);
  }
}

// ── Photopea URL ─────────────────────────────────────────────
function getPhotopeaUrl() {
  const config = {
    environment: {
      plugins: [{
        name: "rembg – Remove Background",
        url: BASE_URL,
        icon: `${BASE_URL}/icon.svg`,
      }],
    },
  };
  return `https://www.photopea.com#${encodeURIComponent(JSON.stringify(config))}`;
}

// ── Window ───────────────────────────────────────────────────
function createSplashWindow() {
  const win = new BrowserWindow({
    width: 400,
    height: 200,
    frame: false,
    resizable: false,
    transparent: false,
    backgroundColor: "#474747",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.loadFile(path.join(__dirname, "splash.html"));
  return win;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Rembg for Photopea",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Accept self-signed certs for localhost (the plugin iframe)
  mainWindow.webContents.session.setCertificateVerifyProc((request, callback) => {
    if (request.hostname === "localhost" || request.hostname === "127.0.0.1") {
      callback(0); // accept
    } else {
      callback(-3); // use default verification
    }
  });

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http") && !url.includes("photopea.com") && !url.includes("localhost")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.loadURL(getPhotopeaUrl());

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── App lifecycle ────────────────────────────────────────────
app.on("certificate-error", (event, webContents, url, error, cert, callback) => {
  // Trust self-signed certs for localhost
  if (new URL(url).hostname === "localhost") {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

app.whenReady().then(async () => {
  const splash = createSplashWindow();

  try {
    await startBackend();
  } catch (err) {
    console.error("Failed to start backend:", err);
    // Continue anyway — user may have started it manually
  }

  splash.close();
  createMainWindow();
});

app.on("window-all-closed", () => {
  stopBackend();
  app.quit();
});

app.on("before-quit", () => {
  stopBackend();
});
