// backend/src/config/wabaConfig.js
const wabaConfig = {
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID, // <-- ADD THIS
  apiVersion: 'v20.0',
};

// Update the check to include the new variable
if (!wabaConfig.accessToken || !wabaConfig.phoneNumberId || !wabaConfig.businessAccountId) { // <-- ADD CHECK
  throw new Error(
    'Missing WhatsApp API credentials. Please check your .env file.'
  );
}

module.exports = wabaConfig;