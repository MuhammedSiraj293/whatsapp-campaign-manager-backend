// backend/src/models/Recipient.js

const mongoose = require('mongoose');

const RecipientSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required.'],
    unique: true, // Prevents duplicate phone numbers in the database
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
  // This creates a relationship between a recipient and the campaigns they are part of.
  campaigns: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
    },
  ],
}, {
  timestamps: true // Automatically adds createdAt and updatedAt fields
});

module.exports = mongoose.model('Recipient', RecipientSchema);