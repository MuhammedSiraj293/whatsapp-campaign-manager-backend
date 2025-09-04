// backend/src/services/campaignService.js

const Campaign = require('../models/Campaign');
const Recipient = require('../models/Recipient');
// Import the new template sending function
const { sendTemplateMessage } = require('../integrations/whatsappAPI');

/**
 * Fetches a campaign and sends its message to its associated recipients.
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

  // 2. Find only the recipients linked to this specific campaign
  const recipients = await Recipient.find({ 
    campaign: campaignId, 
    status: 'subscribed' 
  });

  if (recipients.length === 0) {
    throw new Error('No subscribed recipients found for this campaign.');
  }

  let successCount = 0;
  let failureCount = 0;

  // 3. Loop through each recipient and send the template message
  for (const recipient of recipients) {
    try {
      // --- THIS IS THE KEY CHANGE ---
      // We now call sendTemplateMessage with the template info from the campaign
      await sendTemplateMessage(
        recipient.phoneNumber,
        campaign.templateName,
        campaign.templateLanguage
      );
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