// backend/src/controllers/analyticsController.js

const Campaign = require("../models/Campaign");
const Contact = require("../models/Contact");
const Reply = require("../models/Reply");
const Analytics = require("../models/Analytics");
const { Parser } = require("json2csv");
const { appendToSheet, clearSheet } = require("../integrations/googleSheets");
const mongoose = require("mongoose"); // <--- Added import

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
      return res
        .status(404)
        .json({ success: false, error: "Campaign not found." });
    }

    // --- THIS IS THE KEY CHANGE ---
    // Run all count queries in parallel for better performance
    const [totalSent, delivered, read, failed, totalDelivered] =
      await Promise.all([
        Analytics.countDocuments({ campaign: campaignId }),
        Analytics.countDocuments({ campaign: campaignId, status: "delivered" }),
        Analytics.countDocuments({ campaign: campaignId, status: "read" }),
        Analytics.countDocuments({ campaign: campaignId, status: "failed" }),
        Analytics.countDocuments({
          campaign: campaignId,
          status: { $in: ["delivered", "read"] },
        }), // <-- ADDED FAILED COUNT
      ]);

    if (totalSent === 0) {
      return res.status(200).json({
        success: true,
        data: {
          name: campaign.name,
          totalSent: 0,
          delivered: 0,
          read: 0,
          failed: 0,
          totalDelivered: 0,
          replies: campaign.replyCount || 0,
          deliveryRate: "0%",
          readRate: "0%",
          replyRate: "0%",
          failedRate: "0%",
          totalDeliveryRate: "0%",
        },
      });
    }

    const deliveryRate = ((delivered / totalSent) * 100).toFixed(1) + "%";
    const readRate = ((read / totalSent) * 100).toFixed(1) + "%";
    const replyRate =
      ((campaign.replyCount / totalSent) * 100).toFixed(1) + "%";
    const failedRate = ((failed / totalSent) * 100).toFixed(1) + "%"; // <-- Added failedRat
    const totalDeliveryRate =
      ((totalDelivered / totalSent) * 100).toFixed(1) + "%";

    res.status(200).json({
      success: true,
      data: {
        name: campaign.name,
        totalSent,
        delivered,
        read,
        failed, // <-- ADDED FAILED COUNT TO RESPONSE
        totalDelivered, // 👈 added
        replies: campaign.replyCount || 0,
        deliveryRate,
        readRate,
        replyRate,
        failedRate,
        totalDeliveryRate, // 👈 added
      },
    });
  } catch (error) {
    console.error("Error fetching campaign analytics:", error);
    res.status(500).json({ success: false, error: "Server Error" });
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
      return res.status(200).json({
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
    res.status(200).json({
      success: true,
      message: "Successfully exported leads to Google Sheet.",
    });
  } catch (error) {
    console.error("Error exporting to Google Sheets:", error);
    res.status(500).json({ success: false, error: "Failed to export leads." });
  }
};

// --- NEW FUNCTION TO GET STATS GROUPED BY TEMPLATE ---
// @desc    Get aggregated stats for all templates
// @route   GET /api/analytics/templates
const getTemplateAnalytics = async (req, res) => {
  try {
    const stats = await Analytics.aggregate([
      // 1. Join with the 'campaigns' collection to get template names
      {
        $lookup: {
          from: Campaign.collection.name,
          localField: "campaign",
          foreignField: "_id",
          as: "campaignData",
        },
      },
      // 2. Deconstruct the campaignData array
      { $unwind: "$campaignData" },
      // 3. Group by the template name and count statuses
      {
        $group: {
          _id: "$campaignData.templateName", // Group by template name
          totalSent: { $sum: 1 }, // Count all messages
          delivered: {
            $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
          },
          read: {
            $sum: { $cond: [{ $eq: ["$status", "read"] }, 1, 0] },
          },
          failed: {
            $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
          },
          lastSent: {
            $max: {
              $ifNull: ["$campaignData.sentAt", "$campaignData.createdAt"],
            },
          },
        },
      },
      // 4. Join with the 'campaigns' collection again to get reply counts
      {
        $lookup: {
          from: Campaign.collection.name,
          localField: "_id",
          foreignField: "templateName",
          as: "campaigns",
        },
      },
      // 5. Reshape the data
      {
        $project: {
          _id: 0,
          templateName: "$_id",
          totalSent: 1,
          delivered: 1,
          read: 1,
          failed: 1,
          replies: { $sum: "$campaigns.replyCount" }, // Sum replies from all campaigns using this template
          lastSent: 1,
        },
      },
      { $sort: { lastSent: -1 } }, // Sort by Last Sent by default
    ]);

    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    console.error("Error fetching template analytics:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- NEW FUNCTION TO GET STATS FOR A SINGLE TEMPLATE ---
// @desc    Get aggregated stats for a *single* template
// @route   GET /api/analytics/template/:templateName
const getAnalyticsForTemplate = async (req, res) => {
  try {
    const { templateName } = req.params;

    // 1. Find all campaigns that use this template and populate contactList
    const campaigns = await Campaign.find({
      templateName: templateName,
    }).populate("contactList");

    if (!campaigns || campaigns.length === 0) {
      return res.status(200).json({
        // Return empty data instead of 404 for better UI handling
        success: true,
        data: {
          templateName: templateName,
          total: 0,
          delivered: 0,
          read: 0,
          failed: 0,
          replies: 0,
          deliveryRate: "0%",
          readRate: "0%",
          replyRate: "0%",
          totalDelivered: 0,
          totalDeliveryRate: "0%",
          segments: [],
        },
      });
    }

    const allCampaignIds = campaigns.map((c) => c._id);

    // --- SEGMENT GROUPING LOGIC ---
    const segmentMap = {}; // { "Segment Name": [campaignId, campaignId] }

    campaigns.forEach((c) => {
      const segName = c.contactList ? c.contactList.name : "Unknown Segment";
      if (!segmentMap[segName]) {
        segmentMap[segName] = [];
      }
      segmentMap[segName].push(c._id);
    });

    const segmentsData = [];

    // Calculate stats for each segment
    for (const [segName, segCampaignIds] of Object.entries(segmentMap)) {
      const [segSent, segDelivered, segRead, segFailed, segTotalDelivered] =
        await Promise.all([
          Analytics.countDocuments({ campaign: { $in: segCampaignIds } }),
          Analytics.countDocuments({
            campaign: { $in: segCampaignIds },
            status: "delivered",
          }),
          Analytics.countDocuments({
            campaign: { $in: segCampaignIds },
            status: "read",
          }),
          Analytics.countDocuments({
            campaign: { $in: segCampaignIds },
            status: "failed",
          }),
          Analytics.countDocuments({
            campaign: { $in: segCampaignIds },
            status: { $in: ["delivered", "read"] },
          }),
        ]);

      // Calculate replies for this segment (sum replyCount of campaigns in this segment)
      const segReplies = campaigns
        .filter((c) => segCampaignIds.includes(c._id))
        .reduce((acc, c) => acc + (c.replyCount || 0), 0);

      // Calculate rates
      const safeDiv = (num, den) =>
        den > 0 ? ((num / den) * 100).toFixed(1) + "%" : "0%";

      segmentsData.push({
        name: segName,
        totalSent: segSent, // Match frontend "Total Sent"
        delivered: segDelivered,
        read: segRead,
        failed: segFailed,
        replies: segReplies,
        deliveredRate: safeDiv(segDelivered, segSent),
        readRate: safeDiv(segRead, segSent),
        failedRate: safeDiv(segFailed, segSent),
        replyRate: safeDiv(segReplies, segSent),
      });
    }

    // Sort segments by total sent desc
    segmentsData.sort((a, b) => b.totalSent - a.totalSent);

    // 2. Global Stats (Run parallel query for all IDs)
    const [totalSent, delivered, read, failed, totalDelivered] =
      await Promise.all([
        Analytics.countDocuments({ campaign: { $in: allCampaignIds } }),
        Analytics.countDocuments({
          campaign: { $in: allCampaignIds },
          status: "delivered",
        }),
        Analytics.countDocuments({
          campaign: { $in: allCampaignIds },
          status: "read",
        }),
        Analytics.countDocuments({
          campaign: { $in: allCampaignIds },
          status: "failed",
        }),
        Analytics.countDocuments({
          campaign: { $in: allCampaignIds },
          status: { $in: ["delivered", "read"] },
        }),
      ]);

    // 3. Calculate total replies
    const totalReplies = campaigns.reduce(
      (acc, campaign) => acc + (campaign.replyCount || 0),
      0,
    );

    // 4. Calculate global rates
    const deliveryRate = ((delivered / totalSent) * 100).toFixed(1) + "%";
    const readRate = ((read / totalSent) * 100).toFixed(1) + "%";
    const replyRate = ((totalReplies / totalSent) * 100).toFixed(1) + "%";
    const totalDeliveryRate =
      ((totalDelivered / totalSent) * 100).toFixed(1) + "%";
    const failedRate = ((failed / totalSent) * 100).toFixed(1) + "%"; // Add failed rate

    res.status(200).json({
      success: true,
      data: {
        templateName: templateName,
        total: totalSent,
        delivered,
        read,
        failed,
        totalDelivered,
        replies: totalReplies,
        deliveryRate,
        readRate,
        replyRate,
        totalDeliveryRate,
        failedRate, // Add failed rate
        segments: segmentsData, // <--- Return the segment data
      },
    });
  } catch (error) {
    console.error("Error fetching single template analytics:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- NEW FUNCTION TO GET DETAILED ANALYTICS FOR A CAMPAIGN ---
// @desc    Get detailed list of analytics entries for a campaign (pagination support)
// @route   GET /api/analytics/:campaignId/details
// --- NEW FUNCTION TO GET DETAILED ANALYTICS FOR A CAMPAIGN ---
// @desc    Get detailed list of analytics entries for a campaign (pagination support)
// @route   GET /api/analytics/:campaignId/details
const getCampaignAnalyticsDetails = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Filters
    const { status, search } = req.query;

    const query = { campaign: campaignId };

    // Apply Status Filter
    if (status && status !== "all") {
      query.status = status;
    }

    // Apply Search Filter (Phone or Name)
    if (search) {
      const pipeline = [
        { $match: { campaign: new mongoose.Types.ObjectId(campaignId) } },
        // Join with contacts
        {
          $lookup: {
            from: "contacts",
            localField: "contact",
            foreignField: "_id",
            as: "contactInfo",
          },
        },
        { $unwind: { path: "$contactInfo", preserveNullAndEmptyArrays: true } },
        // Apply Filters
        {
          $match: {
            $and: [
              status && status !== "all" ? { status: status } : {},
              search
                ? {
                    $or: [
                      { wamid: { $regex: search, $options: "i" } },
                      { "contactInfo.name": { $regex: search, $options: "i" } },
                      {
                        "contactInfo.phoneNumber": {
                          $regex: search,
                          $options: "i",
                        },
                      },
                    ],
                  }
                : {},
            ],
          },
        },
        { $sort: { updatedAt: -1 } },
        { $skip: skip },
        { $limit: limit },
      ];

      // Need a separate count query for pagination
      const countPipeline = [
        { $match: { campaign: new mongoose.Types.ObjectId(campaignId) } },
        {
          $lookup: {
            from: "contacts",
            localField: "contact",
            foreignField: "_id",
            as: "contactInfo",
          },
        },
        { $unwind: { path: "$contactInfo", preserveNullAndEmptyArrays: true } },
        {
          $match: {
            $and: [
              status && status !== "all" ? { status: status } : {},
              search
                ? {
                    $or: [
                      { wamid: { $regex: search, $options: "i" } },
                      { "contactInfo.name": { $regex: search, $options: "i" } },
                      {
                        "contactInfo.phoneNumber": {
                          $regex: search,
                          $options: "i",
                        },
                      },
                    ],
                  }
                : {},
            ],
          },
        },
        { $count: "total" },
      ];

      const [results, countResult] = await Promise.all([
        Analytics.aggregate(pipeline),
        Analytics.aggregate(countPipeline),
      ]);

      const total = countResult.length > 0 ? countResult[0].total : 0;

      const formattedData = results.map((item) => ({
        _id: item._id,
        phoneNumber: item.contactInfo ? item.contactInfo.phoneNumber : "N/A",
        contactName: item.contactInfo ? item.contactInfo.name : "N/A",
        wamid: item.wamid,
        status: item.status,
        failureReason: item.failureReason || "-",
        updatedAt: item.updatedAt,
      }));

      return res.status(200).json({
        success: true,
        data: formattedData,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total,
        },
      });
    }

    // Normal query (no search, maybe status only) - Optimization: Use simple find if no complex search
    if (status && status !== "all") {
      query.status = status;
    }

    const [analyticsData, total] = await Promise.all([
      Analytics.find(query)
        .populate("contact", "phoneNumber name")
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit),
      Analytics.countDocuments(query),
    ]);

    const formattedData = analyticsData.map((item) => ({
      _id: item._id,
      phoneNumber: item.contact ? item.contact.phoneNumber : "N/A",
      contactName: item.contact ? item.contact.name : "N/A",
      wamid: item.wamid,
      status: item.status,
      failureReason: item.failureReason || "-",
      updatedAt: item.updatedAt,
    }));

    res.status(200).json({
      success: true,
      data: formattedData,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (error) {
    console.error("Error fetching campaign analytics details:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

module.exports = {
  getStats,
  getCampaignAnalytics,
  exportCampaignAnalytics,
  exportLeadsToSheet,
  getTemplateAnalytics,
  getAnalyticsForTemplate,
  getCampaignAnalyticsDetails, // <-- Exported
};
