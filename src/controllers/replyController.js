// backend/src/controllers/replyController.js

const Reply = require('../models/Reply');

// @desc    Get all replies
// @route   GET /api/replies
const getReplies = async (req, res) => {
  try {
    // Find all replies and sort them by timestamp, newest first
    const replies = await Reply.find().sort({ timestamp: -1 });
    res.status(200).json({ success: true, count: replies.length, data: replies });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

module.exports = {
  getReplies,
};