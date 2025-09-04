// backend/src/routes/replyRoutes.js

const express = require('express');
const { 
  getConversations, 
  getMessagesByNumber,
  markAsRead, // <-- IMPORT
  sendReply 
} = require('../controllers/replyController');

const router = express.Router();

// Route to get a list of unique conversations
router.get('/conversations', getConversations);

// Routes to interact with a specific conversation
router.route('/conversations/:phoneNumber')
  .get(getMessagesByNumber)
  .post(sendReply);

// --- NEW ROUTE TO MARK MESSAGES AS READ ---
router.patch('/conversations/:phoneNumber/read', markAsRead);


module.exports = router;