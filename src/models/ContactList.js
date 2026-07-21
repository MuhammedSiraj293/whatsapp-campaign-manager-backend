// backend/src/models/ContactList.js
const mongoose = require('mongoose');
const Contact = require('./Contact'); // We need to import the Contact model

const ContactListSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a list name'],
    unique: true,
    trim: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
}, { timestamps: true });

// --- THIS IS THE NEW LOGIC ---
// This function runs automatically BEFORE a ContactList document is deleted
ContactListSchema.pre('deleteOne', { document: true, query: false }, async function() {
  console.log(`Contacts being removed for list: ${this._id}`);
  // Find and delete all Contact documents that reference this contactList
  await Contact.deleteMany({ contactList: this._id });
});


module.exports = mongoose.model('ContactList', ContactListSchema);