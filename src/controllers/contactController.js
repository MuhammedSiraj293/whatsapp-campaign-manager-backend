// backend/src/controllers/contactController.js

const fs = require('fs');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const axios = require('axios');
const wabaConfig = require('../config/wabaConfig');
const Contact = require('../models/Contact');
const ContactList = require('../models/ContactList');

// @desc    Create a new contact list (segment)
const createContactList = async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, error: 'Please provide a list name.' });
  }
  try {
    const contactList = await ContactList.create({ name });
    res.status(201).json({ success: true, data: contactList });
  } catch (error) {
    res.status(400).json({ success: false, error: 'List name may already exist.' });
  }
};

// @desc    Get all contact lists
const getAllContactLists = async (req, res) => {
  try {
    const contactLists = await ContactList.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: contactLists });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

// @desc    Upload contacts to a specific list
const uploadContacts = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded.' });
  }

  const { listId } = req.params;
  const filePath = req.file.path;
  let results = [];

  try {
    if (req.file.mimetype === 'text/csv') {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => results.push({ ...data, contactList: listId }))
        .on('end', () => processContactUpload(results, res, filePath));
    } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || req.file.mimetype === 'application/vnd.ms-excel') {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(sheet);
      
      results = jsonData.map(row => ({ ...row, contactList: listId }));
      processContactUpload(results, res, filePath);
    } else {
      fs.unlinkSync(filePath);
      return res.status(400).json({ success: false, error: 'Unsupported file type.' });
    }
  } catch (error) {
      fs.unlinkSync(filePath);
      res.status(500).json({ success: false, error: 'Error processing file.' });
  }
};

// @desc    Get a contact's profile picture URL from Meta
const getContactProfile = async (req, res) => {
  const { phoneNumber } = req.params;
  const url = `https://graph.facebook.com/${wabaConfig.apiVersion}/${phoneNumber}?fields=profile_picture_url`;
  const headers = {
    'Authorization': `Bearer ${wabaConfig.accessToken}`,
  };

  try {
    const response = await axios.get(url, { headers });
    res.status(200).json({ success: true, url: response.data.profile_picture_url });
  } catch (error) {
    console.error(`Could not fetch profile for ${phoneNumber}:`, error.response ? error.response.data : error.message);
    res.status(200).json({ success: true, url: null });
  }
};

// Helper function to process the parsed data
async function processContactUpload(results, res, filePath) {
  try {
    if (results.length === 0) {
        fs.unlinkSync(filePath);
        return res.status(400).json({ success: false, error: 'The file is empty or headers are incorrect.' });
    }
    await Contact.insertMany(results, { ordered: false });
    res.status(201).json({
      success: true,
      message: `${results.length} contacts successfully imported.`,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: `Import failed. Some contacts may have been duplicates within this list.`,
      error: error.message,
    });
  } finally {
    fs.unlinkSync(filePath);
  }
}

module.exports = {
  createContactList,
  getAllContactLists,
  uploadContacts,
  getContactProfile, // <-- This was missing from the exports
};