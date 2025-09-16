// backend/src/routes/contactRoutes.js

const express = require('express');
const {
  createContactList,
  getAllContactLists,
  bulkAddContacts, // <-- 1. IMPORT THE NEW FUNCTION
} = require('../controllers/contactController');

const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

router.route('/lists')
  .get(protect, getAllContactLists)
  .post(protect, authorize('admin', 'manager'), createContactList);

// --- 2. THIS IS THE NEW ROUTE for pasted data ---
router.post('/lists/:listId/bulk-add', protect, bulkAddContacts);

module.exports = router;