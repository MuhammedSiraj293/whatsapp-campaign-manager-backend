// backend/src/integrations/whatsappAPI.js

const axios = require('axios');
const wabaConfig = require('../config/wabaConfig');

/**
 * Sends a simple text message (for replies within the 24-hour window).
 * @param {string} to - The recipient's phone number.
 * @param {string} text - The content of the message.
 * @returns {Promise<object>} The response data from the API.
 */
const sendTextMessage = async (to, text) => {
  const url = `https://graph.facebook.com/${wabaConfig.apiVersion}/${wabaConfig.phoneNumberId}/messages`;

  const data = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: {
      preview_url: false,
      body: text,
    },
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${wabaConfig.accessToken}`,
  };

  try {
    console.log(`Sending text message to ${to}...`);
    const response = await axios.post(url, data, { headers });
    console.log('✅ Text message sent successfully:', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ Error sending WhatsApp text message:', error.response ? error.response.data : error.message);
    throw new Error('Failed to send WhatsApp text message.');
  }
};

/**
 * Sends an approved template message.
 * @param {string} to - The recipient's phone number.
 * @param {string} templateName - The name of the approved template.
 * @param {string} languageCode - The language code of the template (e.g., 'en' or 'en_US').
 * @returns {Promise<object>} The response data from the API.
 */
const sendTemplateMessage = async (to, templateName, languageCode) => {
  const url = `https://graph.facebook.com/${wabaConfig.apiVersion}/${wabaConfig.phoneNumberId}/messages`;

  // This is the specific data structure for a template message
  const data = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'template',
    template: {
      name: templateName,
      language: {
        code: languageCode,
      },
    },
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${wabaConfig.accessToken}`,
  };

  try {
    console.log(`Sending template "${templateName}" to ${to}...`);
    const response = await axios.post(url, data, { headers });
    console.log('✅ Template message sent successfully:', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ Error sending WhatsApp template message:', error.response ? error.response.data : error.message);
    throw new Error('Failed to send WhatsApp template message.');
  }
};


// Export both functions
module.exports = {
  sendTextMessage,
  sendTemplateMessage,
};