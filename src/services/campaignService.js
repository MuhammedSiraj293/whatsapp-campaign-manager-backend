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
      const finalBodyVariables = [];

      // This is the final, most robust logic for handling variables.
      if (campaign.expectedVariables > 0) {
        for (let i = 0; i < campaign.expectedVariables; i++) {
          // Start with the variable from the contact file
          let value = contact.variables[i];

          // If the FIRST variable (i === 0) is missing, try to use the contact's name.
          if (i === 0 && !value) {
            value = contact.name;
          }
          
          // If the value is still missing after all checks, use a generic fallback.
          if (!value) {
            value = 'there'; // A safe default like "Hi there,"
          }

          // Ensure the final value is always a string.
          finalBodyVariables.push(String(value));
        }
      }

      await sendTemplateMessage(
        contact.phoneNumber,
        campaign.templateName,
        campaign.templateLanguage,
        {
          headerImageUrl: campaign.headerImageUrl,
          bodyVariables: finalBodyVariables,
        }
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