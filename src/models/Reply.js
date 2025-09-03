// backend/src/models/Reply.js

const mongoose = require('mongoose');

const ReplySchema = new mongoose.Schema({
  // The unique ID of the incoming WhatsApp message (wamid)
  messageId: {
    type: String,
    required: true,
    unique: true,
  },
  // The phone number of the user who sent the reply
  from: {
    type: String,
    required: true,
  },
  // The text content of the user's message
  body: {
    type: String,
    required: true,
    trim: true,
  },
  // The timestamp when the message was received
  timestamp: {
    type: Date,
    required: true,
  },
  // An optional link to associate the reply with a recipient
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Recipient',
  },
}, {
  // Automatically add createdAt and updatedAt fields
  timestamps: true,
});

module.exports = mongoose.model('Reply', ReplySchema);