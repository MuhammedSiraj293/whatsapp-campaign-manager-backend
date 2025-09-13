// backend/src/controllers/logController.js

const Log = require('../models/Log');

// @desc    Get all logs
// @route   GET /api/logs
const getLogs = async (req, res) => {
  try {
    // Find all logs and sort them by creation date, newest first
    const logs = await Log.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: logs });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

module.exports = {
  getLogs,
};