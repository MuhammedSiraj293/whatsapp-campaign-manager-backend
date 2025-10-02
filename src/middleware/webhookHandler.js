// backend/src/middleware/webhookHandler.js

const Reply = require("../models/Reply");
const Campaign = require("../models/Campaign");
const Analytics = require("../models/Analytics");
const Contact = require("../models/Contact");
const { sendTextMessage } = require("../integrations/whatsappAPI");
const { appendToSheet } = require("../integrations/googleSheets");
const { getIO } = require('../socketManager'); // <-- 1. IMPORT from the manager

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
  const body = req.body;
  const io = getIO(); // <-- 2. GET the io instance

  if (body.object === "whatsapp_business_account") {
    const value = body.entry?.[0]?.changes?.[0]?.value;

    // --- Handle Incoming Messages ---
    if (value && value.messages && value.messages[0]) {
      const message = value.messages[0];
      try {
        let savedReply = null;
        let messageBody = "";

        // --- 1. Find the campaign this message belongs to ---
        let campaignToCredit = null;
        if (message.context && message.context.id) {
          // Find the original sent message and get its campaign
          const originalMessage = await Analytics.findOne({
            wamid: message.context.id,
          }).populate("campaign");
          if (originalMessage) campaignToCredit = originalMessage.campaign;
        }

        let newReplyData = {
          messageId: message.id,
          from: message.from,
          timestamp: new Date(message.timestamp * 1000),
          direction: "incoming",
          campaign: campaignToCredit ? campaignToCredit._id : null, // Link to the campaign
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
            if (message[message.type].caption)
              newReplyData.body = message[message.type].caption;
            break;
          default:
            console.log(`Unsupported message type: ${message.type}`);
            break;
        }

        if (newReplyData.body || newReplyData.mediaId) {
          const newReply = new Reply(newReplyData);
          savedReply = await newReply.save();
          console.log("✅ Incoming reply saved to DB.");
          io.emit("newMessage", { from: message.from, message: savedReply });
        }

        if (campaignToCredit) {
          // --- 2. Check if it's the FIRST reply for this specific campaign ---
          const incomingMessageCount = await Reply.countDocuments({
            from: message.from,
            campaign: campaignToCredit._id,
            direction: "incoming",
          });

          if (incomingMessageCount === 1 && campaignToCredit.spreadsheetId) {
            console.log(
              `✨ New lead for campaign "${campaignToCredit.name}". Appending to Google Sheet...`
            );
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
            await appendToSheet(
              campaignToCredit.spreadsheetId,
              "Sheet1!A1",
              dataRow
            );
          }
          // Always increment the main reply count
          await Campaign.findByIdAndUpdate(campaignToCredit._id, {
            $inc: { replyCount: 1 },
          });
          console.log(
            `✅ Incremented reply count for campaign: ${campaignToCredit._id}`
          );
        }

        // --- THIS IS THE CORRECTED BOT LOGIC ---
        if (messageBody) {
          const messageBodyLower = messageBody.toLowerCase();
          let autoReplyText = null; // Declare the variable once, outside the blocks

          if (messageBodyLower.includes("marbella")) {
            autoReplyText =
              "Your interest has been noted. will contact you shortly.Thank you for contacting us.";
          } else if (
            messageBodyLower.includes("rise") ||
            messageBodyLower.includes("yes, i am interested")
          ) {
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

          // If a reply text was determined, send it, save it, and emit it.
          if (autoReplyText) {
            console.log(`🤖 Sending auto-reply to ${message.from}...`);
            const result = await sendTextMessage(message.from, autoReplyText);
            if (result && result.messages && result.messages[0].id) {
              const newAutoReply = new Reply({
                messageId: result.messages[0].id,
                from: message.from,
                body: autoReplyText,
                timestamp: new Date(),
                direction: "outgoing",
                read: true,
              });
              await newAutoReply.save();
              io.emit("newMessage", {
                from: message.from,
                message: newAutoReply,
              });
            }
          }
        }
      } catch (error) {
        console.error("❌ Error processing incoming message:", error);
      }
    }

    // Handle Message Status Updates
    if (value && value.statuses && value.statuses[0]) {
      const statusUpdate = value.statuses[0];
      try {
        await Analytics.findOneAndUpdate(
          { wamid: statusUpdate.id },
          { status: statusUpdate.status }
        );
        console.log(
          `✅ Updated status for ${statusUpdate.id} to ${statusUpdate.status}`
        );
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
