// backend/src/controllers/botController.js

const Contact = require("../models/Contact");
const Campaign = require("../models/Campaign");
const Enquiry = require("../models/Enquiry");

// Helper to check if string contains any of the target words (helps with typos)
const hasAny = (str, words) => words.some(w => str.includes(w));

const parseQueryAndRespond = async (req, res) => {
  try {
    const { message } = req.body;
    const msg = message.toLowerCase();

    // Extract timeframe if specified (e.g. "last 7 days")
    const daysMatch = msg.match(/(\d+)\s*days?/);
    const days = daysMatch ? parseInt(daysMatch[1]) : 30; // Default 30 days
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // MATCH 1: Template Performance
    if (hasAny(msg, ["temp", "msg", "message"]) && hasAny(msg, ["lead", "leaad", "best", "more", "most", "top", "perform"])) {
      const bestTemplates = await Campaign.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: "$templateName",
            totalReplies: { $sum: "$replyCount" }
          }
        },
        { $sort: { totalReplies: -1 } },
        { $limit: 1 }
      ]);
      
      if (bestTemplates.length > 0) {
        return res.status(200).json({ 
          success: true, 
          reply: `In the last ${days} days, the best performing template is **${bestTemplates[0]._id}** with ${bestTemplates[0].totalReplies} total replies (leads).` 
        });
      } else {
        return res.status(200).json({ success: true, reply: `You don't have enough campaign data in the last ${days} days.` });
      }
    }

    // MATCH 2: Contact List with most failures
    if (hasAny(msg, ["list", "contatact", "db"]) && hasAny(msg, ["fail", "error", "dead", "bad", "worst"])) {
      const listFailures = await Contact.aggregate([
        { $match: { "stats.failed": { $gt: 0 }, lastActive: { $gte: startDate } } },
        {
          $group: {
            _id: "$contactList",
            failedMessages: { $sum: "$stats.failed" }
          }
        },
        { $sort: { failedMessages: -1 } },
        { $limit: 1 },
        {
          $lookup: {
            from: "contactlists",
            localField: "_id",
            foreignField: "_id",
            as: "listData"
          }
        },
        { $unwind: "$listData" }
      ]);

      if (listFailures.length > 0) {
        return res.status(200).json({ 
          success: true, 
          reply: `In the last ${days} days, the list with the most failures is **${listFailures[0].listData.name}** with ${listFailures[0].failedMessages} failed deliveries.` 
        });
      } else {
         return res.status(200).json({ success: true, reply: "Great news! No significant failures recorded recently." });
      }
    }

    // MATCH 3: Contact list with most leads
    if (hasAny(msg, ["list", "contatact", "db"]) && hasAny(msg, ["lead", "leaad", "most", "best", "engaged", "repli"])) {
      const bestLists = await Contact.aggregate([
        { $match: { "stats.replied": { $gt: 0 } } }, // overall stats
        {
          $group: {
            _id: "$contactList",
            totalLeads: { $sum: "$stats.replied" }
          }
        },
        { $sort: { totalLeads: -1 } },
        { $limit: 1 },
        {
          $lookup: {
            from: "contactlists",
            localField: "_id",
            foreignField: "_id",
            as: "listData"
          }
        },
        { $unwind: "$listData" }
      ]);

      if (bestLists.length > 0) {
        return res.status(200).json({ 
          success: true, 
          reply: `Overall, the contact list generating the most leads is **${bestLists[0].listData.name}** with ${bestLists[0].totalLeads} total replies.` 
        });
      } else {
         return res.status(200).json({ success: true, reply: "No lists currently have replies logged." });
      }
    }

    // MATCH 4: Campaign Specific Status (e.g. "what is the status of test campaign")
    if (msg.includes("status of") || msg.includes("stats for")) {
      let campaignName = "";
      if (msg.includes("status of")) {
        campaignName = msg.split("status of")[1].trim().replace(/\?$/, "");
      } else {
        campaignName = msg.split("stats for")[1].trim().replace(/\?$/, "");
      }

      if (campaignName) {
        // Find campaign by name (case insensitive)
        const campaign = await Campaign.findOne({ name: { $regex: new RegExp(campaignName, "i") } });
        
        if (campaign) {
          return res.status(200).json({ 
            success: true, 
            reply: `The campaign **${campaign.name}** is currently **${campaign.status.toUpperCase()}**.\nIt delivered ${campaign.deliveredCount || 0} messages, had ${campaign.readCount || 0} reads, ${campaign.replyCount || 0} replies, and ${campaign.failedCount || 0} failures.` 
          });
        } else {
          return res.status(200).json({ success: true, reply: `I couldn't find a campaign named "${campaignName}". Please check the spelling.` });
        }
      }
    }

    // MATCH 5: Enquiries Volume
    if (hasAny(msg, ["enquiries", "enquiry", "inquir"])) {
      const count = await Enquiry.countDocuments({ createdAt: { $gte: startDate } });
      
      return res.status(200).json({ 
        success: true, 
        reply: `You have received **${count}** enquiries in the last ${days} days.` 
      });
    }

    // FALLBACK
    return res.status(200).json({ 
      success: true, 
      reply: "I'm a simple local bot! I look for keywords to answer. Please include your timeframe in the same sentence (e.g., 'Which list generated the most leads in the last 7 days?'). I can tell you about:\n- Top performing templates\n- Contact list failures\n- Top contact lists for leads\n- Enquiry volumes." 
    });

  } catch (error) {
    console.error("Bot Error:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

module.exports = {
  parseQueryAndRespond
};
