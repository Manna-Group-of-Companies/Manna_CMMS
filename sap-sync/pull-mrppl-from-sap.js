// Fetch Manna Rubber's engineering items from SAP into ERPNext - PASS E of Sync-SapItemCategories.ps1
// (pull_from_sap), for MANNA_RUBBER_LIVE only and nothing else (user, 11 Oct 2026: "sync the manna rubber new
// data from SAP to ERPnext", after the 10 Oct physical-count clean-up).
//
//   node pull-mrppl-from-sap.js            dry run: reads SAP and ERPNext, writes nothing, says what it would do
//   node pull-mrppl-from-sap.js --apply    writes ERPNext (never SAP), then reads both back and compares
//
// The same rules as PASS E, so the next flagged run finds nothing to do:
//   - an active SAP item in group 108 that ERPNext lacks becomes Item MRPPL-<code> (item group Maintenance Store,
//     default warehouse the company store), with name, group, Sub-category A/B, foreign name, HSN, tax, minimum;
//   - a mirrored item whose fields differ from SAP is updated, active state included (SAP inactive = disabled),
//     unless the CMMS has its own edit waiting (custom_sap_category_pending = 1);
//   - a mirrored item SAP files outside group 108 now is disabled;
//   - SAP's on-hand quantity of every active stock item is posted to Manna Rubber Products Store - MRPPL as a
//     submitted Stock Reconciliation where ERPNext differs (absolute quantities, current valuation kept, zero
//     valuation allowed - the clean-up's stock came in at nil value).
// Two refinements over PASS E: SAP unit CM maps to ERPNext Centimeter, and a fractional quantity is refused only
// for a unit ERPNext marks "must be whole number" (PASS E uses a fixed list).
//
// SAP is only read (one session, logout in finally). Credentials: SAP from sap-treads-stock-sync\config.json,
// ERPNext from Manna_CMMS\server\.env via erp.js - neither is printed or written anywhere.
const fs = require('fs');
const path = require('path');
const erp = require('./erp.js');

const APPLY = process.argv.includes('--apply');
const COMPANY_DB = 'MANNA_RUBBER_LIVE';
const ABBR = 'MRPPL';
const COMPANY = 'Manna Rubber Products Private Limited';
const STORE = 'Manna Rubber Products Store - MRPPL';
const SAP_CONFIG = 'C:\\Users\\eldhose\\sap-treads-stock-sync\\config.json';
const LOG_DIR = 'C:\\Users\\eldhose\\sap-engineering-sync\\logs';

const p2 = (n) => String(n).padStart(2, '0');
const d0 = new Date();
const TODAY = `${d0.getFullYear()}-${p2(d0.getMonth() + 1)}-${p2(d0.getDate())}`;
const RUN = `${TODAY}-${p2(d0.getHours())}${p2(d0.getMinutes())}${p2(d0.getSeconds())}`;
const nowIst = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
fs.mkdirSync(LOG_DIR, { recursive: true });
const logFile = path.join(LOG_DIR, `mrppl-pull-${TODAY}.log`);
const log = (level, msg) => { const line = `${nowIst()} [${level}] ${msg}`; console.log(line); fs.appendFileSync(logFile, line + '\n'); };
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const snippet = (t) => String(t ?? '').replace(/\s+/g, ' ').slice(0, 300);

