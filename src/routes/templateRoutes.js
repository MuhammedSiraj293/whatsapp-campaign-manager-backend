const express = require("express");
const {
  getTemplates,
  createTemplate,
} = require("../controllers/templateController");
const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

// All routes are protected
router.use(protect);

router.route("/:wabaId").get(getTemplates);

router.route("/").post(authorize("admin", "manager"), createTemplate);

module.exports = router;
