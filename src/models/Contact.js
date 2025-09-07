// backend/src/models/Contact.js
const mongoose = require('mongoose');

const ContactSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    trim: true,
  },
  name: {
    type: String,
    trim: true,
  },
  contactList: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ContactList',
    required: true,
  },
  // --- THIS IS THE KEY CHANGE ---
  // Variables are now stored as a flexible key-value object
  // Example: { "customer_name": "John", "order_id": "123" }
  variables: {
    type: Map,
    of: String,
  },
}, { timestamps: true });

ContactSchema.index({ phoneNumber: 1, contactList: 1 }, { unique: true });

module.exports = mongoose.model('Contact', ContactSchema);