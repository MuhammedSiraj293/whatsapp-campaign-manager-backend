// backend/src/integrations/whatsappAPI.js

const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
// We no longer import wabaConfig, as credentials are passed in.

const API_VERSION = "v20.0";

/**
 * Sends a simple text message.
 * @param {string} to - The recipient's phone number.
 * @param {string} text - The text message to send.
 * @param {string} accessToken - The Access Token of the WABA.
 * @param {string} phoneNumberId - The Phone Number ID to send from.
 */
/**
 * Sends a simple text message.
 * @param {string} to - The recipient's phone number.
 * @param {string} text - The text message to send.
 * @param {string} accessToken - The Access Token of the WABA.
 * @param {string} phoneNumberId - The Phone Number ID to send from.
 * @param {string} [contextMessageId] - The WAMID of the message to reply to.
 */
const sendTextMessage = async (
  to,
  text,
  accessToken,
  phoneNumberId,
  contextMessageId = null
) => {
  const url = `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`;
  const data = {
    messaging_product: "whatsapp",
    to: to,
    type: "text",
    text: { preview_url: false, body: text },
  };

  if (contextMessageId) {
    data.context = { message_id: contextMessageId };
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
  try {
    const response = await axios.post(url, data, { headers });
    return response.data;
  } catch (error) {
    console.error(
      "❌ Error sending WhatsApp text message:",
      error.response ? error.response.data : error.message
    );
    throw new Error("Failed to send WhatsApp text message.");
  }
};

/**
 * Sends a reaction message.
 * @param {string} to - The recipient's phone number.
 * @param {string} messageId - The WAMID of the message to react to.
 * @param {string} emoji - The emoji to react with.
 * @param {string} accessToken - The Access Token of the WABA.
 * @param {string} phoneNumberId - The Phone Number ID to send from.
 */
const sendReactionMessage = async (
  to,
  messageId,
  emoji,
  accessToken,
  phoneNumberId
) => {
  const url = `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`;
  const data = {
    messaging_product: "whatsapp",
    to: to,
    type: "reaction",
    reaction: {
      message_id: messageId,
      emoji: emoji,
    },
  };
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
  try {
    const response = await axios.post(url, data, { headers });
    return response.data;
  } catch (error) {
    console.error(
      "❌ Error sending WhatsApp reaction:",
      error.response ? error.response.data : error.message
    );
    throw new Error("Failed to send WhatsApp reaction.");
  }
};

// --- NEW FUNCTION: Upload Media to Meta ---
const uploadMedia = async (file, accessToken, phoneNumberId) => {
  try {
    const uploadUrl = `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/media`;
    const formData = new FormData();
    formData.append("messaging_product", "whatsapp");
    formData.append("file", fs.createReadStream(file.path), {
      filename: file.originalname,
      contentType: file.mimetype,
    });

    const uploadHeaders = {
      ...formData.getHeaders(),
      Authorization: `Bearer ${accessToken}`,
    };

    const response = await axios.post(uploadUrl, formData, {
      headers: uploadHeaders,
    });
    return response.data.id; // Return the Media ID
  } catch (error) {
    console.error(
      "❌ Error uploading media to Meta:",
      error.response ? error.response.data : error.message
    );
    throw new Error("Failed to upload media to WhatsApp.");
  } finally {
    // Clean up the local file
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
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
// --- UPDATED: Send Template (Supports Media ID) ---
const sendTemplateMessage = async (
  to,
  templateName,
  languageCode,
  options = {},
  accessToken,
  phoneNumberId
) => {
  const url = `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`;

  const components = [];

  // Logic: If we have a Media ID, use it. Otherwise, check for a Link.
  if (options.headerMediaId) {
    components.push({
      type: "header",
      parameters: [{ type: "image", image: { id: options.headerMediaId } }],
    });
  } else if (options.headerImageUrl) {
    components.push({
      type: "header",
      parameters: [{ type: "image", image: { link: options.headerImageUrl } }],
    });
  }

  if (
    options.bodyVariables &&
    options.bodyVariables.length > 0 &&
    options.bodyVariables.every((v) => v)
  ) {
    components.push({
      type: "body",
      parameters: options.bodyVariables.map((variable) => ({
        type: "text",
        text: variable,
      })),
    });
  }

  if (options.buttons && options.buttons.length > 0) {
    options.buttons.forEach((button, index) => {
      if (button.type === "URL") {
        components.push({
          type: "button",
          sub_type: "url",
          index: String(index),
          parameters: [{ type: "text", text: button.url.split("/").pop() }],
        });
      }
    });
  }

  const data = {
    messaging_product: "whatsapp",
    to: to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length > 0 && { components: components }),
    },
  };

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };

  try {
    const response = await axios.post(url, data, { headers, timeout: 15000 });
    return response.data;
  } catch (error) {
    console.error(
      "❌ Error sending WhatsApp template message:",
      error.response ? error.response.data : error.message
    );
    throw error;
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
    formData.append("messaging_product", "whatsapp");
    formData.append("file", fs.createReadStream(file.path), {
      filename: file.originalname,
      contentType: file.mimetype,
    });
    const uploadHeaders = {
      ...formData.getHeaders(),
      Authorization: `Bearer ${accessToken}`,
    };
    const uploadResponse = await axios.post(uploadUrl, formData, {
      headers: uploadHeaders,
    });
    const mediaId = uploadResponse.data.id;

    const sendUrl = `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`;
    let mediaType = "document";
    if (file.mimetype && typeof file.mimetype === "string") {
      // WhatsApp requires specific formats for "audio" and "video" types.
      // WebM is generally not supported for PTT/Voice Messages or native Video messages.
      // Force "document" for WebM to ensure delivery as a file attachment.
      if (file.mimetype.includes("webm")) {
        mediaType = "document";
      } else {
        mediaType = file.mimetype.split("/")[0];
      }
    }
    const sendData = {
      messaging_product: "whatsapp",
      to: to,
      type: mediaType,
      [mediaType]: { id: mediaId },
    };
    const sendHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    };
    const sendResponse = await axios.post(sendUrl, sendData, {
      headers: sendHeaders,
    });

    return { sendResponse: sendResponse.data, mediaId: mediaId };
  } catch (error) {
    console.error(
      "❌ Error sending WhatsApp media message:",
      error.response ? error.response.data : error.message
    );
    throw new Error("Failed to send WhatsApp media message.");
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
    const headers = { Authorization: `Bearer ${accessToken}` };
    const response = await axios.get(url, { headers });
    return response.data.url;
  } catch (error) {
    console.error(
      "❌ Error fetching media URL:",
      error.response ? error.response.data : error.message
    );
    return null;
  }
};

