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
  // --- NEW FIELD ---
  // An array to store variables like ['John'], ['Jane', 'Monday'], etc.
  variables: [
    {
      type: String,
      trim: true,
    }
  ],
}, { timestamps: true });

ContactSchema.index({ phoneNumber: 1, contactList: 1 }, { unique: true });

module.exports = mongoose.model('Contact', ContactSchema);