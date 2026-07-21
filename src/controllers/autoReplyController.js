const AutoReplyConfig = require("../models/AutoReplyConfig");
const { verifyPhoneNumberAccess } = require("../utils/accessControl");

// @desc    Get config for a phone number
// @route   GET /api/auto-reply/:phoneNumberId
const getAutoReplyConfig = async (req, res) => {
  try {
    const { phoneNumberId } = req.params;
    await verifyPhoneNumberAccess(req.user, phoneNumberId);

    let config = await AutoReplyConfig.findOne({ phoneNumberId });

    if (!config) {
      return res.status(200).json({
        success: true,
        data: {
          phoneNumberId,
          greetingEnabled: false,
          greetingText: "",
        },
      });
    }

    res.status(200).json({ success: true, data: config });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
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
    } = req.body;

    if (!phoneNumberId) {
      return res
        .status(400)
        .json({ success: false, error: "Phone Number ID is required." });
    }
    await verifyPhoneNumberAccess(req.user, phoneNumberId);

    const config = await AutoReplyConfig.findOneAndUpdate(
      { phoneNumberId },
      {
        greetingEnabled,
        greetingText,
      },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ success: true, data: config });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    console.error("Error updating auto-reply config:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

module.exports = {
  getAutoReplyConfig,
  updateAutoReplyConfig,
};
