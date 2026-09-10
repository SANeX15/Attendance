require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const { generateToken, getTimeStep, INTERVAL_SECONDS } = require('./token_generator');

// ----------------------------------------------------
// ENVIRONMENT & SECRETS HYGIENE (OmniPresence by SANeX)
// ----------------------------------------------------
if (!process.env.SHARED_SECRET) {
    console.error("FATAL ERROR: SHARED_SECRET environment variable is not set!");
    process.exit(1);
}

const SHARED_SECRET = process.env.SHARED_SECRET;
const JWT_SECRET = process.env.JWT_SECRET || SHARED_SECRET;
const PORT = process.env.PORT || 3000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';

const app = express();

// ----------------------------------------------------
// CORS & MIDDLEWARE
// ----------------------------------------------------
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || origin === FRONTEND_ORIGIN || process.env.NODE_ENV !== 'production') {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------------------------------
// DATABASE SETUP & SCHEMA MIGRATIONS
// ----------------------------------------------------
const dbPath = path.join(__dirname, 'attendance.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schemaSql);

// Column migrations for existing databases
try { db.prepare("ALTER TABLE redeemed_tokens ADD COLUMN time_step INTEGER").run(); } catch (e) {}
try { db.prepare("ALTER TABLE sessions ADD COLUMN end_time DATETIME").run(); } catch (e) {}

// Pre-seed default session, admin, and student if empty
function preseedDefaultData() {
    const sessionCount = db.prepare("SELECT COUNT(*) as count FROM sessions").get();
    if (sessionCount.count === 0) {
        db.prepare(`
            INSERT INTO sessions (id, name, center_lat, center_lon, radius_meters, is_active)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run('SESS_101', 'CS101: Embedded Systems & Security', 37.774929, -122.419416, 40.0, 1);
        console.log("[OmniPresence] Pre-seeded default session: SESS_101");
    }

    const adminCount = db.prepare("SELECT COUNT(*) as count FROM admins").get();
    if (adminCount.count === 0) {
        const adminHash = bcrypt.hashSync('adminpassword123', 10);
        db.prepare(`
            INSERT INTO admins (id, username, password_hash)
            VALUES (?, ?, ?)
        `).run('ADM_101', 'admin', adminHash);

        db.prepare(`
            INSERT INTO admin_class_assignments (admin_id, session_id)
            VALUES (?, ?)
        `).run('ADM_101', 'SESS_101');
        console.log("[OmniPresence] Pre-seeded default admin: admin / adminpassword123");
    }

    const studentCount = db.prepare("SELECT COUNT(*) as count FROM students").get();
    if (studentCount.count === 0) {
        const studentHash = bcrypt.hashSync('studentpassword123', 10);
        db.prepare(`
            INSERT INTO students (id, username, password_hash, display_name, roll_number)
            VALUES (?, ?, ?, ?, ?)
        `).run('STU_1001', 'student1', studentHash, 'Alice Smith', 'CS-2024-001');
        console.log("[OmniPresence] Pre-seeded default student: student1 / studentpassword123");
    }
}
preseedDefaultData();

// ----------------------------------------------------
// UTILITY FUNCTIONS & AUTH MIDDLEWARE
// ----------------------------------------------------

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

function requireStudentAuth(req, res, next) {
    const token = req.cookies.student_token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
    if (!token) {
        return res.status(401).json({ error: "UNAUTHORIZED", message: "Student authentication required. Please log in." });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'student' || !decoded.student_id) {
            return res.status(403).json({ error: "FORBIDDEN", message: "Invalid student token scope." });
        }
        req.student = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: "UNAUTHORIZED", message: "Invalid or expired student session." });
    }
}

function requireAdminAuth(req, res, next) {
    const token = req.cookies.admin_token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
    if (!token) {
        return res.status(401).json({ error: "UNAUTHORIZED", message: "Admin authentication required. Please log in." });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin' || !decoded.admin_id) {
            return res.status(403).json({ error: "FORBIDDEN", message: "Invalid admin token scope." });
        }
        req.admin = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: "UNAUTHORIZED", message: "Invalid or expired admin session." });
    }
}

function checkAdminSessionAccess(adminId, sessionId) {
    const row = db.prepare(`
        SELECT 1 FROM admin_class_assignments 
        WHERE admin_id = ? AND session_id = ?
    `).get(adminId, sessionId);
    return !!row;
}

// Rate limiter
const scanRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    keyGenerator: (req) => req.student ? req.student.student_id : (req.ip || req.socket.remoteAddress || 'unknown'),
    validate: { keyGeneratorIpFallback: false },
    handler: (req, res) => {
        return res.status(429).json({
            error: "RATE_LIMIT_EXCEEDED",
            message: "Too many scan attempts. Maximum 5 attempts allowed per 60 seconds per student account."
        });
    }
});

// ----------------------------------------------------
// AUTH ENDPOINTS (STUDENT & ADMIN)
// ----------------------------------------------------

app.post('/api/auth/student/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "INVALID_REQUEST", message: "Username and password are required." });
    }

    const student = db.prepare("SELECT * FROM students WHERE username = ?").get(username);
    if (!student || !bcrypt.compareSync(password, student.password_hash)) {
        return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid student username or password." });
    }

    const token = jwt.sign(
        { student_id: student.id, username: student.username, role: 'student' },
        JWT_SECRET,
        { expiresIn: '24h' }
    );

    res.cookie('student_token', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000
    });

    return res.json({
        success: true,
        message: "Student login successful",
        student: {
            id: student.id,
            username: student.username,
            display_name: student.display_name,
            roll_number: student.roll_number
        }
    });
});

app.post('/api/auth/student/logout', (req, res) => {
    res.clearCookie('student_token');
    return res.json({ success: true, message: "Logged out successfully." });
});

app.get('/api/auth/student/me', requireStudentAuth, (req, res) => {
    const student = db.prepare("SELECT id, username, display_name, roll_number FROM students WHERE id = ?").get(req.student.student_id);
    if (!student) {
        return res.status(404).json({ error: "NOT_FOUND", message: "Student record not found." });
    }
    return res.json({ success: true, student });
});

app.get('/api/student/history', requireStudentAuth, (req, res) => {
    try {
        const records = db.prepare(`
            SELECT ar.id, ar.session_id, s.name as session_name, ar.distance_meters, ar.scanned_at
            FROM attendance_records ar
            JOIN sessions s ON ar.session_id = s.id
            WHERE ar.student_id = ?
            ORDER BY ar.scanned_at DESC
        `).all(req.student.student_id);

        return res.json({ success: true, records });
    } catch (err) {
        return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
    }
});

app.post('/api/auth/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "INVALID_REQUEST", message: "Username and password are required." });
    }

    const admin = db.prepare("SELECT * FROM admins WHERE username = ?").get(username);
    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
        return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid admin username or password." });
    }

    const token = jwt.sign(
        { admin_id: admin.id, username: admin.username, role: 'admin' },
        JWT_SECRET,
        { expiresIn: '24h' }
    );

    res.cookie('admin_token', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000
    });

    return res.json({
        success: true,
        message: "Admin login successful",
        admin: {
            id: admin.id,
            username: admin.username
        }
    });
});

app.post('/api/auth/admin/logout', (req, res) => {
    res.clearCookie('admin_token');
    return res.json({ success: true, message: "Admin logged out successfully." });
});

app.get('/api/auth/admin/me', requireAdminAuth, (req, res) => {
    return res.json({ success: true, admin: req.admin });
});

// ----------------------------------------------------
// ADMIN MANAGEMENT & PASSWORD RESET ACTIONS
// ----------------------------------------------------

/**
 * GET /api/admin/students
 * List all provisioned students for Roster & Password Reset View
 */
app.get('/api/admin/students', requireAdminAuth, (req, res) => {
    try {
        const students = db.prepare("SELECT id, username, display_name, roll_number, created_at FROM students ORDER BY display_name ASC").all();
        return res.json({ success: true, students });
    } catch (err) {
        return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
    }
});

/**
 * POST /api/admin/students/reset-password
 * Admin Dashboard Reset Action: Allows logged-in admins to reset any student's password
 */
app.post('/api/admin/students/reset-password', requireAdminAuth, (req, res) => {
    try {
        const { username, student_id, new_password } = req.body;
        if (!new_password || (!username && !student_id)) {
            return res.status(400).json({ error: "INVALID_REQUEST", message: "student_id/username and new_password are required." });
        }

        const passHash = bcrypt.hashSync(new_password, 10);
        let result;

        if (student_id) {
            result = db.prepare("UPDATE students SET password_hash = ? WHERE id = ?").run(passHash, student_id);
        } else {
            result = db.prepare("UPDATE students SET password_hash = ? WHERE username = ?").run(passHash, username);
        }

        if (result.changes === 0) {
            return res.status(404).json({ error: "NOT_FOUND", message: "Student account not found." });
        }

        return res.json({
            success: true,
            message: `Password reset successfully for student account!`
        });

    } catch (err) {
        return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
    }
});

app.post('/api/admin/students/bulk-upload', requireAdminAuth, (req, res) => {
    try {
        let studentsList = req.body.students;

        if (typeof req.body === 'string' || (req.body && typeof req.body.csv === 'string')) {
            const csvText = typeof req.body === 'string' ? req.body : req.body.csv;
            const lines = csvText.trim().split('\n');
            studentsList = [];
            lines.forEach((line, idx) => {
                const parts = line.split(',').map(s => s.trim());
                if (idx === 0 && parts[0].toLowerCase() === 'username') return;
                if (parts.length >= 4) {
                    studentsList.push({
                        username: parts[0],
                        display_name: parts[1],
                        roll_number: parts[2],
                        password: parts[3]
                    });
                }
            });
        }

        if (!Array.isArray(studentsList) || studentsList.length === 0) {
            return res.status(400).json({ error: "INVALID_REQUEST", message: "An array or CSV of student records is required." });
        }

        let addedCount = 0;
        const uploadTx = db.transaction(() => {
            const stmt = db.prepare(`
                INSERT INTO students (id, username, password_hash, display_name, roll_number)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(username) DO UPDATE SET
                    password_hash = excluded.password_hash,
                    display_name = excluded.display_name,
                    roll_number = excluded.roll_number
            `);

            studentsList.forEach((s) => {
                if (!s.username || !s.password || !s.display_name || !s.roll_number) return;
                const studentId = s.id || `STU_${crypto.createHash('md5').update(s.username).digest('hex').substring(0, 8).toUpperCase()}`;
                const passHash = bcrypt.hashSync(s.password, 10);
                stmt.run(studentId, s.username, passHash, s.display_name, s.roll_number);
                addedCount++;
            });
        });

        uploadTx();

        return res.json({
            success: true,
            count: addedCount,
            message: `Successfully provisioned ${addedCount} student account(s).`
        });

    } catch (err) {
        return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
    }
});

app.post('/api/session/create', requireAdminAuth, (req, res) => {
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

        const createTx = db.transaction(() => {
            db.prepare(`
                INSERT INTO sessions (id, name, center_lat, center_lon, radius_meters, is_active)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(sessionId, name, lat, lon, radius, active);

            db.prepare(`
                INSERT INTO admin_class_assignments (admin_id, session_id)
                VALUES (?, ?)
                ON CONFLICT DO NOTHING
            `).run(req.admin.admin_id, sessionId);
        });

        createTx();

        const createdSession = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
        return res.status(201).json({ success: true, session: createdSession });

    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
            return res.status(409).json({ error: "SESSION_EXISTS", message: "Session ID already exists." });
        }
        return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
    }
});

