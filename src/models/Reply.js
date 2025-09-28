// backend/src/models/Reply.js

const mongoose = require("mongoose");

const ReplySchema = new mongoose.Schema(
  {
    messageId: {
      type: String,
      required: true,
      unique: true,
    },
    from: {
      type: String,
      required: true,
    },
    body: {
      type: String,
      trim: true,
    },
    timestamp: {
      type: Date,
      required: true,
    },
    direction: {
      type: String,
      enum: ["incoming", "outgoing"],
      required: true,
    },
    read: {
      type: Boolean,
      default: false,
    },
    mediaId: {
      type: String,
    },
    mediaType: {
      type: String,
    },
    // --- THIS IS THE NEW FIELD ---
    // This field links a reply back to the specific campaign it belongs to
    campaign: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Reply", ReplySchema);
