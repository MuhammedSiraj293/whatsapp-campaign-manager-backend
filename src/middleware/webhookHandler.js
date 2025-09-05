// backend/src/middleware/webhookHandler.js

const Reply = require('../models/Reply');

// This function handles the webhook verification challenge from Meta.
const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log('✅ Webhook verified');
      res.status(200).send(challenge);
    } else {
      console.error('❌ Webhook verification failed: Tokens do not match.');
      res.sendStatus(403);
    }
  }
};

// This function processes incoming message data from Meta.
const processWebhook = async (req, res) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (message) {
      try {
        let newReplyData = {
          messageId: message.id,
          from: message.from,
          timestamp: new Date(message.timestamp * 1000),
          direction: 'incoming',
        };

        // --- NEW LOGIC TO HANDLE DIFFERENT MESSAGE TYPES ---
        switch (message.type) {
          case 'text':
            newReplyData.body = message.text.body;
            break;

          case 'image':
          case 'video':
          case 'audio':
          case 'document':
            const mediaId = message[message.type].id;
            const url = await getMediaUrl(mediaId);
            newReplyData.mediaUrl = url;
            newReplyData.mediaType = message.type;
            // For media with captions
            if (message[message.type].caption) {
                newReplyData.body = message[message.type].caption;
            }
            break;

          default:
            console.log(`Unsupported message type received: ${message.type}`);
            break;
        }

        // Save to DB if we have something to save
        if (newReplyData.body || newReplyData.mediaUrl) {
            const newReply = new Reply(newReplyData);
            await newReply.save();
            console.log('✅ Incoming reply saved to DB:', newReply);
        }

      } catch (error) {
        console.error('❌ Error saving reply to DB:', error);
      }
    }

    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
};
module.exports = {
  verifyWebhook,
  processWebhook,
};