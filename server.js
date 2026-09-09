const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { generateToken, SHARED_SECRET } = require('./token_generator');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database setup
const dbPath = path.join(__dirname, 'attendance.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Initialize schema
const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schemaSql);

// Pre-seed a default session if table is empty
const sessionCount = db.prepare("SELECT COUNT(*) as count FROM sessions").get();
if (sessionCount.count === 0) {
    db.prepare(`
        INSERT INTO sessions (id, name, center_lat, center_lon, radius_meters, is_active)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run('SESS_101', 'CS101: Embedded Systems & Security', 37.774929, -122.419416, 40.0, 1);
    console.log("Pre-seeded default session: SESS_101");
}

/**
 * Haversine formula to compute distance between two coordinates in meters.
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// ----------------------------------------------------
// API ENDPOINTS
// ----------------------------------------------------

/**
 * POST /api/session/create
 * Admin endpoint to create a classroom session with geofence center (lat/lon) and radius.
 */
app.post('/api/session/create', (req, res) => {
    try {
        const { id, name, center_lat, center_lon, radius_meters, is_active } = req.body;

        if (!name || center_lat === undefined || center_lon === undefined) {
            return res.status(400).json({ error: "INVALID_REQUEST", message: "name, center_lat, and center_lon are required." });
        }

        const sessionId = id || `SESS_${Date.now()}`;
        const radius = radius_meters !== undefined ? parseFloat(radius_meters) : 40.0;
        const active = is_active !== undefined ? (is_active ? 1 : 0) : 1;
        const lat = parseFloat(center_lat);
        const lon = parseFloat(center_lon);

        const stmt = db.prepare(`
            INSERT INTO sessions (id, name, center_lat, center_lon, radius_meters, is_active)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run(sessionId, name, lat, lon, radius, active);

        const createdSession = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
        return res.status(201).json({ success: true, session: createdSession });
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
            return res.status(409).json({ error: "SESSION_EXISTS", message: "Session ID already exists." });
        }
        console.error("Error creating session:", err);
        return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
    }
});

/**
 * GET /api/sessions
 * List all sessions.
 */
app.get('/api/sessions', (req, res) => {
    try {
        const sessions = db.prepare("SELECT * FROM sessions ORDER BY created_at DESC").all();
        return res.json({ success: true, sessions });
    } catch (err) {
        return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
    }
});

/**
 * POST /api/attendance/scan
 * Accepts { student_id, token, lat, lon }.
 * Runs strict 5-stage pipeline:
 *  a. Parsing & HMAC Verification
 *  b. Expiration Check (|now - issued_at| <= 25s)
 *  c. Replay Attack Check (redeemed_tokens)
 *  d. Duplicate Student Check (attendance_records)
 *  e. Geofence Check (Haversine distance <= radius)
 */
