// backend/src/routes/campaignRoutes.js

const express = require('express');
const {
  getCampaigns,
  createCampaign,
  executeCampaign,
  getMessageTemplates,
  getRecipientCount,
} = require('../controllers/campaignController');

const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

// Get all campaigns and create a new one (protected)
router.route('/')
  .get(protect, getCampaigns)
  .post(protect, authorize('admin', 'manager'), createCampaign);

// --- THIS IS THE CHANGE ---
// Secure the templates route
router.get('/templates', protect, getMessageTemplates);

// Get recipient count for a specific campaign (protected)
router.get('/:id/recipients/count', protect, getRecipientCount);

// Send a campaign (protected for admin or manager roles)
router.post('/:id/send', protect, authorize('admin', 'manager'), executeCampaign);


module.exports = router;