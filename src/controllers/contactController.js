// backend/src/controllers/contactController.js

const Contact = require('../models/Contact');
const ContactList = require('../models/ContactList');

// Helper function to extract named variables from a row
const extractVariables = (row) => {
    const variables = {};
    const reservedKeys = ['phonenumber', 'name'];
    
    Object.keys(row).forEach(key => {
        const keyLower = key.trim().toLowerCase();
        if (!reservedKeys.includes(keyLower)) {
            variables[key.trim()] = row[key];
        }
    });
    return variables;
};

const createContactList = async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'Please provide a list name.' });
  try {
    const contactList = await ContactList.create({ name });
    res.status(201).json({ success: true, data: contactList });
  } catch (error) {
    res.status(400).json({ success: false, error: 'List name may already exist.' });
  }
};

const getAllContactLists = async (req, res) => {
  try {
    const contactLists = await ContactList.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: contactLists });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

// --- NEW FUNCTION FOR PASTED DATA ---
const bulkAddContacts = async (req, res) => {
    const { listId } = req.params;
    const { contacts } = req.body;

    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
        return res.status(400).json({ success: false, error: 'No contacts provided.' });
    }

    // Process each contact to match our database schema
    const processedContacts = contacts.map(contact => ({
        phoneNumber: String(contact.phoneNumber),
        name: contact.name,
        contactList: listId,
        variables: extractVariables(contact),
    }));

    try {
        await Contact.insertMany(processedContacts, { ordered: false });
        res.status(201).json({
            success: true,
            message: `${contacts.length} contacts were processed successfully.`,
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: `Import failed. Some contacts may have been duplicates within this list.`,
            error: error.message,
        });
    }
};

module.exports = { 
    createContactList, 
    getAllContactLists, 
    bulkAddContacts 
};