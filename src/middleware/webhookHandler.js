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

          /* ------------------------------
           * C1) STOP / UNSUBSCRIBE (Global override)
           * ------------------------------ */
          if (
            messageBodyLower.includes("stop") ||
            messageBodyLower.includes("إيقاف")
          ) {
            autoReplyText =
              "You’ve been unsubscribed. won’t receive further messages, but you can reach out anytime if you need assistance.";

            // 1. Mark ALL existing instances of this contact as unsubscribed
            await Contact.updateMany(
              { phoneNumber: message.from },
              { isSubscribed: false }
            );

            // 2. Add to "Unsubscriber List" (Create copy)
            try {
              let unsubList = await ContactList.findOne({
                name: "Unsubscriber List",
              });
              if (!unsubList) {
                unsubList = await ContactList.create({
                  name: "Unsubscriber List",
                });
                console.log("📝 Created 'Unsubscriber List'");
              }

              const existsInUnsub = await Contact.findOne({
                phoneNumber: message.from,
                contactList: unsubList._id,
              });

              if (!existsInUnsub) {
                const existingContact = await Contact.findOne({
                  phoneNumber: message.from,
                });

                await Contact.create({
                  phoneNumber: message.from,
                  name: existingContact?.name || "Unknown",
                  contactList: unsubList._id,
                  isSubscribed: false,
                });
                console.log(`📝 Added ${message.from} to Unsubscriber List`);
              }
            } catch (err) {
              console.error("❌ Error adding to Unsubscriber List:", err);
            }
          } else {
            /* ------------------------------
             * C2) RESUBSCRIBE
             * ------------------------------ */
            // Check if they are currently unsubscribed in any primary list
            const contact = await Contact.findOne({
              phoneNumber: message.from,
              isSubscribed: false,
            });

            if (contact) {
              // Resubscribe logic...
              try {
                const unsubList = await ContactList.findOne({
                  name: "Unsubscriber List",
                });
                if (unsubList) {
                  await Contact.deleteMany({
                    phoneNumber: message.from,
                    contactList: unsubList._id,
                  });
                }
              } catch (err) {
                console.error("❌ Error removing from Unsubscriber List:", err);
              }

              await Contact.updateMany(
                { phoneNumber: message.from },
                { isSubscribed: true }
              );

              autoReplyText = "Welcome back! How can we assist you today?";
              console.log(`✅ Contact ${message.from} has been re-subscribed.`);
            } else {
              /* ------------------------------
               * C3) BOT FLOW & GREETING
               * ------------------------------ */

              // GREETING LOGIC:
              // Valid only if NOT Campaign AND Config Enabled
              if (!isCampaignReply && config && config.greetingEnabled) {
                // Check if first message ever?
                const totalIncoming = await Reply.countDocuments({
                  from: message.from,
                  direction: "incoming",
                });
                if (totalIncoming <= 1) {
                  // 1 because we just saved the current one
                  autoReplyText = config.greetingText;
                  console.log("👋 Sending First-Time Greeting.");
                }
              }

              // If no greeting/away set, TRY BOT or AI
              if (
                !autoReplyText &&
                !isCampaignReply &&
                (message.type === "text" || message.type === "interactive")
              ) {
                if (credentials?.accessToken) {
                  try {
                    // --- AI AGENT CHECK ---
                    // By default, we try AI if the user isn't in a specific strict flow or if we want to replace the bot.
                    // For now, let's prioritize AI if 'AI_ENABLED' is not explicitly false, or just use it.
                    // We'll check if there's an active Bot Flow first. If there IS a bot flow, we might want to respect it,
                    // BUT the user wants to "create a system that works in ai".
                    // Let's TRY AI first. If AI returns 'handover' or valid text, we use it.

                    console.log("🤖 Passing message to AI Service...");
                    const {
                      generateResponse,
                    } = require("../services/aiService");

                    // Fetch existing enquiry for context
                    const existingEnquiry = await Enquiry.findOne({
                      phoneNumber: message.from,
                      recipientId,
                    });

                    const aiResult = await generateResponse(
                      message.from,
                      messageBody,
                      existingEnquiry
                    );

                    if (aiResult && aiResult.text) {
                      // AI produced a response
                      console.log("✨ AI Response generated:", aiResult.text);

                      // 1. Send AI Text
                      const aiReplyMsg = await sendTextMessage(
                        message.from,
                        aiResult.text,
                        credentials.accessToken,
                        recipientId
                      );

                      // 2. Save Reply to DB
                      if (aiReplyMsg?.messages?.[0]?.id) {
                        const aiDbReply = new Reply({
                          messageId: aiReplyMsg.messages[0].id,
                          from: message.from,
                          recipientId,
                          body: aiResult.text,
                          timestamp: new Date(),
                          direction: "outgoing",
                          read: true,
                          isAiGenerated: true,
                        });
                        await aiDbReply.save();

                        io.emit("newMessage", {
                          from: message.from,
                          recipientId,
                          message: aiDbReply,
                        });
                      }

                      // 3. Handle Data Extraction (Update Enquiry)
                      if (aiResult.extractedData) {
                        const updates = aiResult.extractedData;
                        if (!existingEnquiry) {
                          await Enquiry.create({
                            phoneNumber: message.from,
                            recipientId,
                            name: updates.name,
                            email: updates.email,
                            budget: updates.budget,
                            projectName: updates.projectType, // Mapping
                          });
                        } else {
                          if (updates.name) existingEnquiry.name = updates.name;
                          if (updates.email)
                            existingEnquiry.email = updates.email;
                          if (updates.budget)
                            existingEnquiry.budget = updates.budget;
                          await existingEnquiry.save();
                        }
                      }

                      // 4. Handle Handover
                      if (aiResult.handover) {
                        console.log(
                          "👤 AI requested HUMAN HANDOVER:",
                          aiResult.handoverReason
                        );
                        // We could trigger a notification here or mark the chat as "Needs Attention"
                        if (existingEnquiry) {
                          existingEnquiry.needsImmediateAttention = true;
                          await existingEnquiry.save();
                        }
                        // Optionally send a "Connecting you to an agent..." message if the AI didn't say it.
                      }

                      // STOP HERE - Do not fall through to old bot
                      return res.sendStatus(200);
                    }

                    // Fallback to old bot if AI fails or returns nothing?
                    console.log(
                      "🤖 AI yielded no result, passing to legacy botService..."
                    );
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
                  } catch (err) {
                    console.error("❌ Bot Error:", err);
                  }
                }
              }
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
