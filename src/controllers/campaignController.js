// backend/src/controllers/campaignController.js
const Campaign = require('../models/Campaign');
const { sendTextMessage } = require('../integrations/whatsappAPI');
const { sendCampaign } = require('../services/campaignService');
const axios = require('axios'); // <-- ADD
const wabaConfig = require('../config/wabaConfig'); // <-- ADD

// ... (getCampaigns, createCampaign, executeCampaign, testSendMessage functions are unchanged)

// @desc    Get message templates from Meta
// @route   GET /api/campaigns/templates
const getMessageTemplates = async (req, res) => { // <-- ADD NEW FUNCTION
  const url = `https://graph.facebook.com/${wabaConfig.apiVersion}/${wabaConfig.businessAccountId}/message_templates`;
  const headers = {
    'Authorization': `Bearer ${wabaConfig.accessToken}`,
  };

  try {
    const response = await axios.get(url, { headers });
    // Filter for approved templates with message bodies
    const approvedTemplates = response.data.data.filter(template =>
      template.status === 'APPROVED' &&
      template.components.some(c => c.type === 'BODY')
    );
    res.status(200).json({ success: true, data: approvedTemplates });
  } catch (error) {
    console.error('Error fetching message templates:', error.response ? error.response.data : error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch message templates.' });
  }
};

// backend/src/controllers/campaignController.js

module.exports = {
  getCampaigns, // <-- ADD THIS BACK
  createCampaign,
  executeCampaign,
  testSendMessage,
  getMessageTemplates,
};