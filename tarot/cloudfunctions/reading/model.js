// 模型调用：内置 https，无第三方依赖。支持 OpenAI 兼容（DeepSeek/智谱/Kimi）与 Anthropic。
// 通过云函数环境变量切换：AI_PROVIDER / AI_BASE_URL / AI_MODEL / AI_KEY
const https = require('https');

function postJSON(urlStr, headers, bodyObj, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const data = JSON.stringify(bodyObj);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      port: u.port || 443,
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }, headers)
    }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => resolve({ status: res.statusCode, text: buf }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 20000, () => { req.destroy(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

async function callModel({ system, user, json, maxTokens, temperature }) {
  const provider = process.env.AI_PROVIDER || 'openai';
  const key = process.env.AI_KEY || '';
  if (!key) throw new Error('未配置 AI_KEY 环境变量');
  const temp = (temperature == null ? 0.8 : temperature);
  const mt = maxTokens || 1500;

  if (provider === 'anthropic') {
    const base = process.env.AI_BASE_URL || 'https://api.anthropic.com';
    const model = process.env.AI_MODEL || 'claude-sonnet-4-6';
    const r = await postJSON(base + '/v1/messages',
      { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      { model, max_tokens: mt, temperature: temp, system, messages: [{ role: 'user', content: user }] });
    if (r.status < 200 || r.status >= 300) throw new Error('AI ' + r.status + ' ' + r.text.slice(0, 200));
    const j = JSON.parse(r.text);
    return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  }

  // OpenAI 兼容
  const base = process.env.AI_BASE_URL || 'https://api.deepseek.com';
  const model = process.env.AI_MODEL || 'deepseek-chat';
  const body = {
    model, max_tokens: mt, temperature: temp,
    messages: [].concat(system ? [{ role: 'system', content: system }] : [], [{ role: 'user', content: user }])
  };
  if (json) body.response_format = { type: 'json_object' };
  const r = await postJSON(base + '/chat/completions', { 'Authorization': 'Bearer ' + key }, body);
  if (r.status < 200 || r.status >= 300) throw new Error('AI ' + r.status + ' ' + r.text.slice(0, 200));
  const j = JSON.parse(r.text);
  return ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim();
}

// 宽松 JSON 解析：去掉 ```json 围栏、截取首尾花括号
function parseJSONLoose(raw) {
  let s = String(raw).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

module.exports = { callModel, parseJSONLoose };
