// backend/src/routes/analyticsRoutes.js

const express = require('express');
const { getStats, getCampaignAnalytics } = require('../controllers/analyticsController');

const router = express.Router();

// Route for main dashboard stats
router.get('/stats', getStats);

// --- NEW ROUTE FOR PER-CAMPAIGN STATS ---
router.get('/:campaignId', getCampaignAnalytics);

module.exports = router;