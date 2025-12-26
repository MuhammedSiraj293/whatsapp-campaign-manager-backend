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
    mediaUrl: {
      type: String,
    },
    campaign: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
    },
    interactive: {
      type: {
        type: String,
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
    type: {
      type: String,
      default: "text",
    },
    reaction: {
      emoji: String,
      messageId: String,
    },
    context: {
      id: String,
      from: String,
    },
    isAiGenerated: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Reply", ReplySchema);
