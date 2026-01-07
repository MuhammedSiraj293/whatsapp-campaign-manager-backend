const axios = require("axios");
const WabaAccount = require("../models/WabaAccount");

// @desc    Get filtered templates for a WABA
// @route   GET /api/templates/:wabaId
// @access  Private
const getTemplates = async (req, res) => {
  try {
    const { wabaId } = req.params;
    const { name, category, language, status, limit = 200 } = req.query;

    // 1. Find WABA to get Access Token
    const waba = await WabaAccount.findOne({ businessAccountId: wabaId });
    if (!waba) {
      return res.status(404).json({ success: false, error: "WABA not found" });
    }

    const accessToken = waba.accessToken;
    const apiVersion = process.env.FACEBOOK_API_VERSION || "v20.0";

    // 2. Call Meta API (Fetch a larger batch to allow for effective backend filtering)
    // Identify what fields we need
    const fields =
      "name,status,category,language,components,last_updated_time,quality_score,rejected_reason";
    const url = `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates?limit=${limit}&fields=${fields}`;

    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    let templates = response.data.data;

    // 3. Backend Filtering
    if (name) {
      const lowerName = name.toLowerCase();
      templates = templates.filter((t) =>
        t.name.toLowerCase().includes(lowerName)
      );
    }

    if (category) {
      // category can be comma separated 'MARKETING,UTILITY'
      const timeCats = category.split(",");
      templates = templates.filter((t) => timeCats.includes(t.category));
    }

    if (language) {
      const langs = language.split(",");
      templates = templates.filter((t) => langs.includes(t.language));
    }

    if (status) {
      // status logic might be complex if mapping 'ACTIVE_HIGH' -> status=APPROVED & quality=HIGH
      // For simple matching first:
      const statuses = status.split(",");
      templates = templates.filter((t) => {
        // Basic status check
        if (statuses.includes(t.status)) return true;
        // Detailed check for quality/sub-statuses could go here
        // e.g. if requested 'ACTIVE_HIGH' check t.status==APPROVED && t.quality_score==HIGH
        return false;
      });
    }

    res
      .status(200)
      .json({ success: true, count: templates.length, data: templates });
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

// @desc    Edit an existing Message Template
// @route   PUT /api/templates/:templateId
// @access  Private (Admin/Manager)
const editTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;
    // We need wabaId to look up the access token, even though we edit by Template ID
    const { wabaId, components } = req.body;

    if (!wabaId || !components) {
      return res
        .status(400)
        .json({ success: false, error: "Missing wabaId or components" });
    }

    // 1. Find WABA
    const waba = await WabaAccount.findOne({ businessAccountId: wabaId });
    if (!waba) {
      return res.status(404).json({ success: false, error: "WABA not found" });
    }

    const accessToken = waba.accessToken;
    const apiVersion = process.env.FACEBOOK_API_VERSION || "v20.0";

    // 2. Call Meta API (POST to Template ID to update)
    // Note: To edit, we send the new components
    const url = `https://graph.facebook.com/${apiVersion}/${templateId}`;

    const payload = {
      components: components,
    };

    const response = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    res.status(200).json({ success: true, data: response.data });
  } catch (error) {
    console.error(
      "Error editing template:",
      error.response?.data || error.message
    );
    res.status(500).json({
      success: false,
      error: error.response?.data?.error?.message || "Failed to edit template",
    });
  }
};

module.exports = {
  getTemplates,
  createTemplate,
  editTemplate,
};
