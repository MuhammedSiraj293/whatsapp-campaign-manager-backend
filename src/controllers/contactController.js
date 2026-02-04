// backend/src/controllers/contactController.js

const Contact = require("../models/Contact");
const ContactList = require("../models/ContactList");
const Analytics = require("../models/Analytics");
const Reply = require("../models/Reply");
const mongoose = require("mongoose");
const { getIO } = require("../socketManager"); // <-- 1. IMPORT getIO

// Helper function to extract named variables from a row
const extractVariables = (row) => {
  const variables = {};
  const reservedKeys = ["phonenumber", "name"];

  Object.keys(row).forEach((key) => {
    const keyLower = key.trim().toLowerCase();
    if (!reservedKeys.includes(keyLower)) {
      variables[key.trim()] = row[key];
    }
  });
  return variables;
};

const createContactList = async (req, res) => {
  const { name } = req.body;
  if (!name)
    return res
      .status(400)
      .json({ success: false, error: "Please provide a list name." });
  try {
    const contactList = await ContactList.create({ name });
    res.status(201).json({ success: true, data: contactList });
  } catch (error) {
    res
      .status(400)
      .json({ success: false, error: "List name may already exist." });
  }
};

// --- THIS FUNCTION IS UPGRADED ---
const getAllContactLists = async (req, res) => {
  try {
    const { search } = req.query;
    let listIdsToInclude = null;

    // 1. If search term exists, find matching Lists via Contacts OR List Name
    if (search) {
      const searchRegex = new RegExp(search, "i");

      // A. Find contacts matching name/phone
      const matchingContacts = await Contact.find({
        $or: [{ name: searchRegex }, { phoneNumber: searchRegex }],
      }).select("contactList");

      const contactListIds = matchingContacts.map((c) => c.contactList);

      // B. Find lists matching name (we'll filter the main agg by this OR contact match)
      const matchingLists = await ContactList.find({
        name: searchRegex,
      }).select("_id");
      const nameListIds = matchingLists.map((l) => l._id);

      // Combine unique IDs
      listIdsToInclude = [
        ...new Set([
          ...contactListIds.map((id) => id.toString()),
          ...nameListIds.map((id) => id.toString()),
        ]),
      ].map((id) => new mongoose.Types.ObjectId(id));
    }

    // 2. Build Aggregation Pipeline
    const pipeline = [];

    // Filter by IDs if search was performed
    if (listIdsToInclude) {
      pipeline.push({ $match: { _id: { $in: listIdsToInclude } } });
    }

    pipeline.push(
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "contacts",
          localField: "_id",
          foreignField: "contactList",
          as: "contacts",
        },
      },
      {
        $project: {
          name: 1,
          createdAt: 1,
          contactCount: { $size: "$contacts" },
        },
      },
    );

    const contactLists = await ContactList.aggregate(pipeline);
    res.status(200).json({ success: true, data: contactLists });
  } catch (error) {
    console.error("Error fetching contact lists:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- NEW FUNCTION FOR PASTED DATA ---
const bulkAddContacts = async (req, res) => {
  const { listId } = req.params;
  const { contacts } = req.body;

  if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
    return res
      .status(400)
      .json({ success: false, error: "No contacts provided." });
  }

  // Process each contact to match our database schema
  const processedContacts = contacts.map((contact) => ({
    phoneNumber: String(contact.phoneNumber),
    name: contact.name,
    contactList: listId,
    variables: extractVariables(contact),
  }));

  try {
    await Contact.insertMany(processedContacts, { ordered: false });
    getIO().emit("campaignsUpdated"); // <-- 2. EMIT EVENT
    res.status(201).json({
      success: true,
      message: `${contacts.length} contacts were processed successfully.`,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: `Import failed. Some contacts may have been duplicates within this list.`,
      error: error.message,
    });
  }
};

// --- NEW FUNCTION TO GET ALL CONTACTS IN A LIST ---
const getContactsInList = async (req, res) => {
  try {
    const { listId } = req.params;
    const contacts = await Contact.find({ contactList: listId }).sort({
      createdAt: -1,
    });
    res.status(200).json({ success: true, data: contacts });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- NEW UPDATE FUNCTION ---
const updateContact = async (req, res) => {
  try {
    const { contactId } = req.params;
    const contact = await Contact.findByIdAndUpdate(contactId, req.body, {
      new: true,
      runValidators: true,
    });
    if (!contact) {
      return res
        .status(404)
        .json({ success: false, error: "Contact not found" });
    }
    res.status(200).json({ success: true, data: contact });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- NEW DELETE FUNCTION ---
const deleteContactList = async (req, res) => {
  try {
    const list = await ContactList.findById(req.params.listId);
    if (!list) {
      return res
        .status(404)
        .json({ success: false, error: "Contact list not found" });
    }

    await list.deleteOne(); // This triggers the 'pre' hook in the model
    getIO().emit("campaignsUpdated"); // <-- 2. EMIT EVENT
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- NEW DELETE FUNCTION (for a single contact) ---
const deleteContact = async (req, res) => {
  try {
    const { contactId } = req.params;
    const contact = await Contact.findById(contactId);
    if (!contact) {
      return res
        .status(404)
        .json({ success: false, error: "Contact not found" });
    }
    await contact.deleteOne();
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- NEW BULK DELETE FUNCTION ---
const bulkDeleteContacts = async (req, res) => {
  try {
    const { contactIds } = req.body;
    if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "No contact IDs provided." });
    }

    await Contact.deleteMany({ _id: { $in: contactIds } });
    getIO().emit("campaignsUpdated");
    res.status(200).json({
      success: true,
      message: `${contactIds.length} contacts deleted successfully.`,
    });
  } catch (error) {
    console.error("Error bulk deleting contacts:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- NEW FUNCTION TO GET CONTACT STATS ---
const getContactStats = async (req, res) => {
  try {
    const { contactId } = req.params;
    const contact = await Contact.findById(contactId);

    if (!contact) {
      return res
        .status(404)
        .json({ success: false, error: "Contact not found" });
    }

    const [campaignsSent, campaignsFailed, repliesCount] = await Promise.all([
      // Count sent/delivered/read
      Analytics.countDocuments({
        contact: contact._id,
        status: { $in: ["sent", "delivered", "read"] },
      }),
      // Count failed
      Analytics.countDocuments({
        contact: contact._id,
        status: "failed",
      }),
      // Count incoming replies
      Reply.countDocuments({
        from: contact.phoneNumber,
        direction: "incoming",
      }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        contact,
        stats: {
          campaignsSent,
          campaignsFailed,
          repliesCount,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching contact stats:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- NEW FUNCTION FOR ANALYTICS DASHBOARD ---
const getContactAnalytics = async (req, res) => {
  try {
    const totalContacts = await Contact.countDocuments({});
    const subscribed = await Contact.countDocuments({ isSubscribed: true });
    const unsubscribed = await Contact.countDocuments({ isSubscribed: false });

    // Calculate duplicates: Total Entries - Unique Phone Numbers
    const uniquePhoneNumbers = await Contact.distinct("phoneNumber");
    const duplicates = totalContacts - uniquePhoneNumbers.length;

    // Aggregate Unsubscribe Reasons
    const reasonsAggregation = await Contact.aggregate([
      { $match: { isSubscribed: false } },
      {
        $group: {
          _id: { $toLower: "$unsubscribeReason" }, // Group by lowercase reason to merge "STOP" and "stop"
          count: { $sum: 1 },
          originalReason: { $first: "$unsubscribeReason" }, // Keep one original casing for display
        },
      },
      { $sort: { count: -1 } },
    ]);

    const reasons = reasonsAggregation.map((r) => ({
      reason: r.originalReason || "No reason provided", // Handle null/empty reasons
      count: r.count,
    }));

    res.status(200).json({
      success: true,
      data: {
        totalContacts,
        subscribed,
        unsubscribed,
        duplicates,
        reasons,
      },
    });
  } catch (error) {
    console.error("Error fetching contact analytics:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- NEW CONTACT ANALYTICS DASHBOARD ---
const getContactAnalyticsDashboard = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 25,
      search,
      listId,
      status, // hot, warm, cold, dead
      minReplies,
      minScore,
      lastActiveDays,
      sortBy = "lastActive", // engagementScore, lastActive, sent, replies
      sortOrder = "desc",
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = {};

    // 1. Search (Name/Phone)
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
      ];
    }

    // 2. List Filter
    if (listId) {
      query.contactList = listId;
    }

    // 3. Status Filter (Use denormalized computedStatus)
    if (status && status !== "all") {
      query.computedStatus = { $regex: status, $options: "i" };
    }

    // 4. Min Replies Filter (Use denormalized stats.replied)
    if (minReplies) {
      query["stats.replied"] = { $gte: parseInt(minReplies) };
    }

    // 5. Min Engagement Score Filter
    if (minScore) {
      query.engagementScore = { $gte: parseInt(minScore) };
    }

    // 6. Last Active Filter
    // "Within X Days" means lastActive >= Date.now() - X days
    if (lastActiveDays) {
      const dateLimit = new Date();
      dateLimit.setDate(dateLimit.getDate() - parseInt(lastActiveDays));
      query.lastActive = { $gte: dateLimit };
    }

    // 7. Sorting Field Mapping
    // Map frontend sort keys to backend schema paths
    let sortField = sortBy;
    if (sortBy === "sent") sortField = "stats.sent";
    if (sortBy === "replies") sortField = "stats.replied";

    // 8. Execute Query with Pagination
    const [contacts, total] = await Promise.all([
      Contact.find(query)
        .populate("contactList", "name")
        .sort({ [sortField]: sortOrder === "asc" ? 1 : -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(), // Use lean for performance
      Contact.countDocuments(query),
    ]);

    // 9. Format response to match expected frontend structure
    // Frontend expects flat fields like totalSent, replied, etc.
    const formattedContacts = contacts.map((c) => ({
      ...c,
      totalSent: c.stats?.sent || 0,
      delivered: c.stats?.delivered || 0,
      read: c.stats?.read || 0,
      failed: c.stats?.failed || 0,
      replied: c.stats?.replied || 0,
      // Recalculate rates on the fly for display if needed, or trust stored ones if we added them.
      // We didn't add rate fields to schema, so calc here is cheap O(1).
      readRate: c.stats?.sent > 0 ? (c.stats.read / c.stats.sent) * 100 : 0,
      replyRate: c.stats?.sent > 0 ? (c.stats.replied / c.stats.sent) * 100 : 0,
    }));

    res.status(200).json({
      success: true,
      data: formattedContacts,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching contact analytics dashboard:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- NEW FUNCTION TO GET UNSUBSCRIBED CONTACTS BY REASON ---
const getUnsubscribedContacts = async (req, res) => {
  try {
    const { reason } = req.query;
    let query = { isSubscribed: false };

    if (reason) {
      if (reason === "No reason provided") {
        // Match null or empty string
        query.unsubscribeReason = { $in: [null, ""] };
      } else {
        // Case-insensitive match
        query.unsubscribeReason = { $regex: new RegExp(`^${reason}$`, "i") };
      }
    }

    const contacts = await Contact.find(query).sort({
      unsubscribeDate: -1,
      updatedAt: -1,
    });
    res.status(200).json({ success: true, data: contacts });
  } catch (error) {
    console.error("Error fetching unsubscribed contacts:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- NEW CONTACT DETAILS ENDPOINT ---
const getContactDetails = async (req, res) => {
  try {
    const { contactId } = req.params;

    const contact = await Contact.findById(contactId).populate("contactList");
    if (!contact) {
      return res
        .status(404)
        .json({ success: false, error: "Contact not found" });
    }

    // 1. Get Analytics (Campaign History)
    const analytics = await Analytics.find({ contact: contactId })
      .populate("campaign", "name scheduledFor")
      .sort({ createdAt: -1 });

    // 2. Get Replies
    const replies = await Reply.find({
      $or: [
        { recipientId: contact.phoneNumber }, // Outgoing
        { from: contact.phoneNumber }, // Incoming
      ],
    }).sort({ timestamp: -1 });

    // 3. Merge into a Timeline
    const timeline = [
      ...analytics.map((a) => ({
        type: "campaign_event",
        date: a.createdAt,
        status: a.status,
        campaignName: a.campaign?.name || "Unknown Campaign",
        details: a.failureReason,
      })),
      ...replies.map((r) => ({
        type:
          r.direction === "incoming" ? "incoming_message" : "outgoing_message",
        date: r.timestamp,
        content: r.body,
        media: r.mediaUrl,
      })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    res.status(200).json({
      success: true,
      data: {
        contact,
        timeline,
        stats: {
          sent: analytics.filter((a) => a.status === "sent").length,
          delivered: analytics.filter((a) => a.status === "delivered").length,
          read: analytics.filter((a) => a.status === "read").length,
          replied: replies.filter((r) => r.direction === "incoming").length,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching contact details:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- MIGRATION UTILITY ---
const migrateContactStats = async (req, res) => {
  try {
    console.log("Starting migration of contact stats...");
    const contacts = await Contact.find({}).select(
      "_id phoneNumber isSubscribed",
    );

    let processed = 0;
    const batchSize = 100;

    // Process in batches manually or just iterate but use Promise.all limit
    // We'll iterate and update one by one for safety/simplicity in this script, or batches.
    // Batch updates are better.

    const updates = [];

    for (const contact of contacts) {
      // 1. Get Analytics Counts
      const [sent, delivered, read, failed] = await Promise.all([
        Analytics.countDocuments({ contact: contact._id, status: "sent" }),
        Analytics.countDocuments({ contact: contact._id, status: "delivered" }),
        Analytics.countDocuments({ contact: contact._id, status: "read" }),
        Analytics.countDocuments({ contact: contact._id, status: "failed" }),
      ]);

      // 2. Get Reply Count & Last Active
      const replies = await Reply.find({
        from: contact.phoneNumber,
        direction: "incoming",
      })
        .sort({ timestamp: -1 })
        .select("timestamp");

      const replyCount = replies.length;
      const lastActive = replies.length > 0 ? replies[0].timestamp : null;

      // 3. Compute Score & Status
      let score = 0;
      if (sent > 0) {
        const readRate = (read / sent) * 100;
        const replyRate = (replyCount / sent) * 100;
        score = readRate * 0.4 + replyRate * 0.6;
      }

      const daysSinceActive = lastActive
        ? (new Date() - new Date(lastActive)) / (1000 * 60 * 60 * 24)
        : 999;

      let status = "Cold";
      if (!contact.isSubscribed || failed > 3) status = "Dead";
      else if (score > 60 || daysSinceActive < 3) status = "Hot";
      else if (score > 20 || daysSinceActive < 14) status = "Warm";

      updates.push({
        updateOne: {
          filter: { _id: contact._id },
          update: {
            $set: {
              stats: { sent, delivered, read, failed, replied: replyCount },
              lastActive,
              engagementScore: score,
              computedStatus: status,
            },
          },
        },
      });

      processed++;
      if (updates.length >= batchSize) {
        await Contact.bulkWrite(updates);
        updates.length = 0; // Clear array
        console.log(`Migrated ${processed} contacts...`);
      }
    }

    if (updates.length > 0) {
      await Contact.bulkWrite(updates);
    }

    console.log("Migration complete.");
    res
      .status(200)
      .json({ success: true, message: `Migrated ${processed} contacts.` });
  } catch (error) {
    console.error("Migration failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  createContactList,
  getAllContactLists,
  bulkAddContacts,
  getContactsInList,
  deleteContactList,
  deleteContact,
  updateContact,
  getContactStats,
  getContactAnalytics,
  getUnsubscribedContacts,
  bulkDeleteContacts,
  getContactAnalyticsDashboard,
  getContactDetails,
  migrateContactStats, // <-- EXPORT MIGRATION
};
