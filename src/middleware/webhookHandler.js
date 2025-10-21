// backend/src/middleware/webhookHandler.js

const Reply = require("../models/Reply");
const Campaign = require("../models/Campaign");
const Analytics = require("../models/Analytics");
const Contact = require("../models/Contact");
const PhoneNumber = require("../models/PhoneNumber"); // Import PhoneNumber
const WabaAccount = require("../models/WabaAccount"); // Import WabaAccount
const { sendTextMessage } = require("../integrations/whatsappAPI");
const { appendToSheet } = require("../integrations/googleSheets");
// const { getIO } = require("../socketManager"); // <-- 1. IMPORT from the manager

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
  const io = req.io; // <-- Get the io instance from the request object
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

        if (campaignToCredit) {
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

          if (messageBodyLower === "stop") {
            autoReplyText =
              "Your preference has been noted, and you will no longer receive messages from us. We value your choice and remain available when you wish to engage with us again in the future.";
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
              console.log(`✅ Contact ${message.from} has been re-subscribed.`);
            }

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
          }

          if (autoReplyText) {
            const phoneNumber = await PhoneNumber.findOne({
              phoneNumberId: recipientId,
            }).populate("wabaAccount");
            if (phoneNumber && phoneNumber.wabaAccount) {
              const { accessToken } = phoneNumber.wabaAccount;
              console.log(`🤖 Sending auto-reply to ${message.from}...`);
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
