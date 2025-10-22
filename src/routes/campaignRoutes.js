// backend/src/routes/campaignRoutes.js

const express = require("express");
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

// This route handles getting all campaigns (legacy) and creating a new one
router
  .route("/")
  .get(protect, authorize("admin", "manager"), getCampaigns)
  .post(protect, authorize("admin", "manager"), createCampaign);

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
