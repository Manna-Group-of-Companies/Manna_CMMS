import {
  ERP_TIMEOUT_MS,
  erpAuthHeader,
  erpBaseUrl,
  erpHasCredentials,
} from "./config.js";

/**
 * The only place in this server that speaks to ERPNext over the wire.
 *
 * Everything above it — repositories, controllers, the sync worker — goes
 * through these functions, so retry behaviour, error shapes and authentication
 * are decided once rather than in forty call sites.
 *
 * Frappe's generic `/api/resource` routes cover almost everything the CMMS
 * needs, which is why there is no custom Frappe endpoint to keep in step with
 * an ERPNext upgrade. `callMethod` is the escape hatch for the few operations
 * that are methods rather than documents — login, submit, cancel.
 */

/**
 * An ERPNext call that failed.
 *
 * `retryable` is what the sync worker acts on: a timeout or a 502 will very
 * likely succeed next pass, while a validation error fails identically forever
 * and should not consume attempts.
 */
export class ErpError extends Error {
  constructor(message, { status = null, retryable = false, body = null, code = "" } = {}) {
    super(message);
    this.name = "ErpError";
    this.status = status;
    this.retryable = retryable;
    this.body = body;
    /**
     * A machine-readable tag for the few cases a caller must tell apart.
     *
     * Status alone is not enough during sign-in: a 401 from the person's own
     * password and a 401 from this server's API key are the same number and
     * mean opposite things - one is the user's problem, the other is ours.
     */
    this.code = code;
  }

  /** True when ERPNext refused on permissions rather than on the data. */
  get isPermissionError() {
    return this.status === 403;
  }

  /** True when the credentials themselves were rejected. */
  get isAuthError() {
    return this.status === 401;
  }
}

/**
 * Who a call is made as.
 *
 * Two ways in. The integration account holds an API key and secret and is what
 * every background job uses. A signed-in person is carried by their Frappe
 * session id, so ERPNext applies that user's own permissions and records them
 * as the author rather than attributing the whole store to one robot.
 */
export const asIntegration = () => ({ kind: "integration" });
export const asUser = (sid) => ({ kind: "user", sid });

/**
 * Frappe reports business-rule failures as an exception type in the body, and
 * the useful part is usually buried in `_server_messages` — a JSON string
 * holding an array of JSON strings. Unwrapping it is what turns
 * "417 Expectation Failed" into "Could not find Warehouse Type: Stores".
 */
const readFrappeError = (body) => {
  if (!body || typeof body !== "object") return "";

  const messages = [];
  try {
    for (const raw of JSON.parse(body._server_messages || "[]")) {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (parsed?.message) messages.push(String(parsed.message));
    }
  } catch {
    // Malformed _server_messages is not worth failing over; the exception
    // field below still says something useful.
  }

  if (messages.length > 0) return messages.join("; ");
  if (body.exception) return String(body.exception);
  if (typeof body.message === "string") return body.message;
  return "";
};

/**
 * A 5xx, a timeout or a dropped connection is worth another go. A 4xx is the
 * request being wrong, and repeating it only burns attempts — except 417,
 * which is how Frappe reports a stale timestamp, and that a refetch does fix.
 */
const isRetryable = (status, body) => {
  if (status === null) return true;
  if (status >= 500 || status === 429) return true;
  if (status === 417) return String(body?.exc_type || "") === "TimestampMismatchError";
  return false;
};

/** Query values are JSON except plain strings, which Frappe wants raw. */
const toQuery = (query) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  return params.toString();
};

/**
 * Refuses a call this server cannot possibly authenticate, per actor.
 *
 * A call made as a signed-in person needs only the address — their session is
 * the credential. Only a call made as the integration account needs the API
 * key. Checking the stricter condition for both is what made signing in fail
 * on an install where the background sync had never been configured.
 */
const ensureUsable = (as) => {
  if (!erpBaseUrl()) {
    throw new ErpError("ERPNEXT_URL is not set on this server", { retryable: false });
  }
  if (as?.kind !== "user" && as?.kind !== "none" && !erpHasCredentials()) {
    throw new ErpError(
      "ERPNEXT_API_KEY and ERPNEXT_API_SECRET are not set, so this server cannot act on its own behalf",
      { retryable: false }
    );
  }
};

