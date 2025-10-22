// backend/src/middleware/webhookHandler.js

const Reply = require("../models/Reply");
const Campaign = require("../models/Campaign");
const Analytics = require("../models/Analytics");
const Contact = require("../models/Contact");
const PhoneNumber = require("../models/PhoneNumber"); // Import PhoneNumber
const WabaAccount = require("../models/WabaAccount"); // Import WabaAccount
const { sendTextMessage } = require("../integrations/whatsappAPI");
const { appendToSheet } = require("../integrations/googleSheets");
const { getIO } = require("../socketManager"); // <-- 1. IMPORT from the manager

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

        if (message.context && message.context.id) {
          const originalMessage = await Analytics.findOne({
            wamid: message.context.id,
          }).populate("campaign");
          if (originalMessage) campaignToCredit = originalMessage.campaign;
        }

        let newReplyData = {
          messageId: message.id,
          from: message.from,
          recipientId: recipientId,
          timestamp: new Date(message.timestamp * 1000),
          direction: "incoming",
          campaign: campaignToCredit ? campaignToCredit._id : null,
        };

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

        // --- THIS IS THE NEW DUAL-SYSTEM LEAD ROUTING ---
        if (campaignToCredit && messageBody) {
          const incomingMessageCount = await Reply.countDocuments({
            from: message.from,
            campaign: campaignToCredit._id,
            direction: "incoming",
          });

          // Only process this as a "new lead" if it's the first incoming reply for this campaign
          if (incomingMessageCount === 1) {
            console.log(`✨ New lead for campaign "${campaignToCredit.name}".`);
            const contact = await Contact.findOne({
              phoneNumber: message.from,
            });
            const dataRow = [
              [
                new Date(message.timestamp * 1000).toLocaleString("en-US", {
                  timeZone: "Asia/Dubai",
                }),
                message.from,
                contact ? contact.name : "Unknown",
                messageBody,
              ],
            ];
            const headerRow = ["Timestamp", "From", "Name", "Message"];

            // SYSTEM 1: Check for a campaign-specific sheet ID
            if (campaignToCredit.spreadsheetId) {
              console.log(
                `System 1: Sending lead to campaign-specific sheet: ${campaignToCredit.spreadsheetId}`
              );
              await clearSheet(campaignToCredit.spreadsheetId, "Sheet1!A:D");
              await appendToSheet(campaignToCredit.spreadsheetId, "Sheet1!A1", [
                headerRow,
                ...dataRow,
              ]);

              // SYSTEM 2: No specific ID, so use the Master Sheet
            } else {
              console.log(
                "System 2: No campaign sheet ID. Looking for Master Sheet..."
              );
              const phoneNumber = await PhoneNumber.findOne({
                phoneNumberId: recipientId,
              }).populate("wabaAccount");

              if (
                phoneNumber &&
                phoneNumber.wabaAccount &&
                phoneNumber.wabaAccount.masterSpreadsheetId
              ) {
                const masterSheetId =
                  phoneNumber.wabaAccount.masterSpreadsheetId;
                const templateName = campaignToCredit.templateName; // This is our tab name

                const sheetId = await findSheetIdByName(
                  masterSheetId,
                  templateName
                );
                if (!sheetId) {
                  // Tab doesn't exist, so create it and add the header row
                  console.log(`Creating new tab: "${templateName}"`);
                  await createSheet(masterSheetId, templateName);
                  await addHeaderRow(masterSheetId, templateName, headerRow);
                }

                // Now, append the lead to the correct tab
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
          // Always increment the reply count
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

          // --- THIS IS THE KEY CHANGE ---
          // 1. Find the credentials for this specific phone number FIRST
          const phoneNumber = await PhoneNumber.findOne({
            phoneNumberId: recipientId,
          }).populate("wabaAccount");
          if (!phoneNumber || !phoneNumber.wabaAccount) {
            console.error(
              `❌ Could not find credentials for recipientId ${recipientId}. Aborting auto-reply.`
            );
            return res.sendStatus(200);
          }
          const { accessToken } = phoneNumber.wabaAccount;

          // 2. Handle "stop" and "re-subscribe" logic
          if (messageBodyLower === "stop") {
            autoReplyText =
              "You have been unsubscribed. You will no longer receive messages from us.";
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
              console.log(`✅ Contact ${message.from} has been re-subscribed.`);
            }
            // 3. Handle normal keyword logic
            if (messageBodyLower.includes("yes, i am interested")) {
              autoReplyText =
                "Your interest has been noted. will contact you shortly. Thank you for contacting us.";
            } else if (messageBodyLower.includes("not interested")) {
              autoReplyText =
                "We respect your choice. If at any point you'd like to revisit, our team will be ready to help you.";
            } else {
              const incomingMessageCount = await Reply.countDocuments({
                from: message.from,
              });
              if (incomingMessageCount === 1) {
                autoReplyText =
                  "Hello and welcome to Capital Avenue! It’s a pleasure to connect with you. How can we help you today?";
              }
            }
          }

          // 4. Send the auto-reply (if any) using the correct credentials
          if (autoReplyText) {
            console.log(
              `🤖 Sending auto-reply to ${message.from} from ${recipientId}...`
            );
            const result = await sendTextMessage(
              message.from,
              autoReplyText,
              accessToken,
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