// ------------------------------------------------------------------ SAP, read only
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // self-signed certificate on the SAP server
const sapCfg = JSON.parse(fs.readFileSync(SAP_CONFIG, 'utf8').replace(/^\uFEFF/, '')).sap;
const BASE = String(sapCfg.url).replace(/\/+$/, '');
let cookie = ''; let loggedIn = false;
const http = async (method, p, body) => {
  const url = /^https?:/i.test(p) ? p : `${BASE}/${p}`;
  const h = { Accept: 'application/json', Prefer: 'odata.maxpagesize=200' };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json, text, cookies: typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [] };
};
const login = async () => {
  const r = await http('POST', 'Login', { CompanyDB: COMPANY_DB, UserName: sapCfg.username, Password: sapCfg.password });
  if (r.status !== 200) throw new Error(`SAP login to ${COMPANY_DB} failed: HTTP ${r.status} ${snippet(r.text)}`);
  const jar = {}; for (const c of r.cookies) { const m = c.match(/^(B1SESSION|ROUTEID)=([^;]+)/); if (m) jar[m[1]] = m[2]; }
  if (!jar.B1SESSION) throw new Error('SAP login returned no B1SESSION cookie');
  cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '); loggedIn = true;
};
const logout = async () => { if (!loggedIn) return; try { const r = await http('POST', 'Logout'); log('INFO', `SAP logout: HTTP ${r.status}`); } catch (e) { log('WARN', `logout: ${e.message}`); } loggedIn = false; cookie = ''; };
const sapGet = async (p) => { let r = await http('GET', p); if (r.status === 401) { await login(); r = await http('GET', p); } return r; };
const sapAll = async (p) => {
  const rows = []; let next = p; let pages = 0;
  while (next && pages < 200) {
    pages += 1;
    const r = await sapGet(next);
    if (r.status !== 200) throw new Error(`SAP read ${p}: HTTP ${r.status} ${snippet(r.text)}`);
    rows.push(...(r.json?.value || []));
    const lnk = r.json?.['odata.nextLink'] || r.json?.['@odata.nextLink'];
    next = !lnk ? null : /^https?:/i.test(lnk) ? lnk : lnk.startsWith('/') ? new URL(BASE).origin + lnk : `${BASE}/${lnk}`;
  }
  return rows;
};
const q = (s) => s.replace(/ /g, '%20').replace(/'/g, '%27');
const keyUrl = (code) => `Items('${encodeURIComponent(String(code).replace(/'/g, "''"))}')`;

// SAP unit -> ERPNext UOM, as PASS E, plus CM.
const UOM_OF = { NOS: 'Nos', NO: 'Nos', PCS: 'Nos', PC: 'Nos', EACH: 'Nos', EA: 'Nos', KG: 'Kg', KGS: 'Kg', MTR: 'Meter', M: 'Meter', MTRS: 'Meter', LTR: 'Litre', L: 'Litre', LTRS: 'Litre', SET: 'Set', SETS: 'Set', PAIR: 'Pair', ROLL: 'Roll', BOX: 'Box', PKT: 'Packet', PACKET: 'Packet', UNIT: 'Unit', UNITS: 'Unit', CM: 'Centimeter', CMS: 'Centimeter' };
const ERP_FIELDS = ['name', 'item_name', 'custom_sap_item_code', 'valuation_rate', 'disabled', 'stock_uom', 'is_stock_item', 'custom_sap_item_group', 'custom_sap_sub_type_a', 'custom_sap_sub_type_b', 'custom_sap_foreign_name', 'custom_sap_hsn_code', 'custom_sap_tax_rate', 'safety_stock', 'custom_sap_category_pending'];
const readMirror = async () => {
  const mine = new Map();
  for (const it of await erp.list('Item', { fields: ERP_FIELDS, filters: [['name', 'like', `${ABBR}-%`], ['custom_sap_item_group', 'is', 'set']] })) {
    const sc = norm(it.custom_sap_item_code); if (sc) mine.set(sc, it);
  }
  return mine;
};
const readBins = async () => {
  const bins = new Map();
  for (const b of await erp.list('Bin', { fields: ['item_code', 'actual_qty'], filters: [['warehouse', '=', STORE]] })) bins.set(b.item_code, num(b.actual_qty));
  return bins;
};

const result = { run: RUN, apply: APPLY, new: [], update: [], disable: [], stock: [], skippedStock: [], failures: [], verify: null };

(async () => {
  let exit = 0;
  try {
    // ---------------- the CMMS side's options for this company (groups), from the control Single
    const ctl = await erp.get('SAP Item Category Sync Control', 'SAP Item Category Sync Control');
    const opt = JSON.parse(ctl.item_master_options || '{}')[ABBR];
    if (!opt || opt.sap_db !== COMPANY_DB) throw new Error(`item_master_options has no ${ABBR} entry for ${COMPANY_DB}`);
    const gcodes = opt.groups.map((g) => toInt(g.code));
    const groupName = new Map(opt.groups.map((g) => [toInt(g.code), String(g.name)]));
    const wholeUoms = new Set((await erp.list('UOM', { fields: ['name', 'must_be_whole_number'], filters: [['must_be_whole_number', '=', 1]] })).map((u) => u.name));

    await login();
    log('INFO', `SAP login OK: ${COMPANY_DB} (read only) - ERPNext ${APPLY ? 'WILL BE WRITTEN' : 'DRY RUN, nothing will be written'} - groups ${gcodes.join(', ')}`);

    // HSN digits by AbsEntry (ChapterID), as PASS E.
    const hsn = new Map();
    for (const h of await sapAll('IndiaHsn?$select=AbsEntry,Chapter,Heading,SubHeading')) {
      const d = `${h.Chapter ?? ''}${h.Heading ?? ''}${h.SubHeading ?? ''}`.replace(/[^0-9]/g, '');
      if (d && ![...hsn.values()].includes(d) && !hsn.has(toInt(h.AbsEntry))) hsn.set(toInt(h.AbsEntry), d);
    }
    const filter = gcodes.map((c) => `ItemsGroupCode eq ${c}`).join(' or ');
    const sapItems = await sapAll(q(`Items?$select=ItemCode,ItemName,ForeignName,ItemsGroupCode,U_SubTypeA,U_SubTypeB,ChapterID,U_TaxRate,MinInventory,InventoryUOM,Valid,Frozen,InventoryItem,QuantityOnStock&$filter=${filter}`));
    const mine = await readMirror();
    const bins = await readBins();
    log('INFO', `SAP: ${sapItems.length} items in group(s) ${gcodes.join(', ')} (${sapItems.filter((s) => s.Valid === 'tYES' && s.Frozen !== 'tYES').length} active); ERPNext: ${mine.size} mirrored ${ABBR} items, ${bins.size} bins in ${STORE}`);

    // The way back: every mirrored item and every bin as ERPNext holds them now.
    const backupFile = path.join(LOG_DIR, `mrppl-pull-backup-${RUN}.json`);
    fs.writeFileSync(backupFile, JSON.stringify({ takenAt: new Date().toISOString(), store: STORE, items: [...mine.values()], bins: Object.fromEntries(bins) }, null, 1));
    log('INFO', `ERPNext backup written: ${path.basename(backupFile)}`);

    const wantOf = (si) => {
      const active = si.Valid === 'tYES' && si.Frozen !== 'tYES';
      const ch = toInt(si.ChapterID);
      return {
        // ERPNext's item_name holds 140 characters, SAP's ItemName 200: cut as the 24 Sep import did (MRPPL-ENG-141);
        // the description carries the full name.
        item_name: norm(norm(si.ItemName).slice(0, 140)), custom_sap_item_group: groupName.get(toInt(si.ItemsGroupCode)),
        custom_sap_sub_type_a: norm(si.U_SubTypeA), custom_sap_sub_type_b: norm(si.U_SubTypeB),
        custom_sap_foreign_name: norm(si.ForeignName),
        custom_sap_hsn_code: ch > 0 && hsn.has(ch) ? hsn.get(ch) : '',
        custom_sap_tax_rate: norm(si.U_TaxRate), safety_stock: num(si.MinInventory),
        disabled: active ? 0 : 1,
      };
    };

    // ---------------- items
    const toCreate = []; const toUpdate = []; const seen = new Set();
    for (const si of sapItems) {
      const code = norm(si.ItemCode); seen.add(code);
      const want = wantOf(si);
      const it = mine.get(code);
      if (!it) {
        if (want.disabled) continue;
        const uom = UOM_OF[norm(si.InventoryUOM).toUpperCase()] || 'Nos';
        const doc = {
          item_code: `${ABBR}-${code}`, description: norm(si.ItemName), item_group: 'Maintenance Store', stock_uom: uom,
          is_stock_item: si.InventoryItem === 'tYES' ? 1 : 0, include_item_in_manufacturing: 0, is_purchase_item: 1, is_sales_item: 0,
          custom_sap_item_code: code, custom_sap_category_pending: 0, custom_sap_category_synced_at: nowIst(),
          item_defaults: [{ doctype: 'Item Default', company: COMPANY, default_warehouse: STORE }],
          ...want,
        };
        toCreate.push({ code, doc });
        continue;
      }
      if (toInt(it.custom_sap_category_pending) === 1) { log('WARN', `${it.name}: the CMMS has its own edit waiting - left for the sync to send`); continue; }
      const diff = {};
      for (const [k, b] of Object.entries(want)) {
        const a = it[k];
        const same = k === 'safety_stock' || k === 'disabled' ? num(a) === num(b) : norm(a) === String(b ?? '');
        if (!same) diff[k] = b;
      }
      if (Object.keys(diff).length) {
        if ('item_name' in diff) diff.description = norm(si.ItemName);
        toUpdate.push({ code, name: it.name, diff, from: Object.fromEntries(Object.keys(diff).filter((k) => k !== 'description').map((k) => [k, it[k] ?? ''])) });
      }
    }
    const toDisable = [];
    for (const [code, it] of mine) {
      if (seen.has(code) || toInt(it.disabled) === 1 || toInt(it.custom_sap_category_pending) === 1) continue;
      const r = await sapGet(`${keyUrl(code)}?$select=ItemCode,ItemsGroupCode`);
      if (r.status !== 200) { log('WARN', `${it.name}: not in SAP any more (HTTP ${r.status}) - left as it is`); continue; }
      const grp = toInt(r.json?.ItemsGroupCode);
      if (!gcodes.includes(grp)) toDisable.push({ code, name: it.name, grp });
    }
    log('INFO', `items: ${toCreate.length} to add, ${toUpdate.length} to update, ${toDisable.length} to disable (moved out of the engineering group)`);

    // Inactive in SAP (zero stock there) but holding stock in ERPNext: brought to 0 by the reconciliation BEFORE
    // they are disabled, so no stock is left on an item the CMMS hides (MRPPL-ENG-302, 11 Oct 2026).
    const inactiveCodes = new Set(sapItems.filter((si) => !(si.Valid === 'tYES' && si.Frozen !== 'tYES')).map((si) => norm(si.ItemCode)));
    const zeroFirst = [...mine].filter(([code, it]) => inactiveCodes.has(code) && toInt(it.custom_sap_category_pending) !== 1 && Math.abs(bins.get(it.name) || 0) > 1e-6).map(([code, it]) => ({ code, name: it.name, erpQty: bins.get(it.name) }));
    const laterDisable = [];
    for (const u of toUpdate) if (zeroFirst.some((z) => z.code === u.code) && 'disabled' in u.diff) { delete u.diff.disabled; laterDisable.push({ code: u.code, name: u.name }); }
    if (zeroFirst.length) log('INFO', `${zeroFirst.length} item(s) inactive in SAP hold stock in ERPNext - zeroed first, then disabled: ${zeroFirst.map((z) => `${z.name}=${z.erpQty}`).join(', ')}`);

    const run = async (list, fn, label) => {
      await erp.pool(list, 4, async (x) => {
        try { await fn(x); } catch (e) { result.failures.push({ step: label, code: x.code, error: e.message }); log('ERROR', `${label} ${x.code}: ${e.message}`); }
      });
    };
    if (APPLY) {
      await run(toCreate, async (x) => { await erp.insert('Item', x.doc); result.new.push({ code: x.code, name: x.doc.item_code, item_name: x.doc.item_name, uom: x.doc.stock_uom }); }, 'add');
      await run(toUpdate.filter((x) => Object.keys(x.diff).length), async (x) => { await erp.update('Item', x.name, x.diff); result.update.push({ code: x.code, name: x.name, from: x.from, to: x.diff }); }, 'update');
      await run(toDisable, async (x) => { await erp.update('Item', x.name, { disabled: 1 }); result.disable.push(x); }, 'disable');
    } else {
      result.new = toCreate.map((x) => ({ code: x.code, name: x.doc.item_code, item_name: x.doc.item_name, uom: x.doc.stock_uom, would: true }));
      result.update = toUpdate.filter((x) => Object.keys(x.diff).length).map((x) => ({ code: x.code, name: x.name, from: x.from, to: x.diff, would: true }));
      result.disable = toDisable.map((x) => ({ ...x, would: true }));
    }
    const fieldTally = {}; for (const u of toUpdate) for (const k of Object.keys(u.diff)) if (k !== 'description') fieldTally[k] = (fieldTally[k] || 0) + 1;
    log('INFO', `items ${APPLY ? 'done' : 'would be'}: ${toCreate.length} added, ${toUpdate.length} updated (${Object.entries(fieldTally).map(([k, v]) => `${k} ${v}`).join(', ')}), ${toDisable.length} disabled; failures ${result.failures.length}`);

    // ---------------- on-hand quantity, SAP -> the company store
    const mirrorNow = APPLY ? await readMirror() : new Map([...mine, ...toCreate.map((x) => [x.code, { name: x.doc.item_code, stock_uom: x.doc.stock_uom }])]);
    const reco = [];
    for (const si of sapItems) {
      if (si.InventoryItem !== 'tYES' || si.Valid !== 'tYES' || si.Frozen === 'tYES') continue;
      const it = mirrorNow.get(norm(si.ItemCode));
      if (!it) continue;
      const sapQty = num(si.QuantityOnStock);
      const erpQty = bins.has(it.name) ? bins.get(it.name) : 0;
      if (Math.abs(sapQty - erpQty) < 1e-6) continue;
      if (wholeUoms.has(it.stock_uom) && sapQty !== Math.floor(sapQty)) {
        result.skippedStock.push({ code: norm(si.ItemCode), name: it.name, sapQty, erpQty, uom: it.stock_uom, why: `ERPNext unit ${it.stock_uom} must be a whole number` });
        log('WARN', `${it.name}: SAP holds ${sapQty} ${it.stock_uom} - a fraction of a whole unit, quantity not fetched`);
        continue;
      }
      reco.push({ item_code: it.name, warehouse: STORE, qty: sapQty, allow_zero_valuation_rate: 1, _code: norm(si.ItemCode), _from: erpQty });
    }
    for (const z of zeroFirst) reco.push({ item_code: z.name, warehouse: STORE, qty: 0, allow_zero_valuation_rate: 1, _code: z.code, _from: z.erpQty });

    const up = reco.filter((r) => r.qty > r._from).length; const down = reco.length - up;
    log('INFO', `stock: ${reco.length} item(s) differ from SAP (${up} up, ${down} down), ${result.skippedStock.length} fractional skipped`);
    for (let i = 0; i < reco.length; i += 100) {
      const part = reco.slice(i, i + 100);
      const entry = { part: i / 100 + 1, lines: part.length, doc: '', items: part.map((r) => ({ item: r.item_code, from: r._from, to: r.qty })) };
      if (APPLY) {
        try {
          const d = await erp.insert('Stock Reconciliation', { company: COMPANY, purpose: 'Stock Reconciliation', posting_date: TODAY, set_posting_time: 1, docstatus: 1, remarks: `SAP ${COMPANY_DB} on-hand quantity fetched by the CMMS (run ${RUN}) after the 10 Oct 2026 physical-count clean-up`, items: part.map(({ _code, _from, ...row }) => row) });
          entry.doc = d.name; log('INFO', `stock part ${entry.part}: Stock Reconciliation ${d.name} submitted - ${part.length} line(s)`);
        } catch (e) { entry.error = e.message; result.failures.push({ step: 'stock', part: entry.part, error: e.message }); log('ERROR', `stock part ${entry.part}: ${e.message}`); }
      }
      result.stock.push(entry);
    }
    // Now the items zeroed above can be disabled.
    if (APPLY) {
      const stockFailed = result.failures.some((f) => f.step === 'stock');
      if (stockFailed && laterDisable.length) log('WARN', `stock reconciliation failed - not disabling ${laterDisable.map((x) => x.name).join(', ')} (still holding ERPNext stock)`);
      else await run(laterDisable, async (x) => { await erp.update('Item', x.name, { disabled: 1 }); result.update.push({ code: x.code, name: x.name, from: { disabled: 0 }, to: { disabled: 1 }, afterZeroing: true }); }, 'disable');
    } else for (const x of laterDisable) result.update.push({ code: x.code, name: x.name, from: { disabled: 0 }, to: { disabled: 1 }, afterZeroing: true, would: true });

    // ---------------- read both sides back and compare
    if (APPLY) {
      const m2 = await readMirror(); const b2 = await readBins();
      const bad = []; let okItems = 0; let okStock = 0;
      const skipped = new Set(result.skippedStock.map((s) => s.code));
      for (const si of sapItems) {
        const code = norm(si.ItemCode); const want = wantOf(si); const it = m2.get(code);
        if (!it) { if (!want.disabled) bad.push(`${code}: active in SAP, not in ERPNext`); continue; }
        if (toInt(it.custom_sap_category_pending) === 1) continue;
        const wrong = Object.entries(want).filter(([k, b]) => (k === 'safety_stock' || k === 'disabled' ? num(it[k]) !== num(b) : norm(it[k]) !== String(b ?? ''))).map(([k]) => k);
        if (wrong.length) bad.push(`${it.name}: ${wrong.join(', ')} differ from SAP`); else okItems += 1;
        if (si.InventoryItem === 'tYES' && !skipped.has(code) && (!want.disabled || zeroFirst.some((z) => z.code === code))) {
          const e = b2.get(it.name) || 0;
          if (Math.abs(e - num(si.QuantityOnStock)) > 1e-6) bad.push(`${it.name}: ERPNext store holds ${e}, SAP ${si.QuantityOnStock}`); else okStock += 1;
        }
      }
      result.verify = { itemsMatching: okItems, stockMatching: okStock, problems: bad };
      log(bad.length ? 'ERROR' : 'INFO', `verify: ${okItems} of ${sapItems.length} items match SAP field for field, ${okStock} stock figures match${bad.length ? `; ${bad.length} problem(s): ${bad.slice(0, 10).join(' | ')}` : '; no problems'}`);
      if (bad.length) exit = 1;
    }
    if (result.failures.length) exit = 1;
  } catch (e) {
    exit = 1; result.fatal = e.message; log('ERROR', `fatal: ${e.message}`);
  } finally {
    try {
      const out = path.join(LOG_DIR, `mrppl-pull-${APPLY ? 'result' : 'dryrun'}-${RUN}.json`);
      fs.writeFileSync(out, JSON.stringify(result, null, 1));
      log('INFO', `${APPLY ? 'RESULT' : 'DRY RUN'}: added ${result.new.length}, updated ${result.update.length}, disabled ${result.disable.length}, stock parts ${result.stock.length}, failures ${result.failures.length} -> ${path.basename(out)}`);
    } catch (e) { console.error(`result file: ${e.message}`); }
    await logout();
  }
  process.exit(exit);
})();
