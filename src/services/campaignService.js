// backend/src/services/campaignService.js

const Campaign = require("../models/Campaign");
const Contact = require("../models/Contact");
const Analytics = require("../models/Analytics");
const Log = require("../models/Log");
const Reply = require("../models/Reply");
const { sendTemplateMessage } = require("../integrations/whatsappAPI");
const { getIO } = require("../socketManager");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sendCampaign = async (campaignId) => {
  const io = getIO();
  const campaign = await Campaign.findById(campaignId);

  // Basic checks
  if (!campaign) {
    await Log.create({
      level: "error",
      message: `sendCampaign failed: Campaign with ID ${campaignId} not found.`,
    });
    throw new Error("Campaign not found.");
  }
  if (!campaign.contactList) {
    await Log.create({
      level: "error",
      message: `Campaign "${campaign.name}" has no contact list assigned.`,
      campaign: campaignId,
    });
    throw new Error("No contact list is assigned to this campaign.");
  }

  const contacts = await Contact.find({ contactList: campaign.contactList });
  if (contacts.length === 0) {
    await Log.create({
      level: "info",
      message: `Campaign "${campaign.name}" has no contacts in its list.`,
      campaign: campaignId,
    });
    throw new Error("The assigned contact list is empty.");
  }

  // Get a list of contacts who have ALREADY received this campaign to prevent duplicates
  const alreadySentAnalytics = await Analytics.find({
    campaign: campaignId,
  }).select("contact");
  const alreadySentContactIds = new Set(
    alreadySentAnalytics.map((a) => a.contact.toString())
  );

  let successCount = 0;
  let failureCount = 0;

  for (const contact of contacts) {
    // Check if the current contact is in the list of already-sent contacts
    if (alreadySentContactIds.has(contact._id.toString())) {
      console.log(
        `Skipping ${contact.phoneNumber}, message already sent for this campaign.`
      );
      continue; // Skip to the next contact
    }

    let wamid = `failed-${contact._id}-${Date.now()}`;
    let status = "sent";
    let failureReason = null;

    try {
      const finalBodyVariables = [];
      if (campaign.expectedVariables > 0) {
        for (let i = 0; i < campaign.expectedVariables; i++) {
          let value =
            (contact.variables && contact.variables.get(`var${i + 1}`)) ||
            undefined;
          if (i === 0 && !value) {
            value = contact.name || "Valued Customer";
          }
          finalBodyVariables.push(String(value || ""));
        }
      }

      const response = await sendTemplateMessage(
        contact.phoneNumber,
        campaign.templateName,
        campaign.templateLanguage,
        {
          headerImageUrl: campaign.headerImageUrl,
          bodyVariables: finalBodyVariables,
          buttons: campaign.buttons,
        }
      );

      if (response && response.messages && response.messages[0].id) {
        wamid = response.messages[0].id;

        const campaignMessage = new Reply({
          messageId: wamid,
          from: contact.phoneNumber,
          body: campaign.message,
          timestamp: new Date(),
          direction: "outgoing",
          read: true,
          campaign: campaign._id,
        });
        await campaignMessage.save();

        io.emit("newMessage", {
          from: contact.phoneNumber,
          message: campaignMessage,
        });
      }
      successCount++;
    } catch (error) {
      failureReason = error.response?.data?.error?.message || error.message;
      status = "failed";
      await Log.create({
        level: "error",
        message: `Failed to send to ${contact.phoneNumber}. Reason: ${failureReason}`,
        campaign: campaignId,
      });
      failureCount++;
    }

    await Analytics.create({
      wamid: wamid,
      campaign: campaign._id,
      contact: contact._id,
      status: status,
      failureReason: failureReason,
    });

    await sleep(1000);
  }

  // Find the campaign again to update its status to 'sent'
  const finalCampaign = await Campaign.findById(campaignId);
  if (finalCampaign) {
    finalCampaign.status = "sent";
    await finalCampaign.save();
  }

  await Log.create({
    level: "success",
    message: `Campaign "${campaign.name}" finished. Success: ${successCount}, Failures: ${failureCount}.`,
    campaign: campaignId,
  });

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
