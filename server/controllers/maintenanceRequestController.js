import * as requests from "../repository/maintenanceRequests.js";
import { scopeFor, withinScope } from "../repository/plantScope.js";
import { describeRequestStages } from "../integrations/erpnext/maintenanceRequestStages.js";

/**
 * Maintenance requests, for the web dashboard.
 *
 * The planned side of Module 2: fabrication, preventive jobs, scheduled
 * routines and improvements. Web only, like the rest of the module — nothing
 * here is shaped for the tablets.
 *
 * Raising is open to every signed-in role, on the same reasoning that lets
 * anybody report a breakdown: restricting who may ask for work is the surest
 * way to have the asking happen on the phone instead, where nobody can count
 * it. What is restricted is doing the work and closing the request.
 */

/** Turns an ERPNext refusal into something the screen can show. */
const fail = (res, error, fallback = "Something went wrong") => {
  if (error?.status === 403) {
    return res.status(403).json({
      message: "Your ERPNext role does not allow that step.",
      detail: error.message,
    });
  }
  if (error?.status === 417) {
    // A workflow refusing a transition, almost always. Its message names the
    // states involved, which is more use than anything this layer could add.
    return res.status(400).json({ message: error.message });
  }
  /**
   * The doctype is not in ERPNext yet.
   *
   * Worth naming, because the generic 500 sends somebody looking at the server
   * when the answer is a migration nobody has run. This screen is new and the
   * record behind it has to be pushed before anything on it can work.
   */
  if (error?.status === 404 && /DocType|not found/i.test(error.message || "")) {
    return res.status(503).json({
      message:
        "Maintenance requests are not set up in ERPNext yet. Run " +
        '"npm run erp:sync-requests" on the server.',
    });
  }
  // A refusal this code raised itself, not one ERPNext sent back. Without this
  // it falls through to a generic 500 and its own message — the one the reader
  // can act on — is swallowed.
  if (!error?.status) return res.status(400).json({ message: error.message });

  console.error(`${fallback}:`, error.message);
  return res.status(500).json({ message: fallback });
};

/**
 * A plant head runs one site; everyone else works across the group.
 *
 * Which roles are confined is stated once, in config/access.js — this used to
 * name the role here, which meant adding a management role was two edits and
 * the second one was easy to miss.
 */

/**
 * @desc    The request queue, most urgent first
 * @route   GET /api/maintenance-requests
 * @access  Private
 */
export const list = async (req, res) => {
  try {
    const rows = await requests.listRequests({
      onlyPlants: (await scopeFor(req.user)).plants,
      plant: req.query.plant || "",
      state: req.query.state || "",
      type: req.query.type || "",
      open: req.query.open === "true",
      // "Only the ones I raised" — the view somebody watching for their own
      // work to be finished actually wants.
      mine: req.query.mine === "true" ? req.user.email : "",
      limit: Math.min(Number(req.query.limit) || 200, 400),
    });

    res.json({ rows, summary: requests.requestSummary(rows) });
  } catch (error) {
    fail(res, error, "Could not load maintenance requests");
  }
};

/**
 * @desc    One request in full
 * @route   GET /api/maintenance-requests/:id
 * @access  Private
 */
export const detail = async (req, res) => {
  try {
    const request = await requests.getRequest(req.params.id);

    // A request on somebody else's plant is not in this reader's queue, so it
    // is missing rather than forbidden — the same answer an unknown id gets.
    if (!request || !withinScope(await scopeFor(req.user), request.plant)) {
      return res.status(404).json({ message: "Request not found" });
    }
    res.json(request);
  } catch (error) {
    fail(res, error, "Could not load that request");
  }
};

/**
 * @desc    Raise a request
 * @route   POST /api/maintenance-requests
 * @access  Private
 */
export const raise = async (req, res) => {
  const {
    title,
    requestType,
    machine,
    plant,
    area,
    whatIsNeeded,
    whyNeeded,
    priority,
    neededBy,
    productionAffected,
  } = req.body || {};

  try {
    const created = await requests.raiseRequest({
      title,
      requestType,
      machine,
      plant,
      area,
      whatIsNeeded,
      whyNeeded,
      priority,
      neededBy,
      productionAffected,
      // From the session, never the body: who raised a request decides who may
      // close it, so it is not something the sender should be able to choose.
      requestedBy: req.user.email,
    });
    res.status(201).json(created);
  } catch (error) {
    if (!error.status) return res.status(400).json({ message: error.message });
    fail(res, error, "Could not raise the request");
  }
};

/**
 * @desc    Save this stage's details and move the request on
 * @route   POST /api/maintenance-requests/:id/action
 * @access  Private
 *
 * One call, not two — the same rule the breakdown record settled on. A save
 * that does not advance leaves a half-filled form nobody is prompted to finish.
 */
export const act = async (req, res) => {
  const { action, fields } = req.body || {};
  if (!action) return res.status(400).json({ message: "An action is required" });

  try {
    res.json(await requests.saveAndAdvanceRequest(req.params.id, action, fields || {}, req.user));
  } catch (error) {
    if (error.forbidden) return res.status(403).json({ message: error.message });
    if (error.incomplete) {
      return res.status(422).json({ message: error.message, missing: error.missing });
    }
    if (!error.status) return res.status(400).json({ message: error.message });
    fail(res, error, "Could not move the request on");
  }
};

/**
 * @desc    What each stage collects and will not move without
 * @route   GET /api/maintenance-requests/stages
 * @access  Private
 *
 * Served rather than duplicated in the client, so the fields a form marks
 * required cannot drift from the ones the server actually enforces.
 */
export const stages = async (_req, res) => {
  res.json(describeRequestStages());
};

/**
 * @desc    Attach the signed log sheet
 * @route   POST /api/maintenance-requests/:id/files
 */
export const attach = async (req, res) => {
  try {
    res.status(201).json(await requests.attachToRequest(req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error, "Could not attach the file");
  }
};

/** @route DELETE /api/maintenance-requests/:id/files/:fileId */
export const detach = async (req, res) => {
  try {
    res.json(await requests.detachFromRequest(req.params.id, req.params.fileId));
  } catch (error) {
    fail(res, error, "Could not remove the file");
  }
};

/**
 * @desc    The maintenance head confirms he has seen the signed sheet
 * @route   POST /api/maintenance-requests/:id/verify
 */
export const verify = async (req, res) => {
  try {
    res.json(
      await requests.verifyRequestLogSheet(req.params.id, {
        verified: req.body?.verified !== false,
        user: req.user,
      })
    );
  } catch (error) {
    fail(res, error, "Could not record the verification");
  }
};
