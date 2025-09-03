// backend/src/models/Recipient.js

const mongoose = require('mongoose');

const RecipientSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required.'],
    trim: true,
  },
  name: {
    type: String,
    trim: true,
  },
  status: {
    type: String,
    enum: ['subscribed', 'unsubscribed'],
    default: 'subscribed',
  },
  // This field creates a direct link to the one campaign this recipient belongs to.
  campaign: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true,
  },
}, {
  timestamps: true // Automatically adds createdAt and updatedAt fields
});

// To allow uploading the same phone number for different campaigns, 
// we create a compound index.
RecipientSchema.index({ phoneNumber: 1, campaign: 1 }, { unique: true });

module.exports = mongoose.model('Recipient', RecipientSchema);