const { app, BrowserWindow, ipcMain, screen, globalShortcut, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

let petWindow = null;
let fxWindow = null;
let fxTimer = null;
let fxTopTimer = null;
let dragTimer = null;
let dragStartCursor = null;
let dragStartWindow = null;
let mousePassing = false;
let currentScale = 1;

const PET_WIDTH = 260;
const PET_HEIGHT = 320;
const WINDOW_STATE_FILE = path.join(app.getPath('userData'), 'panda-window.json');
const UPDATE_MANIFEST_FILE = path.join(__dirname, 'update.json');

// The renderer keeps values/settings in localStorage. Window geometry lives
// here instead, because the main process owns the BrowserWindow and needs it
// before the renderer has even loaded.
function loadWindowState() {
  try {
    const data = JSON.parse(fs.readFileSync(WINDOW_STATE_FILE, 'utf8'));
    if (!data || typeof data !== 'object') return null;
    const x = Number(data.x);
    const y = Number(data.y);
    const scale = Number(data.scale);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      x, y,
      scale: Number.isFinite(scale) ? Math.max(.7, Math.min(1.4, scale)) : 1
    };
  } catch (err) {
    return null;
  }
}

function saveWindowState() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const [x, y] = petWindow.getPosition();
  try {
    fs.mkdirSync(path.dirname(WINDOW_STATE_FILE), { recursive: true });
    fs.writeFileSync(WINDOW_STATE_FILE, JSON.stringify({ x, y, scale: currentScale }), 'utf8');
  } catch (err) {
    // Storage may be read-only; losing the geometry is harmless.
  }
}

// Keep at least a sliver of the window on screen so the pet is never lost,
// but allow most of it to hang off any edge. This is what lets you park the
// panda along the very bottom/top/side of the desktop.
function clampPointToBounds(x, y, w, h, refPoint) {
  const ref = refPoint || { x, y };
  const display = screen.getAllDisplays().find((d) => {
    const b = d.bounds;
    return ref.x >= b.x && ref.x <= b.x + b.width && ref.y >= b.y && ref.y <= b.y + b.height;
  }) || screen.getDisplayNearestPoint(ref);
  const b = display.bounds;
  const keepX = Math.min(72, Math.round(w * 0.28));
  const keepY = Math.min(72, Math.round(h * 0.28));
  let minX = b.x - (w - keepX);
  let maxX = b.x + b.width - keepX;
  let minY = b.y - (h - keepY);
  let maxY = b.y + b.height - keepY;
  if (maxX < minX) minX = maxX = b.x;
  if (maxY < minY) minY = maxY = b.y;
  return {
    x: Math.round(Math.max(minX, Math.min(x, maxX))),
    y: Math.round(Math.max(minY, Math.min(y, maxY)))
  };
}

// ---------- Lightweight version / update system ----------
// The project has no release pipeline, so this is deliberately conservative:
// a local manifest always works, and an optional HTTPS feed can be configured
// later. It never installs code by itself; it only reports and opens a link.
function isHttpsUrl(value) {
  try { return new URL(String(value || '')).protocol === 'https:'; } catch (err) { return false; }
}

function isWebUrl(value) {
  try {
    const protocol = new URL(String(value || '')).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch (err) { return false; }
}

function parseVersion(value) {
  const parts = String(value || '').replace(/^v/i, '').split(/[.\-]/);
  const nums = parts.map((part) => parseInt(part, 10) || 0);
  return nums.length ? nums : [0];
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function readUpdateManifest() {
  const fallback = {
    version: app.getVersion(),
    released: '',
    feedUrl: '',
    downloadUrl: '',
    notes: []
  };
  try {
    const data = JSON.parse(fs.readFileSync(UPDATE_MANIFEST_FILE, 'utf8'));
    if (!data || typeof data !== 'object') return fallback;
    return {
      version: typeof data.version === 'string' && data.version.trim() ? data.version.trim() : fallback.version,
      released: typeof data.released === 'string' ? data.released : '',
      feedUrl: isHttpsUrl(data.feedUrl) ? data.feedUrl : '',
      downloadUrl: isWebUrl(data.downloadUrl) ? data.downloadUrl : '',
      notes: Array.isArray(data.notes)
        ? data.notes.filter((note) => typeof note === 'string').slice(0, 40)
        : []
    };
  } catch (err) {
    return fallback;
  }
}

function fetchHttpsJson(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (!isHttpsUrl(url)) {
      reject(new Error('更新源必须使用 HTTPS'));
      return;
    }
    const req = https.get(url, {
      headers: { 'User-Agent': `panda-incense-pet/${app.getVersion()}` }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= 3) {
          reject(new Error('更新源跳转次数过多'));
          return;
        }
        const next = new URL(res.headers.location, url).href;
        fetchHttpsJson(next, redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 200000) req.destroy(new Error('更新清单过大'));
      });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (err) { reject(new Error('更新清单不是合法 JSON')); }
      });
    });
    req.setTimeout(10000, () => req.destroy(new Error('检查更新超时')));
    req.on('error', reject);
  });
}

