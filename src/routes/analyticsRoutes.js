// backend/src/routes/analyticsRoutes.js

const express = require('express');
const { 
  getStats, 
  getCampaignAnalytics, 
  exportCampaignAnalytics // <-- IMPORT
} = require('../controllers/analyticsController');

const router = express.Router();

// Route for main dashboard stats
router.get('/stats', getStats);

// Route for getting a specific campaign's stats
router.get('/:campaignId', getCampaignAnalytics);

// --- NEW ROUTE FOR EXPORTING ---
router.get('/:campaignId/export', exportCampaignAnalytics);


module.exports = router;