// backend/src/routes/contactRoutes.js

const express = require("express");
const {
  createContactList,
  getAllContactLists,
  bulkAddContacts,
  getContactsInList,
  deleteContactList, 
  updateContact, // <-- 1. IMPORT
  deleteContact, // <-- 1. IMPORT
} = require("../controllers/contactController");

const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router
  .route("/lists")
  .get(protect, getAllContactLists)
  .post(protect, authorize("admin", "manager"), createContactList);

// --- 2. THIS IS THE NEW ROUTE for pasted data ---
router.post("/lists/:listId/bulk-add", protect, bulkAddContacts);

// --- 3. ADD DELETE METHOD TO THIS ROUTE ---
// This route now handles uploading to AND deleting a specific list
router
  .route("/lists/:listId")
  .delete(protect, authorize("admin", "manager"), deleteContactList);

// --- 4. NEW ROUTE to get all contacts in a list ---
router.get("/lists/:listId/contacts", protect, getContactsInList);

// --- 5. NEW ROUTE for a single contact ---
// This route handles updating or deleting a specific contact by its ID
router.route('/contacts/:contactId')
    .put(protect, authorize('admin', 'manager'), updateContact)
    .delete(protect, authorize('admin', 'manager'), deleteContact);

module.exports = router;
