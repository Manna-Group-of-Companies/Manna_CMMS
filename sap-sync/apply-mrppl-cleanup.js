// The Manna Rubber Products engineering item clean-up, applied through the Service Layer (user, 10 Oct 2026 -
// a reviewed exception to BRIEFING §1 rule 2, asked for in so many words after inspecting the DTW lists).
//
//   node apply-mrppl-cleanup.js <plan.json>                      dry run: reads SAP, writes nothing, says what it would do
//   node apply-mrppl-cleanup.js <plan.json> --apply --limit 1    canary: the first item of each kind, then verify
//   node apply-mrppl-cleanup.js <plan.json> --apply              the rest
//   --steps rename,new,stock,deactivate   only these steps (default all)      --gr-chunk 100   lines per Goods Receipt
//
// <plan.json> is server/scripts/planMrpplSapCleanup.js output - the lists the user inspected. MANNA_RUBBER_LIVE only.
//
//   1. rename      PATCH Items: ItemName -> the standard name, U_SubTypeA / U_SubTypeB from the count, MinInventory
//   2. new         POST Items: the counted items SAP lacked (ENG-<n>, group 108, nil value), one Bolt / Nut / Washer
//   3. stock       POST InventoryGenEntries: each new item's counted quantity into warehouse 01 at unit price 0
//   4. deactivate  PATCH Items: Valid tNO + Frozen tYES for items that matched nothing and hold no stock
//
// Every action is checked against SAP at run time and skipped with a reason when it no longer fits: a rename needs
// the item active; a deactivation needs zero stock, no open PO line, and the item not renamed or created here; the
// opening stock only goes to new items still at zero on hand. Re-running is safe: a rename of fields already equal
// is a no-op, a new item is adopted by its stamp (SWW = "PS-<counted id>") instead of created twice, stock is not
// received twice, an inactive item is left inactive. Items with stock that matched nothing are never touched.
//
// Built per BRIEFING §2: Node's fetch sends no "Expect: 100-continue"; one login, logout in a finally; the SAP
// password is read from sap-treads-stock-sync\config.json and never written anywhere. Before the first write the
// current state of every item touched is saved to logs\ (the way back), and every write goes to a JSONL journal.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const PLAN = args.find((a) => !a.startsWith('--'));
const APPLY = args.includes('--apply');
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt; };
const LIMIT = Number(opt('--limit', 0)) || 0;
const STEPS = new Set(String(opt('--steps', 'rename,new,stock,deactivate')).split(',').map((s) => s.trim()));
const GR_CHUNK = Math.max(1, Number(opt('--gr-chunk', 100)) || 100);
if (!PLAN) { console.error('usage: node apply-mrppl-cleanup.js <plan.json> [--apply] [--limit N] [--steps a,b] [--gr-chunk N]'); process.exit(2); }

const COMPANY_DB = 'MANNA_RUBBER_LIVE';
const GROUP = 108;              // Engineering Stocks
const WAREHOUSE = '01';          // where every engineering receipt lands (ENG is inactive)
const ITEM_SERIES = 3;           // the manual ENG- numbering, as every existing engineering item
const GR_SERIES = 165;           // the Goods Receipt numbering in use (last docs 1605..1607, 8-9 Oct 2026)
const CONFIG = 'C:\\Users\\eldhose\\sap-treads-stock-sync\\config.json';
const LOG_DIR = 'C:\\Users\\eldhose\\sap-engineering-sync\\logs';

const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const TODAY = stamp();
// Seconds too: a canary and the full run a minute apart must not share a backup file name.
const RUN = (() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${TODAY}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; })();
fs.mkdirSync(LOG_DIR, { recursive: true });
const logFile = path.join(LOG_DIR, `mrppl-cleanup-${TODAY}.log`);
const journalFile = path.join(LOG_DIR, `mrppl-cleanup-journal-${TODAY}.jsonl`);
const nowLocal = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${TODAY} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const log = (level, msg) => { const line = `${nowLocal()} [${level}] ${msg}`; console.log(line); fs.appendFileSync(logFile, line + '\n'); };
const journal = (entry) => { if (APPLY) fs.appendFileSync(journalFile, JSON.stringify({ at: new Date().toISOString(), run: RUN, ...entry }) + '\n'); };
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const snippet = (t) => String(t ?? '').replace(/\s+/g, ' ').slice(0, 300);

