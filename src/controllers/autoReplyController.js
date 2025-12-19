const AutoReplyConfig = require("../models/AutoReplyConfig");

// @desc    Get config for a phone number
// @route   GET /api/auto-reply/:phoneNumberId
const getAutoReplyConfig = async (req, res) => {
  try {
    const { phoneNumberId } = req.params;
    let config = await AutoReplyConfig.findOne({ phoneNumberId });

    if (!config) {
      // Return default empty config structure if not found (or create it?)
      // Let's return defaults to frontend, or create a default one.
      // Better to just return null or defaults without saving to DB yet.
      return res.status(200).json({
        success: true,
        data: {
          phoneNumberId,
          greetingEnabled: false,
          greetingText: "",
          awayMessageEnabled: false,
          awayMessageText: "",
          officeHoursEnabled: false,
          officeHours: [],
          timezone: "UTC",
        },
      });
    }

    res.status(200).json({ success: true, data: config });
  } catch (error) {
    console.error("Error fetching auto-reply config:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// @desc    Create or Update config
// @route   POST /api/auto-reply
const updateAutoReplyConfig = async (req, res) => {
  try {
    const {
      phoneNumberId,
      greetingEnabled,
      greetingText,
      awayMessageEnabled,
      awayMessageText,
      officeHoursEnabled,
      officeHours,
      timezone,
    } = req.body;

    if (!phoneNumberId) {
      return res
        .status(400)
        .json({ success: false, error: "Phone Number ID is required." });
    }

    // Upsert (Update if exists, Insert if not)
    const config = await AutoReplyConfig.findOneAndUpdate(
      { phoneNumberId },
      {
        greetingEnabled,
        greetingText,
        awayMessageEnabled,
        awayMessageText,
        officeHoursEnabled,
        officeHours,
        timezone,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ success: true, data: config });
  } catch (error) {
    console.error("Error updating auto-reply config:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

module.exports = {
  getAutoReplyConfig,
  updateAutoReplyConfig,
};