// Full-screen pranks should really cover the whole desktop, not only the
// primary monitor. Union every display's bounds into one rectangle.
function fullDesktopBounds() {
  const displays = screen.getAllDisplays();
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  displays.forEach((d) => {
    const b = d.bounds;
    left = Math.min(left, b.x);
    top = Math.min(top, b.y);
    right = Math.max(right, b.x + b.width);
    bottom = Math.max(bottom, b.y + b.height);
  });
  if (!Number.isFinite(left)) return screen.getPrimaryDisplay().bounds;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function createPetWindow() {
  const saved = loadWindowState();
  const scale = saved ? saved.scale : 1;
  currentScale = scale;
  const width = Math.round(PET_WIDTH * scale);
  const height = Math.round(PET_HEIGHT * scale);
  const area = screen.getPrimaryDisplay().bounds;
  const fallback = {
    x: Math.round(area.x + area.width / 2 - width / 2),
    y: Math.round(area.y + area.height / 2 - height / 2)
  };
  // Validate the saved spot against the current monitor layout — a monitor
  // may have been unplugged or the resolution changed since last launch.
  const restored = saved
    ? clampPointToBounds(saved.x, saved.y, width, height, { x: saved.x + width / 2, y: saved.y + height / 2 })
    : fallback;
  petWindow = new BrowserWindow({
    width,
    height,
    x: restored.x,
    y: restored.y,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    title: '熊猫烧香桌宠',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Startup must reflect the real OS setting, not just a saved checkbox —
  // the user may have toggled it from Task Manager / Settings externally.
  petWindow.webContents.on('did-finish-load', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('startup-state', app.getLoginItemSettings().openAtLogin);
    }
  });

  // In self-test mode attach diagnostics before loadFile so early renderer
  // errors are not missed, and send the run signal only after the page loaded.
  if (process.env.PANDA_SELFTEST === '1') {
    petWindow.webContents.on('console-message', (event, level, message) => {
      console.log('RENDERER:', message);
    });
    petWindow.webContents.on('render-process-gone', (event, details) => {
      console.log('RENDERER GONE:', details.reason, details.exitCode);
    });
    petWindow.webContents.on('did-finish-load', () => {
      console.log('SELFTEST: renderer did-finish-load');
    });
    // Handshake instead of a fixed delay: a slow/cold start used to make the
    // main process send `selftest-run` before the renderer had registered
    // its listener, so the whole renderer self-test silently never ran.
    ipcMain.once('selftest-renderer-ready', () => {
      console.log('SELFTEST: renderer ready');
      setTimeout(() => {
        if (petWindow && !petWindow.isDestroyed()) {
          console.log('SELFTEST: sending renderer run');
          petWindow.webContents.send('selftest-run');
        }
      }, 300);
    });
  }

  petWindow.loadFile(path.join(__dirname, 'index.html'));
  petWindow.setAlwaysOnTop(true, 'screen-saver');
}

// All full-screen pranks share one slot: a new one replaces the current,
// and its timer is cancelled so an old prank can never close a newer one.
function closeFxWindow() {
  if (fxTimer) {
    clearTimeout(fxTimer);
    fxTimer = null;
  }
  if (fxTopTimer) {
    clearInterval(fxTopTimer);
    fxTopTimer = null;
  }
  if (fxWindow) {
    if (!fxWindow.isDestroyed()) fxWindow.close();
    fxWindow = null;
  }
}

function openFxWindow(browserWindow, html, file, duration) {
  closeFxWindow();
  fxWindow = browserWindow;
  // Windows clamps a freshly created always-on-top window to the work area,
  // which leaves the taskbar uncovered. Re-apply the full desktop bounds
  // synchronously and add a 2-DIP bleed so DPI rounding / rounded window
  // corners cannot expose a hairline of desktop at the edges.
  const b = fullDesktopBounds();
  fxWindow.setBounds({ x: b.x - 2, y: b.y - 2, width: b.width + 4, height: b.height + 4 });
  fxWindow.setAlwaysOnTop(true, 'screen-saver');
  fxWindow.setIgnoreMouseEvents(true);
  if (html) fxWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  else fxWindow.loadFile(path.join(__dirname, file));
  // Other apps can raise their own topmost windows above ours while the
  // prank is running. Re-assert the level periodically to keep the overlay
  // in front for its whole lifetime.
  fxTopTimer = setInterval(() => {
    if (fxWindow && !fxWindow.isDestroyed()) fxWindow.setAlwaysOnTop(true, 'screen-saver');
  }, 400);
  fxTimer = setTimeout(closeFxWindow, duration);
}

function showBlueScreen(duration = 7000) {
  const bounds = fullDesktopBounds();
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#0078d4;color:#fff;font-family:"Segoe UI","Microsoft YaHei",sans-serif;overflow:hidden}
    .wrap{position:absolute;left:14vw;top:26vh;max-width:62vw}
    .face{font-size:78px;line-height:1;margin-bottom:22px;font-weight:300}
    h1{font-size:26px;font-weight:300;letter-spacing:.5px;margin:0 0 20px}
    p{font-size:14px;line-height:1.9;opacity:.9;margin:0 0 4px}
    .code{margin-top:28px;font-size:14px;opacity:.95}
    .prog{margin-top:16px;width:300px;height:3px;background:rgba(255,255,255,.28)}
    .prog i{display:block;height:100%;width:0;background:#fff;animation:fill 6.4s linear forwards}
    @keyframes fill{to{width:100%}}
    .qr{position:absolute;right:12vw;top:30vh;width:104px;height:104px;border:6px solid #fff;opacity:.55;
        background:repeating-linear-gradient(90deg,#fff 0 5px,transparent 5px 10px);box-shadow:inset 0 0 0 10px #0078d4}
  </style></head><body>
    <div class="qr"></div>
    <div class="wrap">
      <div class="face">:(</div>
      <h1>你的电脑遇到问题，需要重新启动。</h1>
      <p>我们只收集某些错误信息，然后为你重新启动。</p>
      <p>如果你想了解更多信息，请访问 windows.com/stopcode</p>
      <p class="code">停止代码：PANDA_INCENSE<br>涉及模块：panda-classic.sys</p>
      <div class="prog"><i></i></div>
    </div>
  </body></html>`;
  openFxWindow(win, html, null, duration);
}

function showOverlay(file, duration, transparent) {
  const bounds = fullDesktopBounds();
  const overlay = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: !!transparent,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  openFxWindow(overlay, null, file, duration);
}

app.whenReady().then(() => {
  createPetWindow();

  globalShortcut.register('CommandOrControl+Alt+P', () => {
    if (!petWindow) return;
    mousePassing = !mousePassing;
    petWindow.setIgnoreMouseEvents(mousePassing, { forward: true });
    petWindow.webContents.send('pass-through-changed', mousePassing);
  });

  globalShortcut.register('CommandOrControl+Alt+1', () => showOverlay('swarm.html', 8500, true));
  globalShortcut.register('CommandOrControl+Alt+2', () => showOverlay('shutdown.html', 9500, false));
  globalShortcut.register('CommandOrControl+Alt+3', () => showBlueScreen());
  globalShortcut.register('CommandOrControl+Alt+0', () => {
    if (fxWindow) closeFxWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow();
  });

  // Dev-only: hold a single prank open so it can be visually inspected.
  if (process.env.PANDA_PRANK_PROBE) {
    const mode = process.env.PANDA_PRANK_PROBE;
    setTimeout(() => {
      if (mode === 'swarm') showOverlay('swarm.html', 15000, true);
      else if (mode === 'blue') showBlueScreen(120000);
      else if (mode === 'shutdown') showOverlay('shutdown.html', 15000, false);
    }, 400);
  }

  // Dev-only self test: actually open every full-screen prank and drive the
  // renderer's new interaction paths so runtime errors surface instead of
  // only checking startup.
  if (process.env.PANDA_SELFTEST === '1') {
    const mainErrors = [];
    const checkMain = (name, ok) => { if (!ok) mainErrors.push(name); };
    // Exercise the exact IPC path the renderer uses. A regression here used
    // to hand the IPC event to showBlueScreen as `duration`, so setTimeout
    // coerced it to 0 and the overlay closed almost instantly.
    setTimeout(() => ipcMain.emit('show-bluescreen', {}), 200);
    setTimeout(() => {
      checkMain('ipcBlueScreenStaysOpen', !!fxWindow && !fxWindow.isDestroyed());
      closeFxWindow();
    }, 900);

    const steps = [
      () => showOverlay('swarm.html', 400, true),
      () => showBlueScreen(),
      () => showOverlay('shutdown.html', 400, false)
    ];
    steps.forEach((fn, i) => setTimeout(fn, 1200 + i * 700));
    ipcMain.once('selftest-done', (event, errors) => {
      console.log('SELFTEST: received renderer result');
      console.log('RENDERER SELFTEST:', errors.length ? errors.join(' | ') : 'OK');
      checkMain('rendererReported', Array.isArray(errors));
    });
    setTimeout(() => {
      console.log('MAIN SELFTEST:', mainErrors.length ? mainErrors.join(' | ') : 'OK');
      console.log('SELFTEST: timeout reached, quitting');
      app.quit();
    }, 9000);
  }
});

app.on('will-quit', () => {
  stopDragPolling();
  closeFxWindow();
  saveWindowState();
  globalShortcut.unregisterAll();
});
app.on('window-all-closed', () => app.quit());

function stopDragPolling() {
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
}

ipcMain.on('pet-drag-start', (event, pos) => {
  if (!petWindow) return;
  const [x, y] = petWindow.getPosition();
  // Take one snapshot when the button goes down. All movement is then a
  // simple delta from this snapshot, so a stationary long-press never
  // nudges the window and there is no accumulated drift.
  const cursor = screen.getCursorScreenPoint();
  dragStartCursor = { x: cursor.x, y: cursor.y };
  dragStartWindow = { x, y };
  stopDragPolling();
  dragTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed() || !dragStartCursor) {
      stopDragPolling();
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const dx = cursor.x - dragStartCursor.x;
    const dy = cursor.y - dragStartCursor.y;
    if (dx === 0 && dy === 0) return;
    const [w, h] = petWindow.getSize();
    const targetX = dragStartWindow.x + dx;
    const targetY = dragStartWindow.y + dy;
    const target = clampPointToBounds(
      targetX, targetY, w, h,
      { x: targetX + w / 2, y: targetY + h / 2 }
    );
    // If an axis is clamped by the screen edge, re-anchor that axis to the
    // current cursor. Otherwise the overshoot stays in the delta and the
    // panda feels stuck when you reverse direction at an edge.
    if (target.x !== targetX) {
      dragStartWindow.x = target.x;
      dragStartCursor.x = cursor.x;
    }
    if (target.y !== targetY) {
      dragStartWindow.y = target.y;
      dragStartCursor.y = cursor.y;
    }
    petWindow.setPosition(target.x, target.y);
  }, 16);
});

ipcMain.on('pet-drag-end', () => {
  dragStartCursor = null;
  dragStartWindow = null;
  stopDragPolling();
  saveWindowState();
});

ipcMain.on('set-scale', (event, scale) => {
  if (!petWindow || petWindow.isDestroyed()) return;
  const value = Math.max(.7, Math.min(1.4, Number(scale) || 1));
  currentScale = value;
  const w = Math.max(1, Math.round(PET_WIDTH * value));
  const h = Math.max(1, Math.round(PET_HEIGHT * value));
  const [x, y] = petWindow.getPosition();
  // Use the final size directly and apply position + size in one call.
  // Reading getSize() right after setSize() could return the old size and
  // make the window jump/jitter while dragging the slider.
  const p = clampPointToBounds(x, y, w, h, { x: x + w / 2, y: y + h / 2 });
  petWindow.setBounds({ x: p.x, y: p.y, width: w, height: h });
  saveWindowState();
});

ipcMain.on('set-opacity', (event, value) => {
  if (petWindow) petWindow.setOpacity(value);
});

ipcMain.on('set-always-on-top', (event, enabled) => {
  if (petWindow) petWindow.setAlwaysOnTop(enabled, 'screen-saver');
});

ipcMain.on('set-pass-through', (event, enabled) => {
  if (!petWindow) return;
  mousePassing = enabled;
  petWindow.setIgnoreMouseEvents(enabled, { forward: true });
});

ipcMain.on('set-startup', (event, enabled) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled });
});

ipcMain.on('get-app-info', (event) => {
  const manifest = readUpdateManifest();
  event.reply('app-info', {
    currentVersion: app.getVersion(),
    manifestVersion: manifest.version,
    released: manifest.released,
    notes: manifest.notes,
    hasFeed: !!manifest.feedUrl,
    hasDownload: !!manifest.downloadUrl
  });
});

ipcMain.on('check-update', async (event) => {
  const manifest = readUpdateManifest();
  const currentVersion = app.getVersion();
  const base = {
    currentVersion,
    released: manifest.released,
    notes: manifest.notes,
    downloadUrl: manifest.downloadUrl
  };
  if (!manifest.feedUrl) {
    event.reply('update-checked', {
      ...base,
      source: 'local',
      latestVersion: currentVersion,
      upToDate: true,
      message: '未配置在线更新源，当前展示本地版本清单。'
    });
    return;
  }
  try {
    const remote = await fetchHttpsJson(manifest.feedUrl);
    if (!remote || typeof remote !== 'object') throw new Error('更新清单格式错误');
    const latestVersion = typeof remote.version === 'string' && remote.version.trim()
      ? remote.version.trim()
      : currentVersion;
    const notes = Array.isArray(remote.notes)
      ? remote.notes.filter((note) => typeof note === 'string').slice(0, 40)
      : manifest.notes;
    const downloadUrl = isWebUrl(remote.downloadUrl) ? remote.downloadUrl : manifest.downloadUrl;
    const comparison = compareVersions(latestVersion, currentVersion);
    event.reply('update-checked', {
      ...base,
      source: 'remote',
      latestVersion,
      upToDate: comparison <= 0,
      notes,
      downloadUrl,
      released: typeof remote.released === 'string' ? remote.released : manifest.released,
      message: comparison > 0 ? '发现新版本，可前往下载。' : '已是最新版本。'
    });
  } catch (err) {
    event.reply('update-checked', {
      ...base,
      source: 'error',
      latestVersion: currentVersion,
      upToDate: true,
      message: `检查失败：${err && err.message || err}`
    });
  }
});

ipcMain.on('open-update-url', (event, url) => {
  if (!isWebUrl(url)) {
    event.reply('update-link-error', '下载地址无效');
    return;
  }
  shell.openExternal(url).catch((err) => {
    event.reply('update-link-error', `打开失败：${err && err.message || err}`);
  });
});

// ipcMain handlers receive the IPC event as their first argument. Passing
// showBlueScreen directly used to make `duration` an event object, which
// setTimeout coerced to 0 and closed the blue screen instantly.
ipcMain.on('show-bluescreen', () => showBlueScreen());
ipcMain.on('show-swarm', () => showOverlay('swarm.html', 8500, true));
ipcMain.on('show-shutdown', () => showOverlay('shutdown.html', 9500, false));

ipcMain.on('save-screenshot', async (event, dataUrl) => {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) return;
  try {
    const base = dataUrl.slice('data:image/png;base64,'.length);
    const buffer = Buffer.from(base, 'base64');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const result = await dialog.showSaveDialog(petWindow, {
      title: '保存熊猫明信片',
      defaultPath: path.join(app.getPath('pictures'), `熊猫烧香-${stamp}.png`),
      filters: [{ name: 'PNG 图片', extensions: ['png'] }]
    });
    if (result.canceled || !result.filePath) {
      event.reply('screenshot-saved', { ok: false, canceled: true });
      return;
    }
    fs.writeFileSync(result.filePath, buffer);
    event.reply('screenshot-saved', { ok: true, filePath: result.filePath });
  } catch (err) {
    event.reply('screenshot-saved', { ok: false, error: String(err && err.message || err) });
  }
});

ipcMain.on('quit-app', () => app.quit());
