// backend/src/middleware/webhookHandler.js

const Reply = require('../models/Reply');
const Campaign = require('../models/Campaign');
const Analytics = require('../models/Analytics');
const Contact = require('../models/Contact'); // <-- Import Contact model

const verifyWebhook = (req, res) => {
  // ... (This function is unchanged)
};

const processWebhook = async (req, res) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    const value = body.entry?.[0]?.changes?.[0]?.value;
    
    console.log('--- Full Webhook Payload Received ---');
    console.log(JSON.stringify(value, null, 2));

    // Handle Incoming Messages
    if (value && value.messages && value.messages[0]) {
      const message = value.messages[0];
      try {
        // ... (Logic to save the incoming reply to the 'replies' collection is unchanged)

        // --- NEW, SMARTER REPLY COUNTING LOGIC ---
        let campaignToCredit = null;

        // First, check if it's a direct reply
        if (message.context && message.context.id) {
          const originalMessage = await Analytics.findOne({ wamid: message.context.id });
          if (originalMessage) campaignToCredit = originalMessage.campaign;
        } else {
          // If not a direct reply, find the last campaign sent to this contact
          const contact = await Contact.findOne({ phoneNumber: message.from });
          if (contact) {
            const lastSentMessage = await Analytics.findOne({ contact: contact._id }).sort({ createdAt: -1 });
            if (lastSentMessage) {
              // Assume this message is a reply to the last campaign sent
              campaignToCredit = lastSentMessage.campaign;
            }
          }
        }

        // If we found a campaign to credit, increment its counter
        if (campaignToCredit) {
          await Campaign.findByIdAndUpdate(campaignToCredit, { $inc: { replyCount: 1 } });
          console.log(`✅ Incremented reply count for campaign: ${campaignToCredit}`);
        }

      } catch (error) {
        console.error('❌ Error processing incoming message:', error);
      }
    }
    
    // Handle Message Status Updates
    if (value && value.statuses && value.statuses[0]) {
        const statusUpdate = value.statuses[0];
        try {
            await Analytics.findOneAndUpdate(
                { wamid: statusUpdate.id },
                { status: statusUpdate.status }
            );
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