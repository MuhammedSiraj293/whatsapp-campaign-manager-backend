// backend/src/middleware/webhookHandler.js

const Reply = require("../models/Reply");
const Campaign = require("../models/Campaign");
const Analytics = require("../models/Analytics");
const Contact = require("../models/Contact");
const PhoneNumber = require("../models/PhoneNumber"); // Import PhoneNumber
const WabaAccount = require("../models/WabaAccount"); // Import WabaAccount
const Enquiry = require("../models/Enquiry");
const { sendTextMessage } = require("../integrations/whatsappAPI");
const { getIO } = require("../socketManager"); // <-- 1. IMPORT from the manager
// Import all our new Google Sheet functions
const {
  appendToSheet,
  clearSheet,
  findSheetIdByName,
  createSheet,
  addHeaderRow,
} = require("../integrations/googleSheets");

// --- 1. IMPORT THE NEW BOT SERVICE ---
const { handleBotConversation } = require("../services/botService");

const verifyWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode && token) {
    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log("✅ Webhook verified");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(403);
  }
};

const processWebhook = async (req, res) => {
  const io = getIO(); // <-- Get the io instance from the request object
  const body = req.body;

  if (body.object === "whatsapp_business_account") {
    const value = body.entry?.[0]?.changes?.[0]?.value;
    const recipientId = value?.metadata?.phone_number_id;
    if (!recipientId) {
      console.log(
        "Webhook received payload without metadata.phone_number_id. Ignoring."
      );
      return res.sendStatus(200);
    }

    // --- Handle Incoming Messages ---
    if (value && value.messages && value.messages[0]) {
      const message = value.messages[0];
      try {
        let savedReply = null;
        let messageBody = "";
        let campaignToCredit = null;

        // --- 2. Find credentials for this WABA ---
        // THIS IS THE ONLY PLACE we need to fetch this.
        const phoneNumber = await PhoneNumber.findOne({
          phoneNumberId: recipientId,
        }).populate("wabaAccount");
        if (!phoneNumber || !phoneNumber.wabaAccount) {
          console.error(
            `❌ Could not find credentials for recipientId ${recipientId}. Aborting.`
          );
          return res.sendStatus(200);
        }
        const credentials = {
          accessToken: phoneNumber.wabaAccount.accessToken,
        };

        // Check if this is a reply to a campaign
        // 2. Check if this is a reply to a campaign
        if (message.context && message.context.id) {
          const originalMessage = await Analytics.findOne({
            wamid: message.context.id,
          }).populate("campaign");
          if (originalMessage) campaignToCredit = originalMessage.campaign;
        }
        // 3. Save the incoming message to the chat history
        let newReplyData = {
          messageId: message.id,
          from: message.from,
          recipientId: recipientId,
          timestamp: new Date(message.timestamp * 1000),
          direction: "incoming",
          campaign: campaignToCredit ? campaignToCredit._id : null,
        };

        // ... (switch case for message types)
        switch (message.type) {
          case "text":
            messageBody = message.text.body;
            newReplyData.body = messageBody;
            break;
          case "interactive":
          case "button":
            if (message.interactive?.button_reply)
              messageBody = message.interactive.button_reply.title;
            else if (message.button?.text) messageBody = message.button.text;
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
              newReplyData.body = message[message.type].caption;
            }
            break;
          default:
            console.log(`Unsupported message type: ${message.type}`);
            break;
        }

        if (newReplyData.body || newReplyData.mediaId) {
          const newReply = new Reply(newReplyData);
          savedReply = await newReply.save();
          console.log("✅ Incoming reply saved to DB.");
          io.emit("newMessage", {
            from: message.from,
            recipientId: recipientId,
            message: savedReply,
          });
        }

        // --- DUAL-SYSTEM LEAD ROUTING ---
        if (campaignToCredit && messageBody) {
          console.log("Processing as a CAMPAIGN reply.");

          const incomingMessageCount = await Reply.countDocuments({
            from: message.from,
            campaign: campaignToCredit._id,
            direction: "incoming",
          });

          if (incomingMessageCount === 1) {
            console.log(`✨ New lead for campaign "${campaignToCredit.name}".`);
            const contact = await Contact.findOne({
              phoneNumber: message.from,
            });
            // --- THIS IS THE KEY CHANGE ---
            // We explicitly define the 12-hour format
            const timestampOptions = {
              timeZone: "Asia/Dubai",
              year: "numeric",
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: true, // This forces AM/PM
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
            // --- END OF CHANGE ---
            const headerRow = ["Timestamp", "From", "Name", "Message"];

            // SYSTEM 1: Campaign-specific sheet
            if (campaignToCredit.spreadsheetId) {
              console.log(
                `System 1: Sending lead to campaign-specific sheet: ${campaignToCredit.spreadsheetId}`
              );
              await clearSheet(campaignToCredit.spreadsheetId, "Sheet1!A:D");
              await appendToSheet(campaignToCredit.spreadsheetId, "Sheet1!A1", [
                headerRow,
                ...dataRow,
              ]);

              // SYSTEM 2: Master Sheet
            } else {
              console.log(
                "System 2: No campaign sheet ID. Looking for Master Sheet..."
              );

              // --- CORRECTION 1: REMOVED REDUNDANT DB CALL ---
              // We already have 'phoneNumber' from line 63.
              if (
                phoneNumber &&
                phoneNumber.wabaAccount &&
                phoneNumber.wabaAccount.masterSpreadsheetId
              ) {
                const masterSheetId =
                  phoneNumber.wabaAccount.masterSpreadsheetId;
                const templateName = campaignToCredit.templateName;

                const sheetId = await findSheetIdByName(
                  masterSheetId,
                  templateName
                );
                if (!sheetId) {
                  console.log(`Creating new tab: "${templateName}"`);
                  await createSheet(masterSheetId, templateName);
                  await addHeaderRow(masterSheetId, templateName, headerRow);
                }

                console.log(
                  `Appending lead to Master Sheet, tab: "${templateName}"`
                );
                await appendToSheet(
                  masterSheetId,
                  `${templateName}!A1`,
                  dataRow
                );
              } else {
                console.log(
                  `No Master Sheet ID configured for this WABA. Lead not exported.`
                );
              }
            }
          }
          await Campaign.findByIdAndUpdate(campaignToCredit._id, {
            $inc: { replyCount: 1 },
          });
          console.log(
            `✅ Incremented reply count for campaign: ${campaignToCredit._id}`
          );
        }

        // --- AUTO-REPLY LOGIC (Original Responses) ---
        if (messageBody) {
          const messageBodyLower = messageBody.toLowerCase();
          let autoReplyText = null;

          // --- CORRECTION 2: REDUNDANT DB CALL already removed ---
          // We are using 'phoneNumber' and 'credentials' from earlier.

          // 1. Handle "stop" and "re-subscribe" logic
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

            // 2. Handle "re-subscribe" logic
            if (contact && !contact.isSubscribed) {
              contact.isSubscribed = true;
              await contact.save();
              autoReplyText =
                "Hello and welcome back to Capital Avenue! How can we help you";
              console.log(`✅ Contact ${message.from} has been re-subscribed.`);
            }
            // 3. Handle normal keyword logic
            // --- CORRECTION 4: Added 'else if' to prevent fall-through ---
            else if (
              messageBodyLower === "yes" ||
              messageBodyLower.includes("yes, i am interested") ||
              /\byes\b/i.test(messageBodyLower)
            ) {
              autoReplyText =
                "Your interest has been noted. We will contact you shortly. Thank you for your response.";
            } else if (messageBodyLower.includes("نعم، مهتم")) {
              autoReplyText =
                ".تم تسجيل اهتمامك. سنتواصل معك قريبًا. شكرًا على ردك";
            } else if (messageBodyLower.includes("not interested")) {
              autoReplyText =
                "We respect your choice. If at any point you'd like to revisit, our team will be ready to help you.";
            }
            // 4. If no keywords match, pass to the bot
            else {
              // This is NOT a keyword.
              // Let the bot service handle it (it will check if it's a new or ongoing chat).
              console.log("No keyword matched. Passing to botService...");
              const botReply = await handleBotConversation(
                message,
                messageBody,
                recipientId,
                credentials // Use credentials from line 76
              );
              if (botReply) {
                // The bot already saved the reply, just emit it
                io.emit("newMessage", {
                  from: message.from,
                  recipientId: recipientId,
                  message: botReply,
                });
              }
            }
            // --- END OF CORRECTION 4 ---
          }

          // 5. Send the auto-reply (if any) using the correct credentials
          // This will *only* run if a keyword was matched ("stop", "yes", etc.)
          // It will *not* run if the bot was called.
          if (autoReplyText) {
            console.log(
              `🤖 Sending auto-reply to ${message.from} from ${recipientId}...`
            );
            const result = await sendTextMessage(
              message.from,
              autoReplyText,
              credentials.accessToken, // Use credentials from line 76
              recipientId
            );

            if (result && result.messages && result.messages[0].id) {
              const newAutoReply = new Reply({
                messageId: result.messages[0].id,
                from: message.from,
                recipientId: recipientId,
                body: autoReplyText,
                timestamp: new Date(),
                direction: "outgoing",
                read: true,
              });
              await newAutoReply.save();
              io.emit("newMessage", {
                from: message.from,
                recipientId: recipientId,
                message: newAutoReply,
              });
            }
          }
        }
      } catch (error) {
        console.error("❌ Error processing incoming message:", error);
      }
    }

    // Handle status updates (unchanged)
    if (value && value.statuses && value.statuses[0]) {
      const statusUpdate = value.statuses[0];
      try {
        const updated = await Analytics.findOneAndUpdate(
          { wamid: statusUpdate.id },
          { status: statusUpdate.status },
          { new: true }
        );
        if (updated) {
          console.log(
            `✅ Updated status for ${statusUpdate.id} to ${statusUpdate.status}`
          );
          io.emit("messageStatusUpdate", {
            wamid: statusUpdate.id,
            status: statusUpdate.status,
            from: statusUpdate.recipient_id,
          });
        }
      } catch (error) {
        console.error("❌ Error updating message status:", error);
      }
    }

    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
};

module.exports = {
  verifyWebhook,
  processWebhook,
};
