// backend/src/controllers/replyController.js

const Reply = require("../models/Reply");
const Contact = require("../models/Contact");
const PhoneNumber = require("../models/PhoneNumber");
const {
  sendTextMessage,
  sendMediaMessage,
  getMediaUrl,
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
// @desc    Get conversations for a specific business phone number
// @route   GET /api/replies/conversations/:recipientId
const getConversations = async (req, res) => {
  try {
    const { recipientId } = req.params;

    const conversations = await Reply.aggregate([
      { $match: { recipientId: recipientId } },
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
        },
      },
      { $sort: { lastMessageTimestamp: -1 } },
    ]);

    res.status(200).json({ success: true, data: conversations });
  } catch (error) {
    console.error("Error fetching conversations:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- UPGRADED ---
// @desc    Get message history for a specific chat
// @route   GET /api/replies/messages/:phoneNumber/:recipientId
const getMessagesByNumber = async (req, res) => {
  try {
    const { phoneNumber, recipientId } = req.params;

    const messages = await Reply.aggregate([
      { $match: { from: phoneNumber, recipientId: recipientId } },
      { $sort: { timestamp: 1 } },
      {
        $lookup: {
          from: "analytics",
          localField: "messageId",
          foreignField: "wamid",
          as: "analyticsData",
        },
      },
      {
        $project: {
          _id: 1,
          body: 1,
          timestamp: 1,
          mediaType: 1,
          interactive: 1,
          type: 1,
          reaction: 1,
          context: 1,
          status: { $arrayElemAt: ["$analyticsData.status", 0] },
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
const sendReply = async (req, res) => {
  const io = getIO();
  try {
    const { phoneNumber, recipientId } = req.params;
    const { message } = req.body;

    const { accessToken, phoneNumberId } = await getCredentialsFromRecipientId(
      recipientId
    );
    const result = await sendTextMessage(
      phoneNumber,
      message,
      accessToken,
      phoneNumberId
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

module.exports = {
  getConversations,
  getMessagesByNumber,
  markAsRead,
  sendReply,
  sendMediaReply,
};
