// backend/src/controllers/campaignController.js

const Campaign = require("../models/Campaign");
const Contact = require("../models/Contact");
const WabaAccount = require("../models/WabaAccount");
const PhoneNumber = require("../models/PhoneNumber"); // <-- 1. IMPORT
const Log = require("../models/Log"); // <-- 1. IMPORT THE LOG MODEL
const {
  sendCampaign,
  pauseCampaign,
  resumeCampaign,
  isCampaignActive,
} = require("../services/campaignService");
const { getIO } = require("../socketManager");
const axios = require("axios");
const { uploadMedia } = require("../integrations/whatsappAPI");
// const wabaConfig = require('../config/wabaConfig');

const getCampaigns = async (req, res) => {
  try {
    const campaigns = await Campaign.find()
      .sort({ createdAt: -1 })
      .populate("contactList", "name") // Populate contact list name
      .populate("exclusionList", "name") // Populate exclusion list name
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
      expectedVariables,
      scheduledFor,
      spreadsheetId,
      contactList,
      exclusionList,
      phoneNumber,
      buttons: buttonsString,
      headerImageUrl, // Fallback if they provided a URL
      batchSize, // <-- New Field
      batchDelay, // <-- New Field
      messageDelay, // <-- New Field
    } = req.body;

    // Parse buttons if they came as a string
    let buttons = [];
    if (buttonsString) {
      try {
        buttons = JSON.parse(buttonsString);
      } catch (e) {}
    }

    if (!phoneNumber || !contactList) {
      return res.status(400).json({
        success: false,
        error: '"Send From" and "Send To" are required.',
      });
    }

    // --- NEW LOGIC: UPLOAD TO META ---
    let finalHeaderMediaId = null;
    let finalHeaderImageUrl = headerImageUrl;

    if (req.file) {
      console.log("📂 File detected. Uploading to Meta...");

      // 1. Find credentials to upload
      const phoneDoc =
        await PhoneNumber.findById(phoneNumber).populate("wabaAccount");
      if (!phoneDoc || !phoneDoc.wabaAccount) {
        return res.status(400).json({
          success: false,
          error: "WABA credentials not found for this phone number.",
        });
      }

      // 2. Upload to Meta
      try {
        finalHeaderMediaId = await uploadMedia(
          req.file,
          phoneDoc.wabaAccount.accessToken,
          phoneDoc.phoneNumberId,
        );
        console.log(`✅ Media uploaded to Meta. ID: ${finalHeaderMediaId}`);
        // We don't need a URL if we have an ID, but we can clear it to be safe
        finalHeaderImageUrl = "";
      } catch (uploadError) {
        return res.status(500).json({
          success: false,
          error: `Failed to upload image to WhatsApp: ${uploadError.message}`,
        });
      }
    }

    const campaignData = {
      name,
      message,
      templateName,
      templateLanguage,
      contactList,
      exclusionList,
      phoneNumber,
      status: scheduledFor ? "scheduled" : "draft",

      // Save both (one will be null)
      headerImageUrl: finalHeaderImageUrl,
      headerMediaId: finalHeaderMediaId,

      expectedVariables: parseInt(expectedVariables, 10) || 0,
      spreadsheetId,
      buttons,
      ...(scheduledFor && {
        scheduledFor: new Date(scheduledFor).toISOString(),
      }),
      batchSize: parseInt(batchSize) || 50,
      batchDelay: parseInt(batchDelay) || 120000,
      messageDelay: parseInt(messageDelay) || 2000,
    };

    const campaign = await Campaign.create(campaignData);

    getIO().emit("campaignsUpdated");

    res.status(201).json({ success: true, data: campaign });
  } catch (error) {
    console.error("Error creating campaign:", error);
    res.status(400).json({ success: false, error: error.message });
  }
};

