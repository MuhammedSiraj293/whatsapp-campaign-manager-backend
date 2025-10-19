// backend/src/controllers/mediaController.js

const axios = require('axios');
const WabaAccount = require('../models/WabaAccount');

// @desc    Proxy to fetch a media file from Meta
// @route   GET /api/media/:mediaId
const getMediaFile = async (req, res) => {
  try {
    const { mediaId } = req.params;

    // 1. Get WABA credentials from database
    const wabaAccount = await WabaAccount.findOne();
    if (!wabaAccount || !wabaAccount.accessToken) {
      return res.status(500).json({ success: false, error: 'WABA account not configured.' });
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
      return res.status(404).json({ success: false, error: 'Media URL not found.' });
    }

    // 3. Download the media file from Meta as a stream
    const mediaResponse = await axios.get(mediaUrl, {
      headers: {
        Authorization: `Bearer ${wabaAccount.accessToken}`,
      },
      responseType: 'stream',
    });

    // 4. Set proper content type and stream to frontend
    res.setHeader('Content-Type', mediaResponse.headers['content-type']);
    mediaResponse.data.pipe(res);

  } catch (error) {
    console.error('Error proxying media:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch media.' });
  }
};

module.exports = {
  getMediaFile,
};
