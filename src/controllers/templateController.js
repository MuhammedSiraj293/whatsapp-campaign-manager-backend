const axios = require("axios");
const WabaAccount = require("../models/WabaAccount");

// @desc    Get all templates for a WABA
// @route   GET /api/templates/:wabaId
// @access  Private
const getTemplates = async (req, res) => {
  try {
    const { wabaId } = req.params;

    // 1. Find WABA to get Access Token
    const waba = await WabaAccount.findOne({ businessAccountId: wabaId });
    if (!waba) {
      return res.status(404).json({ success: false, error: "WABA not found" });
    }

    const accessToken = waba.accessToken;
    const apiVersion = process.env.FACEBOOK_API_VERSION || "v20.0";

    // 2. Call Meta API
    const url = `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates?limit=100`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    res.status(200).json({ success: true, data: response.data.data });
  } catch (error) {
    console.error(
      "Error fetching templates:",
      error.response?.data || error.message
    );
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch templates" });
  }
};

// @desc    Create a new Message Template
// @route   POST /api/templates
// @access  Private (Admin/Manager)
const createTemplate = async (req, res) => {
  try {
    const { wabaId, name, category, language, components } = req.body;

    // Basic Validation
    if (!wabaId || !name || !category || !language || !components) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required fields" });
    }

    // 1. Find WABA
    const waba = await WabaAccount.findOne({ businessAccountId: wabaId });
    if (!waba) {
      return res.status(404).json({ success: false, error: "WABA not found" });
    }

    const accessToken = waba.accessToken;
    const apiVersion = process.env.FACEBOOK_API_VERSION || "v20.0";

    // 2. Prepare Payload
    const payload = {
      name,
      category,
      allow_category_change: true,
      language,
      components,
    };

    // 3. Call Meta API
    const url = `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates`;
    const response = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    res.status(201).json({ success: true, data: response.data });
  } catch (error) {
    console.error(
      "Error creating template:",
      error.response?.data || error.message
    );
    res.status(500).json({
      success: false,
      error:
        error.response?.data?.error?.message || "Failed to create template",
    });
  }
};

module.exports = {
  getTemplates,
  createTemplate,
};
