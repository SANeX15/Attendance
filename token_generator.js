const crypto = require('crypto');

const SHARED_SECRET = process.env.SHARED_SECRET || "SUPER_SECRET_HMAC_KEY";

/**
 * Generate a dynamic HMAC-signed attendance token (Mock ESP32).
 * Format: <session_id>:<issued_at_epoch_sec>:<nonce>:<hex_signature>
 * 
 * @param {string} sessionId 
 * @param {string} [secret=SHARED_SECRET] 
 * @param {number} [timeOffsetSec=0] 
 * @param {string} [customNonce=null] 
 * @returns {string} token
 */
function generateToken(sessionId = "SESS_101", secret = SHARED_SECRET, timeOffsetSec = 0, customNonce = null) {
    const issuedAt = Math.floor(Date.now() / 1000) + timeOffsetSec;
    const nonce = customNonce || crypto.randomBytes(4).toString('hex');
    
    const payloadToSign = `${sessionId}:${issuedAt}:${nonce}`;
    const hexSignature = crypto
        .createHmac('sha256', secret)
        .update(payloadToSign)
        .digest('hex');
        
    return `${sessionId}:${issuedAt}:${nonce}:${hexSignature}`;
}

// If executed directly from command line
if (require.main === module) {
    const args = process.argv.slice(2);
    const sessionId = args[0] || "SESS_101";
    const offsetSec = parseInt(args[1] || "0", 10);
    const secret = args[2] || SHARED_SECRET;
    const nonce = args[3] || null;

    const token = generateToken(sessionId, secret, offsetSec, nonce);
    console.log(token);
}

module.exports = {
    generateToken,
    SHARED_SECRET
};
