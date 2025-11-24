// backend/src/models/Analytics.js
    
const mongoose = require('mongoose');
    
const AnalyticsSchema = new mongoose.Schema({
  wamid: {
    type: String,
    required: true,
    unique: true,
  },
  campaign: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true,
  },
  contact: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contact',
    required: true,
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read', 'failed'],
    required: true,
  },
  // --- NEW FIELD ---
  // Stores the specific error message from Meta if the status is 'failed'
  failureReason: {
    type: String,
  },
}, {
  timestamps: true,
});
    
module.exports = mongoose.model('Analytics', AnalyticsSchema);