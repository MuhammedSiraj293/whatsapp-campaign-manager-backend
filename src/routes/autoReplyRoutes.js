const express = require("express");
const {
  getAutoReplyConfig,
  updateAutoReplyConfig,
} = require("../controllers/autoReplyController");
const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);
router.use(authorize("admin"));

router.get("/:phoneNumberId", getAutoReplyConfig);
router.post("/", updateAutoReplyConfig);

module.exports = router;
