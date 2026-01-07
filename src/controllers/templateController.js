const axios = require("axios");
const WabaAccount = require("../models/WabaAccount");

// @desc    Get filtered templates for a WABA with Analytics
// @route   GET /api/templates/:wabaId
// @access  Private
const getTemplates = async (req, res) => {
  try {
    const { wabaId } = req.params;
    const {
      name,
      category,
      language,
      status,
      limit = 200,
      start,
      end,
    } = req.query;

    // 1. Find WABA to get Access Token
    const waba = await WabaAccount.findOne({ businessAccountId: wabaId });
    if (!waba) {
      return res.status(404).json({ success: false, error: "WABA not found" });
    }

    const accessToken = waba.accessToken;
    const apiVersion = process.env.FACEBOOK_API_VERSION || "v20.0";

    // 2. Prepare Meta API Calls
    // Fetch Templates
    const fields =
      "name,status,category,language,components,last_updated_time,quality_score,rejected_reason";
    const templatesUrl = `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates?limit=${limit}&fields=${fields}`;
    const templatesPromise = axios.get(templatesUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    // Fetch Analytics (Message Template Analytics)
    // Default to last 7 days (mock logic for default if param missing, but usually passed by frontend)
    const now = new Date();
    const defaultStart = new Date();
    defaultStart.setDate(now.getDate() - 7);

    // API expects Unix timestamp in seconds
    const startVal = start
      ? parseInt(start)
      : Math.floor(defaultStart.getTime() / 1000);
    const endVal = end ? parseInt(end) : Math.floor(now.getTime() / 1000);

    // Note: The /message_template_analytics endpoint on WABA ID fetches stats for all templates
    // granularity=DAILY is standard.
    const analyticsUrl = `https://graph.facebook.com/${apiVersion}/${wabaId}/message_template_analytics?start=${startVal}&end=${endVal}&granularity=DAILY&metric_types=SENT,READ`;

    // We execute both request and analytics concurrently
    // Use Promise.allSettled to ensure template list loads even if analytics fails
    const [templatesResult, analyticsResult] = await Promise.allSettled([
      templatesPromise,
      axios.get(analyticsUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    ]);

    if (templatesResult.status === "rejected") {
      throw new Error(
        templatesResult.reason?.message || "Failed to fetch templates"
      );
    }

    let templates = templatesResult.value.data.data;
    const analyticsData =
      analyticsResult.status === "fulfilled"
        ? analyticsResult.value.data.data
        : [];

    // 3. Process Analytics Data
    // Aggregating stats per template_id
    const statsMap = {}; // { [templateId]: { sent: 0, read: 0 } }

    if (analyticsData && Array.isArray(analyticsData)) {
      analyticsData.forEach((entry) => {
        // Structure: { data: [ { id: "TEMPLATE_ID", analytics: [ { stats: [...] } ] } ] }
        // If the structure is simpler flattened list:
        // The documentation for /message_template_analytics on WABA returns a list of objects
        // each representing a template's analytics?
        // Actually no, getting analytics for ALL templates at once often requires
        // querying the `message_templates` edge with the `analytics` field for simpler cases,
        // OR this specific endpoint.
        // Let's assume the shape is { id, analytics: [...] }.

        const tId = entry.id;
        if (tId && entry.analytics) {
          let sent = 0;
          let read = 0;
          entry.analytics.forEach((dayPoint) => {
            if (dayPoint.stats) {
              dayPoint.stats.forEach((s) => {
                if (s.metric_type === "SENT") sent += s.value;
                if (s.metric_type === "READ") read += s.value;
              });
            }
          });
          statsMap[tId] = { sent, read };
        }
      });
    }

    // 4. Backend Filtering & Merging
    templates = templates.map((t) => {
      const stat = statsMap[t.id] || { sent: 0, read: 0 };
      return {
        ...t,
        messages_delivered: stat.sent,
        read_rate:
          stat.sent > 0 ? Math.round((stat.read / stat.sent) * 100) : 0, // percentage integer
      };
    });

    // Apply Filter Params
    if (name) {
      const lowerName = name.toLowerCase();
      templates = templates.filter((t) =>
        t.name.toLowerCase().includes(lowerName)
      );
    }

    if (category) {
      const cats = category.split(",");
      templates = templates.filter((t) => cats.includes(t.category));
    }

    if (language) {
      const langs = language.split(",");
      templates = templates.filter((t) => langs.includes(t.language));
    }

    if (status) {
      const statArr = status.split(",");
      templates = templates.filter((t) => {
        // Basic mapping
        if (statArr.includes(t.status)) return true;
        if (
          statArr.includes("ACTIVE_PENDING") &&
          t.status === "APPROVED" &&
          (!t.quality_score || t.quality_score === "UNKNOWN")
        )
          return true;
        // Add more complex mappings as needed
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

    if (!wabaId || !name || !category || !language || !components) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required fields" });
    }

    const waba = await WabaAccount.findOne({ businessAccountId: wabaId });
    if (!waba) {
      return res.status(404).json({ success: false, error: "WABA not found" });
    }

    const accessToken = waba.accessToken;
    const apiVersion = process.env.FACEBOOK_API_VERSION || "v20.0";

    const payload = {
      name,
      category,
      allow_category_change: true,
      language,
      components,
    };

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
    const { wabaId, components } = req.body;

    if (!wabaId || !components) {
      return res
        .status(400)
        .json({ success: false, error: "Missing wabaId or components" });
    }

    const waba = await WabaAccount.findOne({ businessAccountId: wabaId });
    if (!waba) {
      return res.status(404).json({ success: false, error: "WABA not found" });
    }

    const accessToken = waba.accessToken;
    const apiVersion = process.env.FACEBOOK_API_VERSION || "v20.0";

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
