// backend/src/models/PropertyInquirySession.js
// Tracks the 2-step property inquiry auto-reply flow per user.

const mongoose = require("mongoose");

const PropertyInquirySessionSchema = new mongoose.Schema(
  {
    // Customer's phone number
    phoneNumber: {
      type: String,
      required: true,
    },
    // Business phone number ID they messaged
    recipientId: {
      type: String,
      required: true,
    },
    // The full property URL they shared
    propertyUrl: {
      type: String,
    },
    // Human-readable property name extracted from URL slug
    propertyName: {
      type: String,
    },
    // "awaiting_details" → Step 1 sent, waiting for user form reply
    // "completed"        → Final reply sent, flow done
    state: {
      type: String,
      enum: ["awaiting_details", "completed"],
      default: "awaiting_details",
    },
  },
  { timestamps: true }
);

// One active session per (phone, recipientId) pair
PropertyInquirySessionSchema.index({ phoneNumber: 1, recipientId: 1 });

module.exports = mongoose.model(
  "PropertyInquirySession",
  PropertyInquirySessionSchema
);
