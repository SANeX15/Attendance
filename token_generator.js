require('dotenv').config();
const crypto = require('crypto');

const INTERVAL_SECONDS = 15;

/**
 * Calculate current TOTP time step.
 * @param {number} [unixTimeSec] 
 * @returns {number} time_step
 */
function getTimeStep(unixTimeSec = Math.floor(Date.now() / 1000)) {
    return Math.floor(unixTimeSec / INTERVAL_SECONDS);
}

/**
 * Generate a dynamic TOTP attendance QR token (Mock ESP32).
 * Formula: HMAC-SHA256(shared_secret, `${session_id}:${time_step}`)
 * QR String: `${session_id}:${time_step}:${hex_signature}`
 * 
 * @param {string} sessionId 
 * @param {string} secret 
 * @param {number} [timeStepOffset=0] - Offset in time steps (+1, -1, etc.)
 * @param {number} [customUnixTime=null] 
 * @returns {string} token
 */
function generateToken(sessionId = "SESS_101", secret = process.env.SHARED_SECRET, timeStepOffset = 0, customUnixTime = null) {
    const activeSecret = secret || process.env.SHARED_SECRET;
    if (!activeSecret) {
        throw new Error("SHARED_SECRET environment variable is not defined.");
    }

    const unixTimeSec = customUnixTime !== null ? customUnixTime : Math.floor(Date.now() / 1000);
    const timeStep = getTimeStep(unixTimeSec) + timeStepOffset;

    const payloadToSign = `${sessionId}:${timeStep}`;
    const hexSignature = crypto
        .createHmac('sha256', activeSecret)
        .update(payloadToSign)
        .digest('hex');

    return `${sessionId}:${timeStep}:${hexSignature}`;
}

// CLI Execution Helper
if (require.main === module) {
    const args = process.argv.slice(2);
    const sessionId = args[0] || "SESS_101";
    const offset = parseInt(args[1] || "0", 10);
    const secret = args[2] || process.env.SHARED_SECRET;

    try {
        const token = generateToken(sessionId, secret, offset);
        console.log(token);
    } catch (err) {
        console.error("Token Generation Error:", err.message);
        process.exit(1);
    }
}

module.exports = {
    generateToken,
    getTimeStep,
    INTERVAL_SECONDS
};
