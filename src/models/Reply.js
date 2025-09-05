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
  // This is the corrected field name
  mediaId: {
    type: String,
  },
  mediaType: {
    type: String, // e.g., 'image', 'video', 'audio', 'document'
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Reply', ReplySchema);