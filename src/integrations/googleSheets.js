// backend/src/integrations/googleSheets.js

const { google } = require('googleapis');

// We no longer need the file path
// const path = require('path');
// const KEY_FILE_PATH = path.join(__dirname, '../config/credentials.json');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// --- THIS IS THE KEY CHANGE ---
// Get the credentials directly from an environment variable
const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;
if (!credentialsJson) {
  throw new Error('GOOGLE_CREDENTIALS_JSON environment variable not set.');
}

// Parse the JSON string from the environment variable
const credentials = JSON.parse(credentialsJson);

// Create an authenticated client using the credentials object
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: SCOPES,
});

const sheets = google.sheets({ version: 'v4', auth });
// --- END OF CHANGE ---


const appendToSheet = async (spreadsheetId, range, values) => {
  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values,
      },
    });
    console.log('✅ Successfully appended data to Google Sheet.');
    return response.data;
  } catch (error) {
    console.error('❌ Error appending data to Google Sheet:', error.message);
    throw new Error('Failed to write to Google Sheet. Ensure it is shared with the client_email.');
  }
};

module.exports = {
  appendToSheet,
};