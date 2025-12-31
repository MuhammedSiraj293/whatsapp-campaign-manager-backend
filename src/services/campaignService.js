// backend/src/services/campaignService.js

const Campaign = require("../models/Campaign");
const Contact = require("../models/Contact");
const Analytics = require("../models/Analytics");
const Log = require("../models/Log"); // <-- 1. IMPORT THE LOG MODEL
const Reply = require("../models/Reply");
const { sendTemplateMessage } = require("../integrations/whatsappAPI");
const { getIO } = require("../socketManager");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sendCampaign = async (campaignId) => {
  const io = getIO();
  const campaign = await Campaign.findById(campaignId).populate({
    path: "phoneNumber", // <-- 3. Populate the phone number
    populate: {
      path: "wabaAccount", // <-- 4. Populate the parent WABA account
    },
  });

  // --- NEW VALIDATION ---
  if (!campaign) throw new Error("Campaign not found.");
  if (!campaign.contactList) throw new Error("No contact list assigned.");
  if (!campaign.phoneNumber)
    throw new Error('No "Send From" phone number assigned to this campaign.');
  if (!campaign.phoneNumber.wabaAccount)
    throw new Error(
      "WABA account for this phone number is missing or deleted."
    );

  const { accessToken } = campaign.phoneNumber.wabaAccount;
  const { phoneNumberId } = campaign.phoneNumber;

  if (!accessToken || !phoneNumberId) {
    throw new Error(
      "Invalid account credentials. Check WABA account and Phone Number setup."
    );
  }
  // --- END NEW VALIDATION ---

  const contacts = await Contact.find({
    contactList: campaign.contactList,
    isSubscribed: true,
  });

  // --- NEW EXCLUSION LOGIC ---
  let excludedPhoneNumbers = new Set();
  if (campaign.exclusionList) {
    const excludedContacts = await Contact.find({
      contactList: campaign.exclusionList,
    }).select("phoneNumber");

    excludedContacts.forEach((c) => excludedPhoneNumbers.add(c.phoneNumber));
    console.log(`🚫 Found ${excludedPhoneNumbers.size} contacts to exclude.`);
  }

  // Filter existing contacts array
  // We keep only those whose phone number is NOT in the excluded set
  const originalCount = contacts.length;
  for (let i = contacts.length - 1; i >= 0; i--) {
    if (excludedPhoneNumbers.has(contacts[i].phoneNumber)) {
      contacts.splice(i, 1);
    }
  }
  if (originalCount !== contacts.length) {
    console.log(
      `📉 Removed ${originalCount - contacts.length} contacts due to exclusion.`
    );
  }
  // --- END EXCLUSION LOGIC ---
  if (contacts.length === 0) {
    await Log.create({
      level: "info",
      message: `Campaign "${campaign.name}" has no contacts in its list.`,
      campaign: campaignId,
    });
    campaign.status = "sent";
    campaign.sentAt = new Date();
    await campaign.save();
    io.emit("campaignsUpdated"); // <-- EMIT EVENT
    return {
      message: `Campaign "${campaign.name}" sent. No subscribed contacts found.`,
    };
  }

  // ---------------------------------------
  // 🧠 Deduplication Checks
  // ---------------------------------------

  // 1. Get contacts who already received this campaign
  const alreadySentAnalytics = await Analytics.find({
    campaign: campaignId,
  }).select("contact");
  const alreadySentContactIds = new Set(
    alreadySentAnalytics.map((a) => a.contact.toString())
  );

  // 2. Get contacts who have already received this template across any campaign
  // --- THIS IS THE CORRECTED DEDUPLICATION LOGIC ---
  const campaignsWithSameTemplate = await Campaign.find({
    templateName: campaign.templateName,
  }).select("_id");

  const campaignIds = campaignsWithSameTemplate.map((c) => c._id);

  const analyticsWithPhones = await Analytics.find({
    campaign: { $in: campaignIds },
    status: { $ne: "failed" },
  }).populate("contact", "phoneNumber");

  // Filter out any records where the contact has been deleted
  const phoneNumbersWhoReceivedTemplate = new Set(
    analyticsWithPhones
      .filter((a) => a.contact && a.contact.phoneNumber) // ✅ Safety check ensures contact is not null
      .map((a) => a.contact.phoneNumber)
  ); // --- END OF CORRECTION ---
  console.log(
    `Found ${alreadySentContactIds.size} contacts who already received this campaign.`
  );
  console.log(
    `Found ${phoneNumbersWhoReceivedTemplate.size} contacts who already successfully received template "${campaign.templateName}".`
  );
  // --- END OF CORRECTION ---

  // ---------------------------------------
  // 🚀 Send messages
  // ---------------------------------------

  let successCount = 0;
  let failureCount = 0;

  await Log.create({
    level: "info",
    message: `Starting campaign "${campaign.name}" for ${contacts.length} contacts.`,
    campaign: campaignId,
  });

  for (const contact of contacts) {
    const contactIdStr = contact._id.toString();
    const phone = contact.phoneNumber;

    // Skip if already sent this campaign
    if (alreadySentContactIds.has(contactIdStr)) {
      console.log(
        `Skipping ${contact.phoneNumber}: already sent in this campaign.`
      );
      continue;
    }

    // Skip if this phone number has already received this template
    if (phoneNumbersWhoReceivedTemplate.has(phone)) {
      console.log(
        `Skipping ${phone}: already received template "${campaign.templateName}".`
      );
      continue;
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
          headerMediaId: campaign.headerMediaId,
          bodyVariables: finalBodyVariables,
          buttons: campaign.buttons,
        },
        accessToken, // Pass the dynamic token
        phoneNumberId // Pass the dynamic phone ID
      );

      if (response && response.messages && response.messages[0].id) {
        wamid = response.messages[0].id;

        // --- FIX: Interpolate Variables into Body for History Context ---
        let resolvedBody = campaign.message;
        if (finalBodyVariables.length > 0) {
          // Replace {{1}}, {{2}} etc with their corresponding values
          finalBodyVariables.forEach((val, index) => {
            // Create regex to replace {{1}}, {{2}} globally
            // Whatsapp templates use {{1}}, {{2}}. Index is 0-based in array.
            const placeholder = `{{${index + 1}}}`;
            resolvedBody = resolvedBody.replace(
              new RegExp(placeholder, "g"),
              val
            );
          });
        }

        // Save the outgoing campaign message to the 'replies' collection
        const campaignMessage = new Reply({
          messageId: wamid,
          from: contact.phoneNumber,
          recipientId: phoneNumberId, // Save which number sent it
          body: resolvedBody, // Use the resolved body!
          timestamp: new Date(),
          direction: "outgoing",
          read: true,
          campaign: campaign._id,
        });
        await campaignMessage.save();

        // Emit an event so the frontend chat updates instantly
        io.emit("newMessage", {
          from: contact.phoneNumber,
          recipientId: phoneNumberId,
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

  // --- THIS IS THE KEY CHANGE ---
  // Find the campaign again to update its status and set the sentAt timestamp
  const finalCampaign = await Campaign.findById(campaignId);
  if (finalCampaign) {
    finalCampaign.status = "sent";
    finalCampaign.sentAt = new Date(); // <-- Set the exact sent time
    await finalCampaign.save();
  }
  await Log.create({
    level: "success",
    message: `Campaign "${campaign.name}" finished. Success: ${successCount}, Failures: ${failureCount}.`,
    campaign: campaignId,
  });
  io.emit("campaignsUpdated"); // <-- EMIT EVENT
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
