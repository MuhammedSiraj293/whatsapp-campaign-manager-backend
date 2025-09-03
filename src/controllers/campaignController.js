// backend/src/controllers/campaignController.js

const Campaign = require('../models/Campaign');
const { sendTextMessage } = require('../integrations/whatsappAPI');
const { sendCampaign } = require('../services/campaignService'); // <-- 1. IMPORT THE SERVICE

// ... (getCampaigns and createCampaign functions remain unchanged)
const getCampaigns = async (req, res) => {
  try {
    const campaigns = await Campaign.find();
    res.status(200).json({ success: true, count: campaigns.length, data: campaigns });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};
const createCampaign = async (req, res) => {
  try {
    const { name, message } = req.body;
    const campaign = await Campaign.create({ name, message });
    res.status(201).json({ success: true, data: campaign });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// @desc    Execute and send a campaign
// @route   POST /api/campaigns/:id/send
const executeCampaign = async (req, res) => { // <-- 2. ADD THE NEW FUNCTION
  try {
    const campaignId = req.params.id; // Get the ID from the URL parameter
    const result = await sendCampaign(campaignId);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

const testSendMessage = async (req, res) => {
  // ... (testSendMessage function remains unchanged)
  try {
    const recipient = process.env.TEST_RECIPIENT_NUMBER;
    if (!recipient) {
      return res.status(400).json({ success: false, error: 'TEST_RECIPIENT_NUMBER is not set in .env file.' });
    }
    const message = 'Hello from your Campaign Manager! 👋 This is a successful test.';
    const result = await sendTextMessage(recipient, message);
    res.status(200).json({ success: true, message: 'Test message sent successfully.', data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to send test message.' });
  }
};

module.exports = {
  getCampaigns,
  createCampaign,
  executeCampaign, // <-- 3. EXPORT THE NEW FUNCTION
  testSendMessage,
};