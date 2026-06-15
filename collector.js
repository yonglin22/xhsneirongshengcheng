#!/usr/bin/env node
// ============================================================================
// 小红书采集服务（collector）—— 跑在一台常开的机器上（你的电脑 / 一台便宜 VPS）。
// 它封装已登录的 xhs CLI（扫码登录，不碰 cookie），对外开 /collect 接口；
// 线上主站(Render)用 COLLECTOR_URL 调它，即可按维度抓真实笔记。
//
// 用法：
//   1) 装 CLI：pipx install xiaohongshu-cli   （或确认 `xhs` 在 PATH 里）
//   2) 登录：  xhs login --qrcode             （用手机小红书 App 扫码；过期再扫一次）
//   3) 起服务：COLLECTOR_TOKEN=你设的密钥 node collector.js
//      （默认端口 8799，可用 COLLECTOR_PORT 改）
//   4) 公网可达：
//        - 临时验证：cloudflared tunnel --url http://localhost:8799
//        - VPS 长期：用 nginx/caddy 反代或直接开放端口（建议加 HTTPS）
//   5) Render 环境变量：COLLECTOR_URL=https://你的地址  COLLECTOR_TOKEN=同一密钥
// ============================================================================
const http = require('http');
const { execFile } = require('child_process');

const PORT = parseInt(process.env.COLLECTOR_PORT || '8799', 10);
const TOKEN = process.env.COLLECTOR_TOKEN || '';
const XHS_BIN = process.env.XHS_BIN || 'xhs';
const ENV = { ...process.env, PATH: (process.env.PATH || '') + ':' + (process.env.HOME || '') + '/.local/bin:/usr/local/bin' };

function json(res, code, obj) { const b = JSON.stringify(obj); res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(b); }
function readBody(req) { return new Promise(r => { let s = ''; req.on('data', d => s += d); req.on('end', () => r(s)); }); }

// 把 xhs search 的 JSON 映射成主站要的笔记结构（与 server.js 保持一致）
function mapNotes(j) {
  const items = (j.data && j.data.items) || j.items || [];
  return items.filter(it => it && it.note_card).slice(0, 20).map(it => {
    const nc = it.note_card, u = nc.user || {}, ii = nc.interact_info || {};
    const pt = (nc.corner_tag_info || []).find(c => c.type === 'publish_time');
    return {
      id: it.id || '', token: it.xsec_token || '',
      title: nc.display_title || nc.title || '',
      cover: (nc.cover && (nc.cover.url_default || nc.cover.urlDefault || nc.cover.url)) || '',
      type: nc.type || '',
      author: u.nickname || u.nick_name || '', userId: u.user_id || '', avatar: u.avatar || '',
      likes: ii.liked_count || '', collects: ii.collected_count || '', comments: ii.comment_count || '',
      date: pt ? pt.text : '',
      link: 'https://www.xiaohongshu.com/explore/' + (it.id || '') + (it.xsec_token ? ('?xsec_token=' + it.xsec_token + '&xsec_source=pc_search') : ''),
      authorLink: u.user_id ? ('https://www.xiaohongshu.com/user/profile/' + u.user_id) : '',
    };
  });
}

function runSearch({ keyword, sort, type, page }) {
  const sortOpt = ['general', 'popular', 'latest'].includes(sort) ? sort : 'popular';
  const typeOpt = ['all', 'video', 'image'].includes(type) ? type : 'all';
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  return new Promise((resolve, reject) => {
    execFile(XHS_BIN, ['search', String(keyword), '--sort', sortOpt, '--type', typeOpt, '--page', String(pageNum), '--json'],
      { timeout: 50000, maxBuffer: 12 * 1024 * 1024, env: ENV }, (err, so, se) => {
        if (err && !so) return reject(new Error((se || err.message || '').toString().slice(0, 300)));
        resolve(so);
      });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,x-collector-token', 'access-control-allow-methods': 'POST,GET' }); return res.end(); }
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/health' || url.pathname === '/') {
    // 顺带报告登录状态，方便排查
    return execFile(XHS_BIN, ['status', '--json'], { timeout: 15000, env: ENV }, (err, so) => {
      let loggedIn = false, who = ''; try { const s = JSON.parse(so || '{}'); loggedIn = !!(s.logged_in || s.data || s.user || (s.nickname)); who = (s.data && s.data.nickname) || s.nickname || ''; } catch {}
      json(res, 200, { ok: true, service: 'xhs-collector', loggedIn, who, hint: loggedIn ? '' : '未登录：在本机跑 `xhs login --qrcode` 扫码' });
    });
  }

  if (url.pathname === '/collect' && req.method === 'POST') {
    if (TOKEN && req.headers['x-collector-token'] !== TOKEN) return json(res, 401, { ok: false, error: 'bad token' });
    let body = {}; try { body = JSON.parse((await readBody(req)) || '{}'); } catch {}
    if (!body.keyword) return json(res, 400, { ok: false, error: '缺少 keyword' });
    try {
      const stdout = await runSearch(body);
      let j; try { j = JSON.parse(stdout); } catch { return json(res, 200, { ok: false, error: 'xhs 返回非 JSON（可能未登录，跑 xhs login --qrcode）' }); }
      const notes = mapNotes(j);
      return json(res, 200, { ok: notes.length > 0, notes });
    } catch (e) {
      const m = (e.message || String(e));
      return json(res, 200, { ok: false, error: /ENOENT/.test(m) ? '本机未找到 xhs 命令（pipx install xiaohongshu-cli）' : ('采集失败：' + m) });
    }
  }

  json(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, () => {
  console.log('🛰  xhs 采集服务已启动: http://localhost:' + PORT);
  console.log('   鉴权 token:', TOKEN ? '已设置 ✓' : '未设置（建议设 COLLECTOR_TOKEN）');
  console.log('   健康检查: curl http://localhost:' + PORT + '/health');
  console.log('   若 loggedIn=false → 跑: xhs login --qrcode');
});
