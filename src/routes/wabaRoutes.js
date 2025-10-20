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
    
// All routes in this file are protected and require a login
router.use(protect);
    
// Routes for managing the main WABA accounts
router.route('/accounts')
  // Allow BOTH admin and manager to GET the list of accounts
  .get(authorize('admin', 'manager'), getAllWabaAccounts)
  // Only allow ADMIN to create a new account
  .post(authorize('admin'), addWabaAccount);
    
router.route('/accounts/:id')
  // Only allow ADMIN to delete an account
  .delete(authorize('admin'), deleteWabaAccount);
    
// Routes for managing individual phone numbers
router.route('/phones')
  // Only allow ADMIN to create a new phone number
  .post(authorize('admin'), addPhoneNumber);
      
router.route('/phones/:id')
  // Only allow ADMIN to delete a phone number
  .delete(authorize('admin'), deletePhoneNumber);
    
module.exports = router;