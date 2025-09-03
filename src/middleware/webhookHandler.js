// backend/src/middleware/webhookHandler.js

const Reply = require('../models/Reply');

// This function handles the webhook verification challenge from Meta.
const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Check if a token and mode is in the query string of the request
  if (mode && token) {
    // Check the mode and token sent are correct
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      // Respond with the challenge token from the request
      console.log('✅ Webhook verified');
      res.status(200).send(challenge);
    } else {
      // Respond with '403 Forbidden' if verify tokens do not match
      console.error('❌ Webhook verification failed: Tokens do not match.');
      res.sendStatus(403);
    }
  }
};

// This function processes incoming message data from Meta.
const processWebhook = async (req, res) => {
  const body = req.body;

  // Check if this is an event from a page subscription
  if (body.object === 'whatsapp_business_account') {
    // The incoming message data is nested. This drills down to the actual message.
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    // Ensure it's a valid text message
    if (message && message.type === 'text') {
      try {
        const newReply = new Reply({
          messageId: message.id,
          from: message.from,
          body: message.text.body,
          timestamp: new Date(message.timestamp * 1000), // Convert Unix timestamp to Date
        });

        await newReply.save();
        console.log('✅ Incoming reply saved to DB:', newReply);
      } catch (error) {
        console.error('❌ Error saving reply to DB:', error);
      }
    }

    // Always respond with 200 OK to Meta, otherwise they'll keep resending the webhook.
    res.sendStatus(200);
  } else {
    // Return a '404 Not Found' if event is not from a page subscription
    res.sendStatus(404);
  }
};

module.exports = {
  verifyWebhook,
  processWebhook,
};