// backend/src/services/botFlow.js
 
const botFlow = {
  // This is the default state for any new enquiry
  START: {
    type: 'buttons',
    text: [
      'Hello and welcome to Capital Avenue! It’s a pleasure to connect with you.',
      'How can we help you today?',
    ].join('\n'),
    buttons: [
      { id: 'goto_main_menu', title: 'Main Menu' },
    ],
  },

  // This is the main hub, similar to the  bot
  main_menu: {
    type: 'list',
    text: 'Please select an option from the list below.',
    buttonText: 'View Options',
    sections: [
      {
        title: 'OUR SERVICES',
        rows: [
          { id: 'flow_properties', title: 'View Properties' },
          { id: 'flow_enquiry', title: 'Make an Enquiry' },
          { id: 'flow_contact', title: 'Contact Details' },
        ],
      },
    ],
  },
 
  // This is the flow for a new lead from a website
  website_enquiry_start: {
    type: 'text',
    text: 'Hello! Thanks for your interest in {{projectName}}. To help you better, what is your full name?',
    nextState: 'website_awaiting_name',
  },
  website_awaiting_name: {
    type: 'text',
    text: 'Thank you, {{name}}. What is your email address?',
    nextState: 'website_awaiting_email',
  },
  website_awaiting_email: {
    type: 'text',
    text: 'Thank you! Your enquiry is complete. A consultant will contact you shortly.',
    nextState: 'END',
  },

  // This is the flow for a property-specific enquiry
  property_enquiry_start: {
    type: 'text',
    text: 'Hello! Thanks for your interest in {{projectName}}. To help you better, what is your full name?',
    nextState: 'property_awaiting_name',
  },
  property_awaiting_name: {
    type: 'text',
    text: 'Thank you, {{name}}. What is your approximate budget for this property?',
    nextState: 'property_awaiting_budget',
  },
  property_awaiting_budget: {
    type: 'text',
    text: 'Great. And how many bedrooms are you looking for?',
    nextState: 'property_awaiting_bedrooms',
  },
  property_awaiting_bedrooms: {
    type: 'text',
    text: 'Perfect. Finally, what is your email address?',
    nextState: 'property_awaiting_email',
  },
  property_awaiting_email: {
    type: 'text',
    text: 'Thank you! Your enquiry is complete. A consultant will contact you shortly.',
    nextState: 'END',
  },

  // This is the "Contact Details" flow
  flow_contact: {
    type: 'buttons',
    text: [
      'You can either:',
      'Visit our website: www.thecapitalavenue.com',
      'Or contact our customer happiness center: 800 12345',
    ].join('\n'),
    buttons: [
      { id: 'goto_main_menu', title: 'Main Menu' },
    ],
  },
  
  // This is a placeholder for the "View Properties" flow
  flow_properties: {
    type: 'buttons',
    text: 'This is where you would list your properties. We can build this flow next.',
    buttons: [
      { id: 'goto_main_menu', title: 'Main Menu' },
    ],
  },

  // This is a placeholder for the "Make an Enquiry" flow
  flow_enquiry: {
    type: 'text',
    text: 'To make an enquiry, please state what you are looking for.',
    nextState: 'END', // Or a different flow
  },

};

module.exports = botFlow;