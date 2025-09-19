// backend/src/models/Analytics.js
    
const mongoose = require('mongoose');
    
const AnalyticsSchema = new mongoose.Schema({
  // The unique ID of the message from WhatsApp
  wamid: {
    type: String,
    required: true,
    unique: true,
  },
  // The campaign this message belongs to
  campaign: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true,
  },
  // The contact this message was sent to
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