// --- THIS IS YOUR NEW, CORRECT executeCampaign FUNCTION ---
const executeCampaign = async (req, res) => {
  try {
    const campaignId = req.params.id;
    // Extract batch settings from request body (sent by frontend)
    const { batchSize, batchDelay, messageDelay } = req.body;

    const campaign = await Campaign.findById(campaignId);

    if (!campaign) {
      return res
        .status(404)
        .json({ success: false, error: "Campaign not found" });
    }

    // Prevent re-sending already processed campaigns
    if (["sending", "sent"].includes(campaign.status)) {
      return res.status(400).json({
        success: false,
        error: `This campaign has already been ${campaign.status}.`,
      });
    }

    // Log that manual send started
    await Log.create({
      level: "info",
      message: `Manual send triggered for campaign "${campaign.name}" with batchSize=${batchSize}, batchDelay=${batchDelay}ms, messageDelay=${messageDelay}ms.`,
      campaign: campaign._id,
    });

    // Start sending asynchronously (fire and forget)
    sendCampaign(campaign._id, { batchSize, batchDelay, messageDelay }).catch(
      async (error) => {
        console.error(`Error starting sendCampaign ${campaign._id}:`, error);
        const failedCampaign = await Campaign.findById(campaign._id);
        if (failedCampaign && failedCampaign.status !== "sent") {
          failedCampaign.status = "failed";
          await failedCampaign.save();
          getIO().emit("campaignsUpdated");
        }
        await Log.create({
          level: "error",
          message: `Campaign "${campaign.name}" failed. Reason: ${error.message}`,
          campaign: campaign._id,
        });
      },
    );

    // Return immediately
    res.status(200).json({
      success: true,
      data: { message: "Campaign is being sent in background..." },
    });
  } catch (error) {
    console.error("Error executing campaign:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// executeCampaignBatch REMOVED - Logic moved to background service
// --- END OF YOUR NEW FUNCTION ---

// --- NEW FUNCTION ---
// @desc    Get all campaigns for a specific WabaAccount
// @route   GET /api/campaigns/waba/:wabaId
// --- NEW FUNCTION ---
// @desc    Get all campaigns for a specific WabaAccount
// --- THIS FUNCTION IS UPGRADED ---
// It now calculates the contact count in the database
const getCampaignsByWaba = async (req, res) => {
  try {
    const { wabaId } = req.params;
    const phoneNumbers = await PhoneNumber.find({ wabaAccount: wabaId }).select(
      "_id",
    );
    const phoneNumberIds = phoneNumbers.map((p) => p._id);

    const campaigns = await Campaign.aggregate([
      // 1. Find campaigns for the selected phone numbers
      { $match: { phoneNumber: { $in: phoneNumberIds } } },
      { $sort: { createdAt: -1 } },
      // 2. Join with the 'contactlists' collection
      {
        $lookup: {
          from: "contactlists",
          localField: "contactList",
          foreignField: "_id",
          as: "contactListData",
        },
      },
      // 3. Join with the 'phonenumbers' collection
      {
        $lookup: {
          from: "phonenumbers",
          localField: "phoneNumber",
          foreignField: "_id",
          as: "phoneNumberData",
        },
      },
      // 4. Get the count of contacts
      {
        $lookup: {
          from: "contacts",
          localField: "contactList",
          foreignField: "contactList",
          as: "contacts",
        },
      },
      // 5. Reshape the data to what the frontend expects
      {
        $project: {
          name: 1,
          message: 1,
          status: 1,
          createdAt: 1,
          scheduledFor: 1,
          sentAt: 1,
          contactList: {
            _id: { $arrayElemAt: ["$contactListData._id", 0] },
            name: { $arrayElemAt: ["$contactListData.name", 0] },
          },
          phoneNumber: {
            _id: { $arrayElemAt: ["$phoneNumberData._id", 0] },
            phoneNumberName: {
              $arrayElemAt: ["$phoneNumberData.phoneNumberName", 0],
            },
          },
          contactCount: { $size: "$contacts" }, // <-- Calculate the count here
          batchSize: 1, // <-- Include batch size
          batchDelay: 1, // <-- Include batch delay
          messageDelay: 1, // <-- Include message delay
        },
      },
    ]);

    res
      .status(200)
      .json({ success: true, count: campaigns.length, data: campaigns });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
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
      wabaAccounts = await WabaAccount.find({ _id: wabaId });
      if (wabaAccounts.length === 0)
        return res
          .status(404)
          .json({ success: false, error: "WABA account not found." });
    } else {
      wabaAccounts = await WabaAccount.find();
      if (!wabaAccounts || wabaAccounts.length === 0)
        return res
          .status(404)
          .json({ success: false, error: "No WABA accounts configured." });
    }
    let allTemplates = [];
    for (const account of wabaAccounts) {
      const url = `https://graph.facebook.com/v20.0/${account.businessAccountId}/message_templates`;
      const headers = { Authorization: `Bearer ${account.accessToken}` };
      try {
        const response = await axios.get(url, { headers });
        const approvedTemplates = response.data.data
          .filter(
            (t) =>
              t.status === "APPROVED" &&
              t.components.some((c) => c.type === "BODY"),
          )
          .map((t) => ({ ...t, wabaAccountId: account._id }));
        allTemplates = allTemplates.concat(approvedTemplates);
      } catch (fetchError) {
        console.error(
          `Failed to fetch templates for WABA ${account.accountName}: ${fetchError.message}`,
        );
      }
    }
    res.status(200).json({ success: true, data: allTemplates });
  } catch (error) {
    console.error("Error fetching message templates:", error.message);
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
    getIO().emit("campaignsUpdated");
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

const pauseCampaignHandler = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign)
      return res
        .status(404)
        .json({ success: false, error: "Campaign not found" });
    if (campaign.status !== "sending") {
      return res
        .status(400)
        .json({ success: false, error: "Campaign is not currently sending." });
    }
    pauseCampaign(req.params.id);
    campaign.status = "paused";
    await campaign.save();
    getIO().emit("campaignsUpdated");
    res
      .status(200)
      .json({ success: true, data: { message: "Campaign paused." } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

const resumeCampaignHandler = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign)
      return res
        .status(404)
        .json({ success: false, error: "Campaign not found" });

    // Allow resuming if it's paused OR if it's stuck in "sending" but process is dead
    if (campaign.status !== "paused" && campaign.status !== "sending") {
      return res
        .status(400)
        .json({ success: false, error: "Campaign is not paused or sending." });
    }

    // Check if the background process is actually alive
    const isActive = isCampaignActive(campaign._id);

    if (isActive) {
      // Logic A: Process is alive, just unpause the flag
      console.log(`Resuming in-memory campaign ${campaign._id}`);
      resumeCampaign(req.params.id);
    } else {
      // Logic B: Process is dead (server restart?), restart it
      console.log(`Restarting background process for campaign ${campaign._id}`);
      // We start it again; sendCampaign handles "skipping" already sent ones via deduplication
      sendCampaign(campaign._id);
    }

    campaign.status = "sending";
    await campaign.save();
    getIO().emit("campaignsUpdated");
    res
      .status(200)
      .json({ success: true, data: { message: "Campaign resumed." } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
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
  pauseCampaignHandler,
  resumeCampaignHandler,
};
