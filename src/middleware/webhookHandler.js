// backend/src/middleware/webhookHandler.js

const Reply = require("../models/Reply");
const Campaign = require("../models/Campaign");
const Analytics = require("../models/Analytics");
const Contact = require("../models/Contact");
const PhoneNumber = require("../models/PhoneNumber");
const WabaAccount = require("../models/WabaAccount");
const Enquiry = require("../models/Enquiry");

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
      const newReplyData = {
        messageId: message.id,
        from: message.from,
        recipientId,
        timestamp: new Date(message.timestamp * 1000),
        direction: "incoming",
        campaign: campaignToCredit?._id || null,
      };

      switch (message.type) {
        case "text":
          messageBody = message.text.body;
          newReplyData.body = messageBody;
          break;

        case "interactive":
        case "button":
          if (message.interactive?.button_reply) {
            messageBody = message.interactive.button_reply.title;
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
       * C) AUTO-REPLY + BOT (NOW CORRECTLY SEPARATED)
       * --------------------------------------------------------- */

      if (messageBody) {
        const messageBodyLower = messageBody.toLowerCase();
        const isCampaignReply = !!campaignToCredit;

        let autoReplyText = null;
        let botReplyDoc = null;

        /* ------------------------------
         * C1) STOP / UNSUBSCRIBE
         * ------------------------------ */
        if (
          messageBodyLower.includes("stop") ||
          messageBodyLower.includes("إيقاف")
        ) {
          autoReplyText =
            "You’ve been unsubscribed. You won’t receive further messages.";

          await Contact.findOneAndUpdate(
            { phoneNumber: message.from },
            { isSubscribed: false },
            { upsert: true }
          );
        } else {
          /* ------------------------------
           * C2) RESUBSCRIBE
           * ------------------------------ */
          const contact = await Contact.findOne({
            phoneNumber: message.from,
          });

          if (contact && !contact.isSubscribed) {
            contact.isSubscribed = true;
            await contact.save();

            autoReplyText =
              "Welcome back to Capital Avenue! How can we assist you today?";
          } else if (

          /* ------------------------------
           * C3) Keyword logic
           * ------------------------------ */
            messageBodyLower === "yes" ||
            messageBodyLower.includes("yes, i am interested") ||
            /\byes\b/i.test(messageBodyLower)
          ) {
            autoReplyText =
              "Your interest has been noted. Our team will contact you shortly.";
          } else if (messageBodyLower.includes("نعم، مهتم")) {
            autoReplyText = ".تم تسجيل اهتمامك. سنتواصل معك قريبًا.";
          } else if (messageBodyLower.includes("not interested")) {
            autoReplyText = "No worries! Feel free to reach out anytime.";
          } else {

          /* ------------------------------
           * C4) No keyword → Welcome / Bot
           * IMPORTANT: Bot ONLY for NON-CAMPAIGN
           * ------------------------------ */
            const totalIncoming = await Reply.countDocuments({
              from: message.from,
              direction: "incoming",
            });
            
            // BOT HANDLES ONLY NON-CAMPAIGN
            if (
              !isCampaignReply &&
              totalIncoming === 1 &&
              (message.type === "text" || message.type === "interactive")
            ) {
              if (credentials?.accessToken) {
                try {
                  console.log("🤖 Passing message to botService...");
                  const botReply = await handleBotConversation(
                    message,
                    messageBody,
                    recipientId,
                    credentials
                  );

                  if (botReply) {
                    botReplyDoc = botReply;
                    io.emit("newMessage", {
                      from: message.from,
                      recipientId,
                      message: botReply,
                    });
                  }
                } catch (err) {
                  console.error("❌ Bot Error:", err);
                }
              }
            }
          }
        }

        /* ------------------------------
         * C5) Send auto-reply (if exists)
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
      const updated = await Analytics.findOneAndUpdate(
        { wamid: status.id },
        { status: status.status },
        { new: true }
      );

      if (updated) {
        io.emit("messageStatusUpdate", {
          wamid: status.id,
          status: status.status,
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
