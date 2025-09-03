// backend/src/controllers/recipientController.js

const fs = require('fs');
const csv = require('csv-parser');
const Recipient = require('../models/Recipient');

// @desc    Upload a CSV file of recipients for a specific campaign
// @route   POST /api/recipients/upload/:campaignId
const uploadRecipients = async (req, res) => {
  // Check if a file was uploaded by multer
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded.' });
  }

  // Get the campaignId from the URL parameters
  const { campaignId } = req.params;
  const results = [];
  const filePath = req.file.path;

  // Use a stream to efficiently read the CSV file row by row
  fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', (data) => {
      // For each row, add the campaignId to the object
      results.push({ ...data, campaign: campaignId });
    })
    .on('end', async () => {
      // This event fires when the entire file has been read
      try {
        // Use insertMany for an efficient bulk insert into the database
        const createdRecipients = await Recipient.insertMany(results, { ordered: false });
        res.status(201).json({
          success: true,
          message: `${createdRecipients.length} recipients successfully imported.`,
          data: createdRecipients,
        });
      } catch (error) {
        // This catches errors, such as duplicate phone numbers for the same campaign
        res.status(400).json({
          success: false,
          message: `Import failed. Processed ${error.result.nInserted} of ${results.length} records.`,
          error: 'Please check for duplicate phone numbers or formatting issues.',
        });
      } finally {
        // Always delete the temporary uploaded file
        fs.unlinkSync(filePath);
      }
    });
};

module.exports = {
  uploadRecipients,
};