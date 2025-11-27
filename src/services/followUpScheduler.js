// backend/src/services/followUpScheduler.js

const Enquiry = require("../models/Enquiry");
const PhoneNumber = require("../models/PhoneNumber");
const BotNode = require("../models/BotNode");
const BotFlow = require("../models/BotFlow");
const Reply = require("../models/Reply");
const { getIO } = require("../socketManager");

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

          const sentMsg = await sendTextMessage(
            enquiry.phoneNumber,
            messageText,
            accessToken,
            enquiry.recipientId
          );

          if (sentMsg && sentMsg.messages && sentMsg.messages[0]?.id) {
            const newReply = new Reply({
              messageId: sentMsg.messages[0].id,
              from: enquiry.phoneNumber, // In this context, 'from' is usually the customer phone for consistency in chat view, or we check how outgoing is stored.
              // WAIT: In botService, outgoing messages have from: customerPhone, recipientId: businessPhone (recipientId).
              // The schema says: from: String, recipientId: String.
              // In botService: from: customerPhone, recipientId: recipientId (business).
              // So here: from: enquiry.phoneNumber, recipientId: enquiry.recipientId.
              from: enquiry.phoneNumber,
              recipientId: enquiry.recipientId,
              body: messageText,
              timestamp: new Date(),
              direction: "outgoing",
              read: true,
            });
            await newReply.save();

            // Emit socket event
            try {
              const io = getIO();
              io.emit("newMessage", {
                from: enquiry.phoneNumber,
                recipientId: enquiry.recipientId,
                message: newReply,
              });
            } catch (err) {
              console.error("Socket emit error:", err.message);
            }
          }

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
    // ------------------------------------------------------------------
    // PART 2: CHECK FOR POST-COMPLETION FOLLOW-UPS (Global Flow Setting)
    // ------------------------------------------------------------------
    const completedEnquiries = await Enquiry.find({
      conversationState: "END",
      completionFollowUpSent: false,
      endedAt: { $exists: true, $ne: null },
    });

    if (completedEnquiries.length > 0) {
      console.log(
        `📋 Found ${completedEnquiries.length} completed enquiries for potential follow-up`
      );
    }

    for (const enquiry of completedEnquiries) {
      try {
        const phoneDoc = await PhoneNumber.findOne({
          phoneNumberId: enquiry.recipientId,
        }).populate("wabaAccount");

        if (!phoneDoc || !phoneDoc.activeBotFlow || !phoneDoc.wabaAccount) {
          continue;
        }

        const botFlow = await BotFlow.findById(phoneDoc.activeBotFlow);
        if (!botFlow || !botFlow.completionFollowUpEnabled) {
          continue;
        }

        const delayMs = (botFlow.completionFollowUpDelay || 60) * 60 * 1000;
        const timeSinceEnd = now - new Date(enquiry.endedAt).getTime();

        console.log(
          `🔍 Checking completion follow-up for ${
            enquiry.phoneNumber
          }: TimeSince=${timeSinceEnd / 1000}s, Delay=${delayMs / 1000}s`
        );

        if (timeSinceEnd >= delayMs) {
          console.log(
            `🚀 Sending completion follow-up to ${enquiry.phoneNumber}`
          );

          const accessToken = phoneDoc.wabaAccount.accessToken;
          const messageText =
            botFlow.completionFollowUpMessage ||
            "Did you find what you were looking for?";

          // Send Yes/No Buttons
          const { sendButtonMessage } = require("../integrations/whatsappAPI");

          const buttons = [
            { id: "followup_yes", title: "Yes" },
            { id: "followup_no", title: "No" },
          ];

          const sentMsg = await sendButtonMessage(
            enquiry.phoneNumber,
            messageText,
            buttons,
            accessToken,
            enquiry.recipientId
          );

          if (sentMsg && sentMsg.messages && sentMsg.messages[0]?.id) {
            const newReply = new Reply({
              messageId: sentMsg.messages[0].id,
              from: enquiry.phoneNumber,
              recipientId: enquiry.recipientId,
              body: messageText,
              timestamp: new Date(),
              direction: "outgoing",
              read: true,
              interactive: {
                type: "button",
                body: messageText, // Fixed: Schema expects String, not Object
                action: {
                  buttons: buttons.map((b) => ({
                    type: "reply",
                    reply: { id: b.id, title: b.title },
                  })),
                },
              },
            });
            await newReply.save();

            // Emit socket event
            try {
              const io = getIO();
              io.emit("newMessage", {
                from: enquiry.phoneNumber,
                recipientId: enquiry.recipientId,
                message: newReply,
              });
            } catch (err) {
              console.error("Socket emit error:", err.message);
            }
          }

          enquiry.completionFollowUpSent = true;
          await enquiry.save();

          console.log(`✅ Completion follow-up sent successfully.`);
        }
      } catch (error) {
        console.error(
          `❌ Error processing completion follow-up for ${enquiry.phoneNumber}:`,
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
