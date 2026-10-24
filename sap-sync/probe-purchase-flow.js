// Purchase-flow probe for the CMMS purchase workflow update (23 Oct 2026). TEST COMPANY ONLY.
//
//   node probe-purchase-flow.js                         dry run: reads SAP, writes nothing, prints what it would post
//   node probe-purchase-flow.js --apply --confirm-company HITECH_RUBBER            posts the test documents
//   node probe-purchase-flow.js --apply --confirm-company HITECH_RUBBER --cleanup same, then cancels what it posted (GRPOs, PO, quotation) and closes the PR
//
//   --company NAME    SAP CompanyDB to use (default HITECH_RUBBER, the test database). A name containing LIVE is refused.
//   --confirm-company NAME   required with --apply, and must equal the company: a posting run cannot start by accident
//
//   --item CODE       test item (default: first active stock item on a manual UoM group)
//   --vendor CODE     test supplier (default: first active supplier)
//   --warehouse CODE  default: the item's default warehouse, else 01
//   --uom NAME        vendor UoM name for the lines (default: a SAP UoM called Drum / Box / Bag, else the first UoM)
//   --tax CODE        TaxCode to put on every line, if the demo company refuses lines without one
//   --config PATH     default C:\Users\eldhose\sap-engineering-sync\config.json (sap.url / username / password)
//
// Run it on the SAP server with that machine's own SAP login. Nothing is written without --apply and a matching
// --confirm-company, and a CompanyDB with LIVE in its name is refused. It answers tests 1-6 of "SAP demo test plan" in the plan doc:
//
//   1  vendor UoM on the lines   (MeasureUnit + UnitsOfMeasurment = "UoM Name" and "Items per Unit" of a manual-UoM item)
//   2  bill price on a GRPO      (GRPO line priced differently from its PO line)
//   3  price / quantity precision(inventory qty 59.4, unit cost 444.444...)
//   4  document chain            (PR -> Purchase Quotation -> PO, base types 1470000113 / 540000006)
//   5  partial receipts          (two GRPOs against one PO line)
//   6  re-run safety             (find the quotation again by Reference2)
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt; };
const APPLY = args.includes('--apply');
const CLEANUP = args.includes('--cleanup');
const COMPANY_DB = opt('--company', 'HITECH_RUBBER'); // the test database
if (/live/i.test(COMPANY_DB)) { console.error(`Refusing ${COMPANY_DB}: a company with LIVE in its name is not a test database.`); process.exit(2); }
if (APPLY && opt('--confirm-company', '') !== COMPANY_DB) { console.error(`--apply needs --confirm-company ${COMPANY_DB} (it must match the company the run will write to).`); process.exit(2); }
const CONFIG = opt('--config', 'C:\\Users\\eldhose\\sap-engineering-sync\\config.json');
const LOG_DIR = path.join(path.dirname(CONFIG), 'logs');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // self-signed certificate on the SAP server
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8').replace(/^\uFEFF/, ''));
for (const k of ['url', 'username', 'password']) if (!String(cfg.sap?.[k] ?? '').trim()) { console.error(`config sap.${k} missing in ${CONFIG}`); process.exit(2); }
const BASE = String(cfg.sap.url).replace(/\/+$/, '');

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const due = new Date(now.getTime() + 7 * 864e5);
const DUE = `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`;
const STAMP = `ZT${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`; // 10 chars
const snippet = (t) => String(t ?? '').replace(/\s+/g, ' ').slice(0, 400);

