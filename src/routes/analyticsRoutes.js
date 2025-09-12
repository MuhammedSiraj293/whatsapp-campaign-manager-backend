// backend/src/routes/analyticsRoutes.js

const express = require('express');
const { getStats, getCampaignAnalytics, exportCampaignAnalytics } = require('../controllers/analyticsController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Route for main dashboard stats (protected)
router.get('/stats', protect, getStats);

// Route for getting a specific campaign's stats (protected)
router.get('/:campaignId', protect, getCampaignAnalytics);

// Route for exporting campaign data (protected)
router.get('/:campaignId/export', protect, exportCampaignAnalytics);


module.exports = router;