// backend/src/controllers/dashboardController.js

const Contact = require("../models/Contact");

// --- DASHBOARD SUMMARY ENDPOINT (For KPI Cards) ---
const getDashboardSummary = async (req, res) => {
  try {
    const {
      search,
      listId,
      status,
      minReplies,
      minScore,
      lastActiveDays,
      startDate,
      endDate,
    } = req.query;

    // Build same query as dashboard for consistency
    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
      ];
    }

    if (listId) query.contactList = listId;
    if (status && status !== "all") {
      query.computedStatus = { $regex: status, $options: "i" };
    }
    if (minReplies) query["stats.replied"] = { $gte: parseInt(minReplies) };
    if (minScore) query.engagementScore = { $gte: parseInt(minScore) };
    if (lastActiveDays) {
      const dateLimit = new Date();
      dateLimit.setDate(dateLimit.getDate() - parseInt(lastActiveDays));
      query.lastActive = { $gte: dateLimit };
    }

    // Date range filter
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    // Execute aggregation for summary metrics
    const [totalContacts, statusCounts, scoreStats, messageStats] =
      await Promise.all([
        Contact.countDocuments(query),
        Contact.aggregate([
          { $match: query },
          {
            $group: {
              _id: "$computedStatus",
              count: { $sum: 1 },
            },
          },
        ]),
        Contact.aggregate([
          { $match: query },
          {
            $group: {
              _id: null,
              avgScore: { $avg: "$engagementScore" },
              maxScore: { $max: "$engagementScore" },
            },
          },
        ]),
        Contact.aggregate([
          { $match: query },
          {
            $group: {
              _id: null,
              totalSent: { $sum: "$stats.sent" },
              totalReplied: { $sum: "$stats.replied" },
              totalRead: { $sum: "$stats.read" },
              totalDelivered: { $sum: "$stats.delivered" },
            },
          },
        ]),
      ]);

    // Format status counts
    const statusMap = {};
    statusCounts.forEach((s) => {
      statusMap[s._id?.toLowerCase() || "unknown"] = s.count;
    });

    // Calculate response rate
    const totalSent = messageStats[0]?.totalSent || 0;
    const totalReplied = messageStats[0]?.totalReplied || 0;
    const responseRate = totalSent > 0 ? (totalReplied / totalSent) * 100 : 0;

    res.status(200).json({
      success: true,
      data: {
        totalContacts,
        avgEngagementScore: scoreStats[0]?.avgScore || 0,
        hotLeadsCount: statusMap.hot || 0,
        warmLeadsCount: statusMap.warm || 0,
        coldLeadsCount: statusMap.cold || 0,
        deadLeadsCount: statusMap.dead || 0,
        responseRate,
        totalMessagesSent: totalSent,
        totalReplies: totalReplied,
        totalRead: messageStats[0]?.totalRead || 0,
        totalDelivered: messageStats[0]?.totalDelivered || 0,
      },
    });
  } catch (error) {
    console.error("Error fetching dashboard summary:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- ENGAGEMENT TRENDS ENDPOINT (For Line Charts) ---
const getEngagementTrends = async (req, res) => {
  try {
    const { period = "30d", listId, status } = req.query;

    // Calculate date range based on period
    const endDateValue = new Date();
    const startDateValue = new Date();
    const days = parseInt(period.replace("d", "")) || 30;
    startDateValue.setDate(startDateValue.getDate() - days);

    const query = {
      lastActive: { $gte: startDateValue, $lte: endDateValue },
    };

    if (listId) query.contactList = listId;
    if (status && status !== "all") {
      query.computedStatus = { $regex: status, $options: "i" };
    }

    // Aggregate by day
    const trends = await Contact.aggregate([
      { $match: query },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$lastActive",
            },
          },
          avgScore: { $avg: "$engagementScore" },
          hotCount: {
            $sum: {
              $cond: [
                { $regexMatch: { input: "$computedStatus", regex: /hot/i } },
                1,
                0,
              ],
            },
          },
          warmCount: {
            $sum: {
              $cond: [
                { $regexMatch: { input: "$computedStatus", regex: /warm/i } },
                1,
                0,
              ],
            },
          },
          coldCount: {
            $sum: {
              $cond: [
                { $regexMatch: { input: "$computedStatus", regex: /cold/i } },
                1,
                0,
              ],
            },
          },
          totalContacts: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Format for frontend
    const formattedResults = trends.map((t) => ({
      date: t._id,
      avgScore: Math.round(t.avgScore || 0),
      hotCount: t.hotCount,
      warmCount: t.warmCount,
      coldCount: t.coldCount,
      total: t.totalContacts,
    }));

    res.status(200).json({
      success: true,
      data: formattedResults,
    });
  } catch (error) {
    console.error("Error fetching engagement trends:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- TOP PERFORMERS ENDPOINT (For Bar Chart) ---
const getTopPerformers = async (req, res) => {
  try {
    const { limit = 10, listId, status } = req.query;

    const query = {};
    if (listId) query.contactList = listId;
    if (status && status !== "all") {
      query.computedStatus = { $regex: status, $options: "i" };
    }

    const topContacts = await Contact.find(query)
      .sort({ engagementScore: -1 })
      .limit(parseInt(limit))
      .select(
        "name phoneNumber engagementScore stats.sent stats.replied computedStatus",
      )
      .lean();

    const formattedResults = topContacts.map((c) => ({
      name: c.name || c.phoneNumber.slice(-4),
      score: Math.round(c.engagementScore || 0),
      totalSent: c.stats?.sent || 0,
      replied: c.stats?.replied || 0,
      status: c.computedStatus,
    }));

    res.status(200).json({
      success: true,
      data: formattedResults,
    });
  } catch (error) {
    console.error("Error fetching top performers:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

module.exports = {
  getDashboardSummary,
  getEngagementTrends,
  getTopPerformers,
};
