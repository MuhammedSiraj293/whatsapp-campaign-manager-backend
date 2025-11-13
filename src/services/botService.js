// backend/src/services/botService.js

const Enquiry = require('../models/Enquiry');
const Reply = require('../models/Reply');
const { sendTextMessage } = require('../integrations/whatsappAPI');

// Helper function to parse the project name from a URL
const parseProjectFromUrl = (url) => {
    try {
        const path = new URL(url).pathname;
        if (path.startsWith('/properties/')) {
            const projectName = path.split('/')[2];
            return projectName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        }
        return "General Enquiry";
    } catch (error) {
        return "General Enquiry";
    }
};

/**
 * Handles an incoming message for the conversational bot.
 * @param {object} message - The incoming message object from Meta.
 * @param {string} messageBody - The text content of the message.
 * @param {string} recipientId - The business phone number ID that received the message.
 * @param {object} credentials - The { accessToken } for the correct WABA.
 * @returns {object} The newly created auto-reply message, or null.
 */
const handleBotConversation = async (message, messageBody, recipientId, credentials) => {
  let autoReplyText = null;
  const { accessToken } = credentials;
  const customerPhone = message.from;

  // Find if we already have an enquiry for this number
  let enquiry = await Enquiry.findOne({ phoneNumber: customerPhone, recipientId: recipientId });

  if (!enquiry) {
    // This is the VERY FIRST message from a new user
    const projectName = parseProjectFromUrl(messageBody);

    enquiry = await Enquiry.create({
        phoneNumber: customerPhone,
        recipientId: recipientId,
        pageUrl: messageBody,
        projectName: projectName,
        conversationState: 'awaiting_name', // Start the bot
    });

    autoReplyText = `Hello! Thanks for your interest in ${projectName}. To help you better, what is your full name?`;

  } else {
    // This is a follow-up reply to the bot
    switch (enquiry.conversationState) {

      case 'awaiting_name':
        enquiry.name = messageBody;
        if (enquiry.projectName !== 'General Enquiry') {
          enquiry.conversationState = 'awaiting_budget';
          autoReplyText = `Thank you, ${enquiry.name}. What is your approximate budget for this property?`;
        } else {
          enquiry.conversationState = 'awaiting_email';
          autoReplyText = `Thank you, ${enquiry.name}. What is your email address?`;
        }
        break;

      case 'awaiting_budget':
        enquiry.budget = messageBody;
        enquiry.conversationState = 'awaiting_bedrooms';
        autoReplyText = `Great. And how many bedrooms are you looking for?`;
        break;

      case 'awaiting_bedrooms':
        enquiry.bedrooms = messageBody;
        enquiry.conversationState = 'awaiting_email';
        autoReplyText = `Perfect. Finally, what is your email address?`;
        break;

      case 'awaiting_email':
        enquiry.email = messageBody.toLowerCase().trim();
        enquiry.conversationState = 'completed';
        autoReplyText = `Thank you! Your enquiry is complete. A consultant will contact you shortly.`;
        break;

      case 'completed':
        // Don't reply automatically if the chat is already finished
        break;
    }
    await enquiry.save();
  }

  // Send the bot's reply
  if (autoReplyText) {
    console.log(`🤖 Bot sending reply to ${customerPhone}...`);
    const result = await sendTextMessage(customerPhone, autoReplyText, accessToken, recipientId);

    if (result && result.messages && result.messages[0].id) {
      const newAutoReply = new Reply({
        messageId: result.messages[0].id,
        from: customerPhone,
        recipientId: recipientId,
        body: autoReplyText,
        timestamp: new Date(),
        direction: 'outgoing',
        read: true,
      });
      await newAutoReply.save();
      return newAutoReply; // Return the saved reply
    }
  }
  return null;
};

module.exports = {
  handleBotConversation,
};