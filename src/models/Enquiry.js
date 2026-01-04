// backend/src/models/Enquiry.js

const mongoose = require("mongoose");

const EnquirySchema = new mongoose.Schema(
  {
    // Customer's phone number
    phoneNumber: {
      type: String,
      required: true,
      // ❌ remove unique:true (breaks restarting)
    },

    // The business phone number (recipientId) they contacted
    recipientId: {
      type: String,
      required: true,
    },

    name: { type: String, trim: true },
    projectName: { type: String, trim: true },
    location: { type: String, trim: true },
    pageUrl: { type: String, trim: true },
    budget: { type: String, trim: true },
    bedrooms: { type: String, trim: true },
    intent: { type: String, trim: true }, // Investment / Living
    entrySource: { type: String, trim: true }, // Campaign Name / Direct
    propertyType: { type: String, trim: true }, // Villa / Apartment

    // Tracks the bot's progress
    conversationState: {
      type: String,
      default: "awaiting_name",
    },

    // enquiry status: pending / contacted / closed (your own)
    status: {
      type: String,
      default: "pending",
    },

    // -----------------------------
    // END LOGIC FIELDS
    // -----------------------------

    // Has the user completed the flow?
    endedAt: {
      type: Date,
      default: null,
    },

    // Did the bot already send the END node message?
    endMessageSent: {
      type: Boolean,
      default: false,
    },

    // -----------------------------
    // FOLLOW-UP TRACKING FIELDS
    // -----------------------------

    // Has the 45-minute follow-up been sent?
    followUpSent: {
      type: Boolean,
      default: false,
    },

    // Has the post-completion follow-up been sent?
    completionFollowUpSent: {
      type: Boolean,
      default: false,
    },

    // When was the follow-up sent?
    followUpSentAt: {
      type: Date,
      default: null,
    },

    // Skip asking for name if we already have it from previous enquiry
    skipName: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Allow multiple enquiries for same phone number over time
EnquirySchema.index({ phoneNumber: 1, recipientId: 1 });

// Index for efficient follow-up queries
EnquirySchema.index({
  followUpSent: 1,
  agentContacted: 1,
  conversationState: 1,
  createdAt: 1,
});

module.exports = mongoose.model("Enquiry", EnquirySchema);
