const express = require('express');
const router = express.Router();
const { parseQueryAndRespond } = require('../controllers/botController');
const { protect } = require('../middleware/authMiddleware');

router.post('/chat', protect, parseQueryAndRespond);

module.exports = router;
