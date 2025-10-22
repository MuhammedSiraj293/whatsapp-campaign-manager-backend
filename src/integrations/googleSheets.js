// backend/src/integrations/googleSheets.js

const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// --- Load credentials from environment variable ---
const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;
if (!credentialsJson) {
  throw new Error('GOOGLE_CREDENTIALS_JSON environment variable not set.');
}

const credentials = JSON.parse(credentialsJson);

// --- Set up Google Auth ---
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: SCOPES,
});

const sheets = google.sheets({ version: 'v4', auth });

// --- HELPER FUNCTION to get sheet properties ---
const getSheetProperties = async (spreadsheetId) => {
    try {
        const response = await sheets.spreadsheets.get({
            spreadsheetId,
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching sheet properties:', error.message);
        throw new Error('Could not get sheet properties. Check Sheet ID and permissions.');
    }
};

// --- NEW FUNCTION: Find a tab by its name ---
const findSheetIdByName = async (spreadsheetId, sheetName) => {
    const properties = await getSheetProperties(spreadsheetId);
    const sheet = properties.sheets.find(s => s.properties.title === sheetName);
    return sheet ? sheet.properties.sheetId : null;
};

// --- NEW FUNCTION: Create a new tab ---
const createSheet = async (spreadsheetId, sheetName) => {
    try {
        const requests = [{
            addSheet: {
                properties: {
                    title: sheetName,
                }
            }
        }];
        const response = await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            resource: { requests },
        });
        console.log(`✅ Created new tab: "${sheetName}"`);
        return response.data.replies[0].addSheet.properties;
    } catch (error) {
        console.error(`Error creating new sheet: ${error.message}`);
        throw new Error('Failed to create new sheet tab.');
    }
};

// --- NEW FUNCTION: Add a header row to a tab ---
const addHeaderRow = async (spreadsheetId, sheetName, headers) => {
    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheetName}!A1`, // Append at the first row
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [headers], // Headers as an array of an array
            },
        });
    } catch (error) {
        console.error(`Error adding header row: ${error.message}`);
        throw new Error('Failed to add header row to new sheet.');
    }
};

// --- (Unchanged) ---
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
    return response.data;
  } catch (error) {
    console.error('Error appending data to Google Sheet:', error.message);
    throw new Error('Failed to write to Google Sheet.');
  }
};

// --- (Unchanged) ---
const clearSheet = async (spreadsheetId, range) => {
    try {
        const response = await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range,
        });
        return response.data;
    } catch (error) {
        console.error('Error clearing Google Sheet:', error.message);
        throw new Error('Failed to clear Google Sheet.');
    }
};
    
module.exports = {
  appendToSheet,
  clearSheet,
  findSheetIdByName, // <-- NEW
  createSheet,       // <-- NEW
  addHeaderRow,      // <-- NEW
};