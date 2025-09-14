// backend/src/integrations/googleSheets.js

const { google } = require('googleapis');
const path = require('path');

const KEY_FILE_PATH = path.join(__dirname, '../config/credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// Create an authenticated client
const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE_PATH,
  scopes: SCOPES,
});

const sheets = google.sheets({ version: 'v4', auth });

/**
 * Appends rows of data to a Google Sheet.
 * @param {string} spreadsheetId - The ID of the Google Sheet.
 * @param {string} range - The sheet and range in A1 notation (e.g., 'Sheet1!A1').
 * @param {Array<Array<string>>} values - An array of rows to append.
 * @returns {Promise<object>} The response from the Sheets API.
 */
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
    throw new Error('Failed to write to Google Sheet.');
  }
};

module.exports = {
  appendToSheet,
};