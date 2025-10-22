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

// --- NEW FUNCTION ---
// @desc    Get all campaigns for a specific WabaAccount
// @route   GET /api/campaigns/waba/:wabaId
const getCampaignsByWaba = async (req, res) => {
  try {
    const { wabaId } = req.params;

    // Find all phone numbers associated with this WABA
    const phoneNumbers = await PhoneNumber.find({ wabaAccount: wabaId }).select('_id');
    const phoneNumberIds = phoneNumbers.map(p => p._id);

    // Find all campaigns that use one of those phone numbers
    const campaigns = await Campaign.find({ phoneNumber: { $in: phoneNumberIds } })
      .sort({ createdAt: -1 })
      .populate('contactList', 'name')
      .populate('phoneNumber', 'phoneNumberName');
      
    res.status(200).json({ success: true, count: campaigns.length, data: campaigns });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};
// --- 4. UPGRADED TEMPLATE FETCHER ---
// --- THIS IS THE UPGRADED FUNCTION ---
// --- UPGRADED FUNCTION ---
// @desc    Get templates, either for all accounts or a specific one
// @route   GET /api/campaigns/templates
// @route   GET /api/campaigns/templates/:wabaId
const getMessageTemplates = async (req, res) => {
    try {
        const { wabaId } = req.params;
        let wabaAccounts;

        if (wabaId) {
            // If an ID is provided, fetch only that account
            wabaAccounts = await WabaAccount.find({ _id: wabaId });
            if (wabaAccounts.length === 0) {
                 return res.status(404).json({ success: false, error: 'WABA account not found.' });
            }
        } else {
            // Fetch all WABA accounts
            wabaAccounts = await WabaAccount.find();
            if (!wabaAccounts || wabaAccounts.length === 0) {
                return res.status(404).json({ success: false, error: 'No WABA accounts configured.' });
            }
        }
        
        let allTemplates = [];

        for (const account of wabaAccounts) {
            const url = `https://graph.facebook.com/v20.0/${account.businessAccountId}/message_templates`;
            const headers = { 'Authorization': `Bearer ${account.accessToken}` };

            try {
                const response = await axios.get(url, { headers });
                const approvedTemplates = response.data.data
                    .filter(t => t.status === 'APPROVED' && t.components.some(c => c.type === 'BODY'))
                    .map(t => ({ ...t, wabaAccountId: account._id })); // Add account ID to template
                
                allTemplates = allTemplates.concat(approvedTemplates);
            } catch (fetchError) {
                console.error(`Failed to fetch templates for WABA ${account.accountName}: ${fetchError.message}`);
            }
        }
        
        res.status(200).json({ success: true, data: allTemplates });

    } catch (error) {
        console.error('Error fetching message templates:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch message templates.' });
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
  getCampaignsByWaba,
  getMessageTemplates,
  deleteCampaign,
};
