// 朱砂投屏工作室 · Electron 主进程
// 职责：① 枚举 USB/ADB 连接的安卓真机 ② 每台真机起 scrcpy 投屏窗口（或截图轮询预览）
//       ③ 跑「执行端协议」客户端：用设备 token 拉养号/截流任务 → 驱动真机拟人执行 → 回报
// 依赖系统已装：adb（platform-tools）、scrcpy（投屏，可选）。除 Electron 外不引 npm 包。
const { app, BrowserWindow, ipcMain } = require('electron');
const { execFile, spawn } = require('child_process');
const path = require('path');
const Agent = require('./agent');

const CFG = require('./config');           // { serverBase, deviceTokens: { [serial]: token } }
let win;
const screencap = {};                       // serial -> 最近一帧 dataURL
const agents = {};                          // serial -> Agent 实例

function adb(args, opts) {
  return new Promise((resolve, reject) => {
    execFile('adb', args, { maxBuffer: 16 * 1024 * 1024, encoding: 'buffer', ...opts },
      (err, stdout, stderr) => err ? reject(err) : resolve(stdout));
  });
}

// 列出在线真机
async function listDevices() {
  try {
    const out = (await adb(['devices', '-l'], { encoding: 'utf8' })).toString();
    return out.split('\n').slice(1)
      .map(l => l.trim()).filter(l => l && /\bdevice\b/.test(l))
      .map(l => {
        const serial = l.split(/\s+/)[0];
        const model = (l.match(/model:(\S+)/) || [])[1] || serial;
        return { serial, model };
      });
  } catch (e) { return []; }
}

// 截图预览（无 scrcpy 时的兜底投屏：adb exec-out screencap -p，每 ~1.5s 一帧）
async function grabScreen(serial) {
  try {
    const png = await adb(['-s', serial, 'exec-out', 'screencap', '-p']);
    screencap[serial] = 'data:image/png;base64,' + Buffer.from(png).toString('base64');
  } catch (e) { /* 设备忙/断开 */ }
}

// 起 scrcpy 实时投屏窗口（若系统装了 scrcpy）。失败则回退截图轮询。
function startScrcpy(serial) {
  try {
    const p = spawn('scrcpy', ['-s', serial, '--window-title', '朱砂·' + serial, '--max-size', '800'], { detached: false });
    p.on('error', () => {});   // 没装 scrcpy → 静默回退
    return p;
  } catch { return null; }
}

async function refreshLoop() {
  const devs = await listDevices();
  // 启动/停止 agent
  for (const d of devs) {
    if (!agents[d.serial]) {
      const token = (CFG.deviceTokens || {})[d.serial];
      agents[d.serial] = new Agent({ serial: d.serial, model: d.model, token, serverBase: CFG.serverBase, adb });
      if (token) agents[d.serial].start();
    }
    grabScreen(d.serial);
  }
  const online = new Set(devs.map(d => d.serial));
  for (const s of Object.keys(agents)) if (!online.has(s)) { agents[s].stop(); delete agents[s]; }

  if (win && !win.isDestroyed()) {
    win.webContents.send('devices', devs.map(d => ({
      ...d,
      screen: screencap[d.serial] || null,
      hasToken: !!(CFG.deviceTokens || {})[d.serial],
      ...(agents[d.serial] ? agents[d.serial].state() : {}),
    })));
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  setInterval(refreshLoop, 1500);
  refreshLoop();
});
app.on('window-all-closed', () => { Object.values(agents).forEach(a => a.stop()); app.quit(); });

// 渲染端把某设备的 token 存下并启动 agent
ipcMain.handle('setToken', (e, { serial, token }) => {
  CFG.deviceTokens = CFG.deviceTokens || {};
  CFG.deviceTokens[serial] = token;
  require('./config').save();
  if (agents[serial]) { agents[serial].token = token; agents[serial].start(); }
  return true;
});
ipcMain.handle('openScrcpy', (e, { serial }) => { startScrcpy(serial); return true; });
ipcMain.handle('getConfig', () => ({ serverBase: CFG.serverBase }));
ipcMain.handle('setServer', (e, { serverBase }) => { CFG.serverBase = serverBase; require('./config').save(); return true; });
