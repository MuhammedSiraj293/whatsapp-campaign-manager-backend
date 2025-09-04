// backend/src/controllers/replyController.js

const Reply = require('../models/Reply');
const { sendTextMessage } = require('../integrations/whatsappAPI'); // <-- IMPORT

// This function gets a list of unique conversations
const getConversations = async (req, res) => {
  try {
    const conversations = await Reply.aggregate([
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$from',
          lastMessage: { $first: '$body' },
          lastMessageTimestamp: { $first: '$timestamp' },
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

// This function gets all messages for a specific phone number
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

// --- NEW FUNCTION TO SEND A REPLY ---
// @desc    Send a text message reply to a specific number
// @route   POST /api/replies/conversations/:phoneNumber
const sendReply = async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, error: 'Message body is required.' });
    }

    // Use our existing WhatsApp service to send the message
    const result = await sendTextMessage(phoneNumber, message);

    // Note: We are not saving the outgoing message to our database in this version.
    // In a full application, you would save this message with a direction of 'outgoing'.

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to send reply.' });
  }
};


module.exports = {
  getConversations,
  getMessagesByNumber,
  sendReply, // <-- EXPORT NEW FUNCTION
};