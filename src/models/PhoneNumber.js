// backend/src/models/PhoneNumber.js

const mongoose = require("mongoose");

const PhoneNumberSchema = new mongoose.Schema(
  {
    // A user-friendly name, e.g., "Sales Line" or "Marketing Number"
    phoneNumberName: {
      type: String,
      required: [true, "Please provide a name for this phone number"],
      trim: true,
    },
    // The actual phone number ID from Meta
    phoneNumberId: {
      type: String,
      required: [true, "Please provide the Phone Number ID"],
      unique: true,
    },
    // This links this phone number to its parent WABA account
    wabaAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WabaAccount",
      required: true,
    },
    // --- NEW FIELD ---
    // Links this specific phone number to an active bot flow
    activeBotFlow: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BotFlow", // Links to the BotFlow model
      default: null,
    },
    // --- NEW FIELD ---
    // Enable/Disable AI Assistant for this number
    isAiEnabled: {
      type: Boolean,
      default: false,
    },
    // --- NEW FIELDS ---
    // Enable/Disable Follow-up for this number
    isFollowUpEnabled: {
      type: Boolean,
      default: false,
    },
    // Enable/Disable Review Request for this number
    isReviewEnabled: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("PhoneNumber", PhoneNumberSchema);