// ---------------------------------------------------------------- Service Layer (one session)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // self-signed certificate on the SAP server
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8').replace(/^\uFEFF/, ''));
for (const k of ['url', 'username', 'password']) if (!String(cfg.sap?.[k] ?? '').trim()) { console.error(`config sap.${k} missing in ${CONFIG}`); process.exit(2); }
const BASE = String(cfg.sap.url).replace(/\/+$/, '');
let cookie = '';
let loggedIn = false;

const http = async (method, pathOrUrl, body, headers = {}) => {
  const url = /^https?:/i.test(pathOrUrl) ? pathOrUrl : `${BASE}/${pathOrUrl}`;
  const h = { Accept: 'application/json', Prefer: 'odata.maxpagesize=200', ...headers };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json, text, cookies: typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [] };
};
const login = async () => {
  const r = await http('POST', 'Login', { CompanyDB: COMPANY_DB, UserName: cfg.sap.username, Password: cfg.sap.password });
  if (r.status !== 200) throw new Error(`SAP login to ${COMPANY_DB} failed: HTTP ${r.status} ${snippet(r.text)}`);
  const jar = {};
  for (const c of r.cookies) { const m = c.match(/^(B1SESSION|ROUTEID)=([^;]+)/); if (m) jar[m[1]] = m[2]; }
  if (!jar.B1SESSION) throw new Error('SAP login returned no B1SESSION cookie');
  cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  loggedIn = true;
};
const logout = async () => { if (!loggedIn) return; try { const r = await http('POST', 'Logout'); log('INFO', `SAP logout: HTTP ${r.status}`); } catch (e) { log('WARN', `logout: ${e.message}`); } loggedIn = false; cookie = ''; };
// Ctrl-C: finish the write in flight (and its read-back and journal line), then stop before the next one, so the
// result file is written and the session logged out by the normal finally. A second Ctrl-C exits at once.
let stopping = '';
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { if (stopping) process.exit(130); stopping = sig; log('WARN', `${sig} - finishing the current write, then stopping (press again to exit at once)`); });
const stopped = (what) => { if (stopping) log('WARN', `${stopping}: stopped before ${what}`); return Boolean(stopping); };
// One retry after a re-login when the session has gone (30 min idle timeout, or dropped).
const sl = async (method, p, body, headers) => {
  let r = await http(method, p, body, headers);
  if (r.status === 401) { log('WARN', 'session lost - logging in again'); await login(); r = await http(method, p, body, headers); }
  return r;
};
const fail = (r, what) => { throw new Error(`SAP ${what}: HTTP ${r.status} ${snippet(r.text)}`); };
const keyUrl = (code) => `Items('${encodeURIComponent(String(code).replace(/'/g, "''"))}')`;
const q = (s) => s.replace(/ /g, '%20').replace(/'/g, '%27');
const getAll = async (p) => {
  const rows = []; let next = p; let pages = 0;
  while (next && pages < 200) {
    pages += 1;
    const r = await sl('GET', next);
    if (r.status !== 200) fail(r, `read ${p}`);
    rows.push(...(r.json?.value || []));
    const lnk = r.json?.['odata.nextLink'] || r.json?.['@odata.nextLink'];
    next = !lnk ? null : /^https?:/i.test(lnk) ? lnk : lnk.startsWith('/') ? new URL(BASE).origin + lnk : `${BASE}/${lnk}`;
  }
  return rows;
};
const getItem = async (code, select) => {
  const r = await sl('GET', `${keyUrl(code)}?$select=${select}`);
  if (r.status === 404) return null;
  if (r.status !== 200) fail(r, `read ${code}`);
  return r.json;
};

// ---------------------------------------------------------------- the plan
const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
const limit = (list) => (LIMIT > 0 ? list.slice(0, LIMIT) : list);
const result = { run: RUN, apply: APPLY, limit: LIMIT, steps: [...STEPS], rename: [], new: [], stock: [], deactivate: [], failures: 0 };
// The warehouse rows too: the minimum this run writes sits on the warehouse-01 row, so the backup must hold it and
// the dry run must take the same branch as the apply run.
const ITEM_FIELDS = 'ItemCode,ItemName,U_SubTypeA,U_SubTypeB,MinInventory,QuantityOnStock,Valid,Frozen,ItemsGroupCode,InventoryUOM,SWW,ManageStockByWarehouse,ItemWarehouseInfoCollection';

// Checks that need no SAP: lengths SAP would refuse, codes, stamps.
const problems = [];
for (const r of plan.renames) {
  if (!r.newName || r.newName.length > 100) problems.push(`rename ${r.sapCode}: name empty or over 100`);
  if ((r.subA || '').length > 50 || (r.subB || '').length > 50) problems.push(`rename ${r.sapCode}: sub-category over 50`);
}
const stampOf = (n) => (n.combined ? `PS-${n.name.toUpperCase()}` : `PS-${String(n.physicalIds).split(',')[0].trim()}`);
for (const n of plan.newItems) {
  if (!n.name || n.name.length > 100) problems.push(`new ${n.itemCode}: name empty or over 100`);
  if ((n.subA || '').length > 50 || (n.subB || '').length > 50) problems.push(`new ${n.itemCode}: sub-category over 50`);
  if (stampOf(n).length > 16) problems.push(`new ${n.itemCode}: stamp ${stampOf(n)} over 16`);
  if (!/^ENG-\d+$/.test(n.itemCode)) problems.push(`new ${n.itemCode}: not an ENG- code`);
}
const stamps = plan.newItems.map(stampOf);
if (new Set(stamps).size !== stamps.length) problems.push('duplicate stamps among new items');
if (problems.length) { for (const p of problems) log('ERROR', p); process.exit(2); }

(async () => {
  try {
    await login();
    log('INFO', `SAP login OK: ${COMPANY_DB}${APPLY ? '' : ' - DRY RUN, nothing will be written'}${LIMIT ? ` - limit ${LIMIT}` : ''} - steps ${[...STEPS].join(',')}`);

    // ------------------------------------------------------------ live state
    const live = new Map();
    for (const it of await getAll(`Items?$select=${ITEM_FIELDS}&$filter=ItemsGroupCode%20eq%20${GROUP}`)) live.set(norm(it.ItemCode), it);
    const bySww = new Map();
    for (const it of await getAll(q(`Items?$select=ItemCode,ItemName,SWW,QuantityOnStock&$filter=startswith(SWW,'PS-') and ItemsGroupCode eq ${GROUP}`))) bySww.set(norm(it.SWW), it);
    const taken = new Set((await getAll(q(`Items?$select=ItemCode&$filter=startswith(ItemCode,'ENG')`))).map((it) => norm(it.ItemCode)));
    let maxEng = 0;
    for (const c of taken) { const m = c.match(/^ENG[\s-]*(\d+)$/i); if (m) maxEng = Math.max(maxEng, Number(m[1])); }
    const readOpenPo = async () => {
      const map = new Map();
      for (const d of await getAll(q(`PurchaseOrders?$select=DocEntry,DocNum,DocumentLines&$filter=DocumentStatus eq 'bost_Open'`))) {
        for (const l of d.DocumentLines || []) {
          if (l.LineStatus !== 'bost_Open' || !(Number(l.RemainingOpenQuantity) > 0)) continue;
          const k = norm(l.ItemCode);
          map.set(k, [...(map.get(k) || []), `PO ${d.DocNum}`]);
        }
      }
      return map;
    };
    let openPo = await readOpenPo();
    // A write is decided on the item as SAP holds it NOW, not on the read taken at the start of a run that may
    // last half an hour while staff post documents. (The etag is no help: every row carries the same constant.)
    const FRESH = 'ItemCode,ItemName,U_SubTypeA,U_SubTypeB,MinInventory,Valid,Frozen,QuantityOnStock,ItemsGroupCode,ManageStockByWarehouse,ItemWarehouseInfoCollection';
    const current = async (code) => {
      if (!APPLY) return live.get(code) || null;
      const it = await getItem(code, FRESH);
      return it && Number(it.ItemsGroupCode) === GROUP ? it : null;
    };
    // The minimum stock lives on the warehouse row when an item manages stock by warehouse - every group-108
    // item does (checked 10 Oct 2026; ENG-231's minimum sits on its warehouse-01 row and is mirrored at item
    // level). A PATCH of the item-level MinInventory is accepted and ignored, as the canary showed.
    const whRow = (it) => (Array.isArray(it.ItemWarehouseInfoCollection) ? it.ItemWarehouseInfoCollection.find((w) => norm(w.WarehouseCode) === WAREHOUSE) : null);
    const minOf = (it) => (it.ManageStockByWarehouse === 'tYES' && whRow(it) ? Number(whRow(it).MinimalStock || 0) : Number(it.MinInventory || 0));
    const minPatch = (it, v) => (it.ManageStockByWarehouse === 'tYES' ? { ItemWarehouseInfoCollection: [{ WarehouseCode: WAREHOUSE, MinimalStock: v }] } : { MinInventory: v });
    const diffPatch = (it, want) => {
      const patch = {}; const changes = {};
      for (const [k, v] of Object.entries(want)) {
        if (k === 'MinInventory') { const cur = minOf(it); if (cur !== v) { Object.assign(patch, minPatch(it, v)); changes.MinInventory = { from: cur, to: v }; } continue; }
        if (norm(it[k]) !== norm(v)) { patch[k] = v; changes[k] = { from: it[k] ?? '', to: v }; }
      }
      return { patch, changes };
    };
    const verifyBack = async (code, want) => {
      const back = await getItem(code, FRESH);
      if (!back) throw new Error('written, but SAP cannot read it back');
      for (const [k, v] of Object.entries(want)) {
        const got = k === 'MinInventory' ? minOf(back) : back[k];
        const ok = k === 'MinInventory' ? got === v : norm(got) === norm(v);
        if (!ok) throw new Error(`written, but SAP reads back ${k} = "${got}"`);
      }
      return back;
    };
    log('INFO', `live: ${live.size} items in group ${GROUP}, ${bySww.size} stamped by an earlier run, highest ENG code ${maxEng}, ${openPo.size} items on open PO lines`);

    // The way back: what every item we may touch looks like now.
    const touched = [...new Set([...plan.renames.map((r) => r.sapCode), ...plan.deactivate.map((d) => d.sapCode)])].map(norm);
    const backup = touched.map((c) => live.get(c)).filter(Boolean);
    const backupFile = path.join(LOG_DIR, `mrppl-cleanup-backup-${RUN}.json`);
    fs.writeFileSync(backupFile, JSON.stringify({ companyDb: COMPANY_DB, takenAt: new Date().toISOString(), items: backup }, null, 1));
    log('INFO', `backup of ${backup.length} items written: ${path.basename(backupFile)}`);

    const renamedCodes = new Set();
    const createdCodes = new Set();

    // ------------------------------------------------------------ 1. rename
    if (STEPS.has('rename')) {
      for (const r of limit(plan.renames)) {
        const code = norm(r.sapCode);
        if (stopped(`rename ${code}`)) break;
        const entry = { code, action: '', changes: {}, note: '' };
        let written = null; // set the moment SAP accepts the PATCH: a failed read-back is then "written, unverified", not "failed"
        try {
          const it = await current(code);
          if (!it) throw new Error('not in SAP group 108 any more');
          if (it.Valid !== 'tYES' || it.Frozen === 'tYES') throw new Error('inactive in SAP');
          // Someone renamed it in SAP after the user inspected the list: not overwritten, reported. The target name
          // itself is fine - an earlier run (a canary) may have renamed it and still owe it the other fields.
          if (norm(it.ItemName) !== norm(r.currentName) && norm(it.ItemName) !== norm(r.newName)) throw new Error(`name changed since the plan ("${it.ItemName}") - left as it is`);
          const want = { ItemName: r.newName, U_SubTypeA: r.subA || '', U_SubTypeB: r.subB || '', MinInventory: Number(r.minStock || 0) };
          const { patch, changes } = diffPatch(it, want);
          entry.changes = changes;
          if (!Object.keys(patch).length) entry.action = 'already so';
          else if (!APPLY) entry.action = 'would patch';
          else {
            // No If-Match: the canary showed SAP answers 412 (-2039) to the etag its own key GET returns, and the
            // collection etag is one constant for every row, so the header guards nothing. The fresh read above
            // and the name check are the guard.
            const pr = await sl('PATCH', keyUrl(code), patch);
            if (pr.status !== 204 && pr.status !== 200) fail(pr, `PATCH ${code}`);
            // Journaled the moment SAP accepts it - the audit record of what SAP did, whatever the read-back says.
            written = { patch, status: pr.status };
            journal({ step: 'rename', code, patch, status: pr.status });
            await verifyBack(code, want);
            entry.action = 'renamed';
            renamedCodes.add(code);
            journal({ step: 'rename', code, verified: true });
          }
        } catch (e) {
          entry.action = written ? 'written, unverified' : /left as it is|inactive in SAP|any more/.test(e.message) ? 'skipped' : 'failed';
          entry.note = e.message;
          if (entry.action !== 'skipped') result.failures += 1;
          journal({ step: 'rename', code, [written ? 'unverified' : entry.action]: e.message });
        }
        result.rename.push(entry);
        log(entry.action === 'skipped' ? 'WARN' : /renamed|already so|would patch/.test(entry.action) ? 'INFO' : 'ERROR', `rename ${code}: ${entry.action} ${Object.entries(entry.changes).map(([k, c]) => `${k} "${c.from}" -> "${c.to}"`).join('; ')}${entry.note ? ` (${entry.note})` : ''}`);
      }
    }

    // ------------------------------------------------------------ 2. new items
    let nextFree = maxEng + 1;
    const allocate = (planned) => {
      if (!taken.has(planned)) { taken.add(planned); return planned; }
      while (taken.has(`ENG-${nextFree}`)) nextFree += 1;
      const c = `ENG-${nextFree}`; taken.add(c); nextFree += 1; return c;
    };
    const newCodes = new Map(); // planned -> actual
    if (STEPS.has('new')) {
      for (const n of limit(plan.newItems)) {
        const sww = stampOf(n);
        if (stopped(`new ${n.itemCode}`)) break;
        const entry = { planned: n.itemCode, code: '', name: n.name, action: '', note: '' };
        let written = null;
        try {
          const have = bySww.get(sww);
          if (have) {
            // Created by an earlier run (a canary): adopted, and brought in line if a field differs.
            entry.code = norm(have.ItemCode); entry.action = 'adopted (already in SAP)';
            if (APPLY) {
              const it = await current(entry.code);
              if (!it) throw new Error('stamped item is not in group 108 any more');
              const want = { ItemName: n.name, U_SubTypeA: n.subA || '', U_SubTypeB: n.subB || '', MinInventory: Number(n.minStock || 0) };
              const { patch, changes } = diffPatch(it, want);
              if (Object.keys(patch).length) {
                const pr = await sl('PATCH', keyUrl(entry.code), patch);
                if (pr.status !== 204 && pr.status !== 200) fail(pr, `PATCH ${entry.code}`);
                written = { patch, status: pr.status };
                journal({ step: 'new', code: entry.code, adopted: true, patch, status: pr.status });
                await verifyBack(entry.code, want);
                entry.action = 'adopted, brought in line'; entry.changes = changes;
                journal({ step: 'new', code: entry.code, verified: true });
              }
            } else if (norm(have.ItemName) !== norm(n.name)) entry.note = `SAP holds it as "${have.ItemName}"`;
          } else {
            const code = APPLY ? allocate(n.itemCode) : (taken.has(n.itemCode) ? `(next free after ENG-${maxEng})` : n.itemCode);
            entry.code = code;
            const payload = {
              ItemCode: code, ItemName: n.name, ItemsGroupCode: GROUP, ItemType: 'itItems',
              InventoryItem: 'tYES', SalesItem: 'tYES', PurchaseItem: 'tYES', ProcurementMethod: 'bom_Buy',
              UoMGroupEntry: -1, InventoryUOM: n.uom, PurchaseUnit: n.uom, SalesUnit: n.uom,
              SWW: sww, Series: ITEM_SERIES, U_SubTypeA: n.subA || '', U_SubTypeB: n.subB || '',
              // Stock by warehouse, said outright rather than left to the company default: the minimum then sits on
              // the warehouse-01 row, the one place SAP reads it from for these items (see minOf).
              ManageStockByWarehouse: 'tYES', MinInventory: Number(n.minStock || 0),
            };
            if (Number(n.minStock || 0) > 0) payload.ItemWarehouseInfoCollection = [{ WarehouseCode: WAREHOUSE, MinimalStock: Number(n.minStock) }];
            if (!APPLY) { entry.action = 'would create'; entry.payload = payload; }
            else {
              const pr = await sl('POST', 'Items', payload);
              if (pr.status !== 201 && pr.status !== 200) fail(pr, `POST Items ${code}`);
              written = { code, status: pr.status };
              journal({ step: 'new', code, planned: n.itemCode, name: n.name, sww, status: pr.status });
              const back = await getItem(code, `${FRESH},SWW,InventoryUOM`);
              if (!back || norm(back.ItemName) !== norm(n.name) || norm(back.SWW) !== sww) throw new Error(`created, but SAP reads back ${JSON.stringify({ ItemName: back?.ItemName, SWW: back?.SWW })}`);
              if (minOf(back) !== Number(n.minStock || 0)) throw new Error(`created, but SAP reads back a minimum of ${minOf(back)}, not ${n.minStock}`);
              if (norm(back.InventoryUOM) !== norm(n.uom)) throw new Error(`created, but SAP reads back unit "${back.InventoryUOM}"`);
              entry.action = 'created';
              bySww.set(sww, { ItemCode: code, ItemName: n.name, SWW: sww, QuantityOnStock: 0 });
              journal({ step: 'new', code, verified: true });
            }
          }
          if (entry.code) { newCodes.set(n.itemCode, entry.code); createdCodes.add(norm(entry.code)); }
          if (entry.code !== n.itemCode && entry.action !== 'adopted (already in SAP)') entry.note = `${entry.note ? entry.note + '; ' : ''}planned ${n.itemCode}, code taken meanwhile`;
        } catch (e) {
          // An item SAP created but could not be read back as planned gets no opening stock in this run; the next
          // run adopts it by its stamp, brings it in line and receives the stock.
          entry.action = written ? 'written, unverified' : 'failed'; entry.note = e.message; result.failures += 1;
          journal({ step: 'new', code: entry.code || undefined, planned: n.itemCode, name: n.name, [written ? 'unverified' : 'error']: e.message });
        }
        result.new.push(entry);
        log(/failed|unverified/.test(entry.action) ? 'ERROR' : 'INFO', `new ${entry.code || n.itemCode}: ${entry.action} - ${n.name}${entry.note ? ` (${entry.note})` : ''}`);
      }
    }

    // ------------------------------------------------------------ 3. opening stock, nil value
    if (STEPS.has('stock')) {
      // Fresh on-hand figures: an item already received (an earlier run, a canary) is not received again.
      const onHand = new Map();
      for (const it of await getAll(`Items?$select=ItemCode,QuantityOnStock,Valid&$filter=ItemsGroupCode%20eq%20${GROUP}`)) onHand.set(norm(it.ItemCode), it);
      const lines = [];
      for (const n of limit(plan.newItems)) {
        const qty = Number(n.physicalQty || 0);
        if (qty <= 0) { result.stock.push({ planned: n.itemCode, name: n.name, qty, action: 'skipped', note: qty < 0 ? 'counted as a negative quantity - nothing received' : 'counted with no stock' }); continue; }
        const code = newCodes.get(n.itemCode) || norm(bySww.get(stampOf(n))?.ItemCode || '');
        if (!code) { result.stock.push({ planned: n.itemCode, qty, action: 'skipped', note: 'not created (or not verified) in this run and not stamped in SAP' }); continue; }
        const it = onHand.get(code);
        // In a dry run the new items do not exist yet: count their lines as if just created, at zero on hand.
        const justPlanned = !APPLY && !it && STEPS.has('new') && !bySww.has(stampOf(n));
        if (!it && !justPlanned) { result.stock.push({ code, qty, action: 'skipped', note: 'item not readable in group 108' }); continue; }
        if (it && Number(it.QuantityOnStock || 0) > 0) { result.stock.push({ code, qty, action: 'skipped', note: `already holds ${it.QuantityOnStock}` }); continue; }
        lines.push({ ItemCode: code, Quantity: qty, WarehouseCode: WAREHOUSE, UnitPrice: 0 });
      }
      const parts = Math.ceil(lines.length / GR_CHUNK);
      for (let i = 0; i < lines.length; i += GR_CHUNK) {
        const part = lines.slice(i, i + GR_CHUNK);
        const k = i / GR_CHUNK + 1;
        if (stopped(`stock part ${k}`)) break;
        // Reference2 (OIGN.Ref2) holds 11 characters: "PS<HHMMSS>-<part>", unique per run and part up to part 99
        // (the date is DocDate; the full run id goes in Comments). The 10 Oct 2026 run used "PSC<HHMM>-<part>",
        // which a canary and the full run in the same minute shared (documents 1609 and 1610 are both PSC1245-1).
        const doc = {
          DocDate: TODAY, Series: GR_SERIES, Reference2: `PS${RUN.slice(11, 17)}-${k}`,
          Comments: `Physical stock count - opening stock of new engineering items at nil value (CMMS run ${RUN}, part ${k} of ${parts})`.slice(0, 254),
          DocumentLines: part,
        };
        const entry = { part: k, lines: part.length, qty: part.reduce((s, l) => s + l.Quantity, 0), action: '', docNum: '', note: '' };
        let written = null;
        try {
          if (!APPLY) { entry.action = 'would post'; entry.sample = part.slice(0, 3); }
          else {
            // The lines go to the journal BEFORE the POST: if the client gives up after SAP has posted, the
            // document can still be found (Reference2) and matched line for line.
            entry.reference2 = doc.Reference2; entry.items = part;
            journal({ step: 'stock-intent', part: k, reference2: doc.Reference2, lines: part });
            const pr = await sl('POST', 'InventoryGenEntries', doc);
            if (pr.status !== 201 && pr.status !== 200) fail(pr, `POST InventoryGenEntries part ${k}`);
            entry.docNum = String(pr.json?.DocNum ?? ''); entry.docEntry = pr.json?.DocEntry;
            written = { docEntry: entry.docEntry, docNum: entry.docNum };
            journal({ step: 'stock', part: k, docEntry: entry.docEntry, docNum: entry.docNum, lines: part.length, status: pr.status });
            // Verify every line landed.
            const fresh = new Map();
            for (const it of await getAll(`Items?$select=ItemCode,QuantityOnStock&$filter=ItemsGroupCode%20eq%20${GROUP}`)) fresh.set(norm(it.ItemCode), Number(it.QuantityOnStock || 0));
            const wrong = part.filter((l) => Math.abs((fresh.get(l.ItemCode) ?? -1) - l.Quantity) > 1e-6);
            if (wrong.length) throw new Error(`posted as ${entry.docNum}, but ${wrong.length} line(s) read back a different on-hand: ${wrong.slice(0, 5).map((l) => `${l.ItemCode}=${fresh.get(l.ItemCode)}`).join(', ')}`);
            entry.action = 'posted';
            journal({ step: 'stock', part: k, docEntry: entry.docEntry, verified: true });
          }
        } catch (e) { entry.action = written ? 'posted, unverified' : 'failed'; entry.note = e.message; result.failures += 1; journal({ step: 'stock', part: k, ...(written || {}), [written ? 'unverified' : 'error']: e.message }); }
        result.stock.push(entry);
        log(/failed|unverified/.test(entry.action) ? 'ERROR' : 'INFO', `stock part ${k}/${parts}: ${entry.action} ${entry.docNum ? `Goods Receipt ${entry.docNum} ` : ''}- ${part.length} line(s), ${entry.qty} pcs at nil value${entry.note ? ` (${entry.note})` : ''}`);
      }
      if (!lines.length) log('INFO', 'stock: nothing to receive');
    }

    // ------------------------------------------------------------ 4. deactivate
    if (STEPS.has('deactivate')) {
      const keep = new Set([...plan.renames.map((r) => norm(r.sapCode)), ...renamedCodes, ...createdCodes]);
      if (APPLY) { openPo = await readOpenPo(); log('INFO', `open PO lines re-read before deactivating: ${openPo.size} item(s)`); }
      for (const d of limit(plan.deactivate)) {
        const code = norm(d.sapCode);
        if (stopped(`deactivate ${code}`)) break;
        const entry = { code, name: d.name, action: '', note: '' };
        let written = null;
        try {
          const it = await current(code);
          if (!it) throw new Error('not in SAP group 108 any more');
          if (keep.has(code)) throw new Error('renamed or created in this clean-up - not deactivated');
          const kept = (plan.keep || []).find((k) => norm(k.sapCode) === code);
          if (kept) throw new Error(`kept on the user's instruction (${kept.reason}) - left as it is`);
          if (Number(it.QuantityOnStock || 0) !== 0) throw new Error(`holds ${it.QuantityOnStock} in SAP now - left as it is`);
          if (openPo.has(code)) throw new Error(`on an open PO line (${openPo.get(code).join(', ')}) - left as it is`);
          if (it.Valid === 'tNO' || it.Frozen === 'tYES') entry.action = 'already inactive';
          else if (!APPLY) entry.action = 'would deactivate';
          else {
            const patch = { Valid: 'tNO', Frozen: 'tYES' };
            const pr = await sl('PATCH', keyUrl(code), patch);
            if (pr.status !== 204 && pr.status !== 200) fail(pr, `PATCH ${code}`);
            written = { patch, status: pr.status };
            journal({ step: 'deactivate', code, patch, status: pr.status });
            const back = await getItem(code, 'Valid,Frozen');
            if (!back || back.Valid !== 'tNO' || back.Frozen !== 'tYES') throw new Error(`patched, but SAP reads back Valid=${back?.Valid} Frozen=${back?.Frozen}`);
            entry.action = 'deactivated';
            journal({ step: 'deactivate', code, verified: true });
          }
        } catch (e) {
          entry.action = written ? 'written, unverified' : /left as it is|not deactivated|any more/.test(e.message) ? 'skipped' : 'failed';
          entry.note = e.message;
          if (entry.action !== 'skipped') result.failures += 1;
          journal({ step: 'deactivate', code, [written ? 'unverified' : entry.action]: e.message });
        }
        result.deactivate.push(entry);
        log(entry.action === 'skipped' ? 'WARN' : /deactivated|already inactive|would deactivate/.test(entry.action) ? 'INFO' : 'ERROR', `deactivate ${code}: ${entry.action} - ${d.name}${entry.note ? ` (${entry.note})` : ''}`);
      }
    }

  } catch (e) {
    result.failures += 1; result.fatal = e.message;
    log('ERROR', `fatal: ${e.message}`);
  } finally {
    // The summary and result file are written whatever happened, so a fatal error still leaves the record.
    const count = (list, a) => list.filter((e) => e.action === a).length;
    const unverified = (list) => list.filter((e) => /unverified/.test(e.action)).length;
    result.summary = {
      rename: { renamed: count(result.rename, 'renamed'), wouldPatch: count(result.rename, 'would patch'), alreadySo: count(result.rename, 'already so'), skipped: count(result.rename, 'skipped'), unverified: unverified(result.rename), failed: count(result.rename, 'failed') },
      new: { created: count(result.new, 'created'), wouldCreate: count(result.new, 'would create'), adopted: result.new.filter((e) => String(e.action).startsWith('adopted')).length, unverified: unverified(result.new), failed: count(result.new, 'failed') },
      stock: { posted: count(result.stock, 'posted'), wouldPost: count(result.stock, 'would post'), skipped: count(result.stock, 'skipped'), unverified: unverified(result.stock), failed: count(result.stock, 'failed'), lines: result.stock.filter((e) => e.lines).reduce((s, e) => s + e.lines, 0) },
      deactivate: { deactivated: count(result.deactivate, 'deactivated'), wouldDeactivate: count(result.deactivate, 'would deactivate'), alreadyInactive: count(result.deactivate, 'already inactive'), skipped: count(result.deactivate, 'skipped'), unverified: unverified(result.deactivate), failed: count(result.deactivate, 'failed') },
      failures: result.failures,
      fatal: result.fatal || '',
      stopped: stopping || '',
    };
    if (stopping) result.stopped = stopping;
    // The result file and the logout must both happen: a failure to write the file must not hold the session.
    try {
      const out = path.join(LOG_DIR, `mrppl-cleanup-${APPLY ? 'result' : 'dryrun'}-${RUN}.json`);
      fs.writeFileSync(out, JSON.stringify(result, null, 1));
      log(result.fatal ? 'ERROR' : 'INFO', `${APPLY ? 'RESULT' : 'DRY RUN'}: ${JSON.stringify(result.summary)} -> ${path.basename(out)}`);
    } catch (e) { console.error(`result file: ${e.message}\n${JSON.stringify(result.summary)}`); result.failures += 1; }
    await logout();
  }
  process.exit(stopping ? 130 : result.failures ? 1 : 0);
})();
