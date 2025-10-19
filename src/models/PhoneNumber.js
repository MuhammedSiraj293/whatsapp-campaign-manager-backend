// backend/src/models/PhoneNumber.js

const mongoose = require('mongoose');

const PhoneNumberSchema = new mongoose.Schema({
  // A user-friendly name, e.g., "Sales Line" or "Marketing Number"
  phoneNumberName: {
    type: String,
    required: [true, 'Please provide a name for this phone number'],
    trim: true,
  },
  // The actual phone number ID from Meta
  phoneNumberId: {
    type: String,
    required: [true, 'Please provide the Phone Number ID'],
    unique: true,
  },
  // This links this phone number to its parent WABA account
  wabaAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WabaAccount',
    required: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('PhoneNumber', PhoneNumberSchema);