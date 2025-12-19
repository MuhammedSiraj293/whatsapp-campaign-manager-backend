// backend/src/routes/wabaRoutes.js

const express = require("express");
const {
  getAllWabaAccounts,
  addWabaAccount,
  updateWabaAccount,
  addPhoneNumber,
  deleteWabaAccount,
  deletePhoneNumber,
  updatePhoneNumber,
  connectWabaAccount, // <-- Import
} = require("../controllers/wabaController");

const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

// All routes in this file are protected and require a login
router.use(protect);

// --- NEW ROUTE for Embedded Signup ---
router.post("/connect", connectWabaAccount);

// Routes for managing the main WABA accounts
router
  .route("/accounts")
  // Allow ALL logged-in roles (viewer, manager, admin) to GET the list
  .get(getAllWabaAccounts)
  // Only allow ADMIN to create a new account
  .post(authorize("admin"), addWabaAccount);

router
  .route("/accounts/:id")
  // Only allow ADMIN to update an account
  .put(authorize("admin"), updateWabaAccount)
  // Only allow ADMIN to delete an account
  .delete(authorize("admin"), deleteWabaAccount);
// --- END OF CHANGE ---

// Routes for managing individual phone numbers
router
  .route("/phones")
  // Only allow ADMIN to create a new phone number
  .post(authorize("admin"), addPhoneNumber);

router
  .route("/phones/:id")
  // Only allow ADMIN to delete a phone number
  .put(authorize("admin"), updatePhoneNumber)
  .delete(authorize("admin"), deletePhoneNumber);

module.exports = router;
