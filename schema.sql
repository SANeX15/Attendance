-- High-Security QR Attendance System Schema (TOTP + Auth + Multi-tenant Admin)
-- SQLite3

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    center_lat REAL NOT NULL,
    center_lon REAL NOT NULL,
    radius_meters REAL DEFAULT 40.0,
    is_active INTEGER DEFAULT 1,
    end_time DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    roll_number TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_class_assignments (
    admin_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    PRIMARY KEY (admin_id, session_id),
    FOREIGN KEY(admin_id) REFERENCES admins(id) ON DELETE CASCADE,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS redeemed_tokens (
    token_hash TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    time_step INTEGER NOT NULL,
    student_id TEXT NOT NULL,
    redeemed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS attendance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    distance_meters REAL NOT NULL,
    scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(session_id, student_id),
    FOREIGN KEY(session_id) REFERENCES sessions(id),
    FOREIGN KEY(student_id) REFERENCES students(id)
);
