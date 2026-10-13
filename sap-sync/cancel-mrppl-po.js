// Cancels one Manna Rubber Products purchase order through the Service Layer (user, 10 Oct 2026: PO 1033, the
// open order for ENG - 399, so the item can be kept with no stock and no match).
//
//   node cancel-mrppl-po.js <DocEntry> --docnum <DocNum> --item "<ItemCode>"            dry run: reads and checks
//   node cancel-mrppl-po.js <DocEntry> --docnum <DocNum> --item "<ItemCode>" --apply    cancels it
//
// Refuses unless the order is open and not cancelled, its DocNum is the one expected, every line is for the
// expected item, and nothing has been received against any line (open quantity = ordered quantity) - SAP would
// only allow "Close", not "Cancel", otherwise. MANNA_RUBBER_LIVE only. Logs to sap-engineering-sync\logs.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const ENTRY = Number(args.find((a) => /^\d+$/.test(a)));
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const DOCNUM = String(opt('--docnum') ?? '');
const ITEM = String(opt('--item') ?? '');
const APPLY = args.includes('--apply');
if (!ENTRY || !DOCNUM || !ITEM) { console.error('usage: node cancel-mrppl-po.js <DocEntry> --docnum <DocNum> --item "<ItemCode>" [--apply]'); process.exit(2); }

const COMPANY_DB = 'MANNA_RUBBER_LIVE';
const CONFIG = 'C:\\Users\\eldhose\\sap-treads-stock-sync\\config.json';
const LOG_DIR = 'C:\\Users\\eldhose\\sap-engineering-sync\\logs';
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const snippet = (t) => String(t ?? '').replace(/\s+/g, ' ').slice(0, 300);
const day = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
fs.mkdirSync(LOG_DIR, { recursive: true });
const logFile = path.join(LOG_DIR, `mrppl-cleanup-${day()}.log`);
const log = (level, msg) => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); const line = `${day()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} [${level}] ${msg}`; console.log(line); fs.appendFileSync(logFile, line + '\n'); };

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8').replace(/^\uFEFF/, ''));
const BASE = String(cfg.sap.url).replace(/\/+$/, '');
let cookie = '';
const http = async (method, p, body) => {
  const h = { Accept: 'application/json' };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}/${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json, text, cookies: typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [] };
};

(async () => {
  let code = 0;
  try {
    const lg = await http('POST', 'Login', { CompanyDB: COMPANY_DB, UserName: cfg.sap.username, Password: cfg.sap.password });
    if (lg.status !== 200) throw new Error(`login failed: HTTP ${lg.status} ${snippet(lg.text)}`);
    const jar = {};
    for (const c of lg.cookies) { const m = c.match(/^(B1SESSION|ROUTEID)=([^;]+)/); if (m) jar[m[1]] = m[2]; }
    cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    log('INFO', `SAP login OK: ${COMPANY_DB}${APPLY ? '' : ' - DRY RUN'} - cancel PO DocEntry ${ENTRY}`);

    const r = await http('GET', `PurchaseOrders(${ENTRY})?$select=DocEntry,DocNum,DocumentStatus,Cancelled,CardCode,CardName,DocDate,DocTotal,DocumentLines`);
    if (r.status !== 200) throw new Error(`read PO: HTTP ${r.status} ${snippet(r.text)}`);
    const po = r.json;
    const lines = po.DocumentLines || [];
    const checks = [
      [String(po.DocNum) === DOCNUM, `DocNum is ${po.DocNum}, expected ${DOCNUM}`],
      [po.DocumentStatus === 'bost_Open', `status is ${po.DocumentStatus}, not open`],
      [po.Cancelled !== 'tYES', 'already cancelled'],
      [lines.length > 0, 'no lines'],
      [lines.every((l) => norm(l.ItemCode) === norm(ITEM)), `a line is not for ${ITEM}: ${lines.map((l) => l.ItemCode).join(', ')}`],
      [lines.every((l) => l.LineStatus !== 'bost_Open' || Math.abs(Number(l.RemainingOpenQuantity) - Number(l.Quantity)) < 1e-6), 'something was already received against it (open < ordered) - SAP would only allow Close'],
    ];
    const failed = checks.filter(([okay]) => !okay).map(([, why]) => why);
    log('INFO', `PO ${po.DocNum} (${po.DocEntry}) ${po.CardCode} ${po.CardName}, ${po.DocDate?.slice(0, 10)}, total ${po.DocTotal}: ${lines.map((l) => `${l.ItemCode} ${l.RemainingOpenQuantity}/${l.Quantity} open ${l.LineStatus}`).join('; ')}`);
    if (failed.length) throw new Error(`not cancelled: ${failed.join('; ')}`);
    if (!APPLY) { log('INFO', 'DRY RUN: would POST PurchaseOrders(' + ENTRY + ')/Cancel'); }
    else {
      const c = await http('POST', `PurchaseOrders(${ENTRY})/Cancel`);
      if (c.status !== 204 && c.status !== 200) throw new Error(`Cancel refused: HTTP ${c.status} ${snippet(c.text)}`);
      const back = await http('GET', `PurchaseOrders(${ENTRY})?$select=DocEntry,DocNum,DocumentStatus,Cancelled`);
      if (back.status !== 200 || back.json.Cancelled !== 'tYES') throw new Error(`cancel sent, but SAP reads back status ${back.json?.DocumentStatus} cancelled ${back.json?.Cancelled}`);
      fs.appendFileSync(path.join(LOG_DIR, `mrppl-cleanup-journal-${day()}.jsonl`), JSON.stringify({ at: new Date().toISOString(), step: 'cancel-po', docEntry: ENTRY, docNum: po.DocNum, item: ITEM, status: c.status }) + '\n');
      log('INFO', `PO ${po.DocNum} cancelled: SAP reads back DocumentStatus ${back.json.DocumentStatus}, Cancelled ${back.json.Cancelled}`);
    }
  } catch (e) { code = 1; log('ERROR', e.message); }
  finally { if (cookie) { try { const lo = await http('POST', 'Logout'); log('INFO', `SAP logout: HTTP ${lo.status}`); } catch (e) { log('WARN', `logout: ${e.message}`); } } }
  process.exit(code);
})();
