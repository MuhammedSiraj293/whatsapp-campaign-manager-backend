// backend/src/controllers/campaignController.js

const Campaign = require('../models/Campaign');
const Contact = require('../models/Contact');
const { sendCampaign } = require('../services/campaignService');
const axios = require('axios');
const wabaConfig = require('../config/wabaConfig');

const getCampaigns = async (req, res) => {
  try {
    const campaigns = await Campaign.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: campaigns.length, data: campaigns });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

const getRecipientCount = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign || !campaign.contactList) {
      return res.status(200).json({ success: true, count: 0 });
    }
    const count = await Contact.countDocuments({ contactList: campaign.contactList });
    res.status(200).json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

const createCampaign = async (req, res) => {
  try {
    const {
      name, message, templateName, templateLanguage, headerImageUrl,
      bodyVariables, contactList, expectedVariables
    } = req.body;

    const campaignData = {
      name, message, templateName, templateLanguage, contactList,
      ...(headerImageUrl && { headerImageUrl }),
      ...(expectedVariables && { expectedVariables }),
      ...(bodyVariables && { bodyVariables }),
    };

    const campaign = await Campaign.create(campaignData);
    res.status(201).json({ success: true, data: campaign });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

const executeCampaign = async (req, res) => {
  try {
    const campaignId = req.params.id;
    const result = await sendCampaign(campaignId);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

const getMessageTemplates = async (req, res) => {
  const url = `https://graph.facebook.com/${wabaConfig.apiVersion}/${wabaConfig.businessAccountId}/message_templates`;
  const headers = { 'Authorization': `Bearer ${wabaConfig.accessToken}` };
  try {
    const response = await axios.get(url, { headers });
    const approvedTemplates = response.data.data.filter(t => t.status === 'APPROVED' && t.components.some(c => c.type === 'BODY'));
    res.status(200).json({ success: true, data: approvedTemplates });
  } catch (error) {
    console.error('Error fetching message templates:', error.response ? error.response.data : error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch message templates.' });
  }
};

module.exports = {
  getCampaigns,
  getRecipientCount,
  createCampaign,
  executeCampaign,
  getMessageTemplates,
};