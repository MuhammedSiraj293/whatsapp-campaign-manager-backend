// backend/src/controllers/recipientController.js

const fs = require('fs');
const csv = require('csv-parser');
const XLSX = require('xlsx'); // <-- Import the new library
const Recipient = require('../models/Recipient');

const uploadRecipients = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded.' });
  }

  const { campaignId } = req.params;
  const filePath = req.file.path;
  let results = [];

  try {
    // --- NEW LOGIC TO CHECK FILE TYPE ---
    if (req.file.mimetype === 'text/csv') {
      // Process CSV file
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => results.push({ ...data, campaign: campaignId }))
        .on('end', () => processResults(results, res, filePath));
    } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || req.file.mimetype === 'application/vnd.ms-excel') {
      // Process XLSX/XLS file
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(sheet);
      
      results = jsonData.map(row => ({ ...row, campaign: campaignId }));
      processResults(results, res, filePath);
    } else {
      fs.unlinkSync(filePath); // Delete unsupported file
      return res.status(400).json({ success: false, error: 'Unsupported file type.' });
    }
  } catch (error) {
      fs.unlinkSync(filePath);
      res.status(500).json({ success: false, error: 'Error processing file.' });
  }
};

// Helper function to insert data into DB and send response
async function processResults(results, res, filePath) {
  try {
    if (results.length === 0) {
        fs.unlinkSync(filePath);
        return res.status(400).json({ success: false, error: 'The file is empty or headers are incorrect.' });
    }
    const createdRecipients = await Recipient.insertMany(results, { ordered: false });
    res.status(201).json({
      success: true,
      message: `${createdRecipients.length} recipients successfully imported.`,
      data: createdRecipients,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: `Import failed. Processed ${error.result ? error.result.nInserted : 0} of ${results.length} records.`,
      error: 'Please check for duplicate phone numbers or formatting issues.',
    });
  } finally {
    fs.unlinkSync(filePath);
  }
}

module.exports = {
  uploadRecipients,
};