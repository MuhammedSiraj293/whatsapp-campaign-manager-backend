const express = require('express');
const router = express.Router();
const { parseQueryAndRespond } = require('../controllers/botController');
const { protect } = require('../middleware/authHandler');

router.post('/chat', protect, parseQueryAndRespond);

module.exports = router;
