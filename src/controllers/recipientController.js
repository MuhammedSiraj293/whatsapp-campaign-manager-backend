// backend/src/controllers/recipientController.js

const fs = require('fs');
const csv = require('csv-parser');
const Recipient = require('../models/Recipient');

// @desc    Upload a CSV file of recipients
// @route   POST /api/recipients/upload
const uploadRecipients = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded.' });
  }

  const { campaignId } = req.params; // <-- GET CAMPAIGN ID FROM URL
  const results = [];
  const filePath = req.file.path;

  fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', (data) => {
      // Add the campaignId to each recipient object from the CSV
      results.push({ ...data, campaign: campaignId }); // <-- ADD CAMPAIGN ID
    })
    .on('end', async () => {
      // ... (the rest of the function is the same)
    });
};

module.exports = {
  uploadRecipients,
};