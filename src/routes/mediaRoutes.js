// backend/src/routes/mediaRoutes.js

const express = require('express');
const { getMediaFile } = require('../controllers/mediaController');
// We are removing 'protect' because the <img> tag cannot send an auth token.

const router = express.Router();

// This route is now public so that the browser's <img> tag can access it.
router.get('/:mediaId', getMediaFile);

module.exports = router;