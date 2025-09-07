// backend/src/integrations/whatsappAPI.js

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const wabaConfig = require('../config/wabaConfig');

/**
 * Sends a simple text message.
 */
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
    const response = await axios.post(url, data, { headers });
    return response.data;
  } catch (error) {
    console.error('❌ Error sending WhatsApp text message:', error.response ? error.response.data : error.message);
    throw new Error('Failed to send WhatsApp text message.');
  }
};

/**
 * Sends an approved template message with dynamic components.
 */
// This function is now the final, correct version.
const sendTemplateMessage = async (to, templateName, languageCode, options = {}) => {
  const url = `https://graph.facebook.com/${wabaConfig.apiVersion}/${wabaConfig.phoneNumberId}/messages`;
  
  const components = [];

  // Handle header image
  if (options.headerImageUrl) {
    components.push({
      type: 'header',
      parameters: [{ type: 'image', image: { link: options.headerImageUrl } }],
    });
  }

  // --- THIS IS THE KEY CHANGE ---
  // Convert the variables object into the ordered array Meta requires
  if (options.bodyVariables && typeof options.bodyVariables === 'object' && Object.keys(options.bodyVariables).length > 0) {
    // Assumes the keys in the CSV/XLSX file are in the correct order (e.g., var1, var2)
    // Or that the object keys are already in the correct order.
    const parameters = Object.values(options.bodyVariables).map(variable => ({
        type: 'text',
        text: variable,
    }));
    
    if (parameters.length > 0) {
        components.push({
            type: 'body',
            parameters: parameters
        });
    }
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
    'Authorization': `Bearer ${wabaConfig.accessToken}`,
  };

  try {
    const response = await axios.post(url, data, { headers, timeout: 15000 });
    return response.data;
  } catch (error) {
    console.error('❌ Error sending WhatsApp template message:', error.response ? error.response.data : error.message);
    throw new Error('Failed to send WhatsApp template message.');
  }
};

/**
 * Uploads a media file to Meta and then sends it to a user.
 */
const sendMediaMessage = async (to, file) => {
    try {
        // Step 1: Upload the media to get an ID
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
        const uploadResponse = await axios.post(uploadUrl, formData, { headers: uploadHeaders });
        const mediaId = uploadResponse.data.id;

        // Step 2: Send the media message using the ID
        const sendUrl = `https://graph.facebook.com/${wabaConfig.apiVersion}/${wabaConfig.phoneNumberId}/messages`;
        const mediaType = file.mimetype.split('/')[0]; 
        
        const sendData = {
            messaging_product: 'whatsapp',
            to: to,
            type: mediaType,
            [mediaType]: { id: mediaId },
        };
        const sendHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${wabaConfig.accessToken}`,
        };
        const sendResponse = await axios.post(sendUrl, sendData, { headers: sendHeaders });
        
        return { sendResponse: sendResponse.data, mediaId: mediaId };

    } catch (error) {
        console.error('❌ Error sending WhatsApp media message:', error.response ? error.response.data : error.message);
        throw new Error('Failed to send WhatsApp media message.');
    } finally {
        // Clean up the temporary file
        if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
        }
    }
};

/**
 * Gets a temporary download URL for a given media ID.
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