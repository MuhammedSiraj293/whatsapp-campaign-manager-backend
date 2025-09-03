// backend/src/services/campaignService.js

const Campaign = require('../models/Campaign');
const Recipient = require('../models/Recipient');
const { sendTextMessage } = require('../integrations/whatsappAPI');

/**
 * Fetches a campaign and sends its message to all subscribed recipients.
 * @param {string} campaignId - The ID of the campaign to send.
 */
const sendCampaign = async (campaignId) => {
  // 1. Find the campaign by its ID
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) {
    throw new Error('Campaign not found.');
  }
  if (campaign.status === 'sent') {
    throw new Error('This campaign has already been sent.');
  }

  // 2. Find all recipients who are subscribed.
  // (For a real app, you'd fetch recipients linked to this specific campaign)
  const recipients = await Recipient.find({ status: 'subscribed' });
  if (recipients.length === 0) {
    throw new Error('No subscribed recipients to send to.');
  }

  let successCount = 0;
  let failureCount = 0;

  // 3. Loop through each recipient and send the message
  for (const recipient of recipients) {
    try {
      await sendTextMessage(recipient.phoneNumber, campaign.message);
      successCount++;
    } catch (error) {
      console.error(`Failed to send message to ${recipient.phoneNumber}:`, error);
      failureCount++;
    }
  }

  // 4. After sending, update the campaign's status
  campaign.status = 'sent';
  await campaign.save();

  // 5. Return a summary of the operation
  return {
    message: `Campaign "${campaign.name}" sent.`,
    totalRecipients: recipients.length,
    successCount,
    failureCount,
  };
};

module.exports = {
  sendCampaign,
};