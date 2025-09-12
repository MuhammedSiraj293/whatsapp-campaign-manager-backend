// backend/src/config/wabaConfig.js

const wabaConfig = {
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
  apiVersion: 'v20.0',
};

// This check ensures your app doesn't start without the necessary credentials.
if (!wabaConfig.accessToken || !wabaConfig.phoneNumberId || !wabaConfig.businessAccountId) {
  throw new Error(
    'Missing WhatsApp API credentials. Please check your .env file.'
  );
}

module.exports = wabaConfig;