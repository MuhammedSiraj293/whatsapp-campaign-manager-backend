// backend/src/routes/campaignRoutes.js

const express = require('express');
const {
  getCampaigns,
  createCampaign,
  executeCampaign,
  getMessageTemplates,
  getRecipientCount,
  deleteCampaign,
} = require('../controllers/campaignController');

const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

// This route handles getting all campaigns and creating a new one
router.route('/')
  .get(protect, getCampaigns)
  .post(protect, authorize('admin', 'manager'), createCampaign);

// This route handles fetching templates
router.get('/templates', protect, getMessageTemplates);

// This route gets the recipient count for a specific campaign
router.get('/:id/recipients/count', protect, getRecipientCount);

// This route handles sending a campaign
router.post('/:id/send', protect, authorize('admin', 'manager'), executeCampaign);

// This route handles deleting a campaign
router.route('/:id')
    .delete(protect, authorize('admin', 'manager'), deleteCampaign);

module.exports = router;