app.post('/api/attendance/scan', (req, res) => {
    try {
        const { student_id, token, lat, lon } = req.body;

        if (!student_id || !token || lat === undefined || lon === undefined) {
            return res.status(400).json({
                error: "MISSING_FIELDS",
                message: "student_id, token, lat, and lon are required."
            });
        }

        const studentLat = parseFloat(lat);
        const studentLon = parseFloat(lon);

        if (isNaN(studentLat) || isNaN(studentLon)) {
            return res.status(400).json({
                error: "INVALID_GPS",
                message: "lat and lon must be valid numbers."
            });
        }

        // --- PIPELINE STEP A: Parse Token & HMAC Signature Check ---
        // Token format: <session_id>:<issued_at_epoch_sec>:<nonce>:<hex_signature>
        const parts = token.split(':');
        if (parts.length !== 4) {
            return res.status(401).json({
                error: "INVALID_SIGNATURE",
                message: "Token format invalid."
            });
        }

        const [sessionId, issuedAtStr, nonce, hexSignature] = parts;
        const issuedAtSec = parseInt(issuedAtStr, 10);

        if (!sessionId || !issuedAtStr || !nonce || !hexSignature || isNaN(issuedAtSec)) {
            return res.status(401).json({
                error: "INVALID_SIGNATURE",
                message: "Token payload components malformed."
            });
        }

        // Re-verify HMAC-SHA256
        const payloadToSign = `${sessionId}:${issuedAtStr}:${nonce}`;
        const expectedSignature = crypto
            .createHmac('sha256', SHARED_SECRET)
            .update(payloadToSign)
            .digest('hex');

        // Secure constant-time comparison
        const expectedBuf = Buffer.from(expectedSignature, 'hex');
        const actualBuf = Buffer.from(hexSignature, 'hex');

        if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
            return res.status(401).json({
                error: "INVALID_SIGNATURE",
                message: "HMAC signature mismatch. Token has been tampered with or forged."
            });
        }

        // --- PIPELINE STEP B: Expiration Check ---
        // Verify |server_now - issued_at| <= 25 seconds
        const serverNowSec = Math.floor(Date.now() / 1000);
        const timeDiff = Math.abs(serverNowSec - issuedAtSec);
        if (timeDiff > 25) {
            return res.status(400).json({
                error: "TOKEN_EXPIRED",
                message: `Token expired. Age: ${timeDiff}s (max allowed: 25s).`
            });
        }

        // --- PIPELINE STEP C: Token Replay Check ---
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const existingToken = db.prepare("SELECT token_hash FROM redeemed_tokens WHERE token_hash = ?").get(tokenHash);
        if (existingToken) {
            return res.status(409).json({
                error: "TOKEN_ALREADY_USED",
                message: "This QR code token has already been scanned and redeemed."
            });
        }

        // Session existence check
        const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
        if (!session) {
            return res.status(404).json({
                error: "SESSION_NOT_FOUND",
                message: `Session '${sessionId}' does not exist.`
            });
        }

        if (!session.is_active) {
            return res.status(403).json({
                error: "SESSION_INACTIVE",
                message: `Session '${sessionId}' is currently inactive.`
            });
        }

        // --- PIPELINE STEP D: Duplicate Student Check ---
        const existingRecord = db.prepare(
            "SELECT id FROM attendance_records WHERE session_id = ? AND student_id = ?"
        ).get(sessionId, student_id);

        if (existingRecord) {
            return res.status(409).json({
                error: "ALREADY_MARKED",
                message: `Student '${student_id}' has already been marked present for this session.`
            });
        }

        // --- PIPELINE STEP E: Geofence Check ---
        const distanceMeters = haversineDistance(studentLat, studentLon, session.center_lat, session.center_lon);
        if (distanceMeters > session.radius_meters) {
            return res.status(403).json({
                error: "OUT_OF_BOUNDS",
                message: `Location out of bounds. You are ${Math.round(distanceMeters)}m away (max allowed radius: ${session.radius_meters}m).`,
                distance_meters: Math.round(distanceMeters * 10) / 10,
                radius_meters: session.radius_meters
            });
        }

        // --- PIPELINE STEP F: Success Execution ---
        const roundedDistance = Math.round(distanceMeters * 10) / 10;
        
        const markAttendanceTx = db.transaction(() => {
            db.prepare(`
                INSERT INTO attendance_records (session_id, student_id, lat, lon, distance_meters)
                VALUES (?, ?, ?, ?, ?)
            `).run(sessionId, student_id, studentLat, studentLon, roundedDistance);

            db.prepare(`
                INSERT INTO redeemed_tokens (token_hash, session_id, student_id)
                VALUES (?, ?, ?)
            `).run(tokenHash, sessionId, student_id);
        });

        markAttendanceTx();

        return res.status(200).json({
            success: true,
            message: `Attendance marked successfully! ${roundedDistance}m from target desk.`,
            session_id: sessionId,
            student_id: student_id,
            distance_meters: roundedDistance
        });

    } catch (err) {
        console.error("Error processing attendance scan:", err);
        return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
    }
});

/**
 * GET /api/attendance/report?session_id=X
 * Admin report endpoint returning session metadata and present student list.
 */
app.get('/api/attendance/report', (req, res) => {
    try {
        const sessionId = req.query.session_id;
        if (!sessionId) {
            return res.status(400).json({ error: "MISSING_SESSION_ID", message: "session_id query parameter is required." });
        }

        const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
        if (!session) {
            return res.status(404).json({ error: "SESSION_NOT_FOUND", message: `Session '${sessionId}' not found.` });
        }

        const records = db.prepare(`
            SELECT id, student_id, lat, lon, distance_meters, scanned_at 
            FROM attendance_records 
            WHERE session_id = ?
            ORDER BY scanned_at DESC
        `).all(sessionId);

        return res.json({
            success: true,
            session,
            total_present: records.length,
            records
        });
    } catch (err) {
        return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
    }
});

/**
 * GET /api/token/generate?session_id=X&offset=0
 * Dynamic token generator endpoint for OLED mock display.
 */
app.get('/api/token/generate', (req, res) => {
    const sessionId = req.query.session_id || "SESS_101";
    const offset = parseInt(req.query.offset || "0", 10);
    const token = generateToken(sessionId, SHARED_SECRET, offset);
    return res.json({ token, session_id: sessionId });
});

// Export app and server start helper for testing
let serverInstance = null;
function startServer(port = PORT) {
    return new Promise((resolve) => {
        serverInstance = app.listen(port, '0.0.0.0', () => {
            console.log(`🚀 Attendance Backend Server listening on http://localhost:${port}`);
            resolve(serverInstance);
        });
    });
}

function stopServer() {
    return new Promise((resolve) => {
        if (serverInstance) {
            serverInstance.close(() => {
                db.close();
                resolve();
            });
        } else {
            resolve();
        }
    });
}

if (require.main === module) {
    startServer(PORT);
}

module.exports = { app, startServer, stopServer, db };
