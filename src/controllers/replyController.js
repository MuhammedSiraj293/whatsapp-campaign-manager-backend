// backend/src/controllers/replyController.js

const Reply = require('../models/Reply');
const Campaign = require('../models/Campaign');
const Analytics = require('../models/Analytics');
const Contact = require('../models/Contact');
const { sendTextMessage, sendMediaMessage } = require('../integrations/whatsappAPI');
const { getIO } = require('../socketManager'); // <-- 1. IMPORT from the manager

const getConversations = async (req, res) => {
  try {
    const conversations = await Reply.aggregate([
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$from',
          lastMessage: { $first: '$body' },
          lastMessageTimestamp: { $first: '$timestamp' },
          unreadCount: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$read', false] }, { $eq: ['$direction', 'incoming'] }] }, 1, 0]
            }
          }
        },
      },
      {
        $lookup: {
          from: 'contacts',
          localField: '_id',
          foreignField: 'phoneNumber',
          as: 'contactInfo',
        },
      },
      {
        $project: {
          _id: 1,
          lastMessage: 1,
          lastMessageTimestamp: 1,
          unreadCount: 1,
          name: { $arrayElemAt: ['$contactInfo.name', 0] },
        },
      },
      { $sort: { lastMessageTimestamp: -1 } },
    ]);

    res.status(200).json({ success: true, data: conversations });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

// --- THIS FUNCTION IS UPGRADED ---
const getMessagesByNumber = async (req, res) => {
  try {
    const { phoneNumber } = req.params;

    // Use a MongoDB Aggregation Pipeline to join Replies with Analytics
    const messages = await Reply.aggregate([
      // 1. Find all messages for this conversation
      { $match: { from: phoneNumber } },
      // 2. Sort them by time
      { $sort: { timestamp: 1 } },
      // 3. Join with the 'analytics' collection to get the status for outgoing messages
      {
        $lookup: {
          from: 'analytics', // The collection to join with
          localField: 'messageId', // Field from the 'replies' collection
          foreignField: 'wamid',   // Field from the 'analytics' collection
          as: 'analyticsData'    // Name for the new array field
        }
      },
      // 4. Reshape the data to include the status
      {
        $project: {
          _id: 1, body: 1, timestamp: 1, direction: 1, mediaId: 1, mediaType: 1,
          // Get the 'status' from the first item in the analyticsData array
          status: { $arrayElemAt: ['$analyticsData.status', 0] }
        }
      }
    ]);
    
    res.status(200).json({ success: true, data: messages });
  } catch (error) {
    console.error(`Error fetching messages for ${req.params.phoneNumber}:`, error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

const markAsRead = async (req, res) => {
    try {
        const { phoneNumber } = req.params;
        await Reply.updateMany(
            { from: phoneNumber, read: false, direction: 'incoming' },
            { $set: { read: true } }
        );
        res.status(200).json({ success: true, message: 'Messages marked as read.' });
    } catch (error) {
        console.error(`Error marking messages as read for ${req.params.phoneNumber}:`, error);
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};

const sendReply = async (req, res) => {
   const io = getIO(); // <-- 2. GET the io instance
  try {
    const { phoneNumber } = req.params;
    const { message } = req.body;
    if (!message) {
      return res
        .status(400)
        .json({ success: false, error: "Message body is required." });
    }
    const result = await sendTextMessage(phoneNumber, message);
    if (result && result.messages && result.messages[0].id) {
      const newReply = new Reply({
        messageId: result.messages[0].id,
        from: phoneNumber,
        body: message,
        timestamp: new Date(),
        direction: "outgoing",
        read: true,
      });
      await newReply.save();
      // --- THIS IS THE FIX ---
      io.emit("newMessage", { from: phoneNumber, message: newReply });
    }
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to send reply." });
  }
};

const sendMediaReply = async (req, res) => {
   const io = getIO(); // <-- 2. GET the io instance
  try {
    const { phoneNumber } = req.params;
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "No file uploaded." });
    }
    const result = await sendMediaMessage(phoneNumber, req.file);
    if (result && result.sendResponse && result.sendResponse.messages[0].id) {
      const newReply = new Reply({
        messageId: result.sendResponse.messages[0].id,
        from: phoneNumber,
        timestamp: new Date(),
        direction: "outgoing",
        read: true,
        mediaType: req.file.mimetype.split("/")[0],
        mediaId: result.mediaId,
      });
      await newReply.save();
      // --- THIS IS THE FIX ---
      io.emit("newMessage", { from: phoneNumber, message: newReply });
    }
    res.status(200).json({ success: true, data: result.sendResponse });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, error: "Failed to send media reply." });
  }
};

module.exports = {
  getConversations,
  getMessagesByNumber,
  markAsRead,
  sendReply,
  sendMediaReply,
};