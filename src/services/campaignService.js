// backend/src/services/campaignService.js

const Campaign = require('../models/Campaign');
const Contact = require('../models/Contact');
const { sendTemplateMessage } = require('../integrations/whatsappAPI');

const sendCampaign = async (campaignId) => {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error('Campaign not found.');
  if (!campaign.contactList) throw new Error('No contact list is assigned to this campaign.');
  if (campaign.status === 'sent') throw new Error('This campaign has already been sent.');

  const contacts = await Contact.find({ contactList: campaign.contactList });
  if (contacts.length === 0) throw new Error('The assigned contact list is empty.');

  let successCount = 0;
  let failureCount = 0;

  for (const contact of contacts) {
    try {
      // --- THIS IS THE KEY CHANGE ---
      const options = {
        headerImageUrl: campaign.headerImageUrl,
      };
      // Only add bodyVariables if the template expects them
      if (campaign.expectedVariables > 0) {
        options.bodyVariables = contact.variables;
      }
      
      await sendTemplateMessage(
        contact.phoneNumber,
        campaign.templateName,
        campaign.templateLanguage,
        options
      );
      successCount++;
    } catch (error) {
      console.error(`Failed to send message to ${contact.phoneNumber}:`, error);
      failureCount++;
    }
  }

  campaign.status = 'sent';
  await campaign.save();

  return {
    message: `Campaign "${campaign.name}" sent.`,
    totalRecipients: contacts.length,
    successCount,
    failureCount,
  };
};

module.exports = {
  sendCampaign,
};