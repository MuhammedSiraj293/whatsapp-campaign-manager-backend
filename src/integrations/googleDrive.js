const { google } = require("googleapis");
const stream = require("stream");

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

// --- Load credentials from environment variable (Reusing same as Sheets) ---
const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;
if (!credentialsJson) {
  throw new Error("GOOGLE_CREDENTIALS_JSON environment variable not set.");
}

const credentials = JSON.parse(credentialsJson);

// --- Set up Google Auth ---
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: SCOPES,
});

if (credentials.client_email) {
  console.log(
    `🔍 Google Drive Integration initialized with: ${credentials.client_email}`
  );
} else {
  console.warn("⚠️ Google Credentials missing client_email.");
}

const drive = google.drive({ version: "v3", auth });

/**
 * Uploads a file stream to Google Drive
 * @param {ReadableStream} fileStream - The stream of the file to upload
 * @param {string} filename - The name of the file
 * @param {string} mimeType - The MIME type of the file
 * @param {string} [folderId] - Optional folder ID to upload into. Defaults to env var.
 * @returns {Promise<object>} - Returns object with fileId and webViewLink
 */
const uploadToDrive = async (
  fileStream,
  filename,
  mimeType,
  folderId = process.env.GOOGLE_DRIVE_FOLDER_ID
) => {
  try {
    const fileMetadata = {
      name: filename,
    };

    if (folderId) {
      fileMetadata.parents = [folderId];
    } else {
      console.warn(
        "⚠️ No GOOGLE_DRIVE_FOLDER_ID set. Uploading to root (might fail for Service Accounts)."
      );
    }

    const media = {
      mimeType: mimeType,
      body: fileStream,
    };

    const response = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: "id, webViewLink, webContentLink",
    });

    console.log(`✅ Uploaded to Drive: ${filename} (ID: ${response.data.id})`);

    // Make the file readable by anyone with the link (Optional, depending on privacy needs)
    // For now, we keep it private to the service account, but we return the link.
    // If you need it public:
    /*
    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });
    */

    return {
      fileId: response.data.id,
      webViewLink: response.data.webViewLink, // View in browser
      webContentLink: response.data.webContentLink, // Direct download
    };
  } catch (error) {
    console.error("❌ Google Drive Upload Error:", error.message);
    throw new Error("Failed to upload file to Google Drive.");
  }
};

module.exports = {
  uploadToDrive,
};