const authHeaders = (as) => {
  // Login carries its credentials in the body and must send none in the
  // headers. Attaching the integration token here would either authenticate
  // the call as the robot regardless of the password given, or — when the
  // integration key is not configured yet — send a malformed `token :` and
  // fail a password that was perfectly good.
  if (as?.kind === "none") return {};

  if (as?.kind === "user") {
    if (!as.sid) throw new ErpError("No session for this user", { status: 401 });
    return { Cookie: `sid=${as.sid}` };
  }
  return { Authorization: erpAuthHeader() };
};

/**
 * One HTTP call to ERPNext.
 *
 * `skipConfigCheck` exists for login, which has to run before the caller can
 * possibly hold a session, and which is itself how a session is obtained.
 */
export const request = async (
  method,
  path,
  { body = null, query = null, as = asIntegration(), raw = false, skipConfigCheck = false } = {}
) => {
  if (!skipConfigCheck) ensureUsable(as);

  let url = `${erpBaseUrl()}${path}`;
  const qs = query ? toQuery(query) : "";
  if (qs) url += `?${qs}`;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...authHeaders(as),
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      // AbortSignal.timeout rather than a manual timer: it rejects the fetch
      // itself, so a hung socket cannot hold a request open indefinitely.
      signal: AbortSignal.timeout(ERP_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ErpError(`ERPNext unreachable: ${error.message}`, { retryable: true });
  }

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // ERPNext answers HTML on some failures — a login redirect, or a 502 from
    // the proxy in front of it. Keeping the raw text in the message is what
    // makes that diagnosable rather than a bare status code.
    parsed = null;
  }

  if (!response.ok) {
    const detail =
      readFrappeError(parsed) || (text ? text.slice(0, 300) : response.statusText);
    throw new ErpError(`ERPNext ${response.status}: ${detail}`, {
      status: response.status,
      retryable: isRetryable(response.status, parsed),
      body: parsed,
    });
  }

  // Login needs the response headers, for the session cookie.
  if (raw) return { body: parsed, headers: response.headers };

  return parsed?.data ?? parsed?.message ?? parsed;
};

/**
 * Uploads a file and attaches it to a document.
 *
 * Separate from `request` because this one is multipart, not JSON — so it must
 * not set a Content-Type of its own. `fetch` derives the multipart boundary
 * from the FormData body, and a hand-set header would produce a boundary that
 * does not match the body and a parse failure at the far end that reads like a
 * corrupt file.
 *
 * `is_private` is deliberately on. A machine drawing is not something to serve
 * from a guessable public URL.
 */
export const uploadFile = async (
  { buffer, fileName, contentType = "application/octet-stream", doctype, docname, isPrivate = true },
  { as = asIntegration() } = {}
) => {
  ensureUsable(as);

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType }), fileName);
  form.append("is_private", isPrivate ? "1" : "0");
  form.append("folder", "Home/Attachments");
  if (doctype) form.append("doctype", doctype);
  if (docname) form.append("docname", docname);

  let response;
  try {
    response = await fetch(`${erpBaseUrl()}/api/method/upload_file`, {
      method: "POST",
      headers: { ...authHeaders(as), Accept: "application/json" },
      body: form,
      // Longer than the usual call: this is uploading a manual, not asking a
      // question, and the default would abort a large one mid-flight.
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw new ErpError(`ERPNext unreachable: ${error.message}`, { retryable: true });
  }

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    throw new ErpError(
      `ERPNext ${response.status}: ${readFrappeError(parsed) || text.slice(0, 300)}`,
      { status: response.status, body: parsed }
    );
  }

  return parsed?.message ?? parsed;
};

// --- documents ---------------------------------------------------------

/** Create one document. Returns it, including the `name` ERPNext assigned. */
export const createDoc = (doctype, doc, { as } = {}) =>
  request("POST", `/api/resource/${encodeURIComponent(doctype)}`, { body: doc, as });

/** Fetch one document in full. */
export const getDoc = (doctype, name, { as } = {}) =>
  request(
    "GET",
    `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
    { as }
  );

/**
 * Change some fields of a document.
 *
 * A partial update, so only what is passed is touched. Sending the whole
 * document back would silently reapply every field the caller happened to be
 * holding, including any that changed underneath them.
 */
export const updateDoc = (doctype, name, fields, { as } = {}) =>
  request(
    "PUT",
    `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
    { body: fields, as }
  );