app.post('/api/session/:id/end', requireAdminAuth, (req, res) => {
    try {
        const sessionId = req.params.id;
        if (!checkAdminSessionAccess(req.admin.admin_id, sessionId)) {
            return res.status(403).json({ error: "FORBIDDEN", message: "You are not authorized to manage this session." });
        }

        const result = db.prepare(`
            UPDATE sessions 
            SET is_active = 0, end_time = CURRENT_TIMESTAMP 
            WHERE id = ?
        `).run(sessionId);

        if (result.changes === 0) {
            return res.status(404).json({ error: "SESSION_NOT_FOUND", message: `Session '${sessionId}' not found.` });
        }

        return res.json({ success: true, message: `Session '${sessionId}' ended successfully.` });
    } catch (err) {
        return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
    }
});

app.get('/api/sessions', (req, res) => {
    try {
        let adminId = null;
        const token = req.cookies.admin_token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
        if (token) {
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                if (decoded.role === 'admin') adminId = decoded.admin_id;
            } catch (e) {}
        }

        let sessions;
        if (adminId) {
            sessions = db.prepare(`
                SELECT s.* FROM sessions s
                JOIN admin_class_assignments aca ON s.id = aca.session_id
                WHERE aca.admin_id = ?
                ORDER BY s.created_at DESC
            `).all(adminId);
        } else {
            sessions = db.prepare(`
                SELECT id, name, center_lat, center_lon, radius_meters, is_active, end_time, created_at 
                FROM sessions 
                WHERE is_active = 1 AND (end_time IS NULL OR datetime('now') <= datetime(end_time))
                ORDER BY created_at DESC
            `).all();
        }

        return res.json({ success: true, sessions });
    } catch (err) {
        return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
    }
});

