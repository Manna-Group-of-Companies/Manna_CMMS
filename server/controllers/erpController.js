import ErpSyncOutbox from "../models/ErpSyncOutbox.js";
import ErpDriftReport from "../models/ErpDriftReport.js";
import Company from "../models/Company.js";
import { erpBaseUrl, erpDisabledReason, erpEnabled } from "../integrations/erpnext/config.js";
import { ping } from "../integrations/erpnext/client.js";
import { drainOutbox } from "../integrations/erpnext/worker.js";
import { invalidateWarehouseMap } from "../integrations/erpnext/warehouses.js";
import { runDriftCheck } from "../integrations/erpnext/driftRunner.js";

/**
 * @desc    Whether the sync is on, reachable, and keeping up
 * @route   GET /api/erp/status
 * @access  Admin
 */
export const getErpStatus = async (req, res) => {
  try {
    const counts = await ErpSyncOutbox.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const queue = { Pending: 0, Sent: 0, Failed: 0, Skipped: 0 };
    for (const row of counts) queue[row._id] = row.count;

    const companies = await Company.find({ isActive: true }).sort({ name: 1 });

    // Carried on the status payload so the ERP page shows drift without a
    // second request; the full lists live behind GET /api/erp/drift.
    const latestDrift = await ErpDriftReport.findOne().sort({ createdAt: -1 });

    let reachable = null;
    if (erpEnabled()) {
      try {
        reachable = await ping();
      } catch (error) {
        reachable = { ok: false, error: error.message };
      }
    }

    res.json({
      enabled: erpEnabled(),
      // Never the key or secret — only where this server is pointed.
      url: erpBaseUrl(),
      disabledReason: erpDisabledReason(),
      reachable,
      queue,
      drift: latestDrift
        ? {
            runAt: latestDrift.createdAt,
            compared: latestDrift.compared,
            driftCount: latestDrift.driftCount,
            summary: latestDrift.summary,
            error: latestDrift.error,
          }
        : null,
      companies: companies.map((company) => ({
        name: company.name,
        erpCompany: company.erpCompany,
        erpWarehouse: company.erpWarehouse,
        mapped: company.isErpMapped(),
      })),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    The jobs that gave up, so somebody can see why
 * @route   GET /api/erp/failures
 * @access  Admin
 */
export const getErpFailures = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    // Skipped rows are included: a movement the mapping had no document for is
    // not an error, but it is the thing to look at when a quantity in ERPNext
    // does not match the store.
    const jobs = await ErpSyncOutbox.find({ status: { $in: ["Failed", "Skipped"] } })
      .sort({ updatedAt: -1 })
      .limit(limit);

    res.json(
      jobs.map((job) => ({
        _id: job._id,
        status: job.status,
        entityId: job.entityId,
        doctype: job.doctype,
        attempts: job.attempts,
        lastError: job.lastError,
        stockEntryType: job.payload?.stock_entry_type || "",
        updatedAt: job.updatedAt,
      }))
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Put a failed job back in the queue
 * @route   PUT /api/erp/retry/:id
 * @access  Admin
 *
 * Only ever for a job that has no `erpDocName`. One that does was already
 * posted, and retrying it would move the stock in ERPNext a second time.
 */
export const retryErpJob = async (req, res) => {
  try {
    const job = await ErpSyncOutbox.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ message: "Sync job not found" });
    }
    if (job.erpDocName) {
      return res.status(400).json({
        message: `Already posted to ERPNext as ${job.erpDocName}; retrying would duplicate the stock`,
      });
    }
    if (job.status === "Sent") {
      return res.status(400).json({ message: "That job has already been sent" });
    }

    job.status = "Pending";
    job.attempts = 0;
    job.nextAttemptAt = new Date();
    job.lastError = "";
    await job.save();

    // A failure is usually a mapping that has since been corrected, so the
    // cached warehouse map would otherwise serve the stale answer for a minute.
    invalidateWarehouseMap();
    drainOutbox().catch(() => {});

    res.json({ message: "Queued for another attempt", _id: job._id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Recent drift reports, newest first
 * @route   GET /api/erp/drift
 * @access  Admin
 */
export const getErpDrift = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 60);
    const reports = await ErpDriftReport.find().sort({ createdAt: -1 }).limit(limit);
    res.json(reports);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Run the comparison now instead of waiting for tonight
 * @route   POST /api/erp/drift
 * @access  Admin
 *
 * Reads every balance on both sides, so it is a deliberate action rather than
 * something a page refresh should trigger.
 */
export const checkErpDrift = async (req, res) => {
  try {
    const report = await runDriftCheck();
    res.json(report);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
