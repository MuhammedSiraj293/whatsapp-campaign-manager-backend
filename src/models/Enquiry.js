// backend/src/models/Enquiry.js

const mongoose = require('mongoose');

const EnquirySchema = new mongoose.Schema({
  // Customer's phone number (the unique ID)
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
  },
  // The business phone number (recipientId) they contacted
  recipientId: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    trim: true,
  },
  email: {
    type: String,
    trim: true,
  },
  projectName: {
    type: String,
    trim: true,
  },
  pageUrl: {
    type: String,
    trim: true,
  },
  budget: {
    type: String,
    trim: true,
  },
  bedrooms: {
    type: String,
    trim: true,
  },
  // Tracks the bot's progress
  conversationState: {
    type: String,
    default: 'awaiting_name',
  },
  // 'pending', 'contacted', 'closed'
  status: {
    type: String,
    default: 'pending',
  },
}, {
  timestamps: true,
});

// Create an index to quickly find enquiries for a specific phone number
EnquirySchema.index({ phoneNumber: 1, recipientId: 1 });

module.exports = mongoose.model('Enquiry', EnquirySchema);