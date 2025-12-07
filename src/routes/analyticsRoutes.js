const express = require("express");
const {
  getStats,
  getCampaignAnalytics,
  exportCampaignAnalytics,
  exportLeadsToSheet,
  getTemplateAnalytics, // <-- 1. IMPORT
  getAnalyticsForTemplate, // <-- 1. IMPORT NEW FUNCTION
  getCampaignAnalyticsDetails, // <-- IMPORT NEW FUNCTION
} = require("../controllers/analyticsController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/stats", protect, getStats);
// --- 2. NEW ROUTE FOR TEMPLATE STATS ---
router.get("/templates", getTemplateAnalytics);
router.get("/template/:templateName", getAnalyticsForTemplate);

router.get("/:campaignId", protect, getCampaignAnalytics);
router.get("/:campaignId/export", protect, exportCampaignAnalytics);
// --- 3. NEW ROUTE FOR GOOGLE SHEETS EXPORT ---
router.post("/:campaignId/export-sheet", exportLeadsToSheet);

// --- 4. NEW ROUTE FOR DETAILED ANALYTICS TABLE ---
router.get("/:campaignId/details", protect, getCampaignAnalyticsDetails);

module.exports = router;
