// backend/src/controllers/replyController.js

const Reply = require('../models/Reply');
const { sendTextMessage, sendMediaMessage } = require('../integrations/whatsappAPI');

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

const getMessagesByNumber = async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const messages = await Reply.find({ from: phoneNumber }).sort({ timestamp: 'asc' });
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
  try {
    const { phoneNumber } = req.params;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, error: 'Message body is required.' });
    }

    const result = await sendTextMessage(phoneNumber, message);

    if (result && result.messages && result.messages[0].id) {
      const newReply = new Reply({
        messageId: result.messages[0].id,
        from: phoneNumber,
        body: message,
        timestamp: new Date(),
        direction: 'outgoing',
        read: true,
      });
      await newReply.save();
    }

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to send reply.' });
  }
};

const sendMediaReply = async (req, res) => {
    try {
        const { phoneNumber } = req.params;

        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded.' });
        }

        const result = await sendMediaMessage(phoneNumber, req.file);

        if (result && result.sendResponse && result.sendResponse.messages[0].id) {
            const newReply = new Reply({
                messageId: result.sendResponse.messages[0].id,
                from: phoneNumber,
                timestamp: new Date(),
                direction: 'outgoing',
                read: true,
                mediaType: req.file.mimetype.split('/')[0],
                mediaId: result.mediaId, // Correctly save the mediaId
            });
            await newReply.save();
        }

        res.status(200).json({ success: true, data: result.sendResponse });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to send media reply.' });
    }
};

module.exports = {
  getConversations,
  getMessagesByNumber,
  markAsRead,
  sendReply,
  sendMediaReply,
};