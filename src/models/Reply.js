// backend/src/models/Reply.js

const mongoose = require('mongoose');

const ReplySchema = new mongoose.Schema({
  messageId: {
    type: String,
    required: true,
    unique: true,
  },
  from: {
    type: String,
    required: true,
  },
  body: {
    type: String,
    trim: true,
    // Body is no longer required, as a message could be only an image
  },
  timestamp: {
    type: Date,
    required: true,
  },
  direction: {
    type: String,
    enum: ['incoming', 'outgoing'],
    required: true,
  },
  read: {
    type: Boolean,
    default: false,
  },
  // --- NEW FIELDS ---
  mediaUrl: {
    type: String,
  },
  mediaType: {
    type: String, // e.g., 'image', 'video', 'audio', 'document'
  },
  // --- END OF NEW FIELDS ---
}, {
  timestamps: true,
});

module.exports = mongoose.model('Reply', ReplySchema);