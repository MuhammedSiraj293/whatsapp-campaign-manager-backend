// backend/src/controllers/replyController.js

const Reply = require('../models/Reply');
const { sendTextMessage } = require('../integrations/whatsappAPI');

const getConversations = async (req, res) => {
  try {
    const conversations = await Reply.aggregate([
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$from', // Group by the phone number
          lastMessage: { $first: '$body' },
          lastMessageTimestamp: { $first: '$timestamp' },
          // -- NEW: Count unread messages for each group --
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
          unreadCount: 1, // Include the unread count in the final output
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

// --- NEW FUNCTION TO MARK MESSAGES AS READ ---
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
// @desc    Send a text message reply to a specific number
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


// --- NEW FUNCTION TO SEND A MEDIA REPLY ---
const sendMediaReply = async (req, res) => {
    try {
        const { phoneNumber } = req.params;

        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded.' });
        }

        // Use our new WhatsApp service to upload and send the media
        const result = await sendMediaMessage(phoneNumber, req.file);

        // Save a record of the media message to our database
        if (result && result.messages && result.messages[0].id) {
            const newReply = new Reply({
                messageId: result.messages[0].id,
                from: phoneNumber,
                timestamp: new Date(),
                direction: 'outgoing',
                read: true,
                mediaType: req.file.mimetype.split('/')[0],
                // Note: Meta does not provide a permanent URL. In a production app,
                // you would store the file in your own cloud storage (like S3)
                // and save your own URL here. For now, we'll leave it blank.
                mediaUrl: '', 
            });
            await newReply.save();
        }

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to send media reply.' });
    }
};

module.exports = {
  getConversations,
  getMessagesByNumber,
  markAsRead,
  sendReply,
  sendMediaReply, // <-- EXPORT NEW FUNCTION
};