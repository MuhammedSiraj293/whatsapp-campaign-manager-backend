// backend/src/controllers/campaignController.js

const Campaign = require("../models/Campaign");
const Contact = require("../models/Contact");
const WabaAccount = require("../models/WabaAccount");
const { sendCampaign } = require("../services/campaignService");
const axios = require("axios");
// const wabaConfig = require('../config/wabaConfig');

const getCampaigns = async (req, res) => {
  try {
    const campaigns = await Campaign.find()
      .sort({ createdAt: -1 })
      .populate("contactList", "name") // Populate contact list name
      .populate("phoneNumber", "phoneNumberName"); // Populate phone number name
    res
      .status(200)
      .json({ success: true, count: campaigns.length, data: campaigns });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

const getRecipientCount = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign || !campaign.contactList) {
      return res.status(200).json({ success: true, count: 0 });
    }
    const count = await Contact.countDocuments({
      contactList: campaign.contactList,
    });
    res.status(200).json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- THIS IS THE CORRECTED FUNCTION ---
const createCampaign = async (req, res) => {
  try {
    const {
      name,
      message,
      templateName,
      templateLanguage,
      headerImageUrl,
      expectedVariables,
      scheduledFor,
      spreadsheetId,
      contactList,
      phoneNumber,
      buttons, // Get all fields
    } = req.body;

    if (!phoneNumber || !contactList) {
      return res
        .status(400)
        .json({
          success: false,
          error: '"Send From" and "Send To" are required.',
        });
    }

    const campaignData = {
      name,
      message,
      templateName,
      templateLanguage,
      contactList,
      phoneNumber,
      status: scheduledFor ? "scheduled" : "draft",
      ...(headerImageUrl && { headerImageUrl }),
      ...(expectedVariables && {
        expectedVariables: parseInt(expectedVariables, 10) || 0,
      }),
      ...(scheduledFor && {
        scheduledFor: new Date(scheduledFor).toISOString(),
      }),
      ...(spreadsheetId && { spreadsheetId }),
      ...(buttons && { buttons }),
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
    if (error.message.includes("already been sent")) {
      return res.status(400).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: error.message });
  }
};

// --- 4. UPGRADED TEMPLATE FETCHER ---
const getMessageTemplates = async (req, res) => {
  try {
    // Find the *first* WABA account in the database to get credentials
    const wabaAccount = await WabaAccount.findOne();
    if (!wabaAccount) {
      return res
        .status(404)
        .json({ success: false, error: "No WABA accounts configured." });
    }

    const url = `https://graph.facebook.com/v20.0/${wabaAccount.businessAccountId}/message_templates`;
    const headers = { Authorization: `Bearer ${wabaAccount.accessToken}` };

    const response = await axios.get(url, { headers });
    const approvedTemplates = response.data.data.filter(
      (t) =>
        t.status === "APPROVED" && t.components.some((c) => c.type === "BODY")
    );
    res.status(200).json({ success: true, data: approvedTemplates });
  } catch (error) {
    console.error(
      "Error fetching message templates:",
      error.response ? error.response.data : error.message
    );
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch message templates." });
  }
};
// --- NEW DELETE FUNCTION ---
// @desc    Delete a campaign
// @route   DELETE /api/campaigns/:id
const deleteCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);

    if (!campaign) {
      return res
        .status(404)
        .json({ success: false, error: "Campaign not found" });
    }

    await campaign.deleteOne();

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

module.exports = {
  getCampaigns,
  getRecipientCount,
  createCampaign,
  executeCampaign,
  getMessageTemplates,
  deleteCampaign,
};
