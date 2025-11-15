// backend/src/services/botService.js
    
const Enquiry = require('../models/Enquiry');
const Reply = require('../models/Reply');
const BotFlow = require('../models/BotFlow');
const BotNode = require('../models/BotNode');
const PhoneNumber = require('../models/PhoneNumber');
const { 
  sendTextMessage, 
  sendButtonMessage, 
  sendListMessage 
} = require('../integrations/whatsappAPI');
    
/**
 * Helper to replace variables in a message, e.g., {{name}}
 */
const fillTemplate = (text, enquiry) => {
  if (!text) return '';
  return text
    .replace(/{{name}}/gi, enquiry.name || 'friend')
    .replace(/{{projectName}}/gi, enquiry.projectName || 'our project')
    .replace(/{{email}}/gi, enquiry.email || '')
    .replace(/{{budget}}/gi, enquiry.budget || '')
    .replace(/{{bedrooms}}/gi, enquiry.bedrooms || '');
};

/**
 * Helper to send the correct message type based on the node
 */
const sendMessageNode = async (to, node, enquiry, accessToken, phoneNumberId) => {
  const text = fillTemplate(node.messageText, enquiry);
  
  switch (node.messageType) {
    case 'text':
      return sendTextMessage(to, text, accessToken, phoneNumberId);
    case 'buttons':
      const buttons = node.buttons.map(btn => ({ id: btn.nextNodeId, title: btn.title }));
      return sendButtonMessage(to, text, buttons, accessToken, phoneNumberId);
    case 'list':
      const sections = node.listSections.map(sec => ({
        title: sec.title,
        rows: sec.rows.map(row => ({
          id: row.nextNodeId,
          title: row.title,
          description: row.description || undefined,
        })),
      }));
      return sendListMessage(to, text, node.listButtonText, sections, accessToken, phoneNumberId);
    default:
      console.error(`Unknown node type: ${node.messageType}`);
      return null;
  }
};

/**
 * Helper to find the next node based on user's reply
 */
const getNextNodeKey = (message, currentNode) => {
  if (message.type === 'interactive' && message.interactive.button_reply) {
    // User clicked a button, the ID *is* the next node key
    return message.interactive.button_reply.id;
  }
  if (message.type === 'interactive' && message.interactive.list_reply) {
    // User selected from a list, the ID *is* the next node key
    return message.interactive.list_reply.id;
  }
  if (currentNode.messageType === 'text' && currentNode.nextNodeId) {
    // User sent text in reply to a question, follow the simple path
    return currentNode.nextNodeId;
  }
  // If no logic matches (e.g., user types "hello" in the middle of a flow),
  // we can default to a "main_menu" node if one exists, or just end.
  return 'main_menu'; // We'll assume a 'main_menu' node exists as a fallback
};

/**
 * Main Bot Engine: Handles an incoming message
 */
const handleBotConversation = async (message, messageBody, recipientId, credentials) => {
  const { accessToken } = credentials;
  const customerPhone = message.from;

  // 1. Find the Phone Number doc to get the active bot flow
  const phoneNumberDoc = await PhoneNumber.findOne({ phoneNumberId: recipientId });
  if (!phoneNumberDoc || !phoneNumberDoc.activeBotFlow) {
    console.log(`🤖 Bot disabled for ${recipientId}. No active flow.`);
    return null;
  }
  const botFlowId = phoneNumberDoc.activeBotFlow;

  // 2. Find or create the user's enquiry session
  let enquiry = await Enquiry.findOne({ 
    phoneNumber: customerPhone, 
    recipientId: recipientId 
  });
  
  let currentNodeKey;
  
  if (!enquiry) {
    // This is the VERY FIRST message from a new user
    const flow = await BotFlow.findById(botFlowId);
    const startNode = await BotNode.findById(flow.startNode);
    
    enquiry = await Enquiry.create({
      phoneNumber: customerPhone,
      recipientId: recipientId,
      conversationState: startNode.nodeId, // e.g., "START"
    });
    currentNodeKey = startNode.nodeId;
  } else {
    // This is a follow-up message
    currentNodeKey = enquiry.conversationState;
  }

  // 3. Find the user's current node in the flow
  const currentNode = await BotNode.findOne({ botFlow: botFlowId, nodeId: currentNodeKey });
  if (!currentNode) {
    console.error(`❌ Bot error: Could not find node "${currentNodeKey}" in flow "${botFlowId}"`);
    return null;
  }

  // 4. If the current node was a question, save the answer
  if (currentNode.messageType === 'text' && currentNode.saveToField) {
    const field = currentNode.saveToField; // e.g., "name", "email"
    enquiry[field] = messageBody;
  }

  // 5. Determine the next node to go to
  const nextNodeKey = getNextNodeKey(message, currentNode);
  
  if (nextNodeKey === 'END') {
    enquiry.conversationState = 'END'; // Stop the bot
    await enquiry.save();
    console.log(`🤖 Bot flow ended for ${customerPhone}.`);
    return null;
  }

  // 6. Fetch the next node from the database
  const nextNode = await BotNode.findOne({ botFlow: botFlowId, nodeId: nextNodeKey });
  if (!nextNode) {
     console.error(`❌ Bot error: Could not find next node "${nextNodeKey}" in flow "${botFlowId}"`);
     // Fallback: send them to the start
     const startNode = await BotNode.findOne({ botFlow: botFlowId, nodeId: 'START' });
     await sendMessageNode(customerPhone, startNode, enquiry, accessToken, recipientId);
     enquiry.conversationState = 'START';
     await enquiry.save();
     return null;
  }

  // 7. Send the new message from the next node
  const botReply = await sendMessageNode(customerPhone, nextNode, enquiry, accessToken, recipientId);
  
  // 8. Update the user's state to the new node
  enquiry.conversationState = nextNodeKey;
  await enquiry.save();

  // 9. Save the bot's reply to the chat history
  if (botReply && botReply.messages && botReply.messages[0].id) {
    const newAutoReply = new Reply({
      messageId: botReply.messages[0].id,
      from: customerPhone,
      recipientId: recipientId,
      body: fillTemplate(nextNode.messageText, enquiry),
      timestamp: new Date(),
      direction: 'outgoing',
      read: true,
    });
    await newAutoReply.save();
    return newAutoReply; // Return the saved reply
  }
  
  return null;
};

module.exports = {
  handleBotConversation,
};