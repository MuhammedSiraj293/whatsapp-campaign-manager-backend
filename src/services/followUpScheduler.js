// backend/src/services/followUpScheduler.js

const Enquiry = require("../models/Enquiry");
const PhoneNumber = require("../models/PhoneNumber");
const BotNode = require("../models/BotNode");
const BotFlow = require("../models/BotFlow");

/**
 * Check for enquiries that need follow-up messages
 * Run this every 1 minute via cron job
 */
const checkAndSendFollowUps = async () => {
  try {
    // console.log("🔍 Checking for enquiries needing follow-up...");

    const now = Date.now();

    // Find active enquiries that haven't received a follow-up for the current node
    const enquiries = await Enquiry.find({
      conversationState: { $ne: "END" },
      nodeFollowUpSent: false,
      lastNodeSentAt: { $exists: true, $ne: null },
    });

    if (enquiries.length > 0) {
      console.log(
        `📋 Found ${enquiries.length} potential enquiries for follow-up`
      );
    }

    for (const enquiry of enquiries) {
      try {
        // 1. Get the current node configuration
        const phoneDoc = await PhoneNumber.findOne({
          phoneNumberId: enquiry.recipientId,
        }).populate("wabaAccount");

        if (!phoneDoc || !phoneDoc.activeBotFlow || !phoneDoc.wabaAccount) {
          continue;
        }

        const currentNode = await BotNode.findOne({
          botFlow: phoneDoc.activeBotFlow,
          nodeId: enquiry.conversationState,
        });

        if (!currentNode) {
          console.log(`❌ Node not found: ${enquiry.conversationState}`);
          continue;
        }

        if (!currentNode.followUpEnabled) {
          // console.log(`ℹ️ Follow-up disabled for node ${currentNode.nodeId}`);
          continue;
        }

        // 2. Check if delay has passed
        const delayMs = (currentNode.followUpDelay || 15) * 60 * 1000;
        const timeSinceLastMsg =
          now - new Date(enquiry.lastNodeSentAt).getTime();

        console.log(
          `🔍 Checking ${enquiry.phoneNumber} on node ${
            currentNode.nodeId
          }: TimeSince=${timeSinceLastMsg / 1000}s, Delay=${delayMs / 1000}s`
        );

        if (timeSinceLastMsg >= delayMs) {
          console.log(
            `🚀 Sending follow-up to ${enquiry.phoneNumber} for node ${currentNode.nodeId}`
          );

          // 3. Send the follow-up message
          const accessToken = phoneDoc.wabaAccount.accessToken;

          // Use the configured message or a default
          const messageText =
            currentNode.followUpMessage || "Are you still there?";

          // Send text message
          const { sendTextMessage } = require("../integrations/whatsappAPI");

          await sendTextMessage(
            enquiry.phoneNumber,
            messageText,
            accessToken,
            enquiry.recipientId
          );

          // 4. Mark as sent
          enquiry.nodeFollowUpSent = true;
          await enquiry.save();

          console.log(`✅ Follow-up sent successfully.`);
        }
      } catch (error) {
        console.error(
          `❌ Error processing follow-up for ${enquiry.phoneNumber}:`,
          error.message
        );
      }
    }
  } catch (error) {
    console.error("❌ Error in checkAndSendFollowUps:", error);
  }
};

module.exports = {
  checkAndSendFollowUps,
};
