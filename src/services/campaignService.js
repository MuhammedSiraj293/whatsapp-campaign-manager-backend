// backend/src/services/campaignService.js

const Campaign = require("../models/Campaign");
const Contact = require("../models/Contact");
const Analytics = require("../models/Analytics");
const Log = require("../models/Log");
const Reply = require("../models/Reply");
const { sendTemplateMessage } = require("../integrations/whatsappAPI");
const { getIO } = require("../socketManager");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const processCampaignBackground = async (campaignId, options = {}) => {
  const io = getIO();
  try {
    const campaign = await Campaign.findById(campaignId).populate({
      path: "phoneNumber",
      populate: { path: "wabaAccount" },
    });

    if (!campaign) {
      console.error(
        `Campaign ${campaignId} not found for background processing.`,
      );
      return;
    }

    // Mark as sending
    campaign.status = "sending";
    await campaign.save();
    io.emit("campaignsUpdated");

    // Use settings from request (frontend) or fall back to saved campaign values
    const batchSize = options.batchSize || campaign.batchSize || 50;
    const batchDelay = options.batchDelay || campaign.batchDelay || 2000;
    const messageDelay = options.messageDelay || campaign.messageDelay || 2000;

    console.log(
      `Batch config: size=${batchSize}, batchDelay=${batchDelay}ms, msgDelay=${messageDelay}ms`,
    );

    // Build query
    const query = {
      contactList: campaign.contactList,
      isSubscribed: true,
    };

    const totalContacts = await Contact.countDocuments(query);
    console.log(
      `Starting background campaign "${campaign.name}". Total contacts: ${totalContacts}`,
    );

    // Exclusion List Handling
    let excludedPhoneNumbers = new Set();
    if (campaign.exclusionList) {
      const excludedContacts = await Contact.find({
        contactList: campaign.exclusionList,
      }).select("phoneNumber");
      excludedContacts.forEach((c) => excludedPhoneNumbers.add(c.phoneNumber));
      console.log(`🚫 Found ${excludedPhoneNumbers.size} contacts to exclude.`);
    }

    // Deduplication Data
    const campaignsWithSameTemplate = await Campaign.find({
      templateName: campaign.templateName,
    }).select("_id");
    const campaignIds = campaignsWithSameTemplate.map((c) => c._id);
    const analyticsWithPhones = await Analytics.find({
      campaign: { $in: campaignIds },
      status: { $ne: "failed" },
    }).populate("contact", "phoneNumber");

    const phoneNumbersWhoReceivedTemplate = new Set(
      analyticsWithPhones
        .filter((a) => a.contact && a.contact.phoneNumber)
        .map((a) => a.contact.phoneNumber),
    );

    // BATCH LOOP
    let offset = 0;
    let successCount = 0;
    let failureCount = 0;

    while (offset < totalContacts) {
      console.log(
        `Processing batch offset ${offset} for campaign ${campaign.name}`,
      );

      const contacts = await Contact.find(query).skip(offset).limit(batchSize);

      if (contacts.length === 0) break;

      // MESSAGE LOOP
      for (const contact of contacts) {
        // 1. Exclusion Check
        if (excludedPhoneNumbers.has(contact.phoneNumber)) continue;

        // 2. Deduplication Check
        if (phoneNumbersWhoReceivedTemplate.has(contact.phoneNumber)) {
          console.log(
            `Skipping ${contact.phoneNumber}: already received template.`,
          );
          continue;
        }

        // Send Logic
        try {
          const { accessToken } = campaign.phoneNumber.wabaAccount;
          const { phoneNumberId } = campaign.phoneNumber;

          const finalBodyVariables = [];
          if (campaign.expectedVariables > 0) {
            for (let i = 0; i < campaign.expectedVariables; i++) {
              let value =
                (contact.variables && contact.variables.get(`var${i + 1}`)) ||
                undefined;
              if (i === 0 && !value) value = contact.name || "Valued Customer";
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
            },
            accessToken,
            phoneNumberId,
          );

          // Log/Analytics/Reply logic (simplified for brevity, ensuring core matching)
          if (response?.messages?.[0]?.id) {
            const wamid = response.messages[0].id;

            // --- FIX: Interpolate Variables into Body for History Context ---
            let resolvedBody = campaign.message || "";
            if (finalBodyVariables.length > 0) {
              finalBodyVariables.forEach((val, index) => {
                resolvedBody = resolvedBody.replace(
                  new RegExp(`{{${index + 1}}}`, "g"),
                  val,
                );
              });
            }

            // Save Reply
            try {
              await Reply.create({
                messageId: wamid,
                from: contact.phoneNumber,
                recipientId: phoneNumberId,
                body: resolvedBody,
                timestamp: new Date(),
                direction: "outgoing",
                read: true,
                campaign: campaign._id,
              });
            } catch (err) {
              console.error("Error saving reply:", err.message);
            }

            await Log.create({
              campaign: campaign._id,
              contact: contact._id,
              status: "sent",
              messageId: wamid,
            });
            await Analytics.create({
              wamid,
              campaign: campaign._id,
              contact: contact._id,
              status: "sent",
            });
            // Add to deduplication set
            phoneNumbersWhoReceivedTemplate.add(contact.phoneNumber);
            successCount++;

            // Emit new message
            io.emit("newMessage", {
              from: contact.phoneNumber,
              recipientId: phoneNumberId,
              message: {
                body: resolvedBody,
                direction: "outgoing",
                timestamp: new Date(),
              }, // Simplified
            });
          }
        } catch (error) {
          console.error(
            `Failed to send to ${contact.phoneNumber}: ${error.message}`,
          );
          await Log.create({
            campaign: campaign._id,
            contact: contact._id,
            status: "failed",
            error: error.message,
          });
          failureCount++;
        }

        // Message Delay
        if (messageDelay > 0) await sleep(messageDelay);
      }

      offset += batchSize;

      // Batch Delay
      if (offset < totalContacts) {
        console.log(`Waiting ${batchDelay}ms before next batch...`);
        await sleep(batchDelay);
      }
    }

    // Finish
    campaign.status = "sent";
    campaign.sentAt = new Date();
    await campaign.save();

    await Log.create({
      level: "success",
      message: `Campaign "${campaign.name}" completed. Success: ${successCount}, Failed: ${failureCount}.`,
      campaign: campaign._id,
    });
    console.log(`Campaign "${campaign.name}" finished.`);
    io.emit("campaignsUpdated");
  } catch (error) {
    console.error(`Background processing error: ${error.message}`);
    try {
      const c = await Campaign.findById(campaignId);
      if (c) {
        c.status = "failed";
        await c.save();
        io.emit("campaignsUpdated");
      }
    } catch (e) {
      /* ignore */
    }
  }
};

const sendCampaign = async (campaignId, options = {}) => {
  // Fire and forget — pass options (batch settings from frontend) to background processor
  processCampaignBackground(campaignId, options);
  return { message: "Campaign started in background.", campaignId };
};

module.exports = {
  sendCampaign,
};
