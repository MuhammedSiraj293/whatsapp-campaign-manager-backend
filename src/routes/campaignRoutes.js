// backend/src/routes/campaignRoutes.js

const express = require('express');
const {
  getCampaigns,
  createCampaign,
  testSendMessage,
  executeCampaign,
  getMessageTemplates, // <-- IMPORT
} = require('../controllers/campaignController');

const router = express.Router(); // <-- THIS LINE WAS MISSING

router.route('/').get(getCampaigns).post(createCampaign);
router.post('/test-send', testSendMessage);
router.get('/templates', getMessageTemplates); // <-- ADD NEW ROUTE
router.post('/:id/send', executeCampaign);

module.exports = router;