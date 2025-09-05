// backend/src/controllers/mediaController.js

const axios = require('axios');
const wabaConfig = require('../config/wabaConfig');

// @desc    Proxy to fetch a media file from Meta
// @route   GET /api/media/:mediaId
const getMediaFile = async (req, res) => {
  try {
    const { mediaId } = req.params;

    // 1. Get the media object from Meta, which contains the real download URL
    const urlResponse = await axios.get(`https://graph.facebook.com/${wabaConfig.apiVersion}/${mediaId}`, {
      headers: { 'Authorization': `Bearer ${wabaConfig.accessToken}` }
    });
    const mediaUrl = urlResponse.data.url;

    if (!mediaUrl) {
      return res.status(404).send('Media URL not found.');
    }

    // 2. Download the media file from Meta as a stream
    const mediaResponse = await axios.get(mediaUrl, {
      headers: { 'Authorization': `Bearer ${wabaConfig.accessToken}` },
      responseType: 'stream'
    });

    // 3. Stream the file back to the frontend
    res.setHeader('Content-Type', mediaResponse.headers['content-type']);
    mediaResponse.data.pipe(res);

  } catch (error) {
    console.error('Error proxying media:', error.response ? error.response.data : error.message);
    res.status(500).send('Failed to fetch media.');
  }
};

module.exports = {
  getMediaFile,
};