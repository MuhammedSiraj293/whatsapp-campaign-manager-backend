// backend/src/routes/replyRoutes.js

const express = require('express');
const multer = require('multer');
const { 
  getConversations, 
  getMessagesByNumber,
  markAsRead,
  sendReply,
  sendMediaReply
} = require('../controllers/replyController');
const { protect } = require('../middleware/authMiddleware');

const upload = multer({ dest: 'uploads/' });
const router = express.Router();

// All reply routes are protected
router.use(protect);

router.get('/conversations', getConversations);

router.route('/conversations/:phoneNumber')
  .get(getMessagesByNumber)
  .post(sendReply);

router.patch('/conversations/:phoneNumber/read', markAsRead);

router.post('/conversations/:phoneNumber/media', upload.single('file'), sendMediaReply);

module.exports = router;