// backend/src/integrations/whatsappAPI.js

const axios = require('axios');
const wabaConfig = require('../config/wabaConfig');

// This function remains unchanged.
const sendTextMessage = async (to, text) => {
  const url = `https://graph.facebook.com/${wabaConfig.apiVersion}/${wabaConfig.phoneNumberId}/messages`;
  const data = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: { preview_url: false, body: text },
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
 * Sends an approved template message with dynamic components.
 * @param {string} to - The recipient's phone number.
 * @param {string} templateName - The name of the approved template.
 * @param {string} languageCode - The language code of the template.
 * @param {object} options - An object containing dynamic data.
 * @param {string} [options.headerImageUrl] - URL for the header image.
 * @param {string[]} [options.bodyVariables] - Array of strings for body variables.
 * @returns {Promise<object>} The response data from the API.
 */
const sendTemplateMessage = async (to, templateName, languageCode, options = {}) => {
  const url = `https://graph.facebook.com/${wabaConfig.apiVersion}/${wabaConfig.phoneNumberId}/messages`;
  
  const components = [];

  // --- NEW: Dynamically build the components array ---

  // Add header component if an image URL is provided
  if (options.headerImageUrl) {
    components.push({
      type: 'header',
      parameters: [
        {
          type: 'image',
          image: {
            link: options.headerImageUrl,
          },
        },
      ],
    });
  }

  // Add body component if variables are provided
  if (options.bodyVariables && options.bodyVariables.length > 0) {
    components.push({
      type: 'body',
      parameters: options.bodyVariables.map(variable => ({
        type: 'text',
        text: variable,
      })),
    });
  }

  const data = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'template',
    template: {
      name: templateName,
      language: {
        code: languageCode,
      },
      // Add the components array to the payload
      components: components,
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


module.exports = {
  sendTextMessage,
  sendTemplateMessage,
};