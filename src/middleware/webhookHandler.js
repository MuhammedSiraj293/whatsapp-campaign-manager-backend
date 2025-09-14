// backend/src/middleware/webhookHandler.js

const Reply = require('../models/Reply');
const Campaign = require('../models/Campaign');
const Analytics = require('../models/Analytics');
const Contact = require('../models/Contact');
const { sendTextMessage } = require('../integrations/whatsappAPI');
const { io } = require('../server'); // Import the 'io' object from server.js

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
  } else {
    res.sendStatus(403);
  }
};

const processWebhook = async (req, res) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    const value = body.entry?.[0]?.changes?.[0]?.value;
    
    // --- Handle Incoming Messages ---
    if (value && value.messages && value.messages[0]) {
      const message = value.messages[0];
      try {
        let newReplyData = {
          messageId: message.id,
          from: message.from,
          timestamp: new Date(message.timestamp * 1000),
          direction: 'incoming',
        };

        switch (message.type) {
          case 'text':
            newReplyData.body = message.text.body;
            break;
          case 'image': case 'video': case 'audio': case 'document': case 'voice':
            newReplyData.mediaId = message[message.type].id;
            newReplyData.mediaType = message.type;
            if (message[message.type].caption) newReplyData.body = message[message.type].caption;
            break;
          default:
            console.log(`Unsupported message type: ${message.type}`);
            break;
        }

        if (newReplyData.body || newReplyData.mediaId) {
          const newReply = new Reply(newReplyData);
          await newReply.save();
          console.log('✅ Incoming reply saved to DB.');

          // --- EMIT A SOCKET EVENT ---
          // Send an event named 'newMessage' to all connected clients.
          io.emit('newMessage', { from: message.from, message: newReply });
          console.log(`📡 Emitted newMessage event for ${message.from}`);
        }

        // --- Reply Counting and Auto-Reply Bot Logic ---
        let campaignToCredit = null;
        if (message.context && message.context.id) {
          const originalMessage = await Analytics.findOne({ wamid: message.context.id });
          if (originalMessage) campaignToCredit = originalMessage.campaign;
        } else {
          const contact = await Contact.findOne({ phoneNumber: message.from });
          if (contact) {
            const lastSentMessage = await Analytics.findOne({ contact: contact._id }).sort({ createdAt: -1 });
            if (lastSentMessage) campaignToCredit = lastSentMessage.campaign;
          }
        }

        if (campaignToCredit) {
          await Campaign.findByIdAndUpdate(campaignToCredit, { $inc: { replyCount: 1 } });
          console.log(`✅ Incremented reply count for campaign: ${campaignToCredit}`);
        }

        if (message.type === 'text') {
            const messageBodyLower = message.text.body.toLowerCase();
            if (messageBodyLower.includes('marbella')) {
                const autoReplyText = 'Thank you for your interest in Marbella. I will connect you with one of our property consultants, who will assist you with the specific property and provide you with further details.';
                await sendTextMessage(message.from, autoReplyText);
            } else {
                const messageCount = await Reply.countDocuments({ from: message.from });
                if (messageCount === 1) {
                    const welcomeMessage = 'Hello, Thank you for connecting Capital Avenue! How can we help on your interest.';
                    await sendTextMessage(message.from, welcomeMessage);
                }
            }
        }
      } catch (error) {
        console.error('❌ Error processing incoming message:', error);
      }
    }
    
    // --- Handle Message Status Updates ---
    if (value && value.statuses && value.statuses[0]) {
        const statusUpdate = value.statuses[0];
        try {
            const updated = await Analytics.findOneAndUpdate(
                { wamid: statusUpdate.id },
                { status: statusUpdate.status },
                { new: true }
            );
            if (updated) {
                console.log(`✅ Updated status for ${statusUpdate.id} to ${statusUpdate.status}`);
            }
        } catch(error) {
            console.error('❌ Error updating message status:', error);
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