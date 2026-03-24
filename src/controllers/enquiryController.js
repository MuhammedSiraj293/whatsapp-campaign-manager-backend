// backend/src/controllers/enquiryController.js
const Enquiry = require("../models/Enquiry");
const PhoneNumber = require("../models/PhoneNumber");
const { Parser } = require("json2csv");

const buildEnquiryQuery = async (req) => {
  const {
    search = "",
    status = "all",
    project = "",
    wabaId = "",
    phoneNumberFilter = "",
    dateFilter = "all", // "1", "3", "5", "7", "custom", "all"
    startDate = "",
    endDate = "",
  } = req.query;

  const query = {};

  if (phoneNumberFilter) {
    query.recipientId = phoneNumberFilter;
  } else if (wabaId) {
    const phoneNumbers = await PhoneNumber.find({ wabaAccount: wabaId });
    const recipientIds = phoneNumbers.map((p) => p.phoneNumberId);
    query.recipientId = { $in: recipientIds };
  }

  if (search) {
    const searchRegex = new RegExp(search, "i");
    query.$or = [
      { name: searchRegex },
      { phoneNumber: searchRegex },
      { projectName: searchRegex },
    ];
  }

  if (status && status !== "all") {
    query.status = status;
  }

  if (project) {
    query.projectName = project;
  }

  if (dateFilter && dateFilter !== "all") {
    if (dateFilter === "custom" && startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)),
      };
    } else if (!isNaN(parseInt(dateFilter))) {
      const days = parseInt(dateFilter);
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - days);
      query.createdAt = { $gte: pastDate };
    }
  }

  return query;
};

// @desc    Get all enquiries with Search, Filter, and Pagination
// @route   GET /api/enquiries
const getEnquiries = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    
    const query = await buildEnquiryQuery(req);

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Execute Query
    const totalRecords = await Enquiry.countDocuments(query);
    const enquiries = await Enquiry.find(query)
      .sort({ createdAt: -1 }) // Newest first
      .skip(skip)
      .limit(limitNum);

    res.status(200).json({
      success: true,
      count: totalRecords,
      pagination: {
        totalRecords,
        totalPages: Math.ceil(totalRecords / limitNum),
        currentPage: pageNum,
        limit: limitNum,
      },
      data: enquiries,
    });
  } catch (error) {
    console.error("Error fetching enquiries:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// @desc    Update an enquiry's status
// @route   PUT /api/enquiries/:id
const updateEnquiryStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const enquiry = await Enquiry.findById(req.params.id);

    if (!enquiry) {
      return res
        .status(404)
        .json({ success: false, error: "Enquiry not found" });
    }

    enquiry.status = status || enquiry.status;
    await enquiry.save();

    res.status(200).json({ success: true, data: enquiry });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// @desc    Delete an enquiry
// @route   DELETE /api/enquiries/:id
const deleteEnquiry = async (req, res) => {
  try {
    const enquiry = await Enquiry.findById(req.params.id);

    if (!enquiry) {
      return res
        .status(404)
        .json({ success: false, error: "Enquiry not found" });
    }

    await enquiry.deleteOne();
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// @desc    Bulk Delete Enquiries
// @route   POST /api/enquiries/bulk-delete
const bulkDeleteEnquiries = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: "No IDs provided" });
    }

    await Enquiry.deleteMany({ _id: { $in: ids } });

    res
      .status(200)
      .json({ success: true, message: "Enquiries deleted successfully" });
  } catch (error) {
    console.error("Error bulk deleting enquiries:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// @desc    Export enquiries to CSV
// @route   POST /api/enquiries/export
const exportEnquiries = async (req, res) => {
  try {
    const { ids } = req.body;
    let query = await buildEnquiryQuery(req);

    if (ids && Array.isArray(ids) && ids.length > 0) {
      query = { _id: { $in: ids } };
    }

    const enquiries = await Enquiry.find(query).sort({ createdAt: -1 });

    const fields = [
      { label: "Date", value: "createdAt" },
      { label: "Status", value: "status" },
      { label: "Name", value: "name" },
      { label: "Phone", value: "phoneNumber" },
      { label: "Project", value: "projectName" },
      { label: "Bedrooms", value: "bedrooms" },
      { label: "Budget", value: "budget" },
      { label: "Entry Source", value: "entrySource" },
      { label: "URL", value: "pageUrl" }
    ];

    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(enquiries);

    res.header("Content-Type", "text/csv");
    res.attachment("enquiries_export.csv");
    res.send(csv);

  } catch (error) {
    console.error("Error exporting enquiries:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

module.exports = {
  getEnquiries,
  updateEnquiryStatus,
  deleteEnquiry,
  bulkDeleteEnquiries,
  exportEnquiries,
};
