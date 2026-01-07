const express = require("express");
const multer = require("multer");
const {
  getMediaFile,
  uploadTemplateMedia,
} = require("../controllers/mediaController");
const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

// Memory storage for file handling
const upload = multer({ storage: multer.memoryStorage() });

// Public route for browser access to media
router.get("/:mediaId", getMediaFile);

// Protected route for uploading template media to Meta (getting handle)
router.post(
  "/upload-template-media",
  protect,
  authorize("admin", "manager"),
  upload.single("file"),
  uploadTemplateMedia
);

module.exports = router;
