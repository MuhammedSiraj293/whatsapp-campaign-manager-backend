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
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'sent', 'failed'],
    default: 'draft',
  },
  // --- THIS IS THE KEY CHANGE ---
  // A campaign is now linked to one ContactList.
  contactList: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ContactList',
    // It's not required when creating, you can assign it later.
  },
}, {
  timestamps: true
});

module.exports = mongoose.model('Campaign', CampaignSchema);