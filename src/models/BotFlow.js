// backend/src/models/BotFlow.js

const mongoose = require("mongoose");

const BotFlowSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    // Which of your WABA accounts this flow belongs to
    wabaAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WabaAccount",
      required: true,
    },
    // The first node to send when a conversation starts
    startNode: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BotNode",
    },
    // --- Post-Completion Follow-Up Settings ---
    completionFollowUpEnabled: {
      type: Boolean,
      default: false,
    },
    completionFollowUpDelay: {
      type: Number, // In minutes
      default: 60,
    },
    completionFollowUpMessage: {
      type: String,
      trim: true,
      default: "Did you find what you were looking for?",
    },
    // IDs of nodes to trigger based on follow-up response
    completionFollowUpYesNodeId: {
      type: String,
      trim: true,
    },
    completionFollowUpNoNodeId: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("BotFlow", BotFlowSchema);
