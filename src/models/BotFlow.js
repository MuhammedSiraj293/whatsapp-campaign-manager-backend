// backend/src/models/BotFlow.js

const mongoose = require('mongoose');

const BotFlowSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  // Which of your WABA accounts this flow belongs to
  wabaAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WabaAccount',
    required: true,
  },
  // The first node to send when a conversation starts
  startNode: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BotNode',
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('BotFlow', BotFlowSchema);