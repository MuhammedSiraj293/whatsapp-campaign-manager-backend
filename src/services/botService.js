// backend/src/services/botService.js

const Enquiry = require("../models/Enquiry");
const Reply = require("../models/Reply");
const botFlow = require("./botFlow"); // <-- 1. Import the "flow map"
const {
  sendTextMessage,
  sendButtonMessage,
  sendListMessage,
} = require("../integrations/whatsappAPI");

// Helper function to replace variables like {{name}}
const fillTemplate = (text, enquiry) => {
  return text
    .replace("{{name}}", enquiry.name || "")
    .replace("{{projectName}}", enquiry.projectName || "our project");
};

// Helper to send the correct message type
const sendMessageNode = (to, node, enquiry, accessToken, phoneNumberId) => {
  const text = fillTemplate(node.text, enquiry);

  switch (node.type) {
    case "text":
      return sendTextMessage(to, text, accessToken, phoneNumberId);
    case "buttons":
      return sendButtonMessage(
        to,
        text,
        node.buttons,
        accessToken,
        phoneNumberId
      );
    case "list":
      return sendListMessage(
        to,
        text,
        node.buttonText,
        node.sections,
        accessToken,
        phoneNumberId
      );
    default:
      console.error(`Unknown node type: ${node.type}`);
      return null;
  }
};

/**
 * Handles an incoming message for the conversational bot.
 */
const handleBotConversation = async (
  message,
  messageBody,
  recipientId,
  credentials
) => {
  const { accessToken } = credentials;
  const customerPhone = message.from;
  let nextNodeKey = null;
  let autoReplyText = null;

  // 1. Find or create the user's enquiry session
  let enquiry = await Enquiry.findOne({
    phoneNumber: customerPhone,
    recipientId: recipientId,
  });

  if (!enquiry) {
    enquiry = await Enquiry.create({
      phoneNumber: customerPhone,
      recipientId: recipientId,
      conversationState: "START", // Default start state
    });
  }

  // 2. Decide what to do based on the user's message
  const currentState = enquiry.conversationState || "START";
  const currentNode = botFlow[currentState];

  // Check if the user clicked a button
  if (message.type === "interactive" && message.interactive.button_reply) {
    const buttonId = message.interactive.button_reply.id;
    if (buttonId.startsWith("goto_")) {
      nextNodeKey = buttonId.replace("goto_", ""); // e.g., "goto_main_menu" -> "main_menu"
    }
  }
  // Check if the user clicked a list item
  else if (message.type === "interactive" && message.interactive.list_reply) {
    const listId = message.interactive.list_reply.id;
    if (listId.startsWith("flow_")) {
      nextNodeKey = listId; // e.g., "flow_contact"
    }
  }
  // Check if this is the very first message from a WordPress URL
  else if (
    currentState === "START" &&
    messageBody.includes("thecapitalavenue.com")
  ) {
    const projectName = parseProjectFromUrl(messageBody);
    enquiry.pageUrl = messageBody;
    enquiry.projectName = projectName;

    if (projectName === "General Enquiry") {
      nextNodeKey = "website_enquiry_start";
    } else {
      nextNodeKey = "property_enquiry_start";
    }
  }
  // Check if the user is in a state that is waiting for text input
  else if (currentNode.nextState) {
    // Save the data
    switch (currentState) {
      case "website_awaiting_name":
      case "property_awaiting_name":
        enquiry.name = messageBody;
        break;
      case "property_awaiting_budget":
        enquiry.budget = messageBody;
        break;
      case "property_awaiting_bedrooms":
        enquiry.bedrooms = messageBody;
        break;
      case "website_awaiting_email":
      case "property_awaiting_email":
        enquiry.email = messageBody.toLowerCase().trim();
        break;
    }
    nextNodeKey = currentNode.nextState;
  }
  // If no logic matches, default to the main menu
  else {
    nextNodeKey = "main_menu";
  }

  // 3. Get the next message from the flow map
  const nextNode = botFlow[nextNodeKey];
  if (nextNode) {
    // Send the message for the new state
    const result = await sendMessageNode(
      customerPhone,
      nextNode,
      enquiry,
      accessToken,
      recipientId
    );

    // Update the user's state
    enquiry.conversationState = nextNodeKey;
    await enquiry.save();

    // 4. Save the bot's reply to the chat history
    if (result && result.messages && result.messages[0].id) {
      const newAutoReply = new Reply({
        messageId: result.messages[0].id,
        from: customerPhone,
        recipientId: recipientId,
        body: fillTemplate(nextNode.text, enquiry),
        timestamp: new Date(),
        direction: "outgoing",
        read: true,
      });
      await newAutoReply.save();
      return newAutoReply; // Return the saved reply
    }
  } else if (nextNodeKey === "END") {
    enquiry.conversationState = "END"; // Stop the bot
    await enquiry.save();
  }
 
  return null;
};

// Helper function to parse the project name from a URL
const parseProjectFromUrl = (url) => {
  try {
    const path = new URL(url).pathname;
    if (path.startsWith("/properties/")) {
      const projectName = path.split("/")[2];
      return projectName
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return "General Enquiry";
  } catch (error) {
    return "General Enquiry";
  }
};

module.exports = {
  handleBotConversation,
};