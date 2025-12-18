// backend/src/routes/replyRoutes.js

const express = require("express");
const multer = require("multer");
const {
  getConversations,
  getMessagesByNumber,
  markAsRead,
  sendReply,
  sendMediaReply,
  sendReaction,
  deleteConversation,
  deleteMessage,
  toggleSubscription,
} = require("../controllers/replyController");
const { protect } = require("../middleware/authMiddleware");

const upload = multer({ dest: "uploads/" });
const router = express.Router();

// All reply routes are protected
router.use(protect);

// --- ROUTES ---

// Get all conversations for a specific business phone number
router.get("/conversations/:recipientId", getConversations);

// Get the message history for a specific chat
router.get("/messages/:phoneNumber/:recipientId", getMessagesByNumber);

// Send a text reply
router.post("/send/:phoneNumber/:recipientId", sendReply);

// Send a media reply
router.post(
  "/send-media/:phoneNumber/:recipientId",
  upload.single("file"),
  sendMediaReply
);

// Send a reaction
router.post("/react/:phoneNumber/:recipientId", sendReaction);

// Mark a conversation as read
router.patch("/read/:phoneNumber/:recipientId", markAsRead);

// Delete a conversation
router.delete("/conversations/:phoneNumber/:recipientId", deleteConversation);

// Delete a single message
router.delete("/messages/:messageId", deleteMessage);

// Toggle subscription status
router.post("/subscription/:phoneNumber", toggleSubscription);

module.exports = router;
