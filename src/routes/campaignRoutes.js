// backend/src/routes/campaignRoutes.js

const express = require('express');
const {
  getCampaigns,
  createCampaign,
  testSendMessage,
  executeCampaign,
  getMessageTemplates,
  getRecipientCount, // <-- IMPORT
} = require('../controllers/campaignController');

const router = express.Router();

router.route('/').get(getCampaigns).post(createCampaign);
router.post('/test-send', testSendMessage);
router.get('/templates', getMessageTemplates);
router.get('/:id/recipients/count', getRecipientCount); // <-- ADD NEW ROUTE
router.post('/:id/send', executeCampaign);

module.exports = router;