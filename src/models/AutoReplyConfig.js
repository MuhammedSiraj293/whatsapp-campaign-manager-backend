const mongoose = require("mongoose");

const AutoReplyConfigSchema = new mongoose.Schema(
  {
    phoneNumberId: {
      type: String,
      required: true,
      unique: true, // One config per phone number
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
    awayMessageEnabled: {
      type: Boolean,
      default: false,
    },
    awayMessageText: {
      type: String,
      default:
        "We are currently away. We will get back to you during office hours.",
    },
    // Office Hours: Array of days with open/close times
    officeHoursEnabled: {
      type: Boolean,
      default: false,
    },
    officeHours: [
      {
        day: {
          type: String, // "Monday", "Tuesday", etc.
          enum: [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
          ],
        },
        startTime: { type: String, default: "09:00" }, // HH:mm format (24h)
        endTime: { type: String, default: "17:00" }, // HH:mm format (24h)
        isOpen: { type: Boolean, default: true },
      },
    ],
    timezone: {
      type: String,
      default: "UTC",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AutoReplyConfig", AutoReplyConfigSchema);
