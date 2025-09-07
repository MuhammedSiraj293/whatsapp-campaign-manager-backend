// backend/src/services/campaignService.js

const Campaign = require('../models/Campaign');
const Contact = require('../models/Contact');
const { sendTemplateMessage } = require('../integrations/whatsappAPI');

const sendCampaign = async (campaignId) => {
  // 1. Find the campaign
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error('Campaign not found.');
  if (!campaign.contactList) throw new Error('No contact list is assigned to this campaign.');
  if (campaign.status === 'sent') throw new Error('This campaign has already been sent.');

  // 2. Find all contacts from the associated contact list
  const contacts = await Contact.find({ contactList: campaign.contactList });
  if (contacts.length === 0) throw new Error('The assigned contact list is empty.');

  let successCount = 0;
  let failureCount = 0;

  // 3. Loop through each contact and send the template message
  for (const contact of contacts) {
    try {
      // THIS IS THE KEY: Pass the personalized 'variables' from each contact
      await sendTemplateMessage(
        contact.phoneNumber,
        campaign.templateName,
        campaign.templateLanguage,
        {
          headerImageUrl: campaign.headerImageUrl,
          bodyVariables: contact.variables, // Use the variables from the contact document
        }
      );
      successCount++;
    } catch (error) {
      console.error(`Failed to send message to ${contact.phoneNumber}:`, error);
      failureCount++;
    }
  }

  // 4. Update the campaign's status
  campaign.status = 'sent';
  await campaign.save();

  // 5. Return a summary
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