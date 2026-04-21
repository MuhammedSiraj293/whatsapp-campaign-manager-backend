const mongoose = require("mongoose");

const AutoReplyConfigSchema = new mongoose.Schema(
  {
    phoneNumberId: {
      type: String,
      required: true,
      unique: true,
      ref: "PhoneNumber",
    },
    greetingEnabled: {
      type: Boolean,
      default: true,
    },
    greetingText: {
      type: String,
      default: "Hello! Welcome to our service. How can we help you today?",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AutoReplyConfig", AutoReplyConfigSchema);
