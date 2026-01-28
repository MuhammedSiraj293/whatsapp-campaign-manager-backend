// backend/src/controllers/wabaController.js

const WabaAccount = require("../models/WabaAccount");
const PhoneNumber = require("../models/PhoneNumber");
const axios = require("axios");

// @desc    Get all WABA accounts and their phone numbers
const getAllWabaAccounts = async (req, res) => {
  try {
    const accounts = await WabaAccount.find();
    const phoneNumbers = await PhoneNumber.find();

    const accountsWithPhones = accounts.map((account) => {
      return {
        ...account.toObject(),
        phoneNumbers: phoneNumbers.filter(
          (pn) => pn.wabaAccount.toString() === account._id.toString(),
        ),
      };
    });

    res.status(200).json({ success: true, data: accountsWithPhones });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- UPGRADED FUNCTION ---
// @desc    Add a new WABA account
const addWabaAccount = async (req, res) => {
  try {
    // Now accepts the optional masterSpreadsheetId
    const { accountName, accessToken, businessAccountId, masterSpreadsheetId } =
      req.body;
    if (!accountName || !accessToken || !businessAccountId) {
      return res
        .status(400)
        .json({ success: false, error: "Please provide all required fields." });
    }

    const newAccount = await WabaAccount.create({
      accountName,
      accessToken,
      businessAccountId,
      masterSpreadsheetId, // <-- ADDED
    });

    res.status(201).json({ success: true, data: newAccount });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- NEW FUNCTION ---
// @desc    Update a WABA account (to add the sheet ID)
// @route   PUT /api/waba/accounts/:id
const updateWabaAccount = async (req, res) => {
  try {
    const { masterSpreadsheetId, accountName, accessToken, businessAccountId } =
      req.body;

    const updateData = {};
    if (masterSpreadsheetId !== undefined)
      updateData.masterSpreadsheetId = masterSpreadsheetId;
    if (accountName !== undefined) updateData.accountName = accountName;
    if (accessToken !== undefined) updateData.accessToken = accessToken;
    if (businessAccountId !== undefined)
      updateData.businessAccountId = businessAccountId;

    const account = await WabaAccount.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true },
    );

    if (!account) {
      return res
        .status(404)
        .json({ success: false, error: "Account not found" });
    }

    res.status(200).json({ success: true, data: account });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// @desc    Add a new Phone Number to a WABA account
const addPhoneNumber = async (req, res) => {
  try {
    const { phoneNumberName, phoneNumberId, wabaAccount } = req.body;
    if (!phoneNumberName || !phoneNumberId || !wabaAccount) {
      return res
        .status(400)
        .json({ success: false, error: "Please provide all required fields." });
    }
    const newPhoneNumber = await PhoneNumber.create({
      phoneNumberName,
      phoneNumberId,
      wabaAccount,
    });
    res.status(201).json({ success: true, data: newPhoneNumber });
  } catch (error) {
    console.error("Error adding phone number:", error);
    res
      .status(500)
      .json({ success: false, error: "Server Error: " + error.message });
  }
};

// @desc    Delete a WABA account
const deleteWabaAccount = async (req, res) => {
  try {
    const account = await WabaAccount.findById(req.params.id);
    if (!account) {
      return res
        .status(404)
        .json({ success: false, error: "Account not found" });
    }
    await PhoneNumber.deleteMany({ wabaAccount: req.params.id });
    await account.deleteOne();
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// @desc    Delete a Phone Number
const deletePhoneNumber = async (req, res) => {
  try {
    const phoneNumber = await PhoneNumber.findById(req.params.id);
    if (!phoneNumber) {
      return res
        .status(404)
        .json({ success: false, error: "Phone number not found" });
    }
    await phoneNumber.deleteOne();
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// --- ADD THIS NEW FUNCTION ---
// @desc    Update a Phone Number (e.g., to assign a bot)
// @route   PUT /api/waba/phones/:id
const updatePhoneNumber = async (req, res) => {
  try {
    // Only update the 'activeBotFlow' field
    const { activeBotFlow, isAiEnabled, isFollowUpEnabled, isReviewEnabled } =
      req.body;

    const phone = await PhoneNumber.findById(req.params.id);
    if (!phone) {
      return res
        .status(404)
        .json({ success: false, error: "Phone number not found" });
    }

    // Set to new ID or null if "None" is selected
    if (activeBotFlow !== undefined)
      phone.activeBotFlow = activeBotFlow || null;
    if (isAiEnabled !== undefined) phone.isAiEnabled = isAiEnabled;
    if (isFollowUpEnabled !== undefined)
      phone.isFollowUpEnabled = isFollowUpEnabled;
    if (isReviewEnabled !== undefined) phone.isReviewEnabled = isReviewEnabled;
    // New fields
    if (req.body.phoneNumberName !== undefined)
      phone.phoneNumberName = req.body.phoneNumberName;
    if (req.body.phoneNumberId !== undefined)
      phone.phoneNumberId = req.body.phoneNumberId;

    await phone.save();

    res.status(200).json({ success: true, data: phone });
  } catch (error) {
    console.error("Error updating phone number:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// const axios = require("axios"); // Removed duplicate

// --- NEW FUNCTION: CONNECT WITH FACEBOOK ---
// @desc    Handle Embedded Signup Callback (Exchange Code for Token)
// @route   POST /api/waba/connect
const connectWabaAccount = async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res
        .status(400)
        .json({ success: false, error: "Authorization code is missing." });
    }

    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    const apiVersion = process.env.FACEBOOK_API_VERSION || "v20.0";

    if (!appId || !appSecret) {
      return res.status(500).json({
        success: false,
        error: "Server configuration error (Missing App ID/Secret).",
      });
    }

    // 1. Exchange Code for Access Token
    const tokenUrl = `https://graph.facebook.com/${apiVersion}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${code}`;

    const tokenResponse = await axios.get(tokenUrl);
    const accessToken = tokenResponse.data.access_token;

    if (!accessToken) {
      throw new Error("Failed to retrieve access token from Meta.");
    }

    // 2. Get WABA ID and Name (Debug Token)
    // We use the debug_token endpoint to find which WABA this token belongs to,
    // or we fetch the shared WABAs.
    // Better yet: Embedded Signup usually returns the WABA ID in the setup,
    // but the token allows us to query the user's WABAs.
    // Let's query the specific WABA endpoint if we knew the ID, but we don't.
    // Instead, let's fetch "me/accounts" or "me?fields=id,name,accounts" logic?
    // Actually, for System User tokens from Embedded Signup, we can often just query the WABA directly
    // if we pass the WABA ID from frontend.
    // BUT the standard flow is: The token is for a System User.
    // We can fetch the WABAs this System User has access to.

    // Let's assume the Frontend sends the WABA ID too (it's available in the JS SDK callback).
    // If not, we have to discover it.
    // Let's try to fetch the debug_token info to see the Granular Scopes or the WABA.

    // SIMPLER APPROACH:
    // The specific WABA ID is usually passed in the 'setup' object from the frontend JS SDK response,
    // but the 'code' is all we get for the token.
    // We will assume the frontend sends 'wabaId' as well, which is standard practice.

    // EDIT: Let's look at the request body again.
    // If we only get 'code', we can only get the token.
    // We should ask the frontend to send `wabaId` if possible.
    // If not, we can query `https://graph.facebook.com/${apiVersion}/me/accounts` with the new token.

    // Let's proceed assuming we can discover it or it's passed.
    // For robust implementation, I will iterate over "me/businesses" or similar if needed.
    // However, simplest is:

    // REVISED:
    // We'll fetch the user's WABAs.
    // GET /me/client_whatsapp_business_accounts (if it's a client token)
    // OR GET /<SYSTEM_USER_ID>/whatsapp_business_accounts

    // Let's just fetch the "debug_token" to get the User ID (System User), then fetch their WABAs.
    const debugUrl = `https://graph.facebook.com/debug_token?input_token=${accessToken}&access_token=${accessToken}`;
    const debugRes = await axios.get(debugUrl);
    const userId = debugRes.data.data.user_id; // System User ID

    // Fetch WABAs this user has access to
    const wabaListUrl = `https://graph.facebook.com/${apiVersion}/${userId}/whatsapp_business_accounts?access_token=${accessToken}`;
    const wabaListRes = await axios.get(wabaListUrl);
    const wabaData = wabaListRes.data.data;

    if (!wabaData || wabaData.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "No WABA found for this user." });
    }

    // We'll take the first WABA found (Embedded Signup usually creates/selects one)
    // In a complex multi-WABA scenario, we might need logic, but usually it's 1-to-1 for this flow.
    const targetWaba = wabaData[0];
    const wabaId = targetWaba.id;
    const wabaName = targetWaba.name || `WABA-${wabaId}`;

    // 3. Save/Update WABA in DB
    // Check if exists
    let account = await WabaAccount.findOne({ businessAccountId: wabaId });
    if (account) {
      // Update token
      account.accessToken = accessToken;
      account.accountName = wabaName; // Update name if changed
      await account.save();
    } else {
      account = await WabaAccount.create({
        accountName: wabaName,
        businessAccountId: wabaId,
        accessToken: accessToken,
      });
    }

    // 4. Fetch Phone Numbers for this WABA
    const phoneUrl = `https://graph.facebook.com/${apiVersion}/${wabaId}/phone_numbers?access_token=${accessToken}`;
    // We need to request fields to get the display Name and ID
    const phonesRes = await axios.get(
      `${phoneUrl}&fields=id,display_phone_number,name_status,quality_rating`,
    );
    const phones = phonesRes.data.data;

    if (phones && phones.length > 0) {
      for (const phone of phones) {
        // Check if phone exists
        const existingPhone = await PhoneNumber.findOne({
          phoneNumberId: phone.id,
        });
        if (!existingPhone) {
          await PhoneNumber.create({
            phoneNumberName: phone.display_phone_number || "WhatsApp Number",
            phoneNumberId: phone.id,
            wabaAccount: account._id,
          });
        }
      }
    }

    // 5. Subscribe App to Webhooks (Critical for auto-reply)
    const subscribeUrl = `https://graph.facebook.com/${apiVersion}/${wabaId}/subscribed_apps`;
    await axios.post(
      subscribeUrl,
      {},
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    res.status(200).json({
      success: true,
      message: "Connected successfully",
      data: {
        waba: account,
        phones: phones,
      },
    });
  } catch (error) {
    console.error(
      "Error in connectWabaAccount:",
      error.response ? error.response.data : error.message,
    );
    res
      .status(500)
      .json({ success: false, error: "Failed to connect WhatsApp account." });
  }
};

module.exports = {
  getAllWabaAccounts,
  addWabaAccount,
  updateWabaAccount,
  addPhoneNumber,
  deleteWabaAccount,
  deletePhoneNumber,
  updatePhoneNumber,
  connectWabaAccount, // <-- EXPORT NEW FUNCTION
};
