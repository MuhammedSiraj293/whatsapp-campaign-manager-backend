// backend/src/models/Campaign.js

const mongoose = require('mongoose');

// This is the blueprint for our campaign data
const CampaignSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a campaign name'],
    trim: true, // Removes any extra whitespace
  },
  message: {
    type: String,
    required: [true, 'Please provide a message'],
  },
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'sent', 'failed'], // The status must be one of these values
    default: 'draft', // The default value when a new campaign is created
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Create and export the model based on the schema
// Mongoose will create a collection named "campaigns" (plural and lowercase)
module.exports = mongoose.model('Campaign', CampaignSchema);