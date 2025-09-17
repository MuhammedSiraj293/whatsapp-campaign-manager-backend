// backend/src/middleware/webhookHandler.js

const Reply = require('../models/Reply');
const Campaign = require('../models/Campaign');
const Analytics = require('../models/Analytics');
const Contact = require('../models/Contact');
const { sendTextMessage } = require('../integrations/whatsappAPI');
const { appendToSheet } = require('../integrations/googleSheets');
const { io } = require('../server');

const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log('✅ Webhook verified');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(403);
  }
};

const processWebhook = async (req, res) => {
  const body = req.body;
  const io = req.io;

  if (body.object === 'whatsapp_business_account') {
    const value = body.entry?.[0]?.changes?.[0]?.value;

    if (value && value.messages && value.messages[0]) {
      const message = value.messages[0];
      try {
        let savedReply = null;
        let messageBody = ''; // Variable to hold the text from any message type
        let newReplyData = {
          messageId: message.id, from: message.from,
          timestamp: new Date(message.timestamp * 1000), direction: 'incoming',
        };

        // --- THIS IS THE KEY CHANGE ---
        // This switch statement now correctly handles button clicks
        switch (message.type) {
          case 'text':
            messageBody = message.text.body;
            newReplyData.body = messageBody;
            break;
          case 'interactive': // For Quick Reply button clicks
            if (message.interactive && message.interactive.button_reply) {
              messageBody = message.interactive.button_reply.title;
              newReplyData.body = messageBody;
            }
            break;
          case 'button': // For Call to Action button clicks
            if (message.button && message.button.text) {
                messageBody = message.button.text;
                newReplyData.body = messageBody;
            }
            break;
          case 'image': case 'video': case 'audio': case 'document': case 'voice':
            newReplyData.mediaId = message[message.type].id;
            newReplyData.mediaType = message.type;
            if (message[message.type].caption) newReplyData.body = message[message.type].caption;
            break;
          default:
            console.log(`Unsupported message type received: ${message.type}`);
            break;
        }

        if (newReplyData.body || newReplyData.mediaId) {
          const newReply = new Reply(newReplyData);
          savedReply = await newReply.save();
          console.log('✅ Incoming reply saved to DB.');
          io.emit('newMessage', { from: message.from, message: savedReply });
        }

        // --- Reply Counting and Live Leads Logic ---
        let campaignToCredit = null;
        if (message.context && message.context.id) {
          const originalMessage = await Analytics.findOne({ wamid: message.context.id }).populate('campaign');
          if (originalMessage) campaignToCredit = originalMessage.campaign;
        } else {
          const contact = await Contact.findOne({ phoneNumber: message.from });
          if (contact) {
            const lastSentMessage = await Analytics.findOne({ contact: contact._id }).populate('campaign').sort({ createdAt: -1 });
            if (lastSentMessage) campaignToCredit = lastSentMessage.campaign;
          }
        }
        
        if (campaignToCredit) {
            const existingReplyForCampaign = await Reply.findOne({ from: message.from, campaign: campaignToCredit._id });
            if (!existingReplyForCampaign && savedReply) {
                savedReply.campaign = campaignToCredit._id;
                await savedReply.save();
                if (campaignToCredit.spreadsheetId) {
                    console.log(`✨ New lead for campaign "${campaignToCredit.name}". Appending to Google Sheet...`);
                    const contact = await Contact.findOne({ phoneNumber: message.from });
                    const dataRow = [[
                        new Date(message.timestamp * 1000).toLocaleString(),
                        message.from,
                        contact ? contact.name : 'Unknown',
                        messageBody, // Use the extracted message body
                    ]];
                    await appendToSheet(campaignToCredit.spreadsheetId, 'Sheet1!A1', dataRow);
                }
            }
            await Campaign.findByIdAndUpdate(campaignToCredit._id, { $inc: { replyCount: 1 } });
            console.log(`✅ Incremented reply count for campaign: ${campaignToCredit._id}`);
        }
        
        // --- Auto-Reply Bot Logic ---
        if (messageBody) {
            const messageBodyLower = messageBody.toLowerCase();
            if (messageBodyLower.includes('marbella')) {
                const autoReplyText = 'Thank you for your Interest. We will contact you shortly.';
                await sendTextMessage(message.from, autoReplyText);
            } else if (messageBodyLower.includes('rise') || messageBodyLower.includes('yes, i am interested')) {
                const autoReplyText = 'Thank you for your Interest. We will contact you shortly.';
                await sendTextMessage(message.from, autoReplyText);
            } else if (messageBodyLower.includes('not interested')) {
                const autoReplyText = 'We appreciate your feedback. If at any point you like to revisit the opportunity, our team will be ready to support you.';
                await sendTextMessage(message.from, autoReplyText);
            } else {
                const messageCount = await Reply.countDocuments({ from: message.from });
                if (messageCount === 1) {
                    const welcomeMessage = 'Hello and welcome to Capital Avenue! Its a pleasure to connect with you. How can we help you today!';
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
            await Analytics.findOneAndUpdate({ wamid: statusUpdate.id }, { status: statusUpdate.status });
            console.log(`✅ Updated status for ${statusUpdate.id} to ${statusUpdate.status}`);
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