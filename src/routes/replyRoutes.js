// backend/src/routes/replyRoutes.js

const express = require('express');
const multer = require('multer'); // <-- IMPORT MULTER
const { 
  getConversations, 
  getMessagesByNumber,
  markAsRead,
  sendReply,
  sendMediaReply // <-- IMPORT
} = require('../controllers/replyController');

const upload = multer({ dest: 'uploads/' }); // <-- CONFIGURE MULTER
const router = express.Router();

// Route to get a list of unique conversations
router.get('/conversations', getConversations);

// Routes to interact with a specific conversation
router.route('/conversations/:phoneNumber')
  .get(getMessagesByNumber)
  .post(sendReply);

// Route to mark messages as read
router.patch('/conversations/:phoneNumber/read', markAsRead);

// --- NEW ROUTE TO SEND A MEDIA REPLY ---
// This route uses the 'upload.single("file")' middleware to handle the file
router.post('/conversations/:phoneNumber/media', upload.single('file'), sendMediaReply);

module.exports = router;