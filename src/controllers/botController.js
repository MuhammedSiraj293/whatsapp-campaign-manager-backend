// backend/src/controllers/botController.js

const Contact = require("../models/Contact");
const Campaign = require("../models/Campaign");
const Enquiry = require("../models/Enquiry");

const parseQueryAndRespond = async (req, res) => {
  try {
    const { message } = req.body;
    const msg = message.toLowerCase();

    // MATCH 1: Template Performance
    if (msg.includes("template") && (msg.includes("lead") || msg.includes("best") || msg.includes("more") || msg.includes("most"))) {
      const bestTemplates = await Campaign.aggregate([
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
          reply: `The best performing template is **${bestTemplates[0]._id}** with ${bestTemplates[0].totalReplies} total replies (leads).` 
        });
      } else {
        return res.status(200).json({ success: true, reply: "You don't have enough campaign data to determine the best template yet." });
      }
    }

    // MATCH 2: Contact List with most failures
    if (msg.includes("list") && (msg.includes("fail") || msg.includes("error") || msg.includes("dead"))) {
      const listFailures = await Contact.aggregate([
        { $match: { "stats.failed": { $gt: 0 } } },
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
            from: "contactlists", // check your collection name if it's 'contactlists'
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
          reply: `The contact list with the most failures is **${listFailures[0].listData.name}** with ${listFailures[0].failedMessages} failed deliveries.` 
        });
      } else {
         return res.status(200).json({ success: true, reply: "Great news! You don't have any significant failures recorded across your lists." });
      }
    }

    // MATCH 3: Contact list with most leads
    if (msg.includes("list") && (msg.includes("lead") || msg.includes("most") || msg.includes("best") || msg.includes("engaged"))) {
      const bestLists = await Contact.aggregate([
        { $match: { "stats.replied": { $gt: 0 } } },
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
          reply: `The contact list generating the most leads is **${bestLists[0].listData.name}** with ${bestLists[0].totalLeads} replies.` 
        });
      } else {
         return res.status(200).json({ success: true, reply: "No lists currently have replies logged." });
      }
    }

    // MATCH 4: Enquiries Volume
    if (msg.includes("enquiries") || msg.includes("enquiry")) {
      // By default count last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const count = await Enquiry.countDocuments({ createdAt: { $gte: thirtyDaysAgo } });
      
      return res.status(200).json({ 
        success: true, 
        reply: `You have received **${count}** enquiries in the last 30 days.` 
      });
    }

    // FALLBACK
    return res.status(200).json({ 
      success: true, 
      reply: "I'm a simple local bot! I can tell you about:\n- Which template got the most leads\n- Which contact list has the most failures\n- Which list is generating the most leads\n- How many enquiries you received recently." 
    });

  } catch (error) {
    console.error("Bot Error:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

module.exports = {
  parseQueryAndRespond
};
