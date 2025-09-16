// backend/src/models/Campaign.js

const mongoose = require('mongoose');

// A sub-schema for the buttons
const ButtonSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['QUICK_REPLY', 'URL'],
    required: true,
  },
  text: {
    type: String,
    required: true,
  },
  // URL is only required if the button type is 'URL'
  url: {
    type: String,
  },
});

const CampaignSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a campaign name'],
    trim: true,
  },
  message: {
    type: String,
    required: true,
  },
  templateName: {
    type: String,
    required: true,
  },
  templateLanguage: {
    type: String,
    required: true,
  },
  headerImageUrl: {
    type: String,
    trim: true,
  },
  bodyVariables: [
    {
      type: String,
      trim: true,
    }
  ],
  expectedVariables: {
      type: Number,
      default: 0,
  },
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'sent', 'failed'],
    default: 'draft',
  },
  contactList: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ContactList',
  },
  scheduledFor: {
    type: Date,
  },
  replyCount: {
    type: Number,
    default: 0,
  },
  spreadsheetId: {
    type: String,
    trim: true,
  },
  // --- NEW FIELD ---
  // An array to store the button configurations
  buttons: [ButtonSchema],
}, {
  timestamps: true
});

module.exports = mongoose.model('Campaign', CampaignSchema);