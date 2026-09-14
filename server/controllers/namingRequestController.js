import * as requests from "../repository/namingRequests.js";

/**
 * Item naming requests, for the web dashboard.
 *
 * The one request flow the store still has. Everything else — editing an item,
 * adding stock, issuing — happens directly, because those change a thing that
 * already exists. Naming creates one, and a name entering the catalog is what
 * every issue slip, every audit and eventually SAP will refer to it by.
 */

const fail = (res, error, fallback = "Something went wrong") => {
  if (error?.status === 403) {
    return res.status(403).json({
      message: "Your ERPNext role does not allow that step.",
      detail: error.message,
    });
  }
  if (error?.status === 417) {
    // A workflow refusing a transition. Its message names the states involved,
    // which is more use than anything this layer could add.
    return res.status(400).json({ message: error.message });
  }
  if (!error?.status) return res.status(400).json({ message: error.message });

  console.error(`${fallback}:`, error.message);
  return res.status(500).json({ message: fallback });
};

/**
 * @desc    Naming requests, newest first
 * @route   GET /api/naming-requests
 */
export const list = async (req, res) => {
  try {
    res.json(
      await requests.listRequests({
        state: req.query.state || "",
        open: req.query.open === "true",
        limit: Math.min(Number(req.query.limit) || 100, 300),
      })
    );
  } catch (error) {
    fail(res, error, "Could not load naming requests");
  }
};

/**
 * @desc    One request in full
 * @route   GET /api/naming-requests/:id
 */
export const detail = async (req, res) => {
  try {
    const found = await requests.getRequest(req.params.id);
    if (!found) return res.status(404).json({ message: "Request not found" });
    res.json(found);
  } catch (error) {
    fail(res, error, "Could not load that request");
  }
};

/**
 * @desc    Propose a name for something that has arrived
 * @route   POST /api/naming-requests
 */
export const raise = async (req, res) => {
  try {
    const created = await requests.raiseRequest({
      ...req.body,
      // From the session, never the body: who proposed a name is not something
      // the sender should be able to choose.
      raisedBy: req.user.email,
    });
    res.status(201).json(created);
  } catch (error) {
    fail(res, error, "Could not raise the request");
  }
};

/**
 * @desc    Edit a request that has not been decided yet
 * @route   PUT /api/naming-requests/:id
 */
export const update = async (req, res) => {
  try {
    res.json(await requests.updateRequest(req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error, "Could not save");
  }
};

/**
 * @desc    Approve, reject or reopen
 * @route   POST /api/naming-requests/:id/decide
 */
export const decide = async (req, res) => {
  const { action, note } = req.body || {};
  if (!["Approve", "Reject", "Reopen"].includes(action)) {
    return res.status(400).json({ message: "Approve, Reject or Reopen" });
  }

  try {
    res.json(
      await requests.decide(req.params.id, action, { note: note || "", user: req.user })
    );
  } catch (error) {
    fail(res, error, "Could not record the decision");
  }
};

/**
 * @desc    Record the SAP code an approved item was given
 * @route   POST /api/naming-requests/:id/sap
 *
 * Entered by hand for now. Nothing here can write to the SAP Service Layer
 * until the capability probe comes back, and a push that quietly did nothing
 * would be worse than one that refuses.
 */
export const recordSap = async (req, res) => {
  try {
    res.json(
      await requests.recordSapCode(req.params.id, {
        sapItemCode: req.body?.sapItemCode,
        response: req.body?.response || "entered by hand",
        user: req.user,
      })
    );
  } catch (error) {
    fail(res, error, "Could not record the SAP code");
  }
};
