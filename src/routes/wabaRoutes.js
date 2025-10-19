// backend/src/routes/wabaRoutes.js

const express = require('express');
const {
  getAllWabaAccounts,
  addWabaAccount,
  addPhoneNumber,
  deleteWabaAccount,
  deletePhoneNumber,
} = require('../controllers/wabaController');

const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

// All routes in this file are for admins only
router.use(protect);
router.use(authorize('admin'));

// Routes for managing the main WABA accounts
router.route('/accounts')
  .get(getAllWabaAccounts)
  .post(addWabaAccount);

router.route('/accounts/:id')
  .delete(deleteWabaAccount);

// Routes for managing individual phone numbers
router.route('/phones')
  .post(addPhoneNumber);

router.route('/phones/:id')
  .delete(deletePhoneNumber);

module.exports = router;