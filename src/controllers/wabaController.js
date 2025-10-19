// backend/src/controllers/wabaController.js

const WabaAccount = require('../models/WabaAccount');
const PhoneNumber = require('../models/PhoneNumber');

// @desc    Get all WABA accounts and their phone numbers
// @route   GET /api/waba/accounts
const getAllWabaAccounts = async (req, res) => {
  try {
    const accounts = await WabaAccount.find();
    const phoneNumbers = await PhoneNumber.find();

    // Combine the data so each account has its list of phone numbers
    const accountsWithPhones = accounts.map(account => {
      return {
        ...account.toObject(),
        phoneNumbers: phoneNumbers.filter(pn => pn.wabaAccount.toString() === account._id.toString()),
      };
    });

    res.status(200).json({ success: true, data: accountsWithPhones });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

// @desc    Add a new WABA account
// @route   POST /api/waba/accounts
const addWabaAccount = async (req, res) => {
  try {
    const { accountName, accessToken, businessAccountId } = req.body;
    if (!accountName || !accessToken || !businessAccountId) {
      return res.status(400).json({ success: false, error: 'Please provide all required fields.' });
    }

    const newAccount = await WabaAccount.create({
      accountName,
      accessToken,
      businessAccountId,
    });

    res.status(201).json({ success: true, data: newAccount });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

// @desc    Add a new Phone Number to a WABA account
// @route   POST /api/waba/phones
const addPhoneNumber = async (req, res) => {
    try {
        const { phoneNumberName, phoneNumberId, wabaAccount } = req.body;
        if (!phoneNumberName || !phoneNumberId || !wabaAccount) {
            return res.status(400).json({ success: false, error: 'Please provide all required fields.' });
        }

        const newPhoneNumber = await PhoneNumber.create({
            phoneNumberName,
            phoneNumberId,
            wabaAccount,
        });

        res.status(201).json({ success: true, data: newPhoneNumber });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};

// @desc    Delete a WABA account
// @route   DELETE /api/waba/accounts/:id
const deleteWabaAccount = async (req, res) => {
  try {
    const account = await WabaAccount.findById(req.params.id);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }

    // Also delete all phone numbers associated with this account
    await PhoneNumber.deleteMany({ wabaAccount: req.params.id });
    await account.deleteOne();

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

// @desc    Delete a Phone Number
// @route   DELETE /api/waba/phones/:id
const deletePhoneNumber = async (req, res) => {
    try {
        const phoneNumber = await PhoneNumber.findById(req.params.id);
        if (!phoneNumber) {
            return res.status(404).json({ success: false, error: 'Phone number not found' });
        }
        await phoneNumber.deleteOne();
        res.status(200).json({ success: true, data: {} });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};

module.exports = {
  getAllWabaAccounts,
  addWabaAccount,
  addPhoneNumber,
  deleteWabaAccount,
  deletePhoneNumber,
};