app.get('/api/attendance/report', requireAdminAuth, (req, res) => {
    try {
        const sessionId = req.query.session_id;
        if (!sessionId) {
            return res.status(400).json({ error: "MISSING_SESSION_ID", message: "session_id query parameter is required." });
        }

        if (!checkAdminSessionAccess(req.admin.admin_id, sessionId)) {
            return res.status(403).json({ error: "FORBIDDEN", message: "You are not authorized to access reports for this class/session." });
        }

        const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
        if (!session) {
            return res.status(404).json({ error: "SESSION_NOT_FOUND", message: `Session '${sessionId}' not found.` });
        }

        const records = db.prepare(`
            SELECT ar.id, ar.session_id, ar.student_id, s.display_name, s.roll_number, ar.lat, ar.lon, ar.distance_meters, ar.scanned_at 
            FROM attendance_records ar
            LEFT JOIN students s ON ar.student_id = s.id
            WHERE ar.session_id = ?
            ORDER BY ar.scanned_at DESC
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

// ----------------------------------------------------
// TOTP SCAN ENDPOINT
// ----------------------------------------------------

app.post('/api/attendance/scan', requireStudentAuth, scanRateLimiter, (req, res) => {
    try {
        const studentId = req.student.student_id;
        const { token, lat, lon } = req.body;

        if (!token || lat === undefined || lon === undefined) {
            return res.status(400).json({
                error: "MISSING_FIELDS",
                message: "token, lat, and lon are required."
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

        const parts = token.split(':');
        if (parts.length !== 3) {
            return res.status(401).json({
                error: "INVALID_SIGNATURE",
                message: "Token format invalid. Expected <session_id>:<time_step>:<hex_signature>."
            });
        }

        const [sessionId, timeStepStr, hexSignature] = parts;
        const tokenTimeStep = parseInt(timeStepStr, 10);

        if (!sessionId || !timeStepStr || !hexSignature || isNaN(tokenTimeStep)) {
            return res.status(401).json({
                error: "INVALID_SIGNATURE",
                message: "Token payload components malformed."
            });
        }

        const nowSec = Math.floor(Date.now() / 1000);
        const currentStep = getTimeStep(nowSec);
        const prevStep = currentStep - 1;

        if (tokenTimeStep !== currentStep && tokenTimeStep !== prevStep) {
            return res.status(400).json({
                error: "TOKEN_EXPIRED",
                message: `TOTP token expired or invalid step. Token step: ${tokenTimeStep}, Server step: ${currentStep} (Window: [${prevStep}, ${currentStep}]).`
            });
        }

        const payloadToSign = `${sessionId}:${tokenTimeStep}`;
        const expectedSignature = crypto
            .createHmac('sha256', SHARED_SECRET)
            .update(payloadToSign)
            .digest('hex');

        const expectedBuf = Buffer.from(expectedSignature, 'hex');
        const actualBuf = Buffer.from(hexSignature, 'hex');

        if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
            return res.status(401).json({
                error: "INVALID_SIGNATURE",
                message: "HMAC signature mismatch. Token has been tampered with or forged."
            });
        }

        const tokenHash = crypto.createHash('sha256').update(`${sessionId}:${tokenTimeStep}`).digest('hex');
        const existingToken = db.prepare("SELECT token_hash FROM redeemed_tokens WHERE session_id = ? AND time_step = ?").get(sessionId, tokenTimeStep);
        if (existingToken) {
            return res.status(409).json({
                error: "TOKEN_ALREADY_USED",
                message: "This TOTP time-step token has already been scanned and redeemed."
            });
        }

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

        if (session.end_time && new Date(session.end_time).getTime() < Date.now()) {
            return res.status(403).json({
                error: "SESSION_ENDED",
                message: `Session '${sessionId}' has past its end time and is closed.`
            });
        }

        const existingRecord = db.prepare(
            "SELECT id FROM attendance_records WHERE session_id = ? AND student_id = ?"
        ).get(sessionId, studentId);

        if (existingRecord) {
            return res.status(409).json({
                error: "ALREADY_MARKED",
                message: "You have already been marked present for this session."
            });
        }

        const distanceMeters = haversineDistance(studentLat, studentLon, session.center_lat, session.center_lon);
        if (distanceMeters > session.radius_meters) {
            return res.status(403).json({
                error: "OUT_OF_BOUNDS",
                message: `Location out of bounds. You are ${Math.round(distanceMeters)}m away (max allowed radius: ${session.radius_meters}m).`,
                distance_meters: Math.round(distanceMeters * 10) / 10,
                radius_meters: session.radius_meters
            });
        }

        const roundedDistance = Math.round(distanceMeters * 10) / 10;

        const markAttendanceTx = db.transaction(() => {
            db.prepare(`
                INSERT INTO attendance_records (session_id, student_id, lat, lon, distance_meters)
                VALUES (?, ?, ?, ?, ?)
            `).run(sessionId, studentId, studentLat, studentLon, roundedDistance);

            db.prepare(`
                INSERT INTO redeemed_tokens (token_hash, session_id, time_step, student_id)
                VALUES (?, ?, ?, ?)
            `).run(tokenHash, sessionId, tokenTimeStep, studentId);
        });

        markAttendanceTx();

        return res.status(200).json({
            success: true,
            message: `Attendance marked successfully! ${roundedDistance}m from target desk.`,
            session_id: sessionId,
            student_id: studentId,
            distance_meters: roundedDistance
        });

    } catch (err) {
        console.error("Error processing attendance scan:", err);
        return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
    }
});

// Gated DEV Token Generator Endpoint
app.get('/api/token/generate', (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({
            error: "FORBIDDEN",
            message: "Public token generation endpoint is disabled in production."
        });
    }

    const sessionId = req.query.session_id || "SESS_101";
    const offset = parseInt(req.query.offset || "0", 10);
    const token = generateToken(sessionId, SHARED_SECRET, offset);
    return res.json({ token, session_id: sessionId, time_step: getTimeStep() });
});

let serverInstance = null;
function startServer(port = PORT) {
    return new Promise((resolve) => {
        serverInstance = app.listen(port, '0.0.0.0', () => {
            console.log(`🚀 OmniPresence by SANeX Backend Server listening on http://localhost:${port}`);
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
