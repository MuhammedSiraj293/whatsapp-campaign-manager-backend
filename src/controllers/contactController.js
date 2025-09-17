// backend/src/controllers/contactController.js

const Contact = require("../models/Contact");
const ContactList = require("../models/ContactList");

// Helper function to extract named variables from a row
const extractVariables = (row) => {
  const variables = {};
  const reservedKeys = ["phonenumber", "name"];

  Object.keys(row).forEach((key) => {
    const keyLower = key.trim().toLowerCase();
    if (!reservedKeys.includes(keyLower)) {
      variables[key.trim()] = row[key];
    }
  });
  return variables;
};

const createContactList = async (req, res) => {
  const { name } = req.body;
  if (!name)
    return res
      .status(400)
      .json({ success: false, error: "Please provide a list name." });
  try {
    const contactList = await ContactList.create({ name });
    res.status(201).json({ success: true, data: contactList });
  } catch (error) {
    res
      .status(400)
      .json({ success: false, error: "List name may already exist." });
  }
};

// --- THIS FUNCTION IS UPGRADED ---
const getAllContactLists = async (req, res) => {
  try {
    // Use aggregation to join with contacts and get a count
    const contactLists = await ContactList.aggregate([
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "contacts", // The collection to join with
          localField: "_id",
          foreignField: "contactList",
          as: "contacts", // The name of the new array field
        },
      },
      {
        $project: {
          name: 1,
          createdAt: 1,
          contactCount: { $size: "$contacts" }, // Count the items in the array
        },
      },
    ]);
    res.status(200).json({ success: true, data: contactLists });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- NEW FUNCTION FOR PASTED DATA ---
const bulkAddContacts = async (req, res) => {
  const { listId } = req.params;
  const { contacts } = req.body;

  if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
    return res
      .status(400)
      .json({ success: false, error: "No contacts provided." });
  }

  // Process each contact to match our database schema
  const processedContacts = contacts.map((contact) => ({
    phoneNumber: String(contact.phoneNumber),
    name: contact.name,
    contactList: listId,
    variables: extractVariables(contact),
  }));

  try {
    await Contact.insertMany(processedContacts, { ordered: false });
    res.status(201).json({
      success: true,
      message: `${contacts.length} contacts were processed successfully.`,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: `Import failed. Some contacts may have been duplicates within this list.`,
      error: error.message,
    });
  }
};

// --- NEW FUNCTION TO GET ALL CONTACTS IN A LIST ---
const getContactsInList = async (req, res) => {
  try {
    const { listId } = req.params;
    const contacts = await Contact.find({ contactList: listId }).sort({
      createdAt: -1,
    });
    res.status(200).json({ success: true, data: contacts });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- NEW UPDATE FUNCTION ---
const updateContact = async (req, res) => {
  try {
    const { contactId } = req.params;
    const contact = await Contact.findByIdAndUpdate(contactId, req.body, {
      new: true,
      runValidators: true,
    });
    if (!contact) {
      return res
        .status(404)
        .json({ success: false, error: "Contact not found" });
    }
    res.status(200).json({ success: true, data: contact });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- NEW DELETE FUNCTION ---
const deleteContactList = async (req, res) => {
  try {
    const list = await ContactList.findById(req.params.listId);
    if (!list) {
      return res
        .status(404)
        .json({ success: false, error: "Contact list not found" });
    }

    await list.deleteOne(); // This triggers the 'pre' hook in the model

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- NEW DELETE FUNCTION (for a single contact) ---
const deleteContact = async (req, res) => {
  try {
    const { contactId } = req.params;
    const contact = await Contact.findById(contactId);
    if (!contact) {
      return res
        .status(404)
        .json({ success: false, error: "Contact not found" });
    }
    await contact.deleteOne();
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

module.exports = {
  createContactList,
  getAllContactLists,
  bulkAddContacts,
  getContactsInList,
  deleteContactList,
  deleteContact,
  updateContact
};
