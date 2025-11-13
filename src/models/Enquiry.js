// backend/src/models/Enquiry.js
    
const mongoose = require('mongoose');
    
const EnquirySchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
  },
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
  // --- THIS IS THE CHANGE ---
  // We change the state to be a "node" in our bot flow.
  // "START" will be the keyword for a new conversation.
  conversationState: {
    type: String,
    default: 'START', // No longer 'awaiting_name'
  },
  status: {
    type: String,
    default: 'pending',
  },
}, {
  timestamps: true,
});
    
EnquirySchema.index({ phoneNumber: 1, recipientId: 1 });
    
module.exports = mongoose.model('Enquiry', EnquirySchema);