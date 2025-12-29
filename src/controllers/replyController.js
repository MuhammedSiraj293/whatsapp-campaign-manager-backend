// backend/src/controllers/replyController.js

const Reply = require("../models/Reply");
const Contact = require("../models/Contact");
const ContactList = require("../models/ContactList"); // Added for Unsubscriber List logic
const PhoneNumber = require("../models/PhoneNumber");
const {
  sendTextMessage,
  sendMediaMessage,
  getMediaUrl,
  sendReactionMessage,
} = require("../integrations/whatsappAPI");
const { getIO } = require("../socketManager");

// --- NEW HELPER ---
// Finds the correct WABA credentials for a given phone number ID
const getCredentialsFromRecipientId = async (recipientId) => {
  const phoneNumber = await PhoneNumber.findOne({
    phoneNumberId: recipientId,
  }).populate("wabaAccount");
  if (!phoneNumber || !phoneNumber.wabaAccount) {
    throw new Error(`No credentials found for recipientId: ${recipientId}`);
  }
  return {
    accessToken: phoneNumber.wabaAccount.accessToken,
    phoneNumberId: phoneNumber.phoneNumberId,
  };
};

// --- UPGRADED ---
// @desc    Get conversations for a specific business phone number (Paginated)
// @route   GET /api/replies/conversations/:recipientId?page=1&limit=20
const getConversations = async (req, res) => {
  try {
    const { recipientId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || ""; // Extract search term
    const unread = req.query.unread === "true"; // Extract unread filter
    const activeId = req.query.activeId; // Extract active chat ID
    const skip = (page - 1) * limit;

    // Build Match Stage
    const matchStage = { recipientId: recipientId };

    if (search) {
      matchStage.$or = [
        { from: { $regex: search, $options: "i" } }, // Search by Phone Number
        { body: { $regex: search, $options: "i" } }, // Search by Message Content
      ];
    }

    const pipeline = [
      { $match: matchStage },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: "$from",
          lastMessage: { $first: "$body" },
          lastMessageTimestamp: { $first: "$timestamp" },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$read", false] },
                    { $eq: ["$direction", "incoming"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $lookup: {
          from: "contacts",
          localField: "_id",
          foreignField: "phoneNumber",
          as: "contactInfo",
        },
      },
      {
        $project: {
          _id: 1,
          lastMessage: 1,
          lastMessageTimestamp: 1,
          unreadCount: 1,
          name: { $arrayElemAt: ["$contactInfo.name", 0] },
          isSubscribed: { $arrayElemAt: ["$contactInfo.isSubscribed", 0] }, // Include subscription status
        },
      },
    ];

    // Filter by Unread if requested
    if (unread) {
      if (activeId) {
        // If there's an active chat, keep it visible even if read
        pipeline.push({
          $match: {
            $or: [{ unreadCount: { $gt: 0 } }, { _id: activeId }],
          },
        });
      } else {
        pipeline.push({ $match: { unreadCount: { $gt: 0 } } });
      }
    }

    pipeline.push(
      { $sort: { lastMessageTimestamp: -1 } },
      { $skip: skip },
      { $limit: limit }
    );

    const conversations = await Reply.aggregate(pipeline);

    res.status(200).json({ success: true, data: conversations });
  } catch (error) {
    console.error("Error fetching conversations:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- UPGRADED ---
// @desc    Get message history for a specific chat (Paginated)
// @route   GET /api/replies/messages/:phoneNumber/:recipientId?page=1&limit=50
const getMessagesByNumber = async (req, res) => {
  try {
    const { phoneNumber, recipientId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const messages = await Reply.aggregate([
      {
        $match: {
          $or: [
            { from: phoneNumber, recipientId: recipientId }, // Customer -> Business
            { from: recipientId, recipientId: phoneNumber }, // Business -> Customer
          ],
        },
      },
      { $sort: { timestamp: -1 } }, // Newest first for pagination
      { $skip: skip },
      { $limit: limit },
      { $sort: { timestamp: 1 } }, // Re-sort to Oldest first for display
      {
        $lookup: {
          from: "analytics",
          localField: "messageId",
          foreignField: "wamid",
          as: "analyticsData",
        },
      },
      {
        $lookup: {
          from: "replies",
          let: { msgId: "$messageId" },
          pipeline: [
            { $match: { $expr: { $eq: ["$reaction.messageId", "$$msgId"] } } },
            { $project: { emoji: "$reaction.emoji", from: "$from" } },
          ],
          as: "reactions",
        },
      },
      {
        $lookup: {
          from: "replies",
          localField: "context.id",
          foreignField: "messageId",
          as: "quotedMessageData",
        },
      },
      {
        $project: {
          _id: 1,
          messageId: 1,
          body: 1,
          timestamp: 1,
          direction: 1,
          mediaType: 1,
          interactive: 1,
          type: 1,
          reaction: 1,
          context: 1,
          status: { $arrayElemAt: ["$analyticsData.status", 0] },
          reactions: 1,
          quotedMessage: { $arrayElemAt: ["$quotedMessageData", 0] },
          mediaUrl: 1,
          mediaId: 1,
        },
      },
    ]);

    res.status(200).json({ success: true, data: messages });
  } catch (error) {
    console.error(
      `Error fetching messages for ${req.params.phoneNumber}:`,
      error
    );
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- UPGRADED ---
// @desc    Send a text reply
// @route   POST /api/replies/send/:phoneNumber/:recipientId
// --- UPGRADED ---
// @desc    Send a text reply
// @route   POST /api/replies/send/:phoneNumber/:recipientId
const sendReply = async (req, res) => {
  const io = getIO();
  try {
    const { phoneNumber, recipientId } = req.params;
    const { message, context } = req.body; // Extract context (quoted message)

    const { accessToken, phoneNumberId } = await getCredentialsFromRecipientId(
      recipientId
    );

    // If context is provided, it should be the WAMID of the message being replied to
    const contextMessageId = context ? context.messageId : null;

    const result = await sendTextMessage(
      phoneNumber,
      message,
      accessToken,
      phoneNumberId,
      contextMessageId
    );

    if (result?.messages?.[0]?.id) {
      const newReply = new Reply({
        messageId: result.messages[0].id,
        from: phoneNumber,
        recipientId: recipientId,
        body: message,
        timestamp: new Date(),
        direction: "outgoing",
        read: true,
        context: contextMessageId ? { id: contextMessageId } : undefined, // Save context in DB
      });
      await newReply.save();
      io.emit("newMessage", {
        from: phoneNumber,
        recipientId: recipientId,
        message: newReply,
      });
    }

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("Error sending reply:", error.message);
    res.status(500).json({ success: false, error: "Failed to send reply." });
  }
};

// --- NEW ---
// @desc    Send a reaction
// @route   POST /api/replies/react/:phoneNumber/:recipientId
const sendReaction = async (req, res) => {
  const io = getIO();
  try {
    const { phoneNumber, recipientId } = req.params;
    const { messageId, emoji } = req.body;

    const { accessToken, phoneNumberId } = await getCredentialsFromRecipientId(
      recipientId
    );

    await sendReactionMessage(
      phoneNumber,
      messageId,
      emoji,
      accessToken,
      phoneNumberId
    );

    // Save reaction as a new Reply document (or update existing if you prefer, but your aggregation uses a separate doc)
    // Based on your aggregation pipeline, you look up reactions from the 'replies' collection.
    // So we should save it as a Reply.

    const newReaction = new Reply({
      messageId: `reaction_${Date.now()}`, // Internal ID for the reaction event
      from: phoneNumber, // The business sent the reaction
      recipientId: recipientId,
      timestamp: new Date(),
      direction: "outgoing",
      read: true,
      type: "reaction",
      reaction: {
        messageId: messageId, // The message being reacted to
        emoji: emoji,
      },
    });

    await newReaction.save();

    // Emit socket event so frontend updates immediately
    io.emit("newMessage", {
      from: phoneNumber,
      recipientId: recipientId,
      message: newReaction,
    });

    res.status(200).json({ success: true, message: "Reaction sent" });
  } catch (error) {
    console.error("Error sending reaction:", error.message);
    res.status(500).json({ success: false, error: "Failed to send reaction." });
  }
};

// --- UPGRADED ---
// @desc    Send a media reply
// @route   POST /api/replies/send-media/:phoneNumber/:recipientId
const sendMediaReply = async (req, res) => {
  const io = getIO();
  try {
    const { phoneNumber, recipientId } = req.params;
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "No file uploaded." });
    }

    const { accessToken, phoneNumberId } = await getCredentialsFromRecipientId(
      recipientId
    );
    const result = await sendMediaMessage(
      phoneNumber,
      req.file,
      accessToken,
      phoneNumberId
    );

    if (result?.sendResponse?.messages?.[0]?.id) {
      const newReply = new Reply({
        messageId: result.sendResponse.messages[0].id,
        from: phoneNumber,
        recipientId: recipientId,
        timestamp: new Date(),
        direction: "outgoing",
        read: true,
        mediaType: req.file.mimetype.split("/")[0],
        mediaId: result.mediaId,
      });
      await newReply.save();
      io.emit("newMessage", {
        from: phoneNumber,
        recipientId: recipientId,
        message: newReply,
      });
    }

    res.status(200).json({ success: true, data: result.sendResponse });
  } catch (error) {
    console.error("Error sending media reply:", error.message);
    res
      .status(500)
      .json({ success: false, error: "Failed to send media reply." });
  }
};

// --- UPGRADED ---
// @desc    Mark messages as read
// @route   PATCH /api/replies/read/:phoneNumber/:recipientId
const markAsRead = async (req, res) => {
  try {
    const { phoneNumber, recipientId } = req.params;
    await Reply.updateMany(
      {
        from: phoneNumber,
        recipientId: recipientId,
        read: false,
        direction: "incoming",
      },
      { $set: { read: true } }
    );
    res
      .status(200)
      .json({ success: true, message: "Messages marked as read." });
  } catch (error) {
    console.error("Error marking messages as read:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- NEW ---
// @desc    Delete a conversation (all messages between two numbers)
// @route   DELETE /api/replies/conversations/:phoneNumber/:recipientId
const deleteConversation = async (req, res) => {
  try {
    const { phoneNumber, recipientId } = req.params;
    await Reply.deleteMany({
      $or: [
        { from: phoneNumber, recipientId: recipientId },
        { from: recipientId, recipientId: phoneNumber }, // Handle both directions if needed, but schema seems to use recipientId as business phone usually?
        // Wait, the schema is: from (sender), recipientId (receiver).
        // A conversation is defined by the pair.
        // If I am the business (recipientId), incoming messages have me as recipientId.
        // Outgoing messages have me as from.
        // So we need to delete where (from=customer AND recipientId=business) OR (from=business AND recipientId=customer).
      ],
    });

    // Actually, let's stick to the pattern used in getMessagesByNumber:
    // { $match: { from: phoneNumber, recipientId: recipientId } }
    // This seems to fetch messages *from* the contact *to* the business?
    // Let's re-read getMessagesByNumber.
    // It matches { from: phoneNumber, recipientId: recipientId }.
    // Wait, getMessagesByNumber takes :phoneNumber (customer) and :recipientId (business).
    // So it fetches messages sent BY the customer TO the business?
    // What about outgoing?
    // Ah, the socket listener handles both.
    // Let's look at getMessagesByNumber again.
    // It seems to ONLY fetch incoming messages?
    // No, wait. The aggregation pipeline in getMessagesByNumber might be incomplete in my view or I missed something.
    // Let's look at the file content I viewed earlier.
    // Line 94: { $match: { from: phoneNumber, recipientId: recipientId } }
    // This strictly matches messages FROM phoneNumber TO recipientId.
    // If phoneNumber is the customer and recipientId is the business, this ONLY gets incoming messages.
    // UNLESS the frontend passes different params for outgoing?
    // But the frontend calls `/replies/messages/${customerPhone}/${recipientId}`.
    // This implies the current backend might only be returning one side of the conversation?
    // OR `phoneNumber` in the query is treated as "the other party".

    // Let's assume for deletion we want to delete ALL messages involving this customer for this business.
    // So: (from=customer AND recipientId=business) OR (from=business AND recipientId=customer).

    await Reply.deleteMany({
      $or: [
        { from: phoneNumber, recipientId: recipientId },
        { from: recipientId, recipientId: phoneNumber }, // Assuming recipientId is the business phone ID
      ],
    });

    res.status(200).json({ success: true, message: "Conversation deleted" });
  } catch (error) {
    console.error("Error deleting conversation:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- NEW ---
// @desc    Delete a single message
// @route   DELETE /api/replies/messages/:messageId
const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    await Reply.findOneAndDelete({ _id: messageId }); // Assuming _id is passed, or messageId field?
    // The frontend usually has _id. Let's support both or just _id.
    // If the route is /messages/:messageId, let's assume it's the Mongo _id.

    res.status(200).json({ success: true, message: "Message deleted" });
  } catch (error) {
    console.error("Error deleting message:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- NEW ---
// @desc    Toggle subscription status (Unsubscribe/Resubscribe)
// @route   POST /api/replies/subscription/:phoneNumber
const toggleSubscription = async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const { status } = req.body; // true = Resubscribe, false = Unsubscribe

    console.log(`Manual subscription toggle for ${phoneNumber}: ${status}`);

    if (status === false) {
      // --- UNSUBSCRIBE LOGIC ---
      // 1. Mark ALL existing contacts for this number as unsubscribed
      await Contact.updateMany(
        { phoneNumber: phoneNumber },
        { $set: { isSubscribed: false } }
      );

      // 2. Add to "Unsubscriber List" if not already there
      let unsubList = await ContactList.findOne({ name: "Unsubscriber List" });
      if (!unsubList) {
        unsubList = await ContactList.create({ name: "Unsubscriber List" });
        console.log(`Created new Unsubscriber List: ${unsubList._id}`);
      }

      const existingInUnsub = await Contact.findOne({
        phoneNumber: phoneNumber,
        contactList: unsubList._id,
      });

      if (!existingInUnsub) {
        // Find a name from an existing contact to reuse, or default to "Unknown"
        const anyContact = await Contact.findOne({ phoneNumber: phoneNumber });
        const contactName = anyContact ? anyContact.name : "Unknown";

        await Contact.create({
          phoneNumber: phoneNumber,
          name: contactName,
          contactList: unsubList._id,
          isSubscribed: false,
        });
      }

      res
        .status(200)
        .json({ success: true, message: "Unsubscribed successfully" });
    } else {
      // --- RESUBSCRIBE LOGIC ---
      // 1. Mark ALL existing contacts for this number as subscribed
      await Contact.updateMany(
        { phoneNumber: phoneNumber },
        { $set: { isSubscribed: true } }
      );

      // 2. Remove from "Unsubscriber List"
      const unsubList = await ContactList.findOne({
        name: "Unsubscriber List",
      });
      if (unsubList) {
        await Contact.deleteMany({
          phoneNumber: phoneNumber,
          contactList: unsubList._id,
        });
      }

      res
        .status(200)
        .json({ success: true, message: "Resubscribed successfully" });
    }
  } catch (error) {
    console.error("Error toggling subscription:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to update subscription." });
  }
};

module.exports = {
  getConversations,
  getMessagesByNumber,
  markAsRead,
  sendReply,
  sendMediaReply,
  sendReaction,
  deleteConversation,
  deleteMessage,
  toggleSubscription,
};
