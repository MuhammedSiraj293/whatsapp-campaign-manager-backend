// backend/src/services/campaignService.js

const Campaign = require("../models/Campaign");
const Contact = require("../models/Contact");
const Analytics = require("../models/Analytics");
const Log = require("../models/Log");
const Reply = require("../models/Reply"); // <-- 1. IMPORT Reply
const { sendTemplateMessage } = require("../integrations/whatsappAPI");
const { io } = require("../server"); // <-- 2. IMPORT io

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sendCampaign = async (campaignId) => {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error("Campaign not found.");
  if (!campaign.contactList)
    throw new Error("No contact list is assigned to this campaign.");
  if (campaign.status === "sent") {
    await Log.create({
      level: "error",
      message: `Attempted to send campaign "${campaign.name}" which has already been sent.`,
      campaign: campaignId,
    });
    throw new Error("This campaign has already been sent.");
  }

  const contacts = await Contact.find({ contactList: campaign.contactList });
  if (contacts.length === 0)
    throw new Error("The assigned contact list is empty.");

  let successCount = 0;
  let failureCount = 0;

  await Log.create({
    level: "info",
    message: `Starting campaign "${campaign.name}" for ${contacts.length} contacts.`,
    campaign: campaignId,
  });

  for (const contact of contacts) {
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

        // --- 3. THIS IS THE FIX ---
        // Save the outgoing campaign message to the 'replies' collection for chat history
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

        // Emit an event so the frontend chat updates instantly
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
