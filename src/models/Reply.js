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
    // --- NEW FIELD ---
    // The ID of *your* WABA phone number that received/sent the message
    recipientId: {
      type: String,
      required: true,
      trim: true,
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
    // --- NEW FIELD FOR INTERACTIVE MESSAGES ---
    interactive: {
      type: {
        type: String, // 'button' or 'list'
        enum: ["button", "list"],
      },
      header: {
        type: String,
      },
      body: {
        type: String,
      },
      footer: {
        type: String,
      },
      action: {
        buttons: [
          {
            type: { type: String, default: "reply" },
            reply: {
              id: String,
              title: String,
            },
          },
        ],
        button: String,
        sections: [
          {
            title: String,
            rows: [
              {
                id: String,
                title: String,
                description: String,
              },
            ],
          },
        ],
      },
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Reply", ReplySchema);
