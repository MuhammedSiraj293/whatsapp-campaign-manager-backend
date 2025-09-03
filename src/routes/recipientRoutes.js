// backend/src/routes/recipientRoutes.js

const express = require('express');
const multer = require('multer');
const { uploadRecipients } = require('../controllers/recipientController');

// 1. Configure Multer
// This tells Multer to save uploaded files into a temporary folder called 'uploads'.
const upload = multer({ dest: 'uploads/' });

const router = express.Router();

// 2. Define the upload route
// - The endpoint is '/upload'.
// - 'upload.single('file')' is the middleware. It looks for a single file in the
//   form data under a field named 'file'. It processes the file and then...
// - ...it calls our 'uploadRecipients' controller function.
router.post('/upload/:campaignId', upload.single('file'), uploadRecipients); // <-- CHANGE ROUTE

module.exports = router;