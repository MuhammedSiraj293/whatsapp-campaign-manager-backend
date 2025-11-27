// backend/src/models/BotNode.js

const mongoose = require("mongoose");

// Sub-schema for an interactive button
const ButtonSchema = new mongoose.Schema({
  title: { type: String, required: true },
  // The 'nodeId' of the *next* node to go to when this button is clicked
  nextNodeId: { type: String, required: true },
});

// Sub-schema for a row in a list
const ListRowSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  // The 'nodeId' of the *next* node to go to when this row is selected
  nextNodeId: { type: String, required: true },
});

// Sub-schema for a list section
const ListSectionSchema = new mongoose.Schema({
  title: { type: String, required: true },
  rows: [ListRowSchema],
});

const BotNodeSchema = new mongoose.Schema({
  // Link to the parent flow (e.g., "Property Enquiry Bot")
  botFlow: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "BotFlow",
    required: true,
  },
  // User-friendly ID for this node (e.g., "main_menu", "ask_name")
  nodeId: {
    type: String,
    required: true,
    trim: true,
  },
  messageType: {
    type: String,
    enum: ["text", "buttons", "list"],
    required: true,
  },
  messageText: {
    type: String,
    required: true,
  },

  // --- Fields for 'text' (question) nodes ---
  // If this is a question, where should we save the answer?
  // e.g., "name", "email", "budget"
  saveToField: {
    type: String,
    trim: true,
  },
  // After saving, which node should we go to next?
  nextNodeId: {
    type: String,
    trim: true,
  },

  // --- Fields for 'buttons' nodes ---
  buttons: [ButtonSchema],

  // --- Fields for 'list' nodes ---
  listButtonText: {
    // The text on the button that opens the list
    type: String,
    trim: true,
  },
  listSections: [ListSectionSchema],

  // --- Follow-Up Configuration ---
  followUpEnabled: {
    type: Boolean,
    default: false,
  },
  followUpDelay: {
    type: Number, // In minutes
    default: 15,
  },
  followUpMessage: {
    type: String,
    trim: true,
  },
});

// Create a compound index to quickly find a specific node within a specific flow
BotNodeSchema.index({ botFlow: 1, nodeId: 1 }, { unique: true });

module.exports = mongoose.model("BotNode", BotNodeSchema);
