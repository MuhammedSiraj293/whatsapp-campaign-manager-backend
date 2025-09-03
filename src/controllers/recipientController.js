// backend/src/controllers/recipientController.js

const fs = require('fs');
const csv = require('csv-parser');
const Recipient = require('../models/Recipient');

// @desc    Upload a CSV file of recipients
// @route   POST /api/recipients/upload
const uploadRecipients = async (req, res) => {
  // 1. Multer adds the 'file' object to the request, which contains info like the path
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded.' });
  }

  const results = [];
  const filePath = req.file.path;

  // 2. We use a stream to read the file row-by-row. This is memory-efficient for large files.
  fs.createReadStream(filePath)
    .pipe(csv()) // Pipe the stream into the csv-parser
    .on('data', (data) => results.push(data)) // For each row of data, add it to our results array
    .on('end', async () => {
      // 3. Once the file is fully read, this 'end' event is triggered
      try {
        // 4. Use insertMany for a bulk database operation.
        // 'ordered: false' means if one row fails (e.g., duplicate phone), it will still try to insert the others.
        const createdRecipients = await Recipient.insertMany(results, { ordered: false });
        res.status(201).json({
          success: true,
          message: `${createdRecipients.length} recipients successfully imported.`,
          data: createdRecipients,
        });
      } catch (error) {
        // This catches errors, such as if many phone numbers were duplicates.
        res.status(400).json({
          success: false,
          message: `Import failed. Processed ${error.result.nInserted} of ${results.length} records.`,
          error: 'Please check for duplicate phone numbers or formatting issues.',
        });
      } finally {
        // 5. IMPORTANT: Clean up by deleting the temporary file that multer created.
        fs.unlinkSync(filePath);
      }
    });
};

module.exports = {
  uploadRecipients,
};