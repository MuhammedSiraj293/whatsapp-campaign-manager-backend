// backend/src/utils/encryption.js
const crypto = require("crypto");

if (!process.env.ENCRYPTION_KEY) {
  throw new Error("CRITICAL SECURITY ERROR: ENCRYPTION_KEY environment variable is not defined!");
}

const SECRET = process.env.ENCRYPTION_KEY;
const KEY = crypto.createHash("sha256").update(SECRET).digest();
const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;

/**
 * Encrypts plain text
 * @param {string} text
 * @returns {string}
 */
function encrypt(text) {
  if (!text) return "";
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  // Combine IV and encrypted text with a delimiter (colon)
  return `${iv.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts cipher text. If it is already plain text, returns it as-is.
 * @param {string} text
 * @returns {string}
 */
function decrypt(text) {
  if (!text) return "";
  
  const parts = text.split(":");
  if (parts.length !== 2) {
    // If it doesn't have a colon, it's not encrypted by us. Return it as-is.
    return text;
  }
  
  try {
    const iv = Buffer.from(parts[0], "hex");
    const encryptedText = Buffer.from(parts[1], "hex");
    
    if (iv.length !== IV_LENGTH) {
      return text; // Invalid IV size, return as-is
    }
    
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    // If decryption fails, fallback to returning as-is
    return text;
  }
}

module.exports = {
  encrypt,
  decrypt,
};
