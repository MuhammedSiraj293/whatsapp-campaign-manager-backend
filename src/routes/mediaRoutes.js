// backend/src/routes/mediaRoutes.js

const express = require('express');
const { getMediaFile } = require('../controllers/mediaController');

const router = express.Router();

// This route will take a media ID and proxy the file from Meta
router.get('/:mediaId', getMediaFile);

module.exports = router;