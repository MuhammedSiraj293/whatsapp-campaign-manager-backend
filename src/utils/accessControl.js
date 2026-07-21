// backend/src/utils/accessControl.js

const WabaAccount = require("../models/WabaAccount");
const PhoneNumber = require("../models/PhoneNumber");
const ContactList = require("../models/ContactList");

/**
 * Returns an array of WABA Account ObjectIds that the user is authorized to access.
 * Returns null if the user is an admin (indicating no restriction).
 */
const getAssignedWabaIds = (user) => {
  if (!user) return [];
  if (user.role === "admin") {
    return null; // Admin has no restrictions
  }
  return user.assignedWabas || [];
};

/**
 * Returns an array of Meta Phone Number IDs (string values) that the user is authorized to access.
 * Returns null if the user is an admin (indicating no restriction).
 */
const getAssignedPhoneNumberIds = async (user) => {
  if (!user) return [];
  if (user.role === "admin") {
    return null; // Admin has no restrictions
  }

  const assignedWabaIds = user.assignedWabas || [];
  if (assignedWabaIds.length === 0) return [];

  const phoneNumbers = await PhoneNumber.find({ wabaAccount: { $in: assignedWabaIds } });
  return phoneNumbers.map((p) => p.phoneNumberId);
};

/**
 * Returns a MongoDB query filter for Contact Lists that the user is authorized to access.
 * Returns an empty filter {} if the user is an admin (indicating all).
 */
const getContactListFilter = (user) => {
  if (!user) return { _id: { $in: [] } };
  if (user.role === "admin") {
    return {}; // Admin has no restrictions
  }

  const assignedLists = user.assignedContactLists || [];
  return {
    $or: [
      { _id: { $in: assignedLists } },
      { createdBy: user._id }
    ]
  };
};

/**
 * Returns an array of Contact List ObjectIds that the user is authorized to access.
 */
const getAssignedContactListIds = async (user) => {
  if (!user) return [];
  if (user.role === "admin") {
    const lists = await ContactList.find({}).select("_id");
    return lists.map((l) => l._id);
  }

  const filter = getContactListFilter(user);
  const lists = await ContactList.find(filter).select("_id");
  return lists.map((l) => l._id);
};

/**
 * Throws a 403 error if user is not authorized to access a WABA account.
 */
const verifyWabaAccess = (user, wabaId) => {
  if (!user) throw new Error("Unauthorized");
  if (user.role === "admin") return;

  const assignedWabas = (user.assignedWabas || []).map((id) => id.toString());
  if (!assignedWabas.includes(wabaId.toString())) {
    const err = new Error("Access forbidden to this WABA Account");
    err.statusCode = 403;
    throw err;
  }
};

/**
 * Throws a 403 error if user is not authorized to access a Phone Number.
 */
const verifyPhoneNumberAccess = async (user, phoneNumberId) => {
  if (!user) throw new Error("Unauthorized");
  if (user.role === "admin") return;

  const allowedPhoneIds = await getAssignedPhoneNumberIds(user);
  if (!allowedPhoneIds.includes(phoneNumberId)) {
    const err = new Error("Access forbidden to this Phone Number");
    err.statusCode = 403;
    throw err;
  }
};

/**
 * Throws a 403 error if user is not authorized to access a Contact List.
 */
const verifyContactListAccess = async (user, listId) => {
  if (!user) throw new Error("Unauthorized");
  if (user.role === "admin") return;

  const list = await ContactList.findById(listId);
  if (!list) {
    const err = new Error("Contact list not found");
    err.statusCode = 404;
    throw err;
  }

  const isAssigned = (user.assignedContactLists || []).map(id => id.toString()).includes(listId.toString());
  const isCreator = list.createdBy && list.createdBy.toString() === user._id.toString();

  if (!isAssigned && !isCreator) {
    const err = new Error("Access forbidden to this Contact List");
    err.statusCode = 403;
    throw err;
  }
};

/**
 * Throws a 403 error if user is not authorized to access a Contact.
 */
const verifyContactAccess = async (user, contact) => {
  if (!user) throw new Error("Unauthorized");
  if (user.role === "admin") return;

  // 1. If contact belongs to a list, verify list access
  if (contact.contactList) {
    await verifyContactListAccess(user, contact.contactList._id || contact.contactList);
    return;
  }

  // 2. Otherwise, check if they have active interactions on the user's assigned phone numbers
  const allowedPhoneIds = await getAssignedPhoneNumberIds(user);
  if (allowedPhoneIds.length === 0) {
    const err = new Error("Access forbidden to this Contact");
    err.statusCode = 403;
    throw err;
  }

  const Enquiry = require("../models/Enquiry");
  const Reply = require("../models/Reply");

  const [hasEnquiry, hasReply] = await Promise.all([
    Enquiry.exists({ phoneNumber: contact.phoneNumber, recipientId: { $in: allowedPhoneIds } }),
    Reply.exists({
      $or: [
        { from: contact.phoneNumber, recipientId: { $in: allowedPhoneIds } },
        { recipientId: contact.phoneNumber, from: { $in: allowedPhoneIds } }
      ]
    })
  ]);

  if (!hasEnquiry && !hasReply) {
    const err = new Error("Access forbidden to this Contact");
    err.statusCode = 403;
    throw err;
  }
};

/**
 * Returns an array of PhoneNumber ObjectIds that the user is authorized to access.
 * Returns null if the user is an admin (indicating no restriction).
 */
const getAssignedPhoneNumberObjectIds = async (user) => {
  if (!user) return [];
  if (user.role === "admin") {
    return null;
  }

  const assignedWabaIds = user.assignedWabas || [];
  if (assignedWabaIds.length === 0) return [];

  const phoneNumbers = await PhoneNumber.find({ wabaAccount: { $in: assignedWabaIds } }).select("_id");
  return phoneNumbers.map((p) => p._id);
};

module.exports = {
  getAssignedWabaIds,
  getAssignedPhoneNumberIds,
  getContactListFilter,
  getAssignedContactListIds,
  verifyWabaAccess,
  verifyPhoneNumberAccess,
  verifyContactListAccess,
  verifyContactAccess,
  getAssignedPhoneNumberObjectIds,
};
