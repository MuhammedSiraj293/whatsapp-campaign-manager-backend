// backend/src/models/WabaAccount.js

const mongoose = require("mongoose");

const WabaAccountSchema = new mongoose.Schema(
  {
    // A user-friendly name, e.g., "Client A" or "Marketing Account"
    accountName: {
      type: String,
      required: [true, "Please provide an account name"],
      trim: true,
    },
    // The permanent access token for this WABA
    accessToken: {
      type: String,
      required: [true, "Please provide the Access Token"],
    },
    // The Business Account ID
    businessAccountId: {
      type: String,
      required: [true, "Please provide the Business Account ID"],
    },
    // --- NEW FIELD ---
    // The ID of the single Google Sheet to send all leads to for this account
    masterSpreadsheetId: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("WabaAccount", WabaAccountSchema);
