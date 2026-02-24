// backend/src/services/campaignService.js

const Campaign = require("../models/Campaign");
const Contact = require("../models/Contact");
const Analytics = require("../models/Analytics");
const Log = require("../models/Log");
const Reply = require("../models/Reply");
const { sendTemplateMessage } = require("../integrations/whatsappAPI");
const { getIO } = require("../socketManager");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- In-memory state map for pause/resume ---
// Maps campaignId (string) -> 'running' | 'paused' | 'stopped'
const campaignStateMap = new Map();

const pauseCampaign = (campaignId) => {
  campaignStateMap.set(String(campaignId), "paused");
};

const resumeCampaign = (campaignId) => {
  campaignStateMap.set(String(campaignId), "running");
};

const getCampaignState = (campaignId) => {
  return campaignStateMap.get(String(campaignId)) || "running";
};

// Waits while campaign is paused, resolves when running again
const waitWhilePaused = async (campaignId) => {
  while (getCampaignState(campaignId) === "paused") {
    await sleep(2000); // poll every 2 seconds
  }
};

const processCampaignBackground = async (campaignId, options = {}) => {
  const io = getIO();
  const idStr = String(campaignId);

  // Register as running
  campaignStateMap.set(idStr, "running");

  try {
    const campaign = await Campaign.findById(campaignId).populate({
      path: "phoneNumber",
      populate: { path: "wabaAccount" },
    });

    if (!campaign) {
      console.error(
        `Campaign ${campaignId} not found for background processing.`,
      );
      campaignStateMap.delete(idStr);
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
    const baseQuery = {
      contactList: campaign.contactList,
      isSubscribed: true,
    };

    const totalContactsBeforeFilters = await Contact.countDocuments(baseQuery);
    console.log(
      `Starting background campaign "${campaign.name}". Total contacts before filters: ${totalContactsBeforeFilters}`,
    );

    // Exclusion List Handling
    let excludedPhoneNumbers = [];
    if (campaign.exclusionList) {
      const excludedContacts = await Contact.find({
        contactList: campaign.exclusionList,
      }).select("phoneNumber");
      excludedPhoneNumbers = excludedContacts.map((c) => c.phoneNumber);
      console.log(
        `🚫 Found ${excludedPhoneNumbers.length} contacts to exclude.`,
      );
    }

    // Deduplication Data
    const campaignsWithSameTemplate = await Campaign.find({
      templateName: campaign.templateName,
    }).select("_id");
    const campaignIds = campaignsWithSameTemplate.map((c) => c._id);

    // We want to skip:
    // 1. Any SUCCESSFUL/PENDING message from ANY campaign using this template (status != "failed")
    // 2. ANY message (even failed) from THIS EXACT campaign, so we don't infinitely loop on them when resuming.
    const analyticsWithPhones = await Analytics.find({
      $or: [
        { campaign: { $in: campaignIds }, status: { $ne: "failed" } },
        { campaign: campaignId }, // Skip ALL existing records (successful or failed) from THIS specific campaign instance
      ],
    }).populate("contact", "phoneNumber");

    const phoneNumbersWhoReceivedTemplate = analyticsWithPhones
      .filter((a) => a.contact && a.contact.phoneNumber)
      .map((a) => a.contact.phoneNumber);

    // Build the final query excluding numbers
    const allNumbersToSkip = [
      ...new Set([...excludedPhoneNumbers, ...phoneNumbersWhoReceivedTemplate]),
    ];

    const finalQuery = {
      ...baseQuery,
      phoneNumber: { $nin: allNumbersToSkip },
    };

    const totalContactsToProcess = await Contact.countDocuments(finalQuery);
    console.log(
      `Final contacts to process after deduplication/exclusion: ${totalContactsToProcess}`,
    );

    // BATCH LOOP
    let offset = 0;
    let successCount = 0;
    let failureCount = 0;

    while (offset < totalContactsToProcess) {
      // --- PAUSE CHECK (between batches) ---
      await waitWhilePaused(idStr);

      console.log(
        `Processing batch offset ${offset} of ${totalContactsToProcess} for campaign ${campaign.name}`,
      );

      const contacts = await Contact.find(finalQuery)
        .skip(offset)
        .limit(batchSize);

      if (contacts.length === 0) break;

      // MESSAGE LOOP
      for (const contact of contacts) {
        // --- PAUSE CHECK (between messages) ---
        await waitWhilePaused(idStr);

        // 3. Send Logic — wrapped in try/catch so one failure doesn't stop the loop
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
              // Prefer the stored Meta media ID; fall back to URL if no ID
              headerMediaId: campaign.headerMediaId || undefined,
              headerImageUrl: campaign.headerMediaId
                ? undefined
                : campaign.headerImageUrl,
              bodyVariables: finalBodyVariables,
              buttons: campaign.buttons,
            },
            accessToken,
            phoneNumberId,
          );

          if (response?.messages?.[0]?.id) {
            const wamid = response.messages[0].id;

            // Interpolate variables into body for chat history
            let resolvedBody = campaign.message || "";
            if (finalBodyVariables.length > 0) {
              finalBodyVariables.forEach((val, index) => {
                resolvedBody = resolvedBody.replace(
                  new RegExp(`{{${index + 1}}}`, "g"),
                  val,
                );
              });
            }

            // Save Reply (non-fatal)
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
            } catch (replyErr) {
              console.error("Error saving reply:", replyErr.message);
            }

            // Log success
            try {
              await Log.create({
                level: "info",
                message: `Sent to ${contact.phoneNumber} (wamid: ${wamid}).`,
                campaign: campaign._id,
              });
            } catch (logErr) {
              console.error("Log save error:", logErr.message);
            }

            // Analytics
            await Analytics.create({
              wamid,
              campaign: campaign._id,
              contact: contact._id,
              status: "sent",
            });

            successCount++;

            // Emit new message to frontend
            io.emit("newMessage", {
              from: contact.phoneNumber,
              recipientId: phoneNumberId,
              message: {
                body: resolvedBody,
                direction: "outgoing",
                timestamp: new Date(),
              },
            });
          }
        } catch (error) {
          // Log failure but continue to next contact — don't crash the whole loop
          console.error(
            `Failed to send to ${contact.phoneNumber}: ${error.message}`,
          );

          // Create Analytics record for failed message
          try {
            await Analytics.create({
              wamid: `failed_${contact._id}_${Date.now()}`,
              campaign: campaign._id,
              contact: contact._id,
              status: "failed",
              failureReason: error.message,
            });
          } catch (analyticsErr) {
            console.error("Analytics save error:", analyticsErr.message);
          }

          try {
            await Log.create({
              level: "error",
              message: `Failed to send to ${contact.phoneNumber}: ${error.message}`,
              campaign: campaign._id,
            });
          } catch (logErr) {
            console.error("Log save error:", logErr.message);
          }
          failureCount++;
        }

        // Message Delay between individual messages
        if (messageDelay > 0) await sleep(messageDelay);
      }

      offset += batchSize;

      // Batch Delay before next batch
      if (offset < totalContacts) {
        console.log(`Waiting ${batchDelay}ms before next batch...`);
        await sleep(batchDelay);
      }
    }

    // Mark campaign as completed
    campaign.status = "sent";
    campaign.sentAt = new Date();
    await campaign.save();

    try {
      await Log.create({
        level: "success",
        message: `Campaign "${campaign.name}" completed. Success: ${successCount}, Failed: ${failureCount}.`,
        campaign: campaign._id,
      });
    } catch (logErr) {
      console.error("Final log save error:", logErr.message);
    }

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
  } finally {
    // Always clean up state map when done
    campaignStateMap.delete(idStr);
  }
};

const sendCampaign = async (campaignId, options = {}) => {
  // Fire and forget — pass options (batch settings from frontend) to background processor
  processCampaignBackground(campaignId, options);
  return { message: "Campaign started in background.", campaignId };
};

const isCampaignActive = (campaignId) => {
  return campaignStateMap.has(String(campaignId));
};

module.exports = {
  sendCampaign,
  pauseCampaign,
  resumeCampaign,
  getCampaignState,
  isCampaignActive,
};
