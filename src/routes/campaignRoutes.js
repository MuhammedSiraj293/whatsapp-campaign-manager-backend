// backend/src/routes/campaignRoutes.js

const express = require('express');
const multer = require('multer');
const path = require('path');
const {
  getCampaigns,
  createCampaign,
  executeCampaign,
  getMessageTemplates,
  getRecipientCount,
  deleteCampaign,
  getCampaignsByWaba, // <-- 1. IMPORT NEW FUNCTION
} = require("../controllers/campaignController");

const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

// Configure Multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage });

// This route handles getting all campaigns (legacy) and creating a new one
router
  .route("/")
  .get(protect, authorize("admin", "manager"), getCampaigns)
  // --- UPDATED: Add upload.single('headerImage') middleware ---
  .post(protect, authorize('admin', 'manager'), upload.single('headerImage'), createCampaign);

// --- 2. NEW ROUTES ---
// Get campaigns for a SPECIFIC WABA
router.get(
  "/waba/:wabaId",
  protect,
  authorize("admin", "manager"),
  getCampaignsByWaba
);

// Get templates for a SPECIFIC WABA
router.get(
  "/templates/:wabaId",
  protect,
  authorize("admin", "manager"),
  getMessageTemplates
);
// Get all templates
router.get(
  "/templates",
  protect,
  authorize("admin", "manager"),
  getMessageTemplates
);
// --- END NEW ROUTES ---

router.get(
  "/:id/recipients/count",
  protect,
  authorize("admin", "manager"),
  getRecipientCount
);

router.post(
  "/:id/send",
  protect,
  authorize("admin", "manager"),
  executeCampaign
);

router
  .route("/:id")
  .delete(protect, authorize("admin", "manager"), deleteCampaign);

module.exports = router;
