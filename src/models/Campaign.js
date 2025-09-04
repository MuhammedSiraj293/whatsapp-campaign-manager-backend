// backend/src/models/Campaign.js

const mongoose = require('mongoose');

const CampaignSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a campaign name'],
    trim: true,
  },
  // We still save the message body for display purposes in the UI
  message: {
    type: String,
    required: true,
  },
  // -- NEW FIELDS --
  // We now store the official template name and language code
  templateName: {
    type: String,
    required: true,
  },
  templateLanguage: {
    type: String,
    required: true,
  },
  // -- END OF NEW FIELDS --
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'sent', 'failed'],
    default: 'draft',
  },
}, {
  timestamps: true
});

module.exports = mongoose.model('Campaign', CampaignSchema);