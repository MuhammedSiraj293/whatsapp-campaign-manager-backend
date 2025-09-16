// backend/src/integrations/whatsappAPI.js

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const wabaConfig = require('../config/wabaConfig');

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

const sendTemplateMessage = async (to, templateName, languageCode, options = {}) => {
  const url = `https://graph.facebook.com/${wabaConfig.apiVersion}/${wabaConfig.phoneNumberId}/messages`;
  
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

  // --- NEW LOGIC TO ADD BUTTONS ---
  if (options.buttons && options.buttons.length > 0) {
    // This example focuses on URL buttons, as they are common for marketing.
    // It assumes your template in Meta is a "Call to Action" button type.
    options.buttons.forEach((button, index) => {
        if (button.type === 'URL') {
            components.push({
                type: 'button',
                sub_type: 'url',
                index: String(index), // The index of the button (0, 1, 2...)
                parameters: [
                    {
                        type: 'text',
                        // The API requires you to send the dynamic part of the URL.
                        // This code assumes the dynamic part is everything after the last '/'.
                        // Example URL: https://example.com/products/TICKET123 -> sends "TICKET123"
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

const sendMediaMessage = async (to, file) => {
    try {
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

        const sendUrl = `https://graph.facebook.com/${wabaConfig.apiVersion}/${wabaConfig.phoneNumberId}/messages`;
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
            'Authorization': `Bearer ${wabaConfig.accessToken}`,
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