/**
 * Sends an interactive button message.
 * @param {string} to - Recipient's phone number.
 * @param {string} text - The body text of the message.
 * @param {Array<object>} buttons - An array of button objects, e.g., [{ id: 'btn_1', title: 'Yes' }, { id: 'btn_2', title: 'No' }]
 */
const sendButtonMessage = async (
  to,
  text,
  buttons,
  accessToken,
  phoneNumberId
) => {
  const url = `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`;
  const data = {
    messaging_product: "whatsapp",
    to: to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: text,
      },
      action: {
        buttons: buttons.map((btn) => ({
          type: "reply",
          reply: {
            id: btn.id,
            title: btn.title,
          },
        })),
      },
    },
  };
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
  try {
    const response = await axios.post(url, data, { headers });
    return response.data;
  } catch (error) {
    console.error(
      "❌ Error sending WhatsApp button message:",
      error.response ? error.response.data : error.message
    );
    throw new Error("Failed to send WhatsApp button message.");
  }
};

/**
 * Sends an interactive list message.
 * @param {string} to - Recipient's phone number.
 * @param {string} text - The body text of the message.
 * @param {string} buttonText - The text on the button that opens the list (e.g., "Main Menu").
 * @param {Array<object>} sections - An array of sections, each with a title and rows.
 */
const sendListMessage = async (
  to,
  text,
  buttonText,
  sections,
  accessToken,
  phoneNumberId
) => {
  const url = `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`;
  const data = {
    messaging_product: "whatsapp",
    to: to,
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text: text,
      },
      action: {
        button: buttonText,
        sections: sections.map((section) => ({
          title: section.title,
          rows: section.rows.map((row) => ({
            id: row.id,
            title: row.title,
            description: row.description || undefined,
          })),
        })),
      },
    },
  };
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
  try {
    const response = await axios.post(url, data, { headers });
    return response.data;
  } catch (error) {
    console.error(
      "❌ Error sending WhatsApp list message:",
      error.response ? error.response.data : error.message
    );
    throw new Error("Failed to send WhatsApp list message.");
  }
};

module.exports = {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  getMediaUrl,
  sendButtonMessage, // <-- NEW
  sendListMessage, // <-- NEW
  uploadMedia,
  sendReactionMessage, // <-- NEW
};
