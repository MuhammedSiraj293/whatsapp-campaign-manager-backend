// backend/src/integrations/whatsappAPI.js

const axios = require('axios');
const wabaConfig = require('../config/wabaConfig'); // 1. Import our WABA config

/**
 * Sends a text message to a WhatsApp number.
 * @param {string} to - The recipient's phone number (e.g., '15551234567').
 * @param {string} text - The content of the message to send.
 * @returns {Promise<object>} The response data from the API.
 */
const sendTextMessage = async (to, text) => {
  const url = `https://graph.facebook.com/${wabaConfig.apiVersion}/${wabaConfig.phoneNumberId}/messages`;

  // 2. This is the exact data structure Meta's API requires
  const data = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: {
      preview_url: false, // Set to true to allow URL previews
      body: text,
    },
  };

  // 3. The headers include our secret access token for authentication
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${wabaConfig.accessToken}`,
  };

  try {
    console.log(`Sending message to ${to}...`);
    const response = await axios.post(url, data, { headers });
    console.log('✅ Message sent successfully:', response.data);
    return response.data;
  } catch (error) {
    // 4. Log a detailed error message if the API call fails
    console.error('❌ Error sending WhatsApp message:', error.response ? error.response.data : error.message);
    throw new Error('Failed to send WhatsApp message.');
  }
};

// 5. Export the function so we can use it elsewhere in our app
module.exports = {
  sendTextMessage,
};