// backend/src/controllers/enquiryController.js
const Enquiry = require("../models/Enquiry");
const PhoneNumber = require("../models/PhoneNumber");

// @desc    Get all enquiries
// @route   GET /api/enquiries
// @desc    Get all enquiries with Search, Filter, and Pagination
// @route   GET /api/enquiries
const getEnquiries = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      status = "all",
      project = "",
      wabaId = "", // <-- Active WABA
      phoneNumberFilter = "", // <-- Specific Phone Number
    } = req.query;

    const query = {};

    // 0. Filter by Active WABA OR Specific Phone Number
    if (phoneNumberFilter) {
      // If a specific number is selected, filter by that ONLY
      query.recipientId = phoneNumberFilter;
    } else if (wabaId) {
      // Otherwise, show ALL numbers for the active WABA
      const phoneNumbers = await PhoneNumber.find({ wabaAccount: wabaId });
      const recipientIds = phoneNumbers.map((p) => p.phoneNumberId);
      query.recipientId = { $in: recipientIds };
    }

    // 1. Search Filter (Name, Phone, Project)
    if (search) {
      const searchRegex = new RegExp(search, "i");
      query.$or = [
        { name: searchRegex },
        { phoneNumber: searchRegex },
        { projectName: searchRegex },
      ];
    }

    // 2. Status Filter
    if (status && status !== "all") {
      query.status = status;
    }

    // 3. Project Specific Filter (Optional extra)
    if (project) {
      query.projectName = project;
    }

    // 4. Pagination
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

module.exports = {
  getEnquiries,
  updateEnquiryStatus,
  deleteEnquiry,
  bulkDeleteEnquiries,
};
