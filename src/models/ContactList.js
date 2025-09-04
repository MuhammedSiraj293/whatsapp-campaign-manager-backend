// backend/src/models/ContactList.js
const mongoose = require('mongoose');

const ContactListSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a list name'],
    unique: true,
    trim: true,
  },
}, { timestamps: true });

module.exports = mongoose.model('ContactList', ContactListSchema);