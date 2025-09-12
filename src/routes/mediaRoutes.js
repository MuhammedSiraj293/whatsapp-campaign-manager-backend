// backend/src/routes/mediaRoutes.js
    
const express = require('express');
const { getMediaFile } = require('../controllers/mediaController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();
    
// This route will take a media ID and proxy the file from Meta
router.get('/:mediaId', protect, getMediaFile);
    
module.exports = router;