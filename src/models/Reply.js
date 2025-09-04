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
    required: true,
    trim: true,
  },
  timestamp: {
    type: Date,
    required: true,
  },
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Recipient',
  },
  // -- NEW FIELD --
  // Tracks if the message was from a user or sent by us
  direction: {
    type: String,
    enum: ['incoming', 'outgoing'],
    required: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Reply', ReplySchema);