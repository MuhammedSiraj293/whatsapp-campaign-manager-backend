const express = require('express');
const { getStats, getCampaignAnalytics, exportCampaignAnalytics, exportLeadsToSheet } = require('../controllers/analyticsController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/stats', protect, getStats);
router.get('/:campaignId', protect, getCampaignAnalytics);
router.get('/:campaignId/export', protect, exportCampaignAnalytics);
// --- 2. NEW ROUTE FOR GOOGLE SHEETS EXPORT ---
router.post('/:campaignId/export-sheet', exportLeadsToSheet);
module.exports = router;