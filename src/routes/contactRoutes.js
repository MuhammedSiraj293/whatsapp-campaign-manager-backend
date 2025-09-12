// backend/src/routes/contactRoutes.js

const express = require('express');
const multer = require('multer');
const {
  createContactList,
  getAllContactLists,
  uploadContacts,
} = require('../controllers/contactController');

// Import the security middleware
const { protect, authorize } = require('../middleware/authMiddleware');

const upload = multer({ dest: 'uploads/' });
const router = express.Router();

// --- SECURE THE ROUTES ---
// The 'protect' function will now run before the controller function for each route.

router.route('/lists')
  .get(protect, getAllContactLists)
  // Example of role protection: only an 'admin' can create a new list
   .post(protect, authorize('admin', 'manager'), createContactList);

router.post('/lists/:listId/upload', protect, upload.single('file'), uploadContacts);

module.exports = router;