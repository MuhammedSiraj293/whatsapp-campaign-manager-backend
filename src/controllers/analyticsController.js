// backend/src/controllers/analyticsController.js

const Campaign = require("../models/Campaign");
const Contact = require("../models/Contact");
const Reply = require("../models/Reply");
const Analytics = require("../models/Analytics");
const { Parser } = require("json2csv");
const { appendToSheet, clearSheet } = require("../integrations/googleSheets");

// @desc    Get key analytics stats
const getStats = async (req, res) => {
  try {
    const [campaignCount, contactCount, replyCount] = await Promise.all([
      Campaign.countDocuments({ status: "sent" }),
      Contact.countDocuments(),
      Reply.countDocuments({ direction: "incoming" }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        campaignsSent: campaignCount,
        totalContacts: contactCount,
        repliesReceived: replyCount,
      },
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// @desc    Get aggregated stats for a single campaign
const getCampaignAnalytics = async (req, res) => {
    try {
        const { campaignId } = req.params;
        const campaign = await Campaign.findById(campaignId);
        if (!campaign) {
            return res.status(404).json({ success: false, error: 'Campaign not found.' });
        }

        // --- THIS IS THE KEY CHANGE ---
        // Run all count queries in parallel for better performance
        const [totalSent, delivered, read, failed] = await Promise.all([
            Analytics.countDocuments({ campaign: campaignId }),
            Analytics.countDocuments({ campaign: campaignId, status: 'delivered' }),
            Analytics.countDocuments({ campaign: campaignId, status: 'read' }),
            Analytics.countDocuments({ campaign: campaignId, status: 'failed' }), // <-- ADDED FAILED COUNT
        ]);

        if (totalSent === 0) {
            return res.status(200).json({ success: true, data: {
                name: campaign.name, totalSent: 0, delivered: 0, read: 0, failed: 0,
                replies: campaign.replyCount || 0, deliveryRate: '0%', readRate: '0%', replyRate: '0%',
            }});
        }

        const deliveryRate = ((delivered / totalSent) * 100).toFixed(1) + '%';
        const readRate = ((read / totalSent) * 100).toFixed(1) + '%';
        const replyRate = ((campaign.replyCount / totalSent) * 100).toFixed(1) + '%';

        res.status(200).json({ success: true, data: {
            name: campaign.name,
            totalSent,
            delivered,
            read,
            failed, // <-- ADDED FAILED COUNT TO RESPONSE
            replies: campaign.replyCount || 0,
            deliveryRate,
            readRate,
            replyRate,
        }});

    } catch (error) {
        console.error('Error fetching campaign analytics:', error);
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};


// @desc    Export detailed analytics for a campaign to a CSV file
const exportCampaignAnalytics = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const analyticsData = await Analytics.find({
      campaign: campaignId,
    }).populate("contact", "phoneNumber name");
    if (!analyticsData || analyticsData.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "No analytics data found." });
    }

    // --- THIS IS THE FIX ---
    // Add 'Failure Reason' to the list of fields to export
    const fields = [
      { label: "Phone Number", value: "contact.phoneNumber" },
      { label: "Contact Name", value: "contact.name" },
      { label: "Message ID (wamid)", value: "wamid" },
      { label: "Status", value: "status" },
      { label: "Failure Reason", value: "failureReason" }, // <-- THIS LINE WAS MISSING
      { label: "Last Updated", value: "updatedAt" },
    ];

    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(analyticsData);
    res.header("Content-Type", "text/csv");
    res.attachment(`campaign_${campaignId}_analytics.csv`);
    res.send(csv);
  } catch (error) {
    console.error("Error exporting campaign analytics:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// @desc    Export campaign replies (leads) to a Google Sheet
const exportLeadsToSheet = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { spreadsheetId } = req.body;
    if (!spreadsheetId) {
      return res
        .status(400)
        .json({ success: false, error: "Spreadsheet ID is required." });
    }
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res
        .status(404)
        .json({ success: false, error: "Campaign not found." });
    }
    const contactsInList = await Contact.find({
      contactList: campaign.contactList,
    });
    const contactPhoneNumbers = contactsInList.map((c) => c.phoneNumber);
    const replies = await Reply.find({
      from: { $in: contactPhoneNumbers },
      direction: "incoming",
      campaign: campaignId,
    }).sort({ timestamp: "asc" });
    if (replies.length === 0) {
      return res
        .status(200)
        .json({
          success: true,
          message: "No new replies to export for this campaign.",
        });
    }
    const headerRow = ["Timestamp", "From", "Name", "Message"];
    const dataRows = replies.map((reply) => {
      const contact = contactsInList.find((c) => c.phoneNumber === reply.from);
      return [
        new Date(reply.timestamp).toLocaleString(),
        reply.from,
        contact ? contact.name : "Unknown",
        reply.body,
      ];
    });
    const range = "Sheet1";
    await clearSheet(spreadsheetId, `${range}!A:D`);
    await appendToSheet(spreadsheetId, `${range}!A1`, [headerRow, ...dataRows]);
    res
      .status(200)
      .json({
        success: true,
        message: "Successfully exported leads to Google Sheet.",
      });
  } catch (error) {
    console.error("Error exporting to Google Sheets:", error);
    res.status(500).json({ success: false, error: "Failed to export leads." });
  }
};

module.exports = {
  getStats,
  getCampaignAnalytics,
  exportCampaignAnalytics,
  exportLeadsToSheet,
};
