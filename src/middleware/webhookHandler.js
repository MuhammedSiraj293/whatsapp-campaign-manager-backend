// backend/src/middleware/webhookHandler.js

const Reply = require('../models/Reply');
const Campaign = require('../models/Campaign');
const Analytics = require('../models/Analytics');
const { getMediaUrl } = require('../integrations/whatsappAPI');

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

const processWebhook = async (req, res) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    const value = body.entry?.[0]?.changes?.[0]?.value;

    // --- NEW DEBUGGING LOG ---
    // This will print everything Meta sends to your webhook
    console.log('--- Full Webhook Payload Received ---');
    console.log(JSON.stringify(value, null, 2));

    // Handle Incoming Messages
    if (value && value.messages && value.messages[0]) {
      // ... (This logic is unchanged)
    }
    
    // Handle Message Status Updates
    if (value && value.statuses && value.statuses[0]) {
        const statusUpdate = value.statuses[0];
        try {
            // Find the analytics record by the message ID (wamid) and update its status
            const updated = await Analytics.findOneAndUpdate(
                { wamid: statusUpdate.id },
                { status: statusUpdate.status },
                { new: true } // This option returns the updated document
            );

            if (updated) {
                console.log(`✅ Updated status for ${statusUpdate.id} to ${statusUpdate.status}`);
            } else {
                console.log(`- Could not find matching message for status update: ${statusUpdate.id}`);
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