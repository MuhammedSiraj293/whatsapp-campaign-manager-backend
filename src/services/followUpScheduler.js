// backend/src/services/followUpScheduler.js

const Enquiry = require("../models/Enquiry");
const PhoneNumber = require("../models/PhoneNumber");
const { sendButtonMessage } = require("../integrations/whatsappAPI");

/**
 * Check for enquiries that need follow-up messages
 * Run this every 5-10 minutes via cron job or scheduler
 */
const checkAndSendFollowUps = async () => {
  try {
    console.log("🔍 Checking for enquiries needing follow-up...");

    const now = Date.now();
    const followUpDelayMs = 45 * 60 * 1000; // 45 minutes

    // Find enquiries that:
    // 1. Were created 45+ minutes ago
    // 2. Haven't been contacted by an agent yet
    // 3. Haven't received a follow-up message yet
    // 4. Aren't in END state
    const enquiries = await Enquiry.find({
      agentContacted: { $ne: true },
      followUpSent: { $ne: true },
      conversationState: { $ne: "END" },
      createdAt: { $lte: new Date(now - followUpDelayMs) },
    });

    console.log(`📋 Found ${enquiries.length} enquiries needing follow-up`);

    for (const enquiry of enquiries) {
      try {
        // Get phone number credentials
        const phoneDoc = await PhoneNumber.findOne({
          phoneNumberId: enquiry.recipientId,
        });

        if (!phoneDoc) {
          console.error(`❌ No phone doc found for ${enquiry.recipientId}`);
          continue;
        }

        // Send follow-up message
        await sendButtonMessage(
          enquiry.phoneNumber,
          "👋 Just checking in...\n\nDid someone from Capital Avenue contact you?",
          [
            { id: "followup_yes", title: "Yes!" },
            { id: "followup_no", title: "No" },
          ],
          phoneDoc.accessToken,
          enquiry.recipientId
        );

        // Mark as sent
        enquiry.followUpSent = true;
        enquiry.followUpSentAt = new Date();
        await enquiry.save();

        console.log(`✅ Follow-up sent to ${enquiry.phoneNumber}`);
      } catch (error) {
        console.error(
          `❌ Error sending follow-up to ${enquiry.phoneNumber}:`,
          error
        );
      }
    }

    console.log("✅ Follow-up check completed");
  } catch (error) {
    console.error("❌ Error in checkAndSendFollowUps:", error);
  }
};

module.exports = {
  checkAndSendFollowUps,
};