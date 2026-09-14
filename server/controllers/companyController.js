import Company from "../models/Company.js";
import StockRoom from "../models/StockRoom.js";
import { resolveCompany } from "../utils/companies.js";

/**
 * The company as the client keeps it.
 *
 * `erpMapped` is computed rather than stored so the console can show at a
 * glance which companies the ERPNext sync will skip.
 */
const publicCompany = (company, roomCount = undefined) => ({
  _id: company._id,
  name: company.name,
  description: company.description,
  isActive: company.isActive,
  erpCompany: company.erpCompany,
  erpAbbr: company.erpAbbr,
  erpWarehouse: company.erpWarehouse,
  erpMapped: company.isErpMapped(),
  ...(roomCount === undefined ? {} : { roomCount }),
});

/**
 * @desc    List the companies, with how many rooms each holds
 * @route   GET /api/companies
 * @access  Admin, Supervisor
 */
export const getCompanies = async (req, res) => {
  try {
    // Retired companies are included only when asked for, so the pickers that
    // call this get live ones without having to filter.
    const filter = req.query.includeInactive === "true" ? {} : { isActive: true };

    const companies = await Company.find(filter).sort({ name: 1 });

    const counts = await StockRoom.aggregate([
      { $match: { company: { $ne: null } } },
      { $group: { _id: "$company", count: { $sum: 1 } } },
    ]);
    const byCompany = new Map(counts.map((row) => [String(row._id), row.count]));

    res.json(
      companies.map((company) =>
        publicCompany(company, byCompany.get(String(company._id)) || 0)
      )
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Create a company
 * @route   POST /api/companies
 * @access  Admin
 */
export const createCompany = async (req, res) => {
  const { name, description, erpCompany, erpAbbr, erpWarehouse } = req.body;

  try {
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "Company name is required" });
    }

    const taken = await Company.findOne({ name: String(name).trim() });
    if (taken) {
      return res.status(400).json({ message: "That company already exists" });
    }

    const company = await Company.create({
      name: String(name).trim(),
      description: description || "",
      erpCompany: erpCompany || "",
      erpAbbr: erpAbbr || "",
      erpWarehouse: erpWarehouse || "",
    });

    res.status(201).json(publicCompany(company, 0));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Update a company, including its ERPNext mapping
 * @route   PUT /api/companies/:id
 * @access  Admin
 *
 * The ERPNext fields are editable here on purpose. The mapping was not known
 * when the records were seeded, and requiring a redeploy to correct a
 * warehouse name would put a one-word fix behind a release.
 */
export const updateCompany = async (req, res) => {
  const { name, description, isActive, erpCompany, erpAbbr, erpWarehouse } = req.body;

  try {
    const company = await Company.findById(req.params.id);
    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) {
        return res.status(400).json({ message: "Company name cannot be blank" });
      }

      const taken = await Company.findOne({ name: trimmed, _id: { $ne: company._id } });
      if (taken) {
        return res.status(400).json({ message: "That company already exists" });
      }
      company.name = trimmed;
    }

    if (description !== undefined) company.description = description;
    if (isActive !== undefined) company.isActive = Boolean(isActive);
    if (erpCompany !== undefined) company.erpCompany = erpCompany;
    if (erpAbbr !== undefined) company.erpAbbr = erpAbbr;
    if (erpWarehouse !== undefined) company.erpWarehouse = erpWarehouse;

    await company.save();

    res.json(publicCompany(company));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Attach a stock room to a company
 * @route   PUT /api/companies/rooms/:roomId
 * @access  Admin
 *
 * Rooms created before companies existed are attached on boot by matching the
 * name. Anything the matcher could not place is set here.
 */
export const setRoomCompany = async (req, res) => {
  try {
    const room = await StockRoom.findById(req.params.roomId);
    if (!room) {
      return res.status(404).json({ message: "Stock room not found" });
    }

    // An explicit null detaches the room, which is the only way back if one
    // was attached to the wrong company.
    if (req.body.company === null) {
      room.company = null;
      await room.save();
      return res.json({ _id: room._id, name: room.name, company: null });
    }

    const company = await resolveCompany(req.body.company);
    if (!company) {
      return res.status(400).json({ message: "That company does not exist" });
    }

    room.company = company._id;
    await room.save();

    res.json({
      _id: room._id,
      name: room.name,
      company: { _id: company._id, name: company.name },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
