// backend/src/routes/replyRoutes.js

const express = require('express');
const { getReplies } = require('../controllers/replyController');

const router = express.Router();

router.route('/').get(getReplies);

module.exports = router;