// backend/src/routes/webhookRoutes.js

const express = require('express');
const { verifyWebhook, processWebhook } = require('../middleware/webhookHandler');

const router = express.Router();

// This route handles the verification GET request from Meta
router.get('/', verifyWebhook);

// This route handles the POST request that contains the message data
router.post('/', processWebhook);

module.exports = router;