export const deleteDoc = (doctype, name, { as } = {}) =>
  request(
    "DELETE",
    `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
    { as }
  );

/**
 * List documents.
 *
 * `limit: 0` asks Frappe for everything, which is almost always a mistake
 * against a four-thousand-row catalog, so it is refused. Callers that really
 * want the lot use `listAll`, which pages.
 */
export const listDocs = async (
  doctype,
  { fields, filters, orFilters, limit = 20, start = 0, orderBy, as } = {}
) => {
  if (!limit || limit < 1) {
    throw new ErpError("A page length is required; use listAll to page through everything", {
      retryable: false,
    });
  }

  return request("GET", `/api/resource/${encodeURIComponent(doctype)}`, {
    query: {
      fields: fields || ["name"],
      filters: filters || undefined,
      or_filters: orFilters || undefined,
      order_by: orderBy || undefined,
      limit_page_length: String(limit),
      limit_start: String(start),
    },
    as,
  });
};

/**
 * Rows of a child table, across many parents at once.
 *
 * Frappe will not serve a child doctype from the ordinary list endpoint without
 * being told which parent doctype it belongs to — it has no permission rules of
 * its own and borrows its parent's, so without `parent` it refuses rather than
 * guesses.
 *
 * Worth having as its own call because the alternative is fetching every parent
 * document whole to read three rows out of each. Asking a machine "what have we
 * changed because of your failures" spans a year of breakdowns; one query
 * answers it, and forty document fetches would answer it slowly enough that
 * nobody would put it on the page.
 */
export const listChildRows = async (
  childDoctype,
  parentDoctype,
  { fields, filters, limit = 500, orderBy, as } = {}
) =>
  request("GET", `/api/resource/${encodeURIComponent(childDoctype)}`, {
    query: {
      fields: fields || ["name"],
      filters: filters || undefined,
      order_by: orderBy || undefined,
      limit_page_length: String(limit),
      parent: parentDoctype,
    },
    as,
  });

/**
 * Every matching document, fetched a page at a time.
 *
 * `max` is a guard rather than a preference: a filter that accidentally
 * matches everything should stop at a wall instead of pulling the entire
 * instance into memory one page at a time.
 */
export const listAll = async (doctype, { page = 500, max = 20_000, ...options } = {}) => {
  const rows = [];
  let start = 0;

  for (;;) {
    const batch = await listDocs(doctype, { ...options, limit: page, start });
    if (!Array.isArray(batch) || batch.length === 0) break;

    rows.push(...batch);
    if (batch.length < page || rows.length >= max) break;
    start += page;
  }
  return rows.slice(0, max);
};

/** How many documents match, without fetching them. */
export const countDocs = async (doctype, filters, { as } = {}) => {
  const result = await request("GET", "/api/method/frappe.client.get_count", {
    query: { doctype, filters: filters || [] },
    as,
  });
  return Number(result || 0);
};

/** True when a document with this exact name exists. */
export const docExists = async (doctype, name, { as } = {}) => {
  if (!name) return false;
  try {
    await getDoc(doctype, name, { as });
    return true;
  } catch (error) {
    if (error instanceof ErpError && error.status === 404) return false;
    throw error;
  }
};

// --- methods -----------------------------------------------------------

/** Call a whitelisted Frappe method. */
export const callMethod = (method, args = {}, { as, httpMethod = "POST" } = {}) =>
  request(httpMethod, `/api/method/${method}`, {
    ...(httpMethod === "GET" ? { query: args } : { body: args }),
    as,
  });

/**
 * Submit a draft, moving it to docstatus 1.
 *
 * Separate from `createDoc` because most CMMS documents are inserted already
 * submitted, in one call. This is for the few that are drafted first and
 * confirmed by a person afterwards.
 */
export const submitDoc = (doc, { as } = {}) =>
  callMethod("frappe.client.submit", { doc }, { as });

/**
 * Cancel a submitted document.
 *
 * The only way to undo one: ERPNext never edits a submitted document, it
 * cancels and amends. Anything in the CMMS that reads like an edit of posted
 * stock has to become this plus a fresh document.
 */
export const cancelDoc = (doctype, name, { as } = {}) =>
  callMethod("frappe.client.cancel", { doctype, name }, { as });

/** A one-call reachability check, for the boot log and the health route. */
export const ping = async ({ as } = {}) => {
  const start = Date.now();
  await listDocs("Company", { fields: ["name"], limit: 1, as });
  return { ok: true, ms: Date.now() - start };
};
