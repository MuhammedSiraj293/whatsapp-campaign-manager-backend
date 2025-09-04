// backend/src/routes/replyRoutes.js

const express = require('express');
const { 
  getConversations, 
  getMessagesByNumber,
  sendReply // <-- IMPORT
} = require('../controllers/replyController');

const router = express.Router();

// Route to get a list of unique conversations
router.get('/conversations', getConversations);

// Route to get all messages for a specific phone number
router.get('/conversations/:phoneNumber', getMessagesByNumber);

// --- NEW ROUTE TO SEND A REPLY ---
router.post('/conversations/:phoneNumber', sendReply);

module.exports = router;