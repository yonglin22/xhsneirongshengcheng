// 纯命令版执行端（无需 Electron）：直接用 adb 驱动本机连接的安卓真机跑「养号/截流」任务。
// 投屏请另开 scrcpy 窗口观看。
//   用法：node run-agent.js <设备token zd_...>
//   或：  TOKEN=zd_xxx SERVER=https://yonglin.chat node run-agent.js
const { execFile } = require('child_process');
const Agent = require('./agent');

const SERVER = process.env.SERVER || 'https://yonglin.chat';
const token = process.argv[2] || process.env.TOKEN;
if (!token) { console.error('用法: node run-agent.js <设备token zd_...>（token 在网页「设备看板→接入真机/脚本」生成）'); process.exit(1); }

function adb(args) {
  return new Promise((res, rej) => execFile('adb', args, { maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' }, (e, so) => e ? rej(e) : res(so)));
}

(async () => {
  let out;
  try { out = (await adb(['devices', '-l'])).toString(); }
  catch (e) { console.error('adb 调用失败，确认已装 platform-tools 且 adb 在 PATH：', e.message); process.exit(1); }
  const dev = out.split('\n').slice(1).map(l => l.trim()).filter(l => l && /\bdevice\b/.test(l))[0];
  if (!dev) { console.error('没检测到在线真机。先 `adb devices` 确认有 “xxxx  device”。'); process.exit(1); }
  const serial = dev.split(/\s+/)[0];
  const model = (dev.match(/model:(\S+)/) || [])[1] || serial;
  console.log('设备:', serial, model, '→ 接入', SERVER);

  const a = new Agent({ serial, model, token, serverBase: SERVER, adb });
  // 把执行端内部动作打到控制台
  const origLog = a.log.bind(a);
  a.log = (s) => { origLog(s); console.log(new Date().toLocaleTimeString(), s); };
  a.start();
  console.log('✓ 已上线，等待任务…  去网页「养号/截流计划」点 📤 下发，然后看这里 + scrcpy 投屏。Ctrl+C 退出。');
})();
