// backend/src/models/User.js

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a name'],
  },
  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please provide a valid email',
    ],
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: 6,
    select: false,
  },
  // --- THIS IS THE CHANGE ---
  // Add the new 'viewer' role to the list
  role: {
    type: String,
    enum: ['admin', 'manager', 'viewer'],
    default: 'viewer', // New users will now default to 'viewer'
  },
   // --- NEW FIELDS FOR 2FA ---
  isTwoFactorEnabled: {
    type: Boolean,
    default: false,
  },
  twoFactorSecret: {
    ascii: String,
    hex: String,
    base32: String,
    otpauth_url: String,
  },
});

// This function runs automatically BEFORE a user document is saved
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// This adds a custom function to our User model to compare passwords
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);