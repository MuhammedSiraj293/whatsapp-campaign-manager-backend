// backend/src/middleware/webhookHandler.js

const Reply = require("../models/Reply");
const Campaign = require("../models/Campaign");
const Analytics = require("../models/Analytics");
const Contact = require("../models/Contact");
const PhoneNumber = require("../models/PhoneNumber");
const WabaAccount = require("../models/WabaAccount");
const Enquiry = require("../models/Enquiry");
const ContactList = require("../models/ContactList");
const AutoReplyConfig = require("../models/AutoReplyConfig");

const { sendTextMessage } = require("../integrations/whatsappAPI");
const { getIO } = require("../socketManager");

// Google Sheets API helpers
const {
  appendToSheet,
  clearSheet,
  findSheetIdByName,
  createSheet,
  addHeaderRow,
} = require("../integrations/googleSheets");

// Bot service
const { handleBotConversation } = require("../services/botService");

/* ---------------------------------------------------------
 * 1) META VERIFY WEBHOOK
 * --------------------------------------------------------- */
const verifyWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log("✅ Webhook Verified");
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }
  return res.sendStatus(403);
};

/* ---------------------------------------------------------
 * 2) MAIN WEBHOOK PROCESSOR
 * --------------------------------------------------------- */
const processWebhook = async (req, res) => {
  const io = getIO();
  const body = req.body;

  if (body.object !== "whatsapp_business_account") {
    return res.sendStatus(404);
  }

  const value = body.entry?.[0]?.changes?.[0]?.value;
  const recipientId = value?.metadata?.phone_number_id;
  const contactName = value?.contacts?.[0]?.profile?.name || "Guest";

  if (!recipientId) {
    console.log("⚠️ Missing metadata.phone_number_id — ignoring webhook.");
    return res.sendStatus(200);
  }

  try {
    /* ---------------------------------------------------------
     * A) INCOMING MESSAGE
     * --------------------------------------------------------- */
    if (value?.messages?.[0]) {
      const message = value.messages[0];
      let messageBody = "";
      let campaignToCredit = null;

      /* -------------------------------------------
       * A1) Load PhoneNumber & WABA credentials
       * ------------------------------------------- */
      let phoneNumberDoc = null;
      let credentials = null;

      try {
        phoneNumberDoc = await PhoneNumber.findOne({
          phoneNumberId: recipientId,
        }).populate("wabaAccount");

        if (phoneNumberDoc?.wabaAccount) {
          credentials = {
            accessToken: phoneNumberDoc.wabaAccount.accessToken,
            wabaAccountId: phoneNumberDoc.wabaAccount._id,
          };
        } else {
          console.log(
            `⚠️ No WABA Account for phone_number_id=${recipientId}. (Bot + AutoReply disabled but sheet logging OK)`
          );
        }
      } catch (err) {
        console.error("❌ Error loading PhoneNumber:", err);
      }

      /* -------------------------------------------
       * A2) CAMPAIGN DETECTION (PRIMARY)
       * context.id → Analytics.wamid → campaign
       * ------------------------------------------- */
      if (message.context?.id) {
        const match = await Analytics.findOne({
          wamid: message.context.id,
        }).populate("campaign");

        if (match?.campaign) {
          campaignToCredit = match.campaign;
          console.log(
            `📌 Campaign detected via context → ${campaignToCredit.name}`
          );
        }
      }

      /* -------------------------------------------
       * A3) NORMALIZE MESSAGE BODY
       * ------------------------------------------- */
      /* -------------------------------------------
       * A3) NORMALIZE MESSAGE BODY
       * ------------------------------------------- */
      const newReplyData = {
        messageId: message.id,
        from: message.from,
        recipientId,
        timestamp: new Date(message.timestamp * 1000),
        direction: "incoming",
        campaign: campaignToCredit?._id || null,
        type: message.type, // Save the type explicitly
      };

      // Handle Context (Quoted Replies)
      if (message.context) {
        newReplyData.context = {
          id: message.context.id,
          from: message.context.from,
        };
      }

      switch (message.type) {
        case "text":
          messageBody = message.text.body;
          newReplyData.body = messageBody;
          break;

        case "reaction":
          messageBody = message.reaction.emoji;
          newReplyData.body = messageBody; // Store emoji as body for fallback
          newReplyData.reaction = {
            emoji: message.reaction.emoji,
            messageId: message.reaction.message_id,
          };
          console.log(`👍 Reaction received: ${message.reaction.emoji}`);
          break;

        case "interactive":
        case "button":
          if (message.interactive?.button_reply) {
            messageBody = message.interactive.button_reply.title;
          } else if (message.interactive?.list_reply) {
            messageBody = message.interactive.list_reply.title;
          } else if (message.button?.text) {
            messageBody = message.button.text;
          }
          newReplyData.body = messageBody;
          break;

        case "image":
        case "video":
        case "audio":
        case "document":
        case "voice":
          newReplyData.mediaId = message[message.type].id;
          newReplyData.mediaType = message.type;
          if (message[message.type].caption) {
            messageBody = message[message.type].caption;
            newReplyData.body = messageBody;
          }
          break;
      }

      /* -------------------------------------------
       * A4) SAVE INCOMING MESSAGE
       * ------------------------------------------- */
      const incomingReply = new Reply(newReplyData);
      const savedReply = await incomingReply.save();

      io.emit("newMessage", {
        from: message.from,
        recipientId,
        message: savedReply,
      });

      console.log("💾 Saved incoming reply.");

      /* ---------------------------------------------------------
       * B) LEAD ROUTING (CAMPAIGN REPLY → GOOGLE SHEET)
       * --------------------------------------------------------- */
      if (campaignToCredit && messageBody) {
        console.log("📨 Processing as CAMPAIGN reply...");

        const incomingMessageCount = await Reply.countDocuments({
          from: message.from,
          direction: "incoming",
          campaign: campaignToCredit._id,
        });

        if (incomingMessageCount === 1) {
          console.log(`✨ NEW LEAD for campaign "${campaignToCredit.name}"`);

          const contact = await Contact.findOne({
            phoneNumber: message.from,
          });

          const timestampOptions = {
            timeZone: "Asia/Dubai",
            year: "numeric",
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
          };

          const formattedDate = new Date(
            message.timestamp * 1000
          ).toLocaleString("en-US", timestampOptions);

          const dataRow = [
            [
              `'${formattedDate}`,
              message.from,
              contact ? contact.name : "Unknown",
              messageBody,
            ],
          ];

          const headerRow = ["Timestamp", "From", "Name", "Message"];

          /* -------------------------------
           * SYSTEM 1 — Campaign Sheet
           * ------------------------------- */
          if (campaignToCredit.spreadsheetId) {
            try {
              console.log(
                `📁 Writing lead → Campaign Sheet: ${campaignToCredit.spreadsheetId}`
              );

              await clearSheet(campaignToCredit.spreadsheetId, "Sheet1!A:D");

              await appendToSheet(campaignToCredit.spreadsheetId, "Sheet1!A1", [
                headerRow,
                ...dataRow,
              ]);
            } catch (err) {
              console.error("❌ Campaign Sheet Error:", err);
            }
          } else {
            /* -------------------------------
             * SYSTEM 2 — Master Sheet
             * ------------------------------- */
            if (phoneNumberDoc?.wabaAccount?.masterSpreadsheetId) {
              const masterSheetId =
                phoneNumberDoc.wabaAccount.masterSpreadsheetId;
              const tab = campaignToCredit.templateName || "Leads";

              try {
                let sheetId = await findSheetIdByName(masterSheetId, tab);

                if (!sheetId) {
                  console.log(`📄 Creating new tab: "${tab}"`);
                  await createSheet(masterSheetId, tab);
                  await addHeaderRow(masterSheetId, tab, headerRow);
                }

                console.log(`📁 Appending lead → Master Sheet tab "${tab}"`);

                await appendToSheet(masterSheetId, `${tab}!A1`, dataRow);
              } catch (err) {
                console.error("❌ Master Sheet Error:", err);
              }
            } else {
              console.log("⚠️ No master sheet configured for this WABA.");
            }
          }
        }

        // Update campaign reply count
        await Campaign.findByIdAndUpdate(campaignToCredit._id, {
          $inc: { replyCount: 1 },
        });
      }

      /* ---------------------------------------------------------
       * C) AUTO-REPLY + BOT (DYNAMIC CONFIG)
       * --------------------------------------------------------- */
      if (messageBody) {
        const messageBodyLower = messageBody.toLowerCase();
        const isCampaignReply = !!campaignToCredit;

        let autoReplyText = null;

        // 1. Fetch Config for this phone number
        const config = await AutoReplyConfig.findOne({
          phoneNumberId: recipientId,
        });

        // --- CHECK OFFICE HOURS (If Enabled) ---
        let isAway = false;
        if (
          config &&
          config.officeHoursEnabled &&
          config.officeHours &&
          config.officeHours.length > 0
        ) {
          const now = new Date();
          // Convert 'now' to target timezone if needed (using 'config.timezone')
          // For simplicity, assuming server time or basic offset handling.
          // Ideally use 'moment-timezone' or 'luxon' for robust TZ handling.
          // For now, let's just check the day/time string vs server time (UTC usually).

          // TODO: Implement robust Timezone logic.
          // Assuming config.timezone matches server or using helper.

          const days = [
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
          ];
          const currentDay = days[now.getDay()];
          const currentHour = now.getHours();
          const currentMinute = now.getMinutes();
          const currentTimeStr = `${currentHour
            .toString()
            .padStart(2, "0")}:${currentMinute.toString().padStart(2, "0")}`;

          const todayConfig = config.officeHours.find(
            (d) => d.day === currentDay
          );

          if (todayConfig) {
            if (!todayConfig.isOpen) {
              isAway = true; // Closed all day
            } else {
              // Check time range
              if (
                currentTimeStr < todayConfig.startTime ||
                currentTimeStr > todayConfig.endTime
              ) {
                isAway = true;
              }
            }
          }
        }

        if (isAway && config.awayMessageEnabled) {
          // --- SEND AWAY MESSAGE ---
          // Only send if not a campaign reply? Or always?
          // Usually Away Message overrides Bot, but maybe not Campaign?
          // Let's say Away Message sent only if NO Campaign to be safe ??
          // Actually, Away Message is good for everything if we are closed.

          // BUT: Don't spam away message on every text.
          // Need a "rate limit" or "sent once per window".
          // For now, simplified:
          if (!isCampaignReply) {
            autoReplyText = config.awayMessageText;
            console.log("🌙 Office Closed. Queuing Away Message.");
          }
        } else {
          // --- WE ARE OPEN (OR NO CONFIG) ---
          // 1. Find the credentials for this specific phone number FIRST
          // (Already loaded in A1, but ensuring we have acccesToken)
          if (!credentials || !credentials.accessToken) {
            console.error(
              `❌ Could not find credentials for recipientId ${recipientId}. Aborting auto-reply.`
            );
            // Continue, but won't be able to reply
          } else {
            // 2. Handle "stop" and "re-subscribe" logic
            if (
              messageBodyLower.includes("stop") ||
              messageBodyLower.includes("إيقاف")
            ) {
              autoReplyText =
                "You’ve been unsubscribed. won’t receive further messages, but you can reach out anytime if you need assistance.";
              await Contact.findOneAndUpdate(
                { phoneNumber: message.from },
                { isSubscribed: false }
              );
            } else {
              const contact = await Contact.findOne({
                phoneNumber: message.from,
              });
              if (contact && !contact.isSubscribed) {
                contact.isSubscribed = true;
                await contact.save();
                autoReplyText =
                  "Hello and welcome back to Capital Avenue! How can we help you";
                console.log(
                  `✅ Contact ${message.from} has been re-subscribed.`
                );
              }

              // 3. Handle normal keyword logic
              if (!autoReplyText && isCampaignReply) {
                // RESTRICTED TO CAMPAIGN REPLIES PER USER REQUEST
                // Only if not already responding
                if (messageBodyLower.includes("yes, i am interested")) {
                  autoReplyText =
                    "Your interest has been noted. We will contact you shortly. Thank you for your response.";
                } else if (messageBodyLower.includes("نعم، مهتم")) {
                  autoReplyText =
                    ".تم تسجيل اهتمامك. سنتواصل معك قريبًا. شكرًا على ردك";
                } else if (messageBodyLower.includes("not interested")) {
                  autoReplyText =
                    "We respect your choice. If at any point you'd like to revisit, our team will be ready to help you.";
                }
                // GREETING BLOCK REMOVED PER USER REQUEST ("if some one message first time transfer to ai")
              }
            }
          }
        }

        // OLD: if (!autoReplyText && !isCampaignReply && ...)
        // NEW: We allow AI to handle campaign replies too, to be "smart".
        // User Request 227: "for cmapign replay dont transfer to ai"
        // So we RESTORE !isCampaignReply
        if (
          !autoReplyText &&
          !isCampaignReply &&
          (message.type === "text" || message.type === "interactive")
        ) {
          if (credentials?.accessToken) {
            try {
              // --- AI AGENT CHECK ---
              console.log("🤖 Passing message to AI Service...");
              const { generateResponse } = require("../services/aiService");

              // Fetch existing open enquiry for context
              let existingEnquiry = await Enquiry.findOne({
                phoneNumber: message.from,
                recipientId,
                status: "pending", // Only find active/pending enquiries
              });

              // Update entry source if campaign detected and enquiry is new-ish
              if (existingEnquiry && campaignToCredit) {
                existingEnquiry.entrySource = `Campaign: ${campaignToCredit.name}`;
                existingEnquiry.projectName = campaignToCredit.name; // Infer interest
                await existingEnquiry.save();
              }

              // If no enquiry, create temp object for context (or it will be created in upsert)
              if (!existingEnquiry && campaignToCredit) {
                existingEnquiry = {
                  name: "Guest",
                  entrySource: `Campaign: ${campaignToCredit.name}`,
                  projectName: campaignToCredit.name,
                };
              }

              const aiResult = await generateResponse(
                message.from,
                messageBody,
                existingEnquiry,
                contactName // Pass WhatsApp Profile Name
              );

              if (aiResult && aiResult.text) {
                let aiReplyMsg;
                const {
                  sendButtonMessage,
                  sendListMessage,
                  sendTextMessage,
                } = require("../integrations/whatsappAPI");

                // 1. Send Message via WhatsApp API (with Fallback)
                if (aiResult.replyType === "buttons" && aiResult.buttons) {
                  console.log("🔘 Sending AI Button Message");
                  try {
                    aiReplyMsg = await sendButtonMessage(
                      message.from,
                      aiResult.text,
                      aiResult.buttons,
                      credentials.accessToken,
                      recipientId
                    );
                    console.log(
                      "✅ Button Message SENT. ID:",
                      aiReplyMsg?.messages?.[0]?.id
                    );
                  } catch (btnErr) {
                    console.error(
                      "⚠️ Button Message Failed. Falling back to Text.",
                      btnErr.message
                    );
                    const fallbackText = `${
                      aiResult.text
                    }\n\n[Options: ${aiResult.buttons
                      .map((b) => b.title)
                      .join(" | ")}]`;
                    aiReplyMsg = await sendTextMessage(
                      message.from,
                      fallbackText,
                      credentials.accessToken,
                      recipientId
                    );
                  }
                } else if (
                  aiResult.replyType === "list" &&
                  aiResult.listItems
                ) {
                  console.log("📜 Sending AI List Message");
                  const sections = [
                    {
                      title: aiResult.listTitle || "Options",
                      rows: aiResult.listItems,
                    },
                  ];
                  try {
                    aiReplyMsg = await sendListMessage(
                      message.from,
                      aiResult.text,
                      aiResult.listButtonText || "Select",
                      sections,
                      credentials.accessToken,
                      recipientId
                    );
                    console.log(
                      "✅ List Message SENT. ID:",
                      aiReplyMsg?.messages?.[0]?.id
                    );
                  } catch (listErr) {
                    console.error(
                      "⚠️ List Message Failed. Falling back to Text.",
                      listErr.message
                    );
                    const fallbackText = `${
                      aiResult.text
                    }\n\n[Options: ${aiResult.listItems
                      .map((i) => i.title)
                      .join(" | ")}]`;
                    aiReplyMsg = await sendTextMessage(
                      message.from,
                      fallbackText,
                      credentials.accessToken,
                      recipientId
                    );
                  }
                } else {
                  // Default Text
                  aiReplyMsg = await sendTextMessage(
                    message.from,
                    aiResult.text,
                    credentials.accessToken,
                    recipientId
                  );
                }

                // 2. Save Reply to DB
                if (
                  aiReplyMsg &&
                  aiReplyMsg.messages &&
                  aiReplyMsg.messages[0]
                ) {
                  const sentMsg = new Reply({
                    messageId: aiReplyMsg.messages[0].id,
                    from: message.from,
                    recipientId,
                    body: aiResult.text, // Save the AI text
                    timestamp: new Date(),
                    direction: "outgoing",
                    read: true,
                  });
                  await sentMsg.save();
                  io.emit("newMessage", {
                    from: message.from,
                    recipientId,
                    message: sentMsg,
                  });
                }

                // 2. Save Reply to DB
                // ... (saving logic unchanged)

                // 3. Handle Data Extraction (Update Enquiry & Contact)
                if (aiResult.extractedData) {
                  const updates = aiResult.extractedData;

                  // A) Upsert Enquiry
                  if (!existingEnquiry || !existingEnquiry._id) {
                    existingEnquiry = await Enquiry.create({
                      phoneNumber: message.from,
                      recipientId,
                      name: updates.name,
                      email: updates.email,
                      budget: updates.budget,
                      bedrooms: updates.bedrooms,
                      projectName: updates.projectType,
                      location: updates.area || updates.location,
                      intent: updates.intent,
                      status: "pending", // Explicitly set status
                      entrySource: campaignToCredit
                        ? `Campaign: ${campaignToCredit.name}`
                        : "Direct",
                    });
                  } else {
                    // Update fields
                    if (updates.name) existingEnquiry.name = updates.name;
                    if (updates.email) existingEnquiry.email = updates.email;
                    if (updates.budget) existingEnquiry.budget = updates.budget;
                    if (updates.bedrooms)
                      existingEnquiry.bedrooms = updates.bedrooms;
                    if (updates.projectType)
                      existingEnquiry.projectName = updates.projectType;
                    if (updates.area || updates.location)
                      existingEnquiry.location =
                        updates.area || updates.location;
                    if (updates.intent) existingEnquiry.intent = updates.intent;

                    await existingEnquiry.save();
                  }

                  // B) Upsert Contact
                  let contact = await Contact.findOne({
                    phoneNumber: message.from,
                  });
                  if (!contact) {
                    contact = await Contact.create({
                      phoneNumber: message.from,
                      name: updates.name || existingEnquiry.name || "Unknown",
                      email: updates.email || existingEnquiry.email,
                      isSubscribed: true,
                    });
                    console.log("👤 Created new Contact from AI data.");
                  } else {
                    if (updates.name && contact.name === "Unknown")
                      contact.name = updates.name;
                    if (updates.email && !contact.email)
                      contact.email = updates.email;
                    await contact.save();
                    console.log("👤 Updated existing Contact from AI data.");
                  }
                }

                // 4. Handle Handover
                if (aiResult.handover) {
                  console.log(
                    "👤 AI requested HUMAN HANDOVER:",
                    aiResult.handoverReason
                  );
                  if (existingEnquiry && existingEnquiry._id) {
                    existingEnquiry.needsImmediateAttention = true;
                    existingEnquiry.status = "handover"; // Mark as Handed Over/Closed
                    existingEnquiry.endedAt = new Date();
                    await existingEnquiry.save();
                  }
                }

                // STOP HERE - Success
                return res.sendStatus(200);
              }

              // Fallback to old bot if AI fails (returns null)
              console.log(
                "🤖 AI yielded no result (or error), passing to legacy botService... (Fallback)"
              );

              // Fallthrough to handleBotConversation below...
            } catch (err) {
              console.error("❌ AI/Bot Error:", err);
              // Fallthrough to handleBotConversation below...
            }

            // --- LEGACY BOT FALLBACK ---
            const botReplies = await handleBotConversation(
              message,
              messageBody,
              recipientId,
              credentials
            );
            // Emit socket events for bot replies...
            if (Array.isArray(botReplies)) {
              botReplies.forEach((reply) => {
                io.emit("newMessage", {
                  from: message.from,
                  recipientId,
                  message: reply,
                });
              });
            } else if (botReplies) {
              io.emit("newMessage", {
                from: message.from,
                recipientId,
                message: botReplies,
              });
            }
          }
        }

        /* ------------------------------
         * C5) Send auto-reply (Away, Greeting, or Sub status)
         * ------------------------------ */
        if (autoReplyText && credentials?.accessToken) {
          try {
            console.log(`🤖 Sending auto-reply to ${message.from}...`);

            const result = await sendTextMessage(
              message.from,
              autoReplyText,
              credentials.accessToken,
              recipientId
            );

            if (result?.messages?.[0]?.id) {
              const auto = new Reply({
                messageId: result.messages[0].id,
                from: message.from,
                recipientId,
                body: autoReplyText,
                timestamp: new Date(),
                direction: "outgoing",
                read: true,
              });

              const savedAuto = await auto.save();

              io.emit("newMessage", {
                from: message.from,
                recipientId,
                message: savedAuto,
              });
            }
          } catch (err) {
            console.error("❌ Auto-reply send failed:", err);
          }
        }
      }
    }

    /* ---------------------------------------------------------
     * D) MESSAGE STATUS UPDATES
     * --------------------------------------------------------- */
    if (value?.statuses?.[0]) {
      const status = value.statuses[0];

      // 🔥 NEW: Capture error details
      let failureReason = null;

      if (status.errors && status.errors.length > 0) {
        const err = status.errors[0];
        failureReason = `${err.code} - ${err.title} (${
          err.details || "No details"
        })`;
        console.log("❌ WhatsApp Delivery Error:", failureReason);
      }

      const updated = await Analytics.findOneAndUpdate(
        { wamid: status.id },
        {
          status: status.status,
          failureReason: failureReason, // <-- save errors
        },
        { new: true }
      );

      if (updated) {
        io.emit("messageStatusUpdate", {
          wamid: status.id,
          status: status.status,
          failureReason: failureReason,
          from: status.recipient_id,
        });

        console.log(`📬 Status updated: ${status.id} → ${status.status}`);
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ FATAL webhook error:", err);
    return res.sendStatus(200);
  }
};

module.exports = {
  verifyWebhook,
  processWebhook,
};
