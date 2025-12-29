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

const { sendTextMessage, getMediaUrl } = require("../integrations/whatsappAPI");
const axios = require("axios");
const { uploadToDrive } = require("../integrations/googleDrive");
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

          // --- MEDIA DOWNLOAD LOGIC ---
          if (credentials && credentials.accessToken) {
            try {
              const mediaUrl = await getMediaUrl(
                newReplyData.mediaId,
                credentials.accessToken
              );
              if (mediaUrl) {
                const response = await axios({
                  url: mediaUrl,
                  method: "GET",
                  responseType: "stream",
                  headers: {
                    Authorization: `Bearer ${credentials.accessToken}`,
                  },
                });

                // Determine extension
                let ext = "dat";
                const contentType = response.headers["content-type"];

                const mimeMap = {
                  "image/jpeg": "jpg",
                  "image/png": "png",
                  "image/webp": "webp",
                  "audio/mpeg": "mp3",
                  "audio/ogg": "ogg",
                  "audio/amr": "amr",
                  "video/mp4": "mp4",
                  "application/pdf": "pdf",
                  "application/msword": "doc",
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                    "docx",
                  "application/vnd.ms-excel": "xls",
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                    "xlsx",
                  "text/plain": "txt",
                };

                if (contentType) {
                  const cleanType = contentType.split(";")[0].trim();
                  if (mimeMap[cleanType]) {
                    ext = mimeMap[cleanType];
                  } else {
                    // Fallback
                    ext = contentType.split("/")[1].split(";")[0];
                  }
                }

                // Fix common extensions
                if (ext === "plain") ext = "txt";
                if (ext === "quicktime") ext = "mov";

                const filename = `${newReplyData.mediaId}.${ext}`;

                // Upload to Google Drive (Streaming directly)
                console.log(`📤 Uploading ${filename} to Google Drive...`);
                const driveResult = await uploadToDrive(
                  response.data, // Stream
                  filename,
                  cleanType || contentType
                );

                if (driveResult && driveResult.webViewLink) {
                  newReplyData.mediaUrl = driveResult.webViewLink;
                  console.log(
                    `✅ Media saved to Drive: ${newReplyData.mediaUrl}`
                  );
                } else {
                  console.warn(
                    "⚠️ Drive upload succeeded but no link returned."
                  );
                }
              }
            } catch (mediaErr) {
              console.error(
                "❌ Failed to download/upload media:",
                mediaErr.message
              );
            }
          }
          // ---------------------------

          if (message[message.type].caption) {
            messageBody = message[message.type].caption;
            newReplyData.body = messageBody;
          }
          break;
      }

      /* -------------------------------------------
       * A3.5) DEDUPLICATION CHECK
       * ------------------------------------------- */
      // Meta retries messages if we don't reply in time. Check if we already processed this ID.
      const existingReply = await Reply.findOne({ messageId: message.id });
      if (existingReply) {
        console.log(`⚠️ Duplicate Message Ignored (ID: ${message.id})`);
        return res.sendStatus(200);
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
              // Only run if AI is ENABLED for this phone number
              if (!phoneNumberDoc || !phoneNumberDoc.isAiEnabled) {
                // Skip AI
                throw new Error("AI_DISABLED");
              }

              console.log("🤖 Passing message to AI Service...");
              const { generateResponse } = require("../services/aiService");

              // Fetch existing enquiry for context (Logic: Reuse if < 24 hours)
              let existingEnquiry = await Enquiry.findOne({
                phoneNumber: message.from,
                recipientId,
              }).sort({ updatedAt: -1 });

              // Check time window (24 hours)
              if (existingEnquiry) {
                const now = new Date();
                const diffMs = now - new Date(existingEnquiry.updatedAt);
                const diffHours = diffMs / (1000 * 60 * 60);

                if (diffHours < 24) {
                  console.log(
                    `🔄 Reusing existing enquiry (Age: ${diffHours.toFixed(
                      2
                    )}h)`
                  );
                  // Reset status to pending so AI treats it as active
                  if (existingEnquiry.status === "handover") {
                    existingEnquiry.status = "pending";
                    await existingEnquiry.save();
                  }
                } else {
                  console.log(
                    `✨ Enquiry older than 24h. Creating NEW enquiry.`
                  );
                  existingEnquiry = null; // Too old, create fresh
                }
              }

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

              // --- SMART NAME RESOLUTION ---
              // 1. Default to WhatsApp Profile Name
              let effectiveName = contactName;
              // 2. Check DB for a better name (if we have a Contact)
              try {
                const dbContact = await Contact.findOne({
                  phoneNumber: message.from,
                });
                if (
                  dbContact &&
                  dbContact.name &&
                  dbContact.name !== "Unknown" &&
                  dbContact.name !== "Guest"
                ) {
                  effectiveName = dbContact.name;
                  console.log(
                    `👤 Uses identified name from DB: ${effectiveName}`
                  );
                }
              } catch (err) {
                console.error("⚠️ Contact lookup failed:", err);
              }

              const aiResult = await generateResponse(
                message.from,
                messageBody,
                existingEnquiry,
                effectiveName // Pass DB Name (preferred) or Profile Name
              );

              if (aiResult && aiResult.text) {
                // --- SILENCE CHECK (NO_REPLY) ---
                if (aiResult.text === "NO_REPLY") {
                  console.log(
                    "🤫 AI Chose Silence (End of Conversation Loop)."
                  );
                  return res.sendStatus(200);
                }

                let aiReplyMsg;
                const {
                  sendButtonMessage,
                  sendListMessage,
                  sendTextMessage,
                } = require("../integrations/whatsappAPI");

                // 1. Prepare Messages (Handle Splitting)
                const messagesToSend = [];
                const splitText = aiResult.text.split("|||");

                splitText.forEach((part, index) => {
                  if (!part.trim()) return;

                  // If it's the LAST part, apply button/list formatting
                  const isLast = index === splitText.length - 1;

                  if (
                    isLast &&
                    aiResult.replyType === "buttons" &&
                    aiResult.buttons
                  ) {
                    messagesToSend.push({
                      type: "buttons",
                      text: part.trim(),
                      buttons: aiResult.buttons,
                    });
                  } else if (
                    isLast &&
                    aiResult.replyType === "list" &&
                    aiResult.listItems
                  ) {
                    messagesToSend.push({
                      type: "list",
                      text: part.trim(),
                      listData: aiResult,
                    });
                  } else {
                    messagesToSend.push({ type: "text", text: part.trim() });
                  }
                });

                // 2. Send & Save Each Message
                for (const msgData of messagesToSend) {
                  let sentMsg = null;

                  try {
                    if (msgData.type === "buttons") {
                      console.log("🔘 Sending AI Button Message");
                      sentMsg = await sendButtonMessage(
                        message.from,
                        msgData.text,
                        msgData.buttons,
                        credentials.accessToken,
                        recipientId
                      );
                    } else if (msgData.type === "list") {
                      console.log("📜 Sending AI List Message");
                      const ld = msgData.listData;
                      const sections = [
                        {
                          title: ld.listTitle || "Options",
                          rows: ld.listItems,
                        },
                      ];
                      sentMsg = await sendListMessage(
                        message.from,
                        msgData.text,
                        ld.listButtonText || "Select",
                        sections,
                        credentials.accessToken,
                        recipientId
                      );
                    } else {
                      // Text
                      sentMsg = await sendTextMessage(
                        message.from,
                        msgData.text,
                        credentials.accessToken,
                        recipientId
                      );
                    }

                    // Save to DB
                    if (sentMsg && sentMsg.messages && sentMsg.messages[0]) {
                      const dbMsg = new Reply({
                        messageId: sentMsg.messages[0].id,
                        from: message.from,
                        recipientId,
                        body: msgData.text,
                        timestamp: new Date(),
                        direction: "outgoing",
                        read: true,
                      });
                      await dbMsg.save();
                      io.emit("newMessage", {
                        from: message.from,
                        recipientId,
                        message: dbMsg,
                      });
                      // Brief delay between messages
                      if (messagesToSend.length > 1)
                        await new Promise((r) => setTimeout(r, 800));
                    }
                  } catch (err) {
                    console.error(
                      `❌ Failed to send AI portion: ${err.message}`
                    );
                  }
                }

                // 2. Save Reply to DB
                // ... (saving logic unchanged)

                // 3. Handle Data Extraction (Update Enquiry & Contact)
                if (aiResult.extractedData) {
                  const data = aiResult.extractedData;
                  // Case-insensitive getter helper
                  const getVal = (key) => {
                    const k = Object.keys(data).find(
                      (k) => k.toLowerCase() === key.toLowerCase()
                    );
                    return k ? data[k] : null;
                  };

                  const eName = getVal("name");
                  const eBudget = getVal("budget");
                  const eBedrooms = getVal("bedrooms");
                  const eProject =
                    getVal("project") ||
                    getVal("projectType") ||
                    getVal("projectName");
                  const eArea = getVal("area") || getVal("location");
                  const eIntent = getVal("intent");
                  const ePropType = getVal("propertyType");

                  // A) Upsert Enquiry
                  if (!existingEnquiry || !existingEnquiry._id) {
                    existingEnquiry = await Enquiry.create({
                      phoneNumber: message.from,
                      recipientId,
                      name: eName,
                      budget: eBudget,
                      bedrooms: eBedrooms,
                      projectName: eProject,
                      location: eArea,
                      intent: eIntent,
                      status: "pending",
                      entrySource:
                        data.entrySource ||
                        (campaignToCredit
                          ? `Campaign: ${campaignToCredit.name}`
                          : "Direct"),
                      propertyType: ePropType,
                    });
                  } else {
                    // Update fields
                    if (eName) existingEnquiry.name = eName;
                    if (eBudget) existingEnquiry.budget = eBudget;
                    if (eBedrooms) existingEnquiry.bedrooms = eBedrooms;
                    if (eProject) existingEnquiry.projectName = eProject;
                    if (eArea) existingEnquiry.location = eArea;
                    if (eIntent) existingEnquiry.intent = eIntent;
                    // entrySource is usually not updated unless explicitly different
                    if (ePropType) existingEnquiry.propertyType = ePropType;

                    await existingEnquiry.save();
                  }

                  // B) Upsert Contact
                  let contact = await Contact.findOne({
                    phoneNumber: message.from,
                  });
                  if (!contact) {
                    // Find or create 'Enquiries' list
                    let enquiresList = await ContactList.findOne({
                      name: "Enquiries",
                    });
                    if (!enquiresList) {
                      enquiresList = await ContactList.create({
                        name: "Enquiries",
                      });
                    }

                    contact = await Contact.create({
                      phoneNumber: message.from,
                      name: eName || existingEnquiry.name || "Unknown",
                      isSubscribed: true,
                      contactList: enquiresList._id,
                    });
                    console.log(
                      "👤 Created new Contact from AI data in 'Enquiries' list."
                    );
                  } else {
                    if (eName && contact.name === "Unknown")
                      contact.name = eName;
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
                    existingEnquiry.createdAt = new Date(); // Bump to top of list for Dashboard visibility
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
              if (err.message !== "AI_DISABLED") {
                console.error("❌ AI/Bot Error:", err);
              }
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
