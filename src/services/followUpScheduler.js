// backend/src/services/followUpScheduler.js

const Enquiry = require("../models/Enquiry");
const PhoneNumber = require("../models/PhoneNumber");
const BotNode = require("../models/BotNode");
const BotFlow = require("../models/BotFlow");
const Reply = require("../models/Reply");
const { getIO } = require("../socketManager");
const {
  sendTextMessage,
  sendListMessage,
  sendButtonMessage,
} = require("../integrations/whatsappAPI");

/**
 * Check for enquiries that need follow-up messages
 * Run this every 1 minute via cron job
 */
const checkAndSendFollowUps = async () => {
  console.log("🔄 FollowUpScheduler: Running Smart Checks (v2.0)");
  const now = Date.now();

  try {
    // ------------------------------------------------------------------
    // PART 1: STUCK FOLLOW-UP (3 MIN INACTIVITY, MAX 1 PER 24H)
    // ------------------------------------------------------------------
    // Find active enquiries updated > 3 mins ago
    const threeMinutesAgo = new Date(now - 3 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);

    const stuckEnquiries = await Enquiry.find({
      conversationState: { $ne: "END" },
      status: { $ne: "closed", $ne: "handover" }, // FIX: Explicitly exclude handover
      updatedAt: { $lt: threeMinutesAgo }, // Stuck for > 3 mins
      // Check 24h Rate Limit: Either never sent OR sent > 24h ago
      $or: [
        { lastStuckFollowUpSentAt: null },
        { lastStuckFollowUpSentAt: { $lt: twentyFourHoursAgo } },
      ],
    });

    if (stuckEnquiries.length > 0) {
      console.log(
        `📋 Found ${stuckEnquiries.length} stuck enquiries (inactive > 3m)`,
      );

      for (const enquiry of stuckEnquiries) {
        try {
          const phoneDoc = await PhoneNumber.findOne({
            phoneNumberId: enquiry.recipientId,
          }).populate("wabaAccount");

          if (!phoneDoc || !phoneDoc.wabaAccount) continue;

          // Determine Language (Default to English)
          const accessToken = phoneDoc.wabaAccount.accessToken;
          const isArabic = enquiry.language === "ar";

          // Content
          const textEng =
            "Apologies, I didn't get a response from you! Please complete your enquiry so we can arrange the best assistance for you. ";
          const textAr =
            "أعتذر، لم أتلقَّ ردًا منك! يُرجى إكمال استفسارك حتى نتمكن من تقديم أفضل مساعدة لك. ";
          const buttonsEng = [
            { id: "stuck_continue", title: "Continue" },
            { id: "stuck_end", title: "End Chat" },
          ];
          const buttonsAr = [
            { id: "stuck_continue", title: "متابعة" },
            { id: "stuck_end", title: "إنهاء المحادثة" },
          ];

          // --- HARDENING: Re-check if valid before sending ---
          const freshEnquiry = await Enquiry.findById(enquiry._id);
          if (
            freshEnquiry.lastStuckFollowUpSentAt &&
            Date.now() -
              new Date(freshEnquiry.lastStuckFollowUpSentAt).getTime() <
              24 * 60 * 60 * 1000
          ) {
            console.log(
              `⚠️ Skipping ${enquiry.phoneNumber} - already sent recently.`,
            );
            continue;
          }

          const stuckResult = await sendButtonMessage(
            enquiry.phoneNumber,
            isArabic ? textAr : textEng,
            isArabic ? buttonsAr : buttonsEng,
            accessToken,
            enquiry.recipientId,
          );

          // --- SAVE & EMIT STUCK MESSAGE ---
          if (stuckResult?.messages?.[0]?.id) {
            const stuckReply = await Reply.create({
              messageId: stuckResult.messages[0].id,
              from: phoneDoc.phoneNumberId, // Business Phone
              recipientId: enquiry.recipientId, // Business Phone (Context)
              from: phoneDoc.phoneNumberId,
              recipientId: enquiry.phoneNumber, // The User
              body: isArabic ? textAr : textEng,
              timestamp: new Date(),
              direction: "outgoing",
              isAiGenerated: true,
              type: "interactive",
              interactive: {
                type: "button",
                body: isArabic ? textAr : textEng,
                action: {
                  buttons: (isArabic ? buttonsAr : buttonsEng).map((b) => ({
                    type: "reply",
                    reply: { id: b.id, title: b.title },
                  })),
                },
              },
            });

            const io = getIO();
            if (io) {
              io.emit("newMessage", {
                from: enquiry.phoneNumber, // Chat ID in frontend usually matches User Phone
                recipientId: enquiry.recipientId,
                message: stuckReply,
              });
            }
          }

          // Mark as sent & Force Update Timestamp
          enquiry.lastStuckFollowUpSentAt = new Date();
          enquiry.updatedAt = new Date(); // Explicitly force update
          await enquiry.save();
          console.log(`🚀 Sent stuck follow-up to ${enquiry.phoneNumber}`);
        } catch (err) {
          console.error(
            `❌ Error sending stuck follow-up to ${enquiry.phoneNumber}:`,
            err.message,
          );
        }
      }
    }

    // ------------------------------------------------------------------
    // PART 1.5: TIMEOUT CLOSURE (10 MIN AFTER STUCK MSG)
    // ------------------------------------------------------------------
    const tenMinutesAgo = new Date(now - 10 * 60 * 1000);

    // Find enquiries where stuck message was sent > 10 mins ago AND no update since
    const timeoutEnquiries = await Enquiry.find({
      conversationState: { $ne: "END" },
      status: { $ne: "closed", $ne: "handover" },
      lastStuckFollowUpSentAt: { $lt: tenMinutesAgo, $ne: null }, // Stuck msg sent > 10m ago
      updatedAt: { $lt: tenMinutesAgo }, // No user activity since stuck msg
    });

    if (timeoutEnquiries.length > 0) {
      console.log(
        `⏱️ Found ${timeoutEnquiries.length} timed-out enquiries (10m post-stuck)`,
      );

      for (const enquiry of timeoutEnquiries) {
        try {
          const phoneDoc = await PhoneNumber.findOne({
            phoneNumberId: enquiry.recipientId,
          }).populate("wabaAccount");

          if (!phoneDoc || !phoneDoc.wabaAccount) continue;

          const accessToken = phoneDoc.wabaAccount.accessToken;
          const isArabic = enquiry.language === "ar";
          const timeoutText = isArabic
            ? "لم نسمع منك منذ فترة، لذا سنقوم بإنهاء هذه الجلسة. لا تتردد في التواصل معنا مرة أخرى عندما تحتاج إلى مساعدة. شكراً لك!"
            : "I have not heard from you in a while, so I'll be ending this chat session. Feel free to reach out again whenever you require further assistance.\nThank you!";

          // Send Text
          const sentRes = await sendTextMessage(
            enquiry.phoneNumber,
            timeoutText,
            accessToken,
            enquiry.recipientId,
          );

          // Save & Emit
          if (sentRes?.messages?.[0]?.id) {
            const reply = await Reply.create({
              messageId: sentRes.messages[0].id,
              from: phoneDoc.phoneNumberId,
              recipientId: enquiry.phoneNumber,
              body: timeoutText,
              timestamp: new Date(),
              direction: "outgoing",
              isAiGenerated: true,
              type: "text",
            });
            const io = getIO();
            if (io)
              io.emit("newMessage", {
                from: enquiry.phoneNumber,
                recipientId: enquiry.recipientId,
                message: reply,
              });
          }

          // Close and Prevent Review
          enquiry.conversationState = "END";
          enquiry.status = "closed";
          enquiry.endedAt = new Date();
          enquiry.completionFollowUpSent = true; // DO NOT SEND REVIEW REQUEST
          await enquiry.save();

          console.log(`💤 Closed timed-out enquiry: ${enquiry.phoneNumber}`);
        } catch (err) {
          console.error(
            `❌ Error closing timed-out enquiry ${enquiry.phoneNumber}:`,
            err.message,
          );
        }
      }
    }

    // ------------------------------------------------------------------
    // PART 2: COMPLETION FOLLOW-UP (REVIEW REQUEST - 1 MIN POST END)
    // ------------------------------------------------------------------
    const oneMinuteAgo = new Date(now - 1 * 60 * 1000);

    const reviewCandidates = await Enquiry.find({
      conversationState: "END",
      completionFollowUpSent: false,
      endedAt: { $lt: oneMinuteAgo }, // Ended > 1 min ago
    });

    if (reviewCandidates.length > 0) {
      console.log(
        `📋 Found ${reviewCandidates.length} completed enquiries ready for review request`,
      );

      for (const enquiry of reviewCandidates) {
        try {
          const phoneDoc = await PhoneNumber.findOne({
            phoneNumberId: enquiry.recipientId,
          }).populate("wabaAccount");

          if (!phoneDoc || !phoneDoc.wabaAccount) continue;

          // Double check to prevent race conditions
          const freshEnquiry = await Enquiry.findById(enquiry._id);
          if (freshEnquiry.completionFollowUpSent) continue;

          const accessToken = phoneDoc.wabaAccount.accessToken;

          // Send List Message for 1-5 Stars (English Only - Premium Experience)
          const listBody =
            "How would you rate your experience with your Capital Avenue assistant today?";
          const sections = [
            {
              title: "Your Experience",
              rows: [
                { id: "rate_5", title: "⭐⭐⭐⭐⭐ Excellent" },
                { id: "rate_4", title: "⭐⭐⭐⭐ Good" },
                { id: "rate_3", title: "⭐⭐⭐ Average" },
                { id: "rate_2", title: "⭐⭐ Poor" },
                { id: "rate_1", title: "⭐ Very Poor" },
              ],
            },
          ];

          const listResult = await sendListMessage(
            enquiry.phoneNumber,
            listBody,
            "Rate Experience",
            sections,
            accessToken,
            enquiry.recipientId,
          );

          // --- SAVE & EMIT REVIEW REQUEST ---
          if (listResult?.messages?.[0]?.id) {
            const reviewReply = await Reply.create({
              messageId: listResult.messages[0].id,
              from: phoneDoc.phoneNumberId,
              recipientId: enquiry.phoneNumber,
              body: listBody,
              timestamp: new Date(),
              direction: "outgoing",
              isAiGenerated: true,
              type: "interactive",
              interactive: {
                type: "list",
                body: listBody,
                action: {
                  button: "Rate Experience",
                  sections: sections,
                },
              },
            });

            const io = getIO();
            if (io) {
              io.emit("newMessage", {
                from: enquiry.phoneNumber,
                recipientId: enquiry.recipientId,
                message: reviewReply,
              });
            }
          }

          // Mark review requested
          enquiry.completionFollowUpSent = true;
          enquiry.reviewStatus = "PENDING";
          await enquiry.save();

          console.log(`🚀 Sent Review Request to ${enquiry.phoneNumber}`);
        } catch (err) {
          console.error(
            `❌ Error sending review request to ${enquiry.phoneNumber}:`,
            err.message,
          );
        }
      }
    }
  } catch (error) {
    console.error("❌ Error in checkAndSendFollowUps:", error);
  }
};

module.exports = {
  checkAndSendFollowUps,
};
