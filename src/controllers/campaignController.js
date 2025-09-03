// backend/src/controllers/campaignController.js

const Campaign = require('../models/Campaign');
const { sendTextMessage } = require('../integrations/whatsappAPI');
const { sendCampaign } = require('../services/campaignService');
const axios = require('axios');
const wabaConfig = require('../config/wabaConfig');

// @desc    Get all campaigns
// @route   GET /api/campaigns
const getCampaigns = async (req, res) => {
  try {
    const campaigns = await Campaign.find();
    res.status(200).json({ success: true, count: campaigns.length, data: campaigns });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

// @desc    Create a new campaign
// @route   POST /api/campaigns
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
const executeCampaign = async (req, res) => {
  try {
    const campaignId = req.params.id;
    const result = await sendCampaign(campaignId);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Send a test WhatsApp message
// @route   POST /api/campaigns/test-send
const testSendMessage = async (req, res) => {
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

// @desc    Get message templates from Meta
// @route   GET /api/campaigns/templates
const getMessageTemplates = async (req, res) => {
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

module.exports = {
  getCampaigns,
  createCampaign,
  executeCampaign,
  testSendMessage,
  getMessageTemplates,
};