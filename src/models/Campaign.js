// backend/src/models/Campaign.js

const mongoose = require("mongoose");

const ButtonSchema = new mongoose.Schema({
  type: { type: String, enum: ["QUICK_REPLY", "URL"], required: true },
  text: { type: String, required: true },
  url: { type: String },
});

const CampaignSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please provide a campaign name"],
      trim: true,
    },
    message: { type: String, required: true },
    templateName: { type: String, required: true },
    templateLanguage: { type: String, required: true },
    headerImageUrl: { type: String, trim: true },
    // --- NEW FIELD ---
    // Stores the Media ID from Meta (e.g., "1234567890")
    headerMediaId: { type: String, trim: true },
    bodyVariables: [{ type: String, trim: true }],
    expectedVariables: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["draft", "scheduled", "sending", "sent", "failed"],
      default: "draft",
    },
    contactList: { type: mongoose.Schema.Types.ObjectId, ref: "ContactList" },
    scheduledFor: { type: Date },
    replyCount: { type: Number, default: 0 },
    spreadsheetId: { type: String, trim: true },
    buttons: [ButtonSchema],
    exclusionList: { type: mongoose.Schema.Types.ObjectId, ref: "ContactList" },

    // --- THIS IS THE NEW FIELD ---
    // This links the campaign to the specific phone number it should be sent from.
    phoneNumber: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PhoneNumber",
      required: [true, "Please select a phone number to send from."],
    },
    sentAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Campaign", CampaignSchema);