let cookie = ''; let loggedIn = false;
const http = async (method, p, body) => {
  const url = /^https?:/i.test(p) ? p : `${BASE}/${p}`;
  const h = { Accept: 'application/json', Prefer: 'odata.maxpagesize=200' };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json, text, cookies: typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [] };
};
const q = (s) => s.replace(/ /g, '%20').replace(/'/g, '%27');
const login = async () => {
  const r = await http('POST', 'Login', { CompanyDB: COMPANY_DB, UserName: cfg.sap.username, Password: cfg.sap.password });
  if (r.status !== 200) throw new Error(`login to ${COMPANY_DB} failed: HTTP ${r.status} ${snippet(r.text)}`);
  const jar = {};
  for (const c of r.cookies) { const m = c.match(/^(B1SESSION|ROUTEID)=([^;]+)/); if (m) jar[m[1]] = m[2]; }
  if (!jar.B1SESSION) throw new Error('login returned no B1SESSION cookie');
  cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  loggedIn = true;
};
const logout = async () => { if (loggedIn) { try { await http('POST', 'Logout'); } catch { /* ignore */ } loggedIn = false; } };

const results = [];
const record = (test, what, ok, detail) => {
  results.push({ test, what, ok, detail });
  console.log(`[T${test}] ${ok === null ? 'INFO' : ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' - ' + detail : ''}`);
};
const sapMsg = (r) => { const m = r.json?.error?.message?.value || r.json?.error?.message || r.text; return `HTTP ${r.status} ${snippet(m)}`; };
const created = { pr: null, pq: null, po: null, grpo: [] };

const lineSummary = (l) => `item ${l.ItemCode} qty ${l.Quantity} invQty ${l.InventoryQuantity} price ${l.UnitPrice ?? l.Price} lineTotal ${l.LineTotal} uom '${l.MeasureUnit ?? ''}' perUnit ${l.UnitsOfMeasurment}`;
const readDoc = async (entity, entry) => {
  const r = await http('GET', `${entity}(${entry})`);
  return r.status === 200 ? r.json : null;
};
const stockOf = async (item, wh) => {
  const r = await http('GET', `Items('${encodeURIComponent(item)}')?$select=ItemCode,ItemWarehouseInfoCollection`);
  if (r.status !== 200) return null;
  const w = (r.json.ItemWarehouseInfoCollection || []).find((x) => String(x.WarehouseCode) === String(wh));
  return w ? { inStock: Number(w.InStock), avg: Number(w.StandardAveragePrice) } : null;
};

(async () => {
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} against ${COMPANY_DB} at ${BASE} (stamp ${STAMP})`);
  await login();
  try {
    // ---------------- discovery (read only)
    const uoms = (await http('GET', 'UnitOfMeasurements?$select=Code,Name,AbsEntry&$top=60')).json?.value || [];
    record(1, `SAP UoM list (${uoms.length} read): ${uoms.slice(0, 15).map((u) => u.Code).join(', ')}`, null);
    const groups = (await http('GET', 'UnitOfMeasurementGroups?$select=AbsEntry,Code,Name&$top=30')).json?.value || [];
    record(1, `UoM groups in this company: ${groups.map((g) => g.Code).join(', ') || 'none'}`, null);

    const itemCode = opt('--item', '');
    let item;
    if (itemCode) {
      const r = await http('GET', `Items('${encodeURIComponent(itemCode)}')?$select=ItemCode,ItemName,InventoryUOM,UoMGroupEntry,DefaultWarehouse,ManageStockByWarehouse`);
      if (r.status !== 200) throw new Error(`item ${itemCode}: ${sapMsg(r)}`);
      item = r.json;
    } else {
      const r = await http('GET', q(`Items?$select=ItemCode,ItemName,InventoryUOM,UoMGroupEntry,DefaultWarehouse,ManageStockByWarehouse&$filter=Valid eq 'tYES' and InventoryItem eq 'tYES' and UoMGroupEntry eq -1&$top=1`));
      item = r.json?.value?.[0];
      if (!item) throw new Error('no active stock item on a manual UoM group found - pass --item CODE');
    }
    const warehouse = opt('--warehouse', item.DefaultWarehouse || '01');
    record(1, `test item ${item.ItemCode} "${item.ItemName}", inventory UoM ${item.InventoryUOM}, UoM group ${item.UoMGroupEntry} (-1 = manual), warehouse ${warehouse}`, null);

    let vendor = opt('--vendor', '');
    if (!vendor) {
      const r = await http('GET', q(`BusinessPartners?$select=CardCode,CardName&$filter=CardType eq 'cSupplier' and Valid eq 'tYES'&$top=1`));
      vendor = r.json?.value?.[0]?.CardCode;
      if (!vendor) throw new Error('no active supplier found - pass --vendor CODE');
    }
    record(4, `test supplier ${vendor}`, null);

    const vendorUom = opt('--uom', (uoms.find((u) => /^(drum|box|bag)$/i.test(String(u.Code))) || uoms.find((u) => u.Code !== item.InventoryUOM) || { Code: 'Drum' }).Code);
    record(1, `vendor UoM used on the lines: ${vendorUom}`, null);

    const admin = await http('POST', 'CompanyService_GetAdminInfo', {});
    const decimals = admin.status === 200 ? Object.entries(admin.json || {}).filter(([k]) => /price|decimal|accura|precis/i.test(k)).map(([k, v]) => `${k}=${v}`).join(', ') : sapMsg(admin);
    record(3, `company decimal settings: ${decimals || 'not exposed'}`, null);

    const tax = opt('--tax', '');
    const withTax = (l) => (tax ? { ...l, TaxCode: tax } : l);
    const before = await stockOf(item.ItemCode, warehouse);
    record(3, `stock before: ${before ? `${before.inStock} on hand, average price ${before.avg}` : 'no warehouse row'}`, null);

    // Plan: 100 inventory units = 5 Drum at 20 per Drum, 8,500 per Drum.
    // GRPO 1: bill for 3 Drum at 8,800, counted 59.4 -> 19.8 per Drum, value 26,400. GRPO 2: the last 2 Drum at 8,500, 20 per Drum.
    const planned = {
      PR: { DocDate: TODAY, RequriedDate: DUE, ReqType: 171, ReqCode: cfg.pr_requester || cfg.sap.username, Reference2: STAMP, Comments: 'PROBE - purchase workflow test, safe to cancel', DocumentLines: [{ ItemCode: item.ItemCode, Quantity: 100, RequiredDate: DUE, WarehouseCode: warehouse }] },
    };
    if (!APPLY) {
      console.log('\nDry run - would post, in order:');
      console.log(' 1. PurchaseRequests            100 x ' + item.ItemCode);
      console.log(` 2. PurchaseQuotations          based on the PR line, 5 ${vendorUom} at 8500, 20 per ${vendorUom}, Reference2 ${STAMP}`);
      console.log(` 3. PurchaseOrders              based on the quotation line (BaseType 540000006), same quantity and price`);
      console.log(` 4. PurchaseDeliveryNotes (1)   based on the PO line (BaseType 22), 3 ${vendorUom} at 8800, 19.8 per ${vendorUom} (expect inventory qty 59.4, value 26400)`);
      console.log(` 5. PurchaseDeliveryNotes (2)   2 ${vendorUom} at 8500, 20 per ${vendorUom}; the PO should then close`);
      console.log('Run with --apply to post them.');
      return;
    }

    // ---------------- PR
    let r = await http('POST', 'PurchaseRequests', planned.PR);
    if (r.status !== 201 && r.status !== 200) { record(4, 'post Purchase Request', false, sapMsg(r)); return; }
    created.pr = { entry: r.json.DocEntry, num: r.json.DocNum };
    record(4, `Purchase Request ${created.pr.num} posted`, true);

    // ---------------- Purchase Quotation based on the PR line, in vendor UoM (tests 1 and 4)
    const manual = (qty, price, perUnit) => ({ Quantity: qty, UnitPrice: price, MeasureUnit: vendorUom, UnitsOfMeasurment: perUnit });
    // RequriedDate (SAP's spelling): a quotation without it is refused, "Specify the required date [OINV.ReqDate]".
    r = await http('POST', 'PurchaseQuotations', {
      CardCode: vendor, DocDate: TODAY, DocDueDate: DUE, RequriedDate: DUE, Reference2: STAMP, Comments: 'PROBE - purchase workflow test, safe to cancel',
      DocumentLines: [withTax({ BaseType: 1470000113, BaseEntry: created.pr.entry, BaseLine: 0, WarehouseCode: warehouse, ...manual(5, 8500, 20) })],
    });
    if (r.status !== 201 && r.status !== 200) {
      record(4, 'Purchase Quotation based on the PR line', false, sapMsg(r));
      // Retry without the vendor-UoM fields, to tell a chain problem from a UoM problem.
      const r2 = await http('POST', 'PurchaseQuotations', { CardCode: vendor, DocDate: TODAY, DocDueDate: DUE, RequriedDate: DUE, Reference2: STAMP + 'b', DocumentLines: [withTax({ BaseType: 1470000113, BaseEntry: created.pr.entry, BaseLine: 0, Quantity: 100, UnitPrice: 425, WarehouseCode: warehouse })] });
      record(1, 'quotation WITHOUT vendor UoM fields', r2.status === 201 || r2.status === 200, r2.status === 201 || r2.status === 200 ? `posted as ${r2.json.DocNum} - so the chain works and the vendor-UoM fields are what SAP refused` : sapMsg(r2));
      if (r2.status === 201 || r2.status === 200) created.pq = { entry: r2.json.DocEntry, num: r2.json.DocNum, plain: true };
      return;
    }
    created.pq = { entry: r.json.DocEntry, num: r.json.DocNum };
    const pq = await readDoc('PurchaseQuotations', created.pq.entry);
    const pql = pq?.DocumentLines?.[0] || {};
    record(4, `Purchase Quotation ${created.pq.num} posted from the PR line`, true);
    record(1, `quotation line read back: ${lineSummary(pql)}`, Number(pql.InventoryQuantity) === 100 && Number(pql.Quantity) === 5, 'expect qty 5, inventory qty 100');

    const found = await http('GET', q(`PurchaseQuotations?$select=DocEntry,DocNum&$filter=Reference2 eq '${STAMP}'`));
    record(6, 'find the quotation again by Reference2', (found.json?.value || []).length === 1, `${(found.json?.value || []).length} found`);

    // ---------------- PO based on the quotation line
    r = await http('POST', 'PurchaseOrders', {
      CardCode: vendor, DocDate: TODAY, TaxDate: TODAY, DocDueDate: DUE, Reference2: STAMP, Comments: 'PROBE - purchase workflow test, safe to cancel',
      DocumentLines: [withTax({ BaseType: 540000006, BaseEntry: created.pq.entry, BaseLine: 0, Quantity: 5, UnitPrice: 8500 })],
    });
    if (r.status !== 201 && r.status !== 200) { record(4, 'Purchase Order based on the quotation line', false, sapMsg(r)); return; }
    created.po = { entry: r.json.DocEntry, num: r.json.DocNum };
    const po = await readDoc('PurchaseOrders', created.po.entry);
    const pol = po?.DocumentLines?.[0] || {};
    record(4, `Purchase Order ${created.po.num} posted from the quotation line`, true);
    record(1, `PO line read back: ${lineSummary(pol)}`, Number(pol.InventoryQuantity) === 100, 'expect qty 5, inventory qty 100');
    const pqAfter = await readDoc('PurchaseQuotations', created.pq.entry);
    record(4, `quotation line status after the PO: ${pqAfter?.DocumentLines?.[0]?.LineStatus}, document ${pqAfter?.DocumentStatus}`, null);

    // ---------------- GRPO 1: bill 3 at 8,800, counted 59.4 (19.8 per vendor unit)
    r = await http('POST', 'PurchaseDeliveryNotes', {
      CardCode: vendor, DocDate: TODAY, TaxDate: TODAY, NumAtCard: `${STAMP}-1`, Reference2: STAMP, Comments: 'PROBE - purchase workflow test, safe to cancel',
      DocumentLines: [withTax({ BaseType: 22, BaseEntry: created.po.entry, BaseLine: 0, WarehouseCode: warehouse, ...manual(3, 8800, 19.8) })],
    });
    if (r.status !== 201 && r.status !== 200) {
      record(2, 'GRPO with a changed price and a different items-per-unit', false, sapMsg(r));
      // Isolate which of the two SAP refused.
      const rp = await http('POST', 'PurchaseDeliveryNotes', { CardCode: vendor, DocDate: TODAY, TaxDate: TODAY, NumAtCard: `${STAMP}-1p`, Reference2: STAMP + 'p', DocumentLines: [withTax({ BaseType: 22, BaseEntry: created.po.entry, BaseLine: 0, WarehouseCode: warehouse, Quantity: 3, UnitPrice: 8800 })] });
      record(2, 'GRPO with the changed price only (ratio left as on the PO)', rp.status === 201 || rp.status === 200, rp.status === 201 || rp.status === 200 ? `posted as ${rp.json.DocNum}` : sapMsg(rp));
      if (rp.status === 201 || rp.status === 200) created.grpo.push({ entry: rp.json.DocEntry, num: rp.json.DocNum });
      record(1, 'the ratio change on the GRPO line is what SAP refused, if the price-only GRPO posted and this one did not', null);
      return;
    }
    created.grpo.push({ entry: r.json.DocEntry, num: r.json.DocNum });
    const g1 = await readDoc('PurchaseDeliveryNotes', created.grpo[0].entry);
    const g1l = g1?.DocumentLines?.[0] || {};
    record(2, `GRPO ${created.grpo[0].num} posted at 8,800 against a 8,500 PO line: ${lineSummary(g1l)}`, Number(g1l.UnitPrice) === 8800 && Math.abs(Number(g1l.LineTotal) - 26400) < 0.01, 'expect line total 26400');
    record(1, `GRPO inventory quantity ${g1l.InventoryQuantity} (expect 59.4: 3 x 19.8 per unit)`, Math.abs(Number(g1l.InventoryQuantity) - 59.4) < 1e-6);
    const after1 = await stockOf(item.ItemCode, warehouse);
    record(3, `stock after GRPO 1: ${after1 ? `${after1.inStock} on hand (was ${before ? before.inStock : '?'}), average price ${after1.avg}` : 'no warehouse row'}`,
      after1 && before ? Math.abs(after1.inStock - before.inStock - 59.4) < 1e-6 : null, 'expect +59.4; unit cost should be about 444.4444');
    const poMid = await readDoc('PurchaseOrders', created.po.entry);
    record(5, `PO after GRPO 1: ${poMid?.DocumentStatus}, line open qty ${poMid?.DocumentLines?.[0]?.RemainingOpenQuantity} (expect 2)`, Number(poMid?.DocumentLines?.[0]?.RemainingOpenQuantity) === 2);

    // ---------------- GRPO 2: the last 2 at the PO price, 20 per unit
    r = await http('POST', 'PurchaseDeliveryNotes', {
      CardCode: vendor, DocDate: TODAY, TaxDate: TODAY, NumAtCard: `${STAMP}-2`, Reference2: STAMP + 'g', Comments: 'PROBE - purchase workflow test, safe to cancel',
      DocumentLines: [withTax({ BaseType: 22, BaseEntry: created.po.entry, BaseLine: 0, WarehouseCode: warehouse, ...manual(2, 8500, 20) })],
    });
    if (r.status !== 201 && r.status !== 200) { record(5, 'second GRPO against the same PO line', false, sapMsg(r)); return; }
    created.grpo.push({ entry: r.json.DocEntry, num: r.json.DocNum });
    const poEnd = await readDoc('PurchaseOrders', created.po.entry);
    record(5, `PO after GRPO 2: ${poEnd?.DocumentStatus}, line open qty ${poEnd?.DocumentLines?.[0]?.RemainingOpenQuantity} (expect closed, 0)`, poEnd?.DocumentStatus === 'bost_Close' && Number(poEnd?.DocumentLines?.[0]?.RemainingOpenQuantity) === 0);
  } finally {
    if (APPLY && CLEANUP) {
      console.log('\nCleanup:');
      for (const g of [...created.grpo].reverse()) { const c = await http('POST', `PurchaseDeliveryNotes(${g.entry})/Cancel`); console.log(`  GRPO ${g.num}: ${c.status === 204 || c.status === 200 ? 'cancelled' : sapMsg(c)}`); }
      if (created.po) { const c = await http('POST', `PurchaseOrders(${created.po.entry})/Cancel`); console.log(`  PO ${created.po.num}: ${c.status === 204 || c.status === 200 ? 'cancelled' : sapMsg(c)}`); }
      if (created.pq) { const c = await http('POST', `PurchaseQuotations(${created.pq.entry})/Cancel`); console.log(`  quotation ${created.pq.num}: ${c.status === 204 || c.status === 200 ? 'cancelled' : sapMsg(c)}`); }
      if (created.pr) { const c = await http('POST', `PurchaseRequests(${created.pr.entry})/Close`); console.log(`  PR ${created.pr.num}: ${c.status === 204 || c.status === 200 ? 'closed' : sapMsg(c)}`); }
    }
    await logout();
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      const file = path.join(LOG_DIR, `probe-purchase-flow-${STAMP}.json`);
      fs.writeFileSync(file, JSON.stringify({ company: COMPANY_DB, apply: APPLY, stamp: STAMP, created, results }, null, 2));
      console.log(`\nResults written to ${file}`);
    } catch (e) { console.log(`could not write the results file: ${e.message}`); }
  }
})().catch(async (e) => { console.error('\nERROR:', e.message); await logout(); process.exit(1); });
