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
  },
  { timestamps: true }
);

ContactSchema.index({ phoneNumber: 1, contactList: 1 }, { unique: true });

module.exports = mongoose.model("Contact", ContactSchema);
