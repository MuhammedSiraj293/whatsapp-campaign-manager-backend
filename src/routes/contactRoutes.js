// backend/src/routes/contactRoutes.js

const express = require('express');
const multer = require('multer');
const {
  createContactList,
  getAllContactLists,
  uploadContacts,
  getContactProfile, // <-- IMPORT THE FUNCTION
} = require('../controllers/contactController');

// Configure Multer for file uploads
const upload = multer({ dest: 'uploads/' });
const router = express.Router();

// Routes for getting all lists and creating a new one
router.route('/lists')
  .get(getAllContactLists)
  .post(createContactList);

// Route for uploading contacts to a specific list
router.post('/lists/:listId/upload', upload.single('file'), uploadContacts);

// --- THIS IS THE MISSING ROUTE ---
router.get('/:phoneNumber/profile', getContactProfile);

module.exports = router;