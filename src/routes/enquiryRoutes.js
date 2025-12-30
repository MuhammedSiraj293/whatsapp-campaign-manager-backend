// backend/src/routes/enquiryRoutes.js

const express = require("express");
const {
  getEnquiries,
  updateEnquiryStatus,
  deleteEnquiry,
  bulkDeleteEnquiries,
} = require("../controllers/enquiryController");

const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

// All routes in this file are protected and require at least a 'manager' role
router.use(protect);
router.use(authorize("admin", "manager"));

router.route("/").get(getEnquiries);

router.post("/bulk-delete", bulkDeleteEnquiries);

router.route("/:id").put(updateEnquiryStatus).delete(deleteEnquiry);

module.exports = router;
