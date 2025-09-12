const express = require('express');
const { getStats, getCampaignAnalytics, exportCampaignAnalytics } = require('../controllers/analyticsController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/stats', protect, getStats);
router.get('/:campaignId', protect, getCampaignAnalytics);
router.get('/:campaignId/export', protect, exportCampaignAnalytics);

module.exports = router;