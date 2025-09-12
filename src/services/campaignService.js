// backend/src/services/campaignService.js

const Campaign = require('../models/Campaign');
const Contact = require('../models/Contact');
const Analytics = require('../models/Analytics');
const { sendTemplateMessage } = require('../integrations/whatsappAPI');

// A helper function to create a delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const sendCampaign = async (campaignId) => {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error('Campaign not found.');
  if (!campaign.contactList) throw new Error('No contact list is assigned to this campaign.');
  if (campaign.status === 'sent') throw new Error('This campaign has already been sent.');

  const contacts = await Contact.find({ contactList: campaign.contactList });
  if (contacts.length === 0) throw new Error('The assigned contact list is empty.');

  let successCount = 0;
  let failureCount = 0;

  console.log(`Starting campaign "${campaign.name}" for ${contacts.length} contacts...`);

  for (const contact of contacts) {
    try {
      const finalBodyVariables = [];
      if (campaign.expectedVariables > 0) {
        for (let i = 0; i < campaign.expectedVariables; i++) {
          let value = (contact.variables && contact.variables.get(`var${i + 1}`)) || undefined;
          if (i === 0 && !value) {
            value = contact.name || 'Valued Customer';
          }
          finalBodyVariables.push(String(value || ''));
        }
      }

      const response = await sendTemplateMessage(
        contact.phoneNumber,
        campaign.templateName,
        campaign.templateLanguage,
        {
          headerImageUrl: campaign.headerImageUrl,
          bodyVariables: finalBodyVariables,
        }
      );

      if (response && response.messages && response.messages[0].id) {
        const wamid = response.messages[0].id;
        await Analytics.create({
          wamid: wamid,
          campaign: campaign._id,
          contact: contact._id,
          status: 'sent',
        });
      }
      
      successCount++;
    } catch (error) {
      console.error(`Failed to send message to ${contact.phoneNumber}:`, error);
      failureCount++;
    }

    // Wait for 1 second before sending the next message
    await sleep(1000); 
  }

  const finalCampaign = await Campaign.findById(campaignId);
  if (finalCampaign) {
    finalCampaign.status = 'sent';
    await finalCampaign.save();
  }

  console.log(`Campaign "${campaign.name}" finished. Success: ${successCount}, Failures: ${failureCount}`);
  
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