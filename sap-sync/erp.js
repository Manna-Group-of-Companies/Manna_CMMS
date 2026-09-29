// Tiny read helper for ERPNext using server/.env creds. Never prints creds.
const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('C:/Users/eldhose/Manna_CMMS/server/.env','utf8').split(/\r?\n/)
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0,l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]));
const h = { Authorization: 'token ' + env.ERPNEXT_API_KEY + ':' + env.ERPNEXT_API_SECRET };
const enc = o => new URLSearchParams(Object.fromEntries(Object.entries(o).map(([k,v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])));
exports.list = async (dt, params) => {
  const r = await fetch(env.ERPNEXT_URL + '/api/resource/' + encodeURIComponent(dt) + '?' + enc({ limit_page_length: 0, ...params }), { headers: h });
  const j = await r.json(); if (!r.ok) throw new Error(dt + ' ' + r.status + ' ' + JSON.stringify(j).slice(0, 300)); return j.data;
};
exports.method = async (m, params) => {
  const r = await fetch(env.ERPNEXT_URL + '/api/method/' + m + '?' + enc(params || {}), { headers: h });
  const j = await r.json(); if (!r.ok) throw new Error(m + ' ' + r.status + ' ' + JSON.stringify(j).slice(0, 300)); return j.message;
};
exports.get = async (dt, name) => {
  const r = await fetch(env.ERPNEXT_URL + '/api/resource/' + encodeURIComponent(dt) + '/' + encodeURIComponent(name), { headers: h });
  const j = await r.json(); if (!r.ok) throw new Error(dt + ' ' + name + ' ' + r.status + ' ' + JSON.stringify(j).slice(0, 300)); return j.data;
};
const send = async (method, path, body) => {
  const r = await fetch(env.ERPNEXT_URL + path, { method, headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 300) }; }
  if (!r.ok) { const m = j._server_messages ? JSON.parse(j._server_messages).map(s => { try { return JSON.parse(s).message; } catch { return s; } }).join(' | ') : (j.exception || j.message || JSON.stringify(j).slice(0, 300)); throw new Error(method + ' ' + path + ' -> ' + r.status + ' ' + String(m).replace(/<[^>]+>/g, '').slice(0, 400)); }
  return j.data !== undefined ? j.data : j.message;
};
exports.insert = (dt, doc) => send('POST', '/api/resource/' + encodeURIComponent(dt), doc);
exports.update = (dt, name, doc) => send('PUT', '/api/resource/' + encodeURIComponent(dt) + '/' + encodeURIComponent(name), doc);
exports.call = (m, body) => send('POST', '/api/method/' + m, body);
exports.pool = async (items, n, fn) => { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; };
