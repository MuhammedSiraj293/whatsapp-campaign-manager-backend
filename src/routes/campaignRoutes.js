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

router.route('/')
  .get(protect, getCampaigns)
  .post(protect, authorize('admin', 'manager'), createCampaign);

router.get('/templates', protect, getMessageTemplates);

router.get('/:id/recipients/count', protect, getRecipientCount);

router.post('/:id/send', protect, authorize('admin', 'manager'), executeCampaign);

module.exports = router;