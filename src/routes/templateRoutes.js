const express = require("express");
const {
  getTemplates,
  createTemplate,
  editTemplate,
  getTemplateAnalytics,
} = require("../controllers/templateController");
const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

// All routes are protected
router.use(protect);

router.route("/:wabaId").get(getTemplates);
router
  .route("/:wabaId/analytics")
  .get(authorize("admin", "manager"), getTemplateAnalytics);

router.route("/").post(authorize("admin", "manager"), createTemplate);

router.route("/:templateId").put(authorize("admin", "manager"), editTemplate);

module.exports = router;
