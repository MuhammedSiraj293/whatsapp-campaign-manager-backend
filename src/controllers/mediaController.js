// backend/src/controllers/mediaController.js

const axios = require("axios");
const WabaAccount = require("../models/WabaAccount");

// @desc    Proxy to fetch a media file from Meta
// @route   GET /api/media/:mediaId
const getMediaFile = async (req, res) => {
  try {
    const { mediaId } = req.params;

    // 1. Get WABA credentials from database
    const wabaAccount = await WabaAccount.findOne();
    if (!wabaAccount || !wabaAccount.accessToken) {
      return res
        .status(500)
        .json({ success: false, error: "WABA account not configured." });
    }

    // 2. Get the media object from Meta (to get the actual download URL)
    const urlResponse = await axios.get(
      `https://graph.facebook.com/v20.0/${mediaId}`,
      {
        headers: {
          Authorization: `Bearer ${wabaAccount.accessToken}`,
        },
      }
    );

    const mediaUrl = urlResponse.data.url;
    if (!mediaUrl) {
      return res
        .status(404)
        .json({ success: false, error: "Media URL not found." });
    }

    // 3. Download the media file from Meta as a stream
    const mediaResponse = await axios.get(mediaUrl, {
      headers: {
        Authorization: `Bearer ${wabaAccount.accessToken}`,
      },
      responseType: "stream",
    });

    // 4. Set proper content type and stream to frontend
    res.setHeader("Content-Type", mediaResponse.headers["content-type"]);
    mediaResponse.data.pipe(res);
  } catch (error) {
    console.error(
      "Error proxying media:",
      error.response?.data || error.message
    );
    res.status(500).json({ success: false, error: "Failed to fetch media." });
  }
};

/* ---------------------------------------------------------
 * UPLOAD MEDIA FOR TEMPLATE (Resumable Upload API)
 * --------------------------------------------------------- */
// @desc    Upload media to Meta to get a handle for Template Creation
// @route   POST /api/media/upload-template-media
// @access  Private
const uploadTemplateMedia = async (req, res) => {
  try {
    const { wabaId } = req.body;
    const file = req.file;

    if (!wabaId || !file) {
      return res
        .status(400)
        .json({ success: false, error: "Missing wabaId or file" });
    }

    const waba = await WabaAccount.findOne({ businessAccountId: wabaId });
    if (!waba) {
      return res.status(404).json({ success: false, error: "WABA not found" });
    }

    const accessToken = waba.accessToken;
    const apiVersion = process.env.FACEBOOK_API_VERSION || "v20.0";
    const appId = process.env.FACEBOOK_APP_ID;

    // 1. Start Resumable Upload Session
    // POST https://graph.facebook.com/v20.0/app/uploads
    const sessionUrl = `https://graph.facebook.com/${apiVersion}/${appId}/uploads`;

    console.log(
      `Starting upload session: ${sessionUrl} (${file.size} bytes, ${file.mimetype})`
    );

    const sessionResponse = await axios.post(sessionUrl, null, {
      params: {
        file_length: file.size,
        file_type: file.mimetype,
        access_token: accessToken, // Use System User Token (WABA token usually works for this if it has permissions)
      },
    });

    const uploadSessionId = sessionResponse.data.id;
    console.log(`Upload Session ID: ${uploadSessionId}`);

    // 2. Upload Binary Data
    // POST https://graph.facebook.com/v20.0/{uploadSessionId}
    const uploadUrl = `https://graph.facebook.com/${apiVersion}/${uploadSessionId}`;

    // Authorization header format is differnet for this endpoint: OAuth <Access Token>
    const uploadResponse = await axios.post(uploadUrl, file.buffer, {
      headers: {
        Authorization: `OAuth ${accessToken}`,
        file_offset: 0,
        "Content-Type": "application/octet-stream", // file.mimetype? No, documentation says octet-stream often used or match
      },
    });

    const handle = uploadResponse.data.h;

    console.log(`✅ Media Uploaded. Handle: ${handle}`);

    res.status(200).json({ success: true, handle: handle });
  } catch (error) {
    console.error(
      "Error uploading template media:",
      error.response?.data || error.message
    );
    res.status(500).json({
      success: false,
      error: error.response?.data?.error?.message || "Failed to upload media",
    });
  }
};

module.exports = {
  getMediaFile,
  uploadTemplateMedia,
};
