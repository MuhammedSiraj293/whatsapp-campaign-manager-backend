// backend/src/models/Campaign.js

const mongoose = require('mongoose');

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
  // --- NEW FIELD ---
  // A simple counter for replies to this campaign
  replyCount: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true
});

module.exports = mongoose.model('Campaign', CampaignSchema);