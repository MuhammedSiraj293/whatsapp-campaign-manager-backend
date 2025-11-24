// backend/src/models/Log.js

const mongoose = require('mongoose');

const LogSchema = new mongoose.Schema({
  level: {
    type: String,
    enum: ['info', 'error', 'success'],
    default: 'info',
  },
  message: {
    type: String,
    required: true,
  },
  // Optional link to a campaign for campaign-specific logs
  campaign: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
  },
}, {
  timestamps: true, // Automatically adds createdAt
});

module.exports = mongoose.model('Log', LogSchema);