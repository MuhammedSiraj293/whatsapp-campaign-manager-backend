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
        `📋 Found ${stuckEnquiries.length} stuck enquiries (inactive > 3m)`
      );

      for (const enquiry of stuckEnquiries) {
        try {
          const phoneDoc = await PhoneNumber.findOne({
            phoneNumberId: enquiry.recipientId,
          }).populate("wabaAccount");

          if (!phoneDoc || !phoneDoc.wabaAccount) continue;

          // Determine Language (Default to English)
          const isArabic = enquiry.language === "ar";

          // Content
          const textEng =
            "We are almost done! Please complete your enquiry so we can arrange the best assistance for you. ";
          const textAr =
            "لقد أوشكنا على الانتهاء! يرجى استكمال استفسارك لنتمكن من ترتيب أفضل مساعدة لك. ";

          const buttonsEng = [
            { id: "stuck_continue", title: "Continue" },
            { id: "stuck_end", title: "End Chat" },
          ];
          const buttonsAr = [
            { id: "stuck_continue", title: "متابعة" },
            { id: "stuck_end", title: "إنهاء المحادثة" },
          ];

          const stuckResult = await sendButtonMessage(
            enquiry.phoneNumber,
            isArabic ? textAr : textEng,
            isArabic ? buttonsAr : buttonsEng,
            accessToken,
            enquiry.recipientId
          );

          // --- SAVE & EMIT STUCK MESSAGE ---
          if (stuckResult?.messages?.[0]?.id) {
            const stuckReply = await Reply.create({
              messageId: stuckResult.messages[0].id,
              from: phoneDoc.phoneNumberId, // Business Phone
              recipientId: enquiry.recipientId, // Business Phone (Context)
              // For outgoing: 'from' could be business number, or we just track direction 'outgoing'
              // Actually for outgoing: from = business_number, recipientId = user_phone usually?
              // Wait, existing logic: outgoing -> from=business, recipientId=user
              // But here enquiry.recipientId is the business phone ID in DB context usually?
              // Let's stick to standard:
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

          // Mark as sent
          enquiry.lastStuckFollowUpSentAt = new Date();
          // We also update 'updatedAt' implicitly by saving, which resets the 3m timer
          await enquiry.save();
          console.log(`🚀 Sent stuck follow-up to ${enquiry.phoneNumber}`);
        } catch (err) {
          console.error(
            `❌ Error sending stuck follow-up to ${enquiry.phoneNumber}:`,
            err.message
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
        `📋 Found ${reviewCandidates.length} completed enquiries ready for review request`
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
            "How would you rate your experience with your Capital Avenue assistant today? 🌟";
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
            enquiry.recipientId
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
            err.message
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
