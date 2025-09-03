// backend/src/config/wabaConfig.js

// The dotenv.config() in server.js loads these variables into process.env
const wabaConfig = {
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  apiVersion: 'v20.0', // It's good practice to specify the API version
};

// This is a check to ensure your app doesn't start without the necessary credentials.
if (!wabaConfig.accessToken || !wabaConfig.phoneNumberId) {
  throw new Error(
    'Missing WhatsApp API credentials. Please check your .env file.'
  );
}

module.exports = wabaConfig;