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
  .get(authorize("admin"), getTemplateAnalytics);

router.route("/").post(authorize("admin"), createTemplate);

router.route("/:templateId").put(authorize("admin"), editTemplate);

module.exports = router;
