// backend/src/integrations/whatsappAPI.js

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
// We no longer import wabaConfig, as credentials are passed in.

const API_VERSION = 'v20.0';

/**
 * Sends a simple text message.
 * @param {string} to - The recipient's phone number.
 * @param {string} text - The text message to send.
 * @param {string} accessToken - The Access Token of the WABA.
 * @param {string} phoneNumberId - The Phone Number ID to send from.
 */
const sendTextMessage = async (to, text, accessToken, phoneNumberId) => {
  const url = `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`;
  const data = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: { preview_url: false, body: text },
  };
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  };
  try {
    const response = await axios.post(url, data, { headers });
    return response.data;
  } catch (error) {
    console.error('❌ Error sending WhatsApp text message:', error.response ? error.response.data : error.message);
    throw new Error('Failed to send WhatsApp text message.');
  }
};

/**
 * Sends an approved template message.
 * @param {string} to - The recipient's phone number.
 * @param {string} templateName - The name of the template.
 * @param {string} languageCode - The language code (e.g., "en").
 * @param {object} options - Options like headerImageUrl, bodyVariables, buttons.
 * @param {string} accessToken - The Access Token of the WABA.
 * @param {string} phoneNumberId - The Phone Number ID to send from.
 */
const sendTemplateMessage = async (to, templateName, languageCode, options = {}, accessToken, phoneNumberId) => {
  const url = `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`;
  
  const components = [];

  if (options.headerImageUrl) {
    components.push({
      type: 'header',
      parameters: [{ type: 'image', image: { link: options.headerImageUrl } }],
    });
  }

  if (options.bodyVariables && options.bodyVariables.length > 0 && options.bodyVariables.every(v => v)) {
    components.push({
      type: 'body',
      parameters: options.bodyVariables.map(variable => ({
        type: 'text',
        text: variable,
      })),
    });
  }

  if (options.buttons && options.buttons.length > 0) {
    options.buttons.forEach((button, index) => {
        if (button.type === 'URL') {
            components.push({
                type: 'button',
                sub_type: 'url',
                index: String(index),
                parameters: [
                    {
                        type: 'text',
                        text: button.url.split('/').pop() 
                    }
                ]
            });
        }
    });
  }

  const data = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length > 0 && { components: components }),
    },
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  };

  try {
    const response = await axios.post(url, data, { headers, timeout: 15000 });
    return response.data;
  } catch (error) {
    console.error('❌ Error sending WhatsApp template message:', error.response ? error.response.data : error.message);
    throw error; // Re-throw the original error so campaignService can catch it
  }
};

/**
 * Uploads and sends a media file.
 * @param {string} to - The recipient's phone number.
 * @param {object} file - The file object from multer.
 * @param {string} accessToken - The Access Token of the WABA.
 * @param {string} phoneNumberId - The Phone Number ID to send from.
 */
const sendMediaMessage = async (to, file, accessToken, phoneNumberId) => {
    try {
        const uploadUrl = `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/media`;
        const formData = new FormData();
        formData.append('messaging_product', 'whatsapp');
        formData.append('file', fs.createReadStream(file.path), {
            filename: file.originalname,
            contentType: file.mimetype,
        });
        const uploadHeaders = {
            ...formData.getHeaders(),
            'Authorization': `Bearer ${accessToken}`,
        };
        const uploadResponse = await axios.post(uploadUrl, formData, { headers: uploadHeaders });
        const mediaId = uploadResponse.data.id;

        const sendUrl = `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`;
        let mediaType = 'document';
        if (file.mimetype && typeof file.mimetype === 'string') {
            mediaType = file.mimetype.split('/')[0];
        }
        const sendData = {
            messaging_product: 'whatsapp',
            to: to,
            type: mediaType,
            [mediaType]: { id: mediaId },
        };
        const sendHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
        };
        const sendResponse = await axios.post(sendUrl, sendData, { headers: sendHeaders });
        
        return { sendResponse: sendResponse.data, mediaId: mediaId };

    } catch (error) {
        console.error('❌ Error sending WhatsApp media message:', error.response ? error.response.data : error.message);
        throw new Error('Failed to send WhatsApp media message.');
    } finally {
        if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
        }
    }
};

/**
 * Gets a temporary download URL for a media ID.
 * @param {string} mediaId - The media ID to fetch.
 * @param {string} accessToken - The Access Token of the WABA.
 * @returns {Promise<string>} The temporary download URL.
 */
const getMediaUrl = async (mediaId, accessToken) => {
    try {
        const url = `https://graph.facebook.com/${API_VERSION}/${mediaId}`;
        const headers = { 'Authorization': `Bearer ${accessToken}` };
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