// backend/src/routes/contactRoutes.js

const express = require('express');
const multer = require('multer');
const {
  createContactList,
  getAllContactLists,
  uploadContacts,
} = require('../controllers/contactController');

const { protect, authorize } = require('../middleware/authMiddleware');

const upload = multer({ dest: 'uploads/' });
const router = express.Router();

router.route('/lists')
  .get(protect, getAllContactLists)
  .post(protect, authorize('admin', 'manager'), createContactList);

router.post('/lists/:listId/upload', protect, uploadContacts);

module.exports = router;