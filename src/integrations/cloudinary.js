const cloudinary = require("cloudinary").v2;
const stream = require("stream");

// --- Configure Cloudinary ---
// These will be loaded from process.env
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Uploads a file stream to Cloudinary
 * @param {ReadableStream} fileStream - The stream of the file to upload
 * @param {string} filename - The name of the file (public_id)
 * @param {string} folder - Optional folder in Cloudinary
 * @returns {Promise<object>} - Returns object with url and secure_url
 */
const uploadToCloudinary = (
  fileStream,
  filename,
  folder = "whatsapp_media"
) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        public_id: filename.split(".")[0], // Cloudinary adds extension automatically usually, but let's be safe
        folder: folder,
        resource_type: "auto", // Auto-detect image/video/raw
      },
      (error, result) => {
        if (error) {
          console.error("❌ Cloudinary Upload Error:", error);
          reject(error);
        } else {
          console.log(`✅ Uploaded to Cloudinary: ${result.secure_url}`);
          resolve({
            url: result.url,
            secure_url: result.secure_url,
            public_id: result.public_id,
          });
        }
      }
    );

    // Pipe the read stream to the upload stream
    fileStream.pipe(uploadStream);
  });
};

module.exports = {
  uploadToCloudinary,
};
