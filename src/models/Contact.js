// backend/src/models/Contact.js
const mongoose = require("mongoose");

const ContactSchema = new mongoose.Schema(
  {
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      trim: true,
    },
    contactList: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ContactList",
      // required: true, // Removed requirement to allow AI-created contacts
    },
    // Variables are stored as a flexible key-value object
    variables: {
      type: Map,
      of: String,
    },
    isSubscribed: {
      type: Boolean,
      default: true,
    },
    unsubscribeReason: {
      type: String,
      trim: true,
    },
    unsubscribeDate: {
      type: Date,
    },
    previousContactList: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ContactList",
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    notes: {
      type: String,
      trim: true,
    },
    // Denormalized Stats for Performance
    stats: {
      sent: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      read: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      replied: { type: Number, default: 0 },
    },
    lastActive: {
      type: Date,
    },
    engagementScore: {
      type: Number,
      default: 0,
    },
    computedStatus: {
      type: String,
      default: "Cold",
    },
  },
  { timestamps: true },
);

ContactSchema.index({ phoneNumber: 1, contactList: 1 }, { unique: true });
ContactSchema.index({ "stats.sent": 1 });
ContactSchema.index({ engagementScore: -1 });
ContactSchema.index({ lastActive: -1 });
ContactSchema.index({ computedStatus: 1 });

module.exports = mongoose.model("Contact", ContactSchema);
