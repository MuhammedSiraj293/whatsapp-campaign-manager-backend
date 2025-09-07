// backend/src/controllers/contactController.js

const fs = require('fs');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const Contact = require('../models/Contact');
const ContactList = require('../models/ContactList');

// This helper now extracts named variables into an object
const extractVariables = (row) => {
    const variables = {};
    const reservedKeys = ['phonenumber', 'name']; // Use lowercase for case-insensitive check
    
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

const uploadContacts = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded.' });
  const { listId } = req.params;
  const filePath = req.file.path;
  let results = [];
  try {
    const processRow = (row) => {
      const cleanedRow = {};
      Object.keys(row).forEach(key => { cleanedRow[key.trim()] = row[key]; });
      return {
        phoneNumber: String(cleanedRow.phoneNumber),
        name: cleanedRow.name,
        contactList: listId,
        variables: extractVariables(cleanedRow),
      };
    };
    if (req.file.mimetype === 'text/csv') {
      fs.createReadStream(filePath).pipe(csv()).on('data', (data) => results.push(processRow(data))).on('end', () => processContactUpload(results, res, filePath));
    } else if (req.file.mimetype.includes('sheet')) {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(sheet);
      results = jsonData.map(processRow);
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

async function processContactUpload(results, res, filePath) {
  try {
    if (results.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ success: false, error: 'The file is empty or headers are incorrect.' });
    }
    await Contact.insertMany(results, { ordered: false });
    res.status(201).json({ success: true, message: `${results.length} contacts successfully imported.` });
  } catch (error) {
    res.status(400).json({ success: false, message: `Import failed.`, error: error.message });
  } finally {
    fs.unlinkSync(filePath);
  }
}

module.exports = { createContactList, getAllContactLists, uploadContacts };