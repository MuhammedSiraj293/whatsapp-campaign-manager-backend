// backend/src/integrations/whatsappAPI.js

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
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
  if (options.bodyVariables && options.bodyVariables.length > 0 && options.bodyVariables.every(v => v)) {
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

/**
 * Uploads a media file to Meta and sends it to a user.
 * @param {string} to - The recipient's phone number.
 * @param {object} file - The file object from multer (contains path, mimetype).
 * @returns {Promise<object>} The response data from the API.
 */
const sendMediaMessage = async (to, file) => {
    try {
        // --- Step 1: Upload the media to get an ID ---
        const uploadUrl = `https://graph.facebook.com/${wabaConfig.apiVersion}/${wabaConfig.phoneNumberId}/media`;
        
        const formData = new FormData();
        formData.append('messaging_product', 'whatsapp');
        formData.append('file', fs.createReadStream(file.path), {
            filename: file.originalname,
            contentType: file.mimetype,
        });

        const uploadHeaders = {
            ...formData.getHeaders(),
            'Authorization': `Bearer ${wabaConfig.accessToken}`,
        };

        console.log(`Uploading media ${file.originalname}...`);
        const uploadResponse = await axios.post(uploadUrl, formData, { headers: uploadHeaders });
        const mediaId = uploadResponse.data.id;
        console.log(`✅ Media uploaded successfully. ID: ${mediaId}`);


        // --- Step 2: Send the media message using the ID ---
        const sendUrl = `https://graph.facebook.com/${wabaConfig.apiVersion}/${wabaConfig.phoneNumberId}/messages`;
        
        const mediaType = file.mimetype.split('/')[0]; 
        
        const sendData = {
            messaging_product: 'whatsapp',
            to: to,
            type: mediaType,
            [mediaType]: {
                id: mediaId,
            },
        };

        const sendHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${wabaConfig.accessToken}`,
        };

        console.log(`Sending ${mediaType} message to ${to}...`);
        const sendResponse = await axios.post(sendUrl, sendData, { headers: sendHeaders });
        console.log(`✅ Media message sent successfully.`);
        return sendResponse.data;

    } catch (error) {
        console.error('❌ Error sending WhatsApp media message:', error.response ? error.response.data : error.message);
        throw new Error('Failed to send WhatsApp media message.');
    } finally {
        // Clean up by deleting the temporary file from the 'uploads' folder
        fs.unlinkSync(file.path);
    }
};
// --- NEW HELPER FUNCTION ---
/**
 * Gets a temporary download URL for a given media ID.
 * @param {string} mediaId - The ID of the media from Meta.
 * @returns {Promise<string|null>} The temporary URL or null.
 */
const getMediaUrl = async (mediaId) => {
    try {
        const url = `https://graph.facebook.com/${wabaConfig.apiVersion}/${mediaId}`;
        const headers = { 'Authorization': `Bearer ${wabaConfig.accessToken}` };

        const response = await axios.get(url, { headers });
        return response.data.url;
    } catch (error) {
        console.error('❌ Error fetching media URL:', error.response ? error.response.data : error.message);
        return null;
    }
};

module.exports = {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
    getMediaUrl,
};