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
const { uploadToCloudinary } = require("../integrations/cloudinary");
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
 * GLOBALS FOR DEBOUNCING / BUFFERING
 * --------------------------------------------------------- */
const userMessageBuffer = {}; // { phoneNumber: { timer: timeoutId, messages: [objs] } }
const BUFFER_DELAY_MS = 2000; // 2 seconds delay

/* ---------------------------------------------------------
 * HELPER: PROCESS BUFFERED MESSAGES
 * --------------------------------------------------------- */
const processBufferedMessages = async (
  recipientId,
  userPhone,
  credentials,
  phoneNumberDoc,
) => {
  if (!userMessageBuffer[userPhone]) return;

  const { messages } = userMessageBuffer[userPhone];
  // Clear buffer immediately to prevent double processing
  delete userMessageBuffer[userPhone];

  console.log(
    `🔥 Processing ${messages.length} buffered messages for ${userPhone}...`,
  );

  // 1. Aggregation Strategy
  const textMessages = messages.filter(
    (m) => m.body && typeof m.body === "string",
  );

  // Join with period if multiple
  const combinedBody = textMessages.map((m) => m.body).join(". ");
  const lastMessage = messages[messages.length - 1]; // Use latest for timestamp/meta
  const campaignToCredit = messages.find((m) => m.campaign)?.campaign; // Use ANY campaign found in batch

  // Check if any message in the batch was a DIRECT reply (Context or Button)
  const isDirectReply = messages.some((m) => m.isDirectReply);

  if (!combinedBody) {
    console.log(
      "⚠️ No text content in buffered messages. Skipping logic processing.",
    );
    return;
  }

  console.log(`📝 Combined Context: "${combinedBody}"`);
  if (campaignToCredit)
    console.log(
      `📌 Associated Campaign: ${campaignToCredit.name} (Direct: ${isDirectReply})`,
    );

  // ---------------------------------------------------------
  // RE-INSERTED LOGIC: B & C
  // ---------------------------------------------------------
  const io = getIO();
  const messageBody = combinedBody;
  const messageBodyLower = messageBody.toLowerCase();
  let isHandledByWebhook = false; // Flag to prevent AI from running if webhook handled it

  /* ---------------------------------------------------------
   * B) LEAD ROUTING (CAMPAIGN REPLY → GOOGLE SHEET)
   * --------------------------------------------------------- */
  // Only log if it is a DIRECT reply (Context/Button) to the campaign
  if (campaignToCredit && messageBody && isDirectReply) {
    console.log("📨 Processing as CAMPAIGN reply...");

    // FILTER: Ignore STOP/UNSUBSCRIBE messages from being treated as "Leads"
    const stopKeywords = ["stop", "unsubscribe", "cancel", "opt out", "remove"];
    // Also ignore standard unsubscribe reasons (case-insensitive)
    const unsubscribeReasons = [
      "too many messages",
      "not relevant",
      "already purchased",
      "prefer another channel",
      "other",
    ];

    const isStopMessage =
      stopKeywords.some((k) => messageBodyLower.includes(k)) ||
      unsubscribeReasons.some((r) => messageBodyLower === r);

    if (isStopMessage) {
      console.log(
        "🛑 Campaign reply is 'Stop/Unsubscribe' - Skipping Lead Sheet & Notification.",
      );
    } else {
      // PROCEED WITH LEAD PROCESSING

      // Count existing replies to see if this is the first interaction for this campaign
      const incomingMessageCount = await Reply.countDocuments({
        from: userPhone,
        direction: "incoming",
        campaign: campaignToCredit._id,
      });

      // If the count matches the batch size (meaning we just saved them), it's new.
      // We add a small buffer (+2) just in case.
      if (incomingMessageCount <= messages.length + 2) {
        console.log(`✨ NEW LEAD for campaign "${campaignToCredit.name}"`);

        const contact = await Contact.findOne({ phoneNumber: userPhone });

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

        const formattedDate = new Date().toLocaleString(
          "en-US",
          timestampOptions,
        );

        const dataRow = [
          [
            `'${formattedDate}`,
            userPhone,
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
              `📁 Writing lead → Campaign Sheet: ${campaignToCredit.spreadsheetId}`,
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

        /* ---------------------------------------------------------
         * NOTIFY ADMIN (LIVE LEAD)
         * --------------------------------------------------------- */
        try {
          const ADMIN_NUMBER = "971506796073"; // User specified number
          const templateName =
            campaignToCredit.templateName ||
            campaignToCredit.name ||
            "Unknown Campaign";

          const notificationBody = `NEW LEAD RECEIVED

${contact ? contact.name : "Unknown"}
${userPhone}
${templateName}
WhatsApp`;

          console.log(
            `🔔 Sending Live Lead Notification to Admin (${ADMIN_NUMBER})...`,
          );
          const { sendTextMessage } = require("../integrations/whatsappAPI");

          // We use the same credentials to send the notification FROM the bot TO the admin
          await sendTextMessage(
            ADMIN_NUMBER,
            notificationBody,
            credentials.accessToken,
            recipientId, // Sending from this phone ID
          );
        } catch (notifyErr) {
          console.error("❌ Failed to notify admin:", notifyErr.message);
        }
      }

      // Update campaign reply count
      await Campaign.findByIdAndUpdate(campaignToCredit._id, {
        $inc: { replyCount: 1 },
      });
    } // Close else (Proceed with Lead Processing)
  }

  /* ---------------------------------------------------------
   * C) AUTO-REPLY + BOT (DYNAMIC CONFIG)
   * --------------------------------------------------------- */
  if (messageBody) {
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

      const todayConfig = config.officeHours.find((d) => d.day === currentDay);

      if (todayConfig) {
        if (!todayConfig.isOpen) {
          isAway = true; // Closed all day
        } else {
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
      if (!isCampaignReply) {
        autoReplyText = config.awayMessageText;
        console.log("🌙 Office Closed. Queuing Away Message.");
      }
    } else {
      // --- WE ARE OPEN (OR NO CONFIG) ---
      if (!credentials || !credentials.accessToken) {
        console.error(
          `❌ Could not find credentials for recipientId ${recipientId}. Aborting auto-reply.`,
        );
      } else {
        // 2. Handle "stop" and "re-subscribe" logic
        const unsubscribeReasons = [
          "Too many messages",
          "Not relevant",
          "Already purchased",
          "Prefer another channel",
          "Other",
        ];

        // 2.1 CHECK IF USER IS PROVIDING CUSTOM "OTHER" REASON
        const contactCheck = await Contact.findOne({ phoneNumber: userPhone });
        if (
          contactCheck &&
          contactCheck.unsubscribeReason === "Other" &&
          contactCheck.isSubscribed &&
          !messageBodyLower.includes("stop")
        ) {
          // Helper function to handle Adding to Unsubscriber List
          const addToUnsubscriberList = async () => {
            const ContactList = require("../models/ContactList");
            let unsubList = await ContactList.findOne({
              name: "Unsubscriber List",
            });
            if (!unsubList) {
              unsubList = await ContactList.create({
                name: "Unsubscriber List",
              });
            }
            return unsubList._id;
          };

          const unsubListId = await addToUnsubscriberList();

          // Treat this message as the custom reason
          await Contact.findOneAndUpdate(
            { phoneNumber: userPhone },
            {
              unsubscribeReason: messageBody, // Save the text as reason
              isSubscribed: false,
              unsubscribeDate: new Date(),
              contactList: unsubListId, // Add to Unsubscriber List
              previousContactList: contactCheck.contactList, // Backup current list
            },
          );
          autoReplyText =
            "You’ve been unsubscribed. Thank you for your feedback.";
          isHandledByWebhook = true;
          console.log(
            `✅ Contact ${userPhone} unsubscribed with custom reason: ${messageBody}`,
          );
        } else if (
          messageBodyLower.includes("stop") ||
          messageBodyLower.includes("إيقاف")
        ) {
          // A) STOP RECEIVED: Request Feedback (Do NOT unsubscribe yet)
          const {
            sendTextMessage,
            sendListMessage,
          } = require("../integrations/whatsappAPI");

          await sendTextMessage(
            userPhone,
            "We've received your request to unsubscribe. Before you go, could you tell us why?",
            credentials.accessToken,
            recipientId,
          );

          const sections = [
            {
              title: "Select a reason",
              rows: unsubscribeReasons.map((r) => ({
                id: `reason_${r.replace(/\s/g, "_").toLowerCase()}`,
                title: r,
              })),
            },
          ];

          await sendListMessage(
            userPhone,
            "Please select a reason:",
            "Reason",
            sections,
            credentials.accessToken,
            recipientId,
          );

          autoReplyText = null;
          isHandledByWebhook = true; // Prevent AI
          console.log(`🛑 Contact ${userPhone} requested STOP. Survey sent.`);
        } else if (
          unsubscribeReasons.some((r) => r.toLowerCase() === messageBodyLower)
        ) {
          // Helper function to handle Adding to Unsubscriber List
          const addToUnsubscriberList = async (phone) => {
            const ContactList = require("../models/ContactList");
            let unsubList = await ContactList.findOne({
              name: "Unsubscriber List",
            });
            if (!unsubList) {
              unsubList = await ContactList.create({
                name: "Unsubscriber List",
              });
            }
            return unsubList._id;
          };

          // B) REASON SELECTED
          const unsubListId = await addToUnsubscriberList(userPhone);

          if (messageBody === "Other") {
            // Handle "Other" -> Ask for details
            await Contact.findOneAndUpdate(
              { phoneNumber: userPhone },
              {
                unsubscribeReason: "Other",
                // We do NOT unsubscribe yet, we wait for the text explanation
                // But user asked for "after complete flow", so effectively we wait.
                // Actually, for "Other", we haven't completed flow.
              },
            );
            autoReplyText = "Please type your reason below so we can improve.";
          } else {
            // Standard Reason -> Unsubscribe Immediately & Add to List
            // We need to fetch current contact to backup list
            const currentContact = await Contact.findOne({
              phoneNumber: userPhone,
            });
            await Contact.findOneAndUpdate(
              { phoneNumber: userPhone },
              {
                unsubscribeReason: messageBody,
                isSubscribed: false,
                unsubscribeDate: new Date(),
                contactList: unsubListId, // Add to the specific Unsubscriber List
                previousContactList: currentContact
                  ? currentContact.contactList
                  : null, // Backup
              },
            );
            autoReplyText =
              "You’ve been unsubscribed. Thank you for your feedback.";
            console.log(
              `✅ Contact ${userPhone} unsubscribed & added to 'Unsubscriber List' with reason: ${messageBody}`,
            );
          }
        } else {
          // Re-subscribe logic if they say something else but were unsubscribed
          let contact = contactCheck; // Re-use fetched contact from line 315 if available
          if (!contact) {
            contact = await Contact.findOne({ phoneNumber: userPhone });
          }

          if (contact && !contact.isSubscribed) {
            contact.isSubscribed = true;

            // Restore segment if available
            if (contact.previousContactList) {
              contact.contactList = contact.previousContactList;
              contact.previousContactList = null; // Clear backup
              console.log(
                `🔄 Contact ${userPhone} restored to previous segment.`,
              );
            } else {
              // Remove from Unsubscriber List if no backup?
              // Or keep logic simple: just ensure they are NOT in Unsub list if they have another home.
              // For now, if no backup, we might just leave them or set to null?
              // The user asked "go back to his segment", implies restoration.
            }
            // Clear unsubscribe info
            contact.unsubscribeReason = null;
            contact.unsubscribeDate = null;

            await contact.save();
            autoReplyText =
              "Hello and welcome back to Capital Avenue! How can we help you";
            console.log(`✅ Contact ${userPhone} has been re-subscribed.`);
          }

          // 3. Handle normal keyword logic
          if (!autoReplyText && isCampaignReply) {
            if (messageBodyLower.includes("yes, i am interested")) {
              autoReplyText =
                "Your interest has been noted. One of our Sales Consultant will contact you shortly to assist you, Thank you for your response.";

              // --- FIX: Close Enquiry Immediately ---
              const finalName =
                contactCheck?.name || lastMessage.contactName || "NA";
              await Enquiry.create({
                phoneNumber: userPhone,
                recipientId,
                name: finalName,
                status: "handover", // Stop Bot
                conversationState: "END", // Stop Stuck Scheduler
                handoverReason: "Campaign Interested",
                entrySource: `Campaign: ${campaignToCredit ? campaignToCredit.name : "Unknown"}`,
                createdAt: new Date(),
                updatedAt: new Date(),
                endedAt: new Date(), // Mark as ended
                completionFollowUpSent: true, // <--- FIX: DO NOT ASK FOR REVIEW
              });
              console.log(
                `✅ Campaign Interest Logged & Handover Triggered for ${userPhone}`,
              );
            } else if (messageBodyLower.includes("نعم، مهتم")) {
              autoReplyText =
                "لقد تم تسجيل اهتمامكم. سيتصل بكم أحد مستشاري المبيعات لدينا قريباً لمساعدتكم، شكراً لردكم.";

              // --- FIX: Close Enquiry Immediately (Arabic) ---
              const finalName =
                contactCheck?.name || lastMessage.contactName || "NA";
              await Enquiry.create({
                phoneNumber: userPhone,
                recipientId,
                name: finalName,
                status: "handover",
                conversationState: "END",
                handoverReason: "Campaign Interested (Arabic)",
                entrySource: `Campaign: ${campaignToCredit ? campaignToCredit.name : "Unknown"}`,
                createdAt: new Date(),
                updatedAt: new Date(),
                endedAt: new Date(),
                language: "ar",
                completionFollowUpSent: true, // <--- FIX: DO NOT ASK FOR REVIEW
              });
              console.log(
                `✅ Campaign Interest Logged (AR) & Handover Triggered for ${userPhone}`,
              );
            } else if (messageBodyLower.includes("not interested")) {
              autoReplyText =
                "We respect your choice. If at any point you'd like to revisit, our team will be ready to help you.";

              // --- FIX: Close Enquiry Immediately (Not Interested) ---
              // valid to just close it so bot doesn't wake up
              await Enquiry.create({
                phoneNumber: userPhone,
                recipientId,
                status: "closed",
                conversationState: "END",
                handoverReason: "Campaign Not Interested",
                createdAt: new Date(),
                updatedAt: new Date(),
                endedAt: new Date(),
                completionFollowUpSent: true, // <--- FIX: DO NOT ASK FOR REVIEW
              });
            }
          }
        }
      }
    }

    if (!autoReplyText && !isCampaignReply && !isHandledByWebhook) {
      if (credentials?.accessToken) {
        try {
          // --- 0. INTERCEPT STUCK BUTTONS (System Actions) ---
          const messageType = lastMessage?.type;
          if (messageType === "interactive" && !isHandledByWebhook) {
            const btnId =
              lastMessage?.interactive?.button_reply?.id ||
              lastMessage?.interactive?.list_reply?.id;

            if (btnId && btnId.startsWith("stuck_")) {
              console.log(`🛑 Intercepting System Button: ${btnId}`);
              const {
                handleBotConversation,
              } = require("../services/botService");
              await handleBotConversation(
                lastMessage,
                messageBody,
                recipientId,
                credentials,
              );
              return; // EXIT - Do not pass to AI
            }
          }

          // --- AI AGENT CHECK ---
          if (!phoneNumberDoc || !phoneNumberDoc.isAiEnabled) {
            throw new Error("AI_DISABLED");
          }

          console.log("🤖 Passing message to AI Service (Debounced)...");
          const { generateResponse } = require("../services/aiService");

          // --- ENQUIRY CONTEXT MANAGEMENT ---
          let existingEnquiry = null;
          const hasPropertyLink = messageBodyLower.includes("/properties/");
          let detectedUrl = null;

          if (hasPropertyLink) {
            console.log(
              "🔗 New Property Link detected. Forcing FRESH Context (Skipping reuse).",
            );
            existingEnquiry = null;

            const urlMatch = messageBody.match(/(https?:\/\/[^\s]+)/);
            if (urlMatch) {
              detectedUrl = urlMatch[0];
            }
          } else {
            existingEnquiry = await Enquiry.findOne({
              phoneNumber: userPhone,
              recipientId,
            }).sort({ updatedAt: -1 });

            if (existingEnquiry) {
              const now = new Date();
              const diffMs = now - new Date(existingEnquiry.updatedAt);
              const diffHours = diffMs / (1000 * 60 * 60);

              if (diffHours < 12) {
                // Reset status to pending so AI treats it as active
                if (existingEnquiry.status === "handover") {
                  existingEnquiry.status = "pending";
                  await existingEnquiry.save();
                }
              } else {
                existingEnquiry = null;
              }
            }
          }

          if (existingEnquiry && campaignToCredit) {
            existingEnquiry.entrySource = `Campaign: ${campaignToCredit.name}`;
            existingEnquiry.projectName = campaignToCredit.name;
            await existingEnquiry.save();
          }

          if (!existingEnquiry && campaignToCredit) {
            existingEnquiry = {
              name: "Guest",
              entrySource: `Campaign: ${campaignToCredit.name}`,
              projectName: campaignToCredit.name,
            };
          }

          // --- SMART NAME RESOLUTION ---
          // Step 1: Default to last message contact name
          let effectiveName = lastMessage.contactName || "NA";

          try {
            const dbContact = await Contact.findOne({
              phoneNumber: userPhone,
            });
            if (
              dbContact &&
              dbContact.name &&
              dbContact.name !== "Unknown" &&
              dbContact.name !== "Guest"
            ) {
              effectiveName = dbContact.name;

              if (
                existingEnquiry &&
                (existingEnquiry.name === "Guest" ||
                  existingEnquiry.name === "Unknown")
              ) {
                existingEnquiry.name = effectiveName;
                if (typeof existingEnquiry.save === "function") {
                  await existingEnquiry.save();
                }
              }
            }
          } catch (err) {
            console.error("⚠️ Contact lookup failed:", err);
          }

          const aiResult = await generateResponse(
            userPhone,
            messageBody,
            existingEnquiry,
            effectiveName,
          );

          if (aiResult && aiResult.text) {
            if (aiResult.text === "NO_REPLY") {
              console.log("🤫 AI Chose Silence (End of Conversation Loop).");
              return;
            }

            // 1. Prepare Messages (Handle Splitting)
            const messagesToSend = [];
            const splitText = aiResult.text.split("|||");

            splitText.forEach((part, index) => {
              if (!part.trim()) return;
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
            const {
              sendButtonMessage,
              sendListMessage,
              sendTextMessage,
            } = require("../integrations/whatsappAPI");

            for (const msgData of messagesToSend) {
              let sentMsg = null;
              try {
                if (msgData.type === "buttons") {
                  sentMsg = await sendButtonMessage(
                    userPhone,
                    msgData.text,
                    msgData.buttons,
                    credentials.accessToken,
                    recipientId,
                  );
                } else if (msgData.type === "list") {
                  const ld = msgData.listData;
                  const sections = [
                    {
                      title: ld.listTitle || "Options",
                      rows: ld.listItems,
                    },
                  ];
                  sentMsg = await sendListMessage(
                    userPhone,
                    msgData.text,
                    ld.listButtonText || "Select",
                    sections,
                    credentials.accessToken,
                    recipientId,
                  );
                } else {
                  sentMsg = await sendTextMessage(
                    userPhone,
                    msgData.text,
                    credentials.accessToken,
                    recipientId,
                  );
                }

                if (sentMsg && sentMsg.messages && sentMsg.messages[0]) {
                  const dbMsg = new Reply({
                    messageId: sentMsg.messages[0].id,
                    from: recipientId, // Business
                    recipientId: userPhone, // Customer
                    body: msgData.text,
                    timestamp: new Date(),
                    direction: "outgoing",
                    read: true,
                  });
                  await dbMsg.save();
                  io.emit("newMessage", {
                    from: userPhone,
                    recipientId,
                    message: dbMsg,
                  });
                  if (messagesToSend.length > 1)
                    await new Promise((r) => setTimeout(r, 800));
                }
              } catch (err) {
                console.error(`❌ Failed to send AI portion: ${err.message}`);
              }
            }

            // 3. Handle Data Extraction (Update Enquiry & Contact)
            if (aiResult.extractedData) {
              const data = aiResult.extractedData;
              const getVal = (key) => {
                const k = Object.keys(data).find(
                  (k) => k.toLowerCase() === key.toLowerCase(),
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
                  phoneNumber: userPhone,
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
                  pageUrl: detectedUrl,
                });
              } else {
                if (eName) existingEnquiry.name = eName;
                if (eBudget) existingEnquiry.budget = eBudget;
                if (eBedrooms) existingEnquiry.bedrooms = eBedrooms;
                if (eProject) existingEnquiry.projectName = eProject;
                if (eArea) existingEnquiry.location = eArea;
                if (eIntent) existingEnquiry.intent = eIntent;
                if (ePropType) existingEnquiry.propertyType = ePropType;
                if (detectedUrl) existingEnquiry.pageUrl = detectedUrl;
                if (aiResult.detectedLanguage)
                  existingEnquiry.language = aiResult.detectedLanguage;
                await existingEnquiry.save();
              }

              // B) Upsert Contact
              let contact = await Contact.findOne({
                phoneNumber: userPhone,
              });
              if (!contact) {
                let enquiresList = await ContactList.findOne({
                  name: "Enquiries",
                });
                if (!enquiresList) {
                  enquiresList = await ContactList.create({
                    name: "Enquiries",
                  });
                }
                contact = await Contact.create({
                  phoneNumber: userPhone,
                  name: eName || existingEnquiry.name || "Unknown",
                  isSubscribed: true,
                  contactList: enquiresList._id,
                });
              } else {
                // Correct: Allow update if Unknown OR Guest
                if (
                  eName &&
                  (contact.name === "Unknown" || contact.name === "Guest")
                ) {
                  console.log(
                    `👤 Updating Contact Name: ${contact.name} -> ${eName}`,
                  );
                  contact.name = eName;
                  await contact.save();
                }
              }
            }

            // 4. Handle Handover
            if (aiResult.handover) {
              if (existingEnquiry && existingEnquiry._id) {
                existingEnquiry.needsImmediateAttention = true;
                existingEnquiry.status = "handover";
                existingEnquiry.conversationState = "END"; // FIX: Stop stuck scheduler
                existingEnquiry.endedAt = new Date();
                existingEnquiry.createdAt = new Date();
                await existingEnquiry.save();

                // NOTIFY ADMIN (AI ENQUIRY HANDOVER)
                // Skip notification if this is just a Review Completion
                if (
                  !existingEnquiry.reviewStatus ||
                  existingEnquiry.reviewStatus === "PENDING"
                ) {
                  try {
                    console.log(
                      "🔔 AI Handover Triggered - Sending Notification...",
                    );
                    const ADMIN_NUMBER = "971506796073";
                    const noteBody = `NEW AI ENQUIRY

${existingEnquiry.name || "Unknown"}
${userPhone}
${existingEnquiry.projectName || "General"}
${existingEnquiry.bedrooms || "N/A"}
${existingEnquiry.pageUrl || "N/A"}`;

                    const {
                      sendTextMessage,
                    } = require("../integrations/whatsappAPI");
                    await sendTextMessage(
                      ADMIN_NUMBER,
                      noteBody,
                      credentials.accessToken,
                      recipientId,
                    );
                    console.log(
                      `🔔 Sent AI Enquiry Notification to ${ADMIN_NUMBER}`,
                    );
                  } catch (noteErr) {
                    console.error(
                      "❌ Failed to notify admin for AI Handover:",
                      noteErr,
                    );
                  }
                }
              }
            }
            return;
          }

          console.log(
            "🤖 AI yielded no result, passing to legacy botService...",
          );
        } catch (err) {
          if (err.message !== "AI_DISABLED") {
            console.error("❌ AI/Bot Error:", err);
          }
        }
      }

      // --- LEGACY BOT FALLBACK ---
      const { handleBotConversation } = require("../services/botService");
      // Use lastMessage logic for fallback
      const botReplies = await handleBotConversation(
        lastMessage, // Passing the full message object
        messageBody, // The combined body
        recipientId,
        credentials,
      );
      if (Array.isArray(botReplies)) {
        botReplies.forEach((reply) => {
          io.emit("newMessage", {
            from: userPhone,
            recipientId,
            message: reply,
          });
        });
      } else if (botReplies) {
        io.emit("newMessage", {
          from: userPhone,
          recipientId,
          message: botReplies,
        });
      }
    }

    // Auto-Reply sending
    if (autoReplyText && credentials?.accessToken) {
      try {
        const { sendTextMessage } = require("../integrations/whatsappAPI");
        const result = await sendTextMessage(
          userPhone,
          autoReplyText,
          credentials.accessToken,
          recipientId,
        );
        if (result?.messages?.[0]?.id) {
          const auto = new Reply({
            messageId: result.messages[0].id,
            from: userPhone,
            recipientId,
            body: autoReplyText,
            timestamp: new Date(),
            direction: "outgoing",
            read: true,
          });
          await auto.save();
          io.emit("newMessage", {
            from: userPhone,
            recipientId,
            message: auto,
          });
        }
      } catch (err) {
        console.error("❌ Auto-reply send failed:", err);
      }
    }
  }
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
  const contactName = value?.contacts?.[0]?.profile?.name || "NA";

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
            `⚠️ No WABA Account for phone_number_id=${recipientId}. (Bot + AutoReply disabled but sheet logging OK)`,
          );
        }
      } catch (err) {
        console.error("❌ Error loading PhoneNumber:", err);
      }

      /* -------------------------------------------
      /* -------------------------------------------
       * A2) CAMPAIGN DETECTION (PRIMARY)
       * context.id → Analytics.wamid → campaign
       * ------------------------------------------- */
      let isDirectReply = false;

      if (message.context?.id) {
        const match = await Analytics.findOne({
          wamid: message.context.id,
        }).populate("campaign");

        if (match?.campaign) {
          campaignToCredit = match.campaign;
          isDirectReply = true;
          console.log(
            `📌 Campaign detected via context → ${campaignToCredit.name}`,
          );
        }
      }

      /* -------------------------------------------
       * A2.4) KEYWORD DETECTED CAMPAIGN ATTRIBUTION (FORCE LOOKBACK 7 DAYS)
       * ------------------------------------------- */
      // If user replies with specific keywords, we assume it's for the last campaign they got,
      // even if it was days ago.
      const lowerBody = (messageBody || "").toLowerCase();
      // You can expand this list as needed
      const keywords = [
        "yes, i am interested",
        "not interested",
        "stop",
        "subscribe",
        "نعم، مهتم",
      ];

      if (!campaignToCredit && keywords.some((k) => lowerBody.includes(k))) {
        console.log(
          "🗝️ Keyword detected. Forcing extended campaign lookup (7 days)...",
        );
        try {
          const contactForKeyword = await Contact.findOne({
            phoneNumber: message.from,
          });
          if (contactForKeyword) {
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const recentAnalytics = await Analytics.findOne({
              contact: contactForKeyword._id,
              status: { $in: ["sent", "delivered", "read"] },
              createdAt: { $gte: sevenDaysAgo },
            })
              .sort({ createdAt: -1 })
              .populate("campaign");

            if (recentAnalytics?.campaign) {
              campaignToCredit = recentAnalytics.campaign;
              console.log(
                `📌 Campaign detected via KEYWORD ('${messageBody}') → ${campaignToCredit.name}`,
              );
            }
          }
        } catch (err) {
          console.error("⚠️ Keyword campaign lookup failed:", err);
        }
      }

      // --- A2.5) IMPLICIT CAMPAIGN DETECTION (FALLBACK) ---
      // If user didn't use the "Reply" feature (swiping right), check if we sent them a campaign recently.
      // 🛑 FIX: Ignore implicit detection if the message looks like a new Website Enquiry (has URL).
      const isWebsiteEnquiry = (message.text?.body || "")
        .toLowerCase()
        .includes("http");

      // FIX: Removed !hasActiveEnquiry to allow campaign replies to override old context
      if (!campaignToCredit && !isWebsiteEnquiry) {
        try {
          // 1. Find the contact ID
          const contactForImplicit = await Contact.findOne({
            phoneNumber: message.from,
          });

          if (contactForImplicit) {
            // 2. Check for recent campaign sent to this contact (e.g., last 16 hours)
            const threeHoursAgo = new Date(Date.now() - 16 * 60 * 60 * 1000);
            const recentAnalytics = await Analytics.findOne({
              contact: contactForImplicit._id,
              status: { $in: ["sent", "delivered", "read"] }, // FIX: Allow any valid status (not just 'sent')
              createdAt: { $gte: threeHoursAgo },
            })
              .sort({ createdAt: -1 })
              .populate("campaign");

            if (recentAnalytics?.campaign) {
              campaignToCredit = recentAnalytics.campaign;
              console.log(
                `📌 Implicit Campaign detected (Recent Sent) → ${campaignToCredit.name}`,
              );
            }
          }
        } catch (implicitErr) {
          console.error("⚠️ Implicit campaign check failed:", implicitErr);
        }
      }

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
                credentials.accessToken,
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

                let cleanType = contentType; // Default to full content-type
                if (contentType) {
                  cleanType = contentType.split(";")[0].trim();
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

                // Upload to Cloudinary (Streaming directly)
                console.log(`📤 Uploading ${filename} to Cloudinary...`);

                const cloudResult = await uploadToCloudinary(
                  response.data,
                  filename,
                );

                if (cloudResult && cloudResult.secure_url) {
                  newReplyData.mediaUrl = cloudResult.secure_url;
                  console.log(
                    `✅ Media saved to Cloudinary: ${newReplyData.mediaUrl}`,
                  );
                } else {
                  console.warn(
                    "⚠️ Cloudinary upload succeeded but no URL returned.",
                  );
                }
              }
            } catch (mediaErr) {
              console.error(
                "❌ Failed to download/upload media:",
                mediaErr.message,
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
      // WRAPPED IN TRY/CATCH to handle Race Conditions (Duplicate Webhooks)
      try {
        const incomingReply = new Reply(newReplyData);
        const savedReply = await incomingReply.save();

        io.emit("newMessage", {
          from: message.from,
          recipientId,
          message: savedReply,
        });

        console.log("💾 Saved incoming reply.");
      } catch (saveErr) {
        if (saveErr.code === 11000) {
          console.warn(
            `⚠️ Race Condition Detected: Message ${message.id} was already saved by another process. Ignoring duplicate.`,
          );
          // Stop processing this specific request, but return 200 OK to Meta
          return res.sendStatus(200);
        } else {
          console.error("❌ Error saving reply:", saveErr);
          throw saveErr; // Rethrow other errors
        }
      }

      /* ---------------------------------------------------------
       * B & C) DEBOUNCED PROCESSING
       * --------------------------------------------------------- */
      if (messageBody) {
        // Initialize buffer for this user if not exists
        if (!userMessageBuffer[message.from]) {
          userMessageBuffer[message.from] = {
            messages: [],
            timer: null,
          };
        }

        const userBuffer = userMessageBuffer[message.from];

        // Add this message to the batch
        userBuffer.messages.push({
          ...message,
          body: messageBody,
          campaign: campaignToCredit,
          contactName: contactName, // Pass profile name
          isDirectReply:
            isDirectReply || ["button", "interactive"].includes(message.type), // Mark if direct
        });

        // Clear existing timer
        if (userBuffer.timer) {
          clearTimeout(userBuffer.timer);
        }

        // Set new timer
        console.log(
          `⏳ Buffering message from ${message.from}... (Wait ${BUFFER_DELAY_MS}ms)`,
        );
        userBuffer.timer = setTimeout(() => {
          processBufferedMessages(
            recipientId,
            message.from,
            credentials,
            phoneNumberDoc,
          );
        }, BUFFER_DELAY_MS);
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
        { new: true },
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
