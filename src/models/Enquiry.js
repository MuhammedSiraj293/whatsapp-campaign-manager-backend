// backend/src/models/Enquiry.js

const mongoose = require('mongoose');

const EnquirySchema = new mongoose.Schema({
  // Customer's phone number
  phoneNumber: {
    type: String,
    required: true,
    // ❌ remove unique:true (breaks restarting)
  },

  // The business phone number (recipientId) they contacted
  recipientId: {
    type: String,
    required: true,
  },

  name: { type: String, trim: true },
  email: { type: String, trim: true },
  projectName: { type: String, trim: true },
  pageUrl: { type: String, trim: true },
  budget: { type: String, trim: true },
  bedrooms: { type: String, trim: true },

  // Tracks the bot's progress
  conversationState: {
    type: String,
    default: 'awaiting_name',
  },

  // enquiry status: pending / contacted / closed (your own)
  status: {
    type: String,
    default: 'pending',
  },

  // -----------------------------
  // NEW FIELDS FOR END LOGIC
  // -----------------------------

  // Has the user completed the flow?
  endedAt: {
    type: Date,
    default: null,
  },

  // Did the bot already send the END node message?
  endMessageSent: {
    type: Boolean,
    default: false,
  },

  // 45-minute follow-up tracking
  agentContacted: {
    type: Boolean,
    default: false,
  },

  needsImmediateAttention: {
    type: Boolean,
    default: false,
  },

}, {
  timestamps: true,
});

// Allow multiple enquiries for same phone number over time
EnquirySchema.index({ phoneNumber: 1, recipientId: 1 });

module.exports = mongoose.model('Enquiry', EnquirySchema);
