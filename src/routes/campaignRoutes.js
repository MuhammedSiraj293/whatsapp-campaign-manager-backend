// backend/src/routes/campaignRoutes.js

const express = require('express');
const {
  getCampaigns,
  createCampaign,
  testSendMessage,
  executeCampaign, // <-- 1. IMPORT THE NEW FUNCTION
} = require('../controllers/campaignController');

const router = express.Router();

router.route('/').get(getCampaigns).post(createCampaign);
router.post('/test-send', testSendMessage);

// 2. ADD THE NEW ROUTE
// The ':id' is a URL parameter. Express will capture whatever is in that
// part of the URL and make it available in req.params.id
router.post('/:id/send', executeCampaign);

module.exports = router;