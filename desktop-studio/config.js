// 简单本地配置：serverBase + 每台设备的执行端 token。存到用户目录 zhusha-studio.json
const fs = require('fs');
const path = require('path');
const os = require('os');
const FILE = path.join(os.homedir(), '.zhusha-studio.json');

let data = { serverBase: 'https://yonglin.chat', deviceTokens: {} };
try { Object.assign(data, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch {}

module.exports = data;
module.exports.save = function () {
  try { fs.writeFileSync(FILE, JSON.stringify({ serverBase: data.serverBase, deviceTokens: data.deviceTokens }, null, 2)); } catch {}
};
