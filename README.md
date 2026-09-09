# High-Security QR Attendance System (Phase 4 & 5)

A dynamic, rotating OLED QR-code based classroom attendance application built with Node.js, Express, SQLite3, HTML5, Geolocation API, and HMAC-SHA256 token verification.

---

## 🔒 Security Architecture & Pipeline

### Token Payload Format
```text
<session_id>:<issued_at_epoch_sec>:<nonce>:<hex_signature>
```
Example: `SESS_101:1725800000:a1b2c3d4:7f8a9b0c...`

### Signature Formula
$$\text{HMAC-SHA256}(\text{session\_id} + ":" + \text{issued\_at} + ":" + \text{nonce},\ \text{SHARED\_SECRET})$$

---

## 🚀 5-Stage Verification Pipeline (`/api/attendance/scan`)

Every scan submission undergoes strict sequential verification:

1. **HMAC Signature Check**: Re-computes the HMAC-SHA256 signature using `SHARED_SECRET`. Returns `401 INVALID_SIGNATURE` if signature mismatch or tampered payload.
2. **Expiration Window**: Verifies $| \text{server\_now} - \text{issued\_at} | \le 25\text{ seconds}$. Returns `400 TOKEN_EXPIRED` if outside window.
3. **Token Replay Prevention**: Hashes token string (`SHA-256`) and checks `redeemed_tokens` table. Returns `409 TOKEN_ALREADY_USED` if token was already redeemed.
4. **Duplicate Student Check**: Verifies student has not already scanned in for the session. Returns `409 ALREADY_MARKED` if found.
5. **Geofence Haversine Check**: Calculates distance between student's GPS location and session center $(lat, lon)$. Returns `403 OUT_OF_BOUNDS` if distance $> \text{radius\_meters}$.
6. **Attendance Recorded**: Records present status in `attendance_records` and saves token hash to `redeemed_tokens`.

---

## 📁 Project Structure

```text
.
├── schema.sql              # Database schema (sessions, redeemed_tokens, attendance_records)
├── server.js              # Express REST API backend & SQLite DB database controller
├── token_generator.js     # Mock ESP32 HMAC generator script
├── test_suite.js          # Automated test runner testing all 5 rejection paths + valid scan
├── package.json           # Dependencies (express, cors, better-sqlite3)
├── public/                # Single-page Web App Frontend
│   ├── index.html         # Responsive dark-theme UI with 3 tabs
│   ├── app.js             # Camera scanner, GPS, API calls, feedback banners, OLED simulator
│   └── styles.css         # Animations & custom styling
└── README.md
```

---

## 🛠️ Installation & Setup

1. Install dependencies:
```bash
npm install
```

2. Start the Backend Server:
```bash
node server.js
```
The server will run on `http://localhost:3000`.

---

## 🧪 Running Automated Verification Tests

Run the comprehensive test suite verifying valid scans and all 5 rejection paths:
```bash
node test_suite.js
```

### Verified Test Cases:
- **Test 1**: Valid scan within geofence ($\to$ HTTP 200 OK + `distance_meters`)
- **Test 2**: Replay attack ($\to$ HTTP 409 `TOKEN_ALREADY_USED`)
- **Test 3**: Tampered HMAC signature ($\to$ HTTP 401 `INVALID_SIGNATURE`)
- **Test 4**: Expired timestamp ($\to$ HTTP 400 `TOKEN_EXPIRED`)
- **Test 5**: Out-of-bounds GPS ($\to$ HTTP 403 `OUT_OF_BOUNDS`)
- **Test 6**: Duplicate student check ($\to$ HTTP 409 `ALREADY_MARKED`)

---

## 🖥️ Mock ESP32 CLI Generator

Generate dynamic HMAC tokens on demand:
```bash
node token_generator.js SESS_101 0
```
- Argument 1: `session_id` (default `SESS_101`)
- Argument 2: `timeOffsetSec` (0 for current time, -30 for expired token)

---

## 📱 Web App Features

1. **Student Scanner View**:
   - Camera scanner powered by `html5-qrcode`
   - Real-time GPS location acquisition with high-accuracy mode (`enableHighAccuracy: true`)
   - Distinct feedback banners for `SUCCESS` and all error rejection states (`INVALID_SIGNATURE`, `TOKEN_EXPIRED`, `TOKEN_ALREADY_USED`, `ALREADY_MARKED`, `OUT_OF_BOUNDS`, `GPS_DISABLED`).
   - Anti-spam rate limiting lockout.

2. **Virtual OLED QR Simulator (ESP32)**:
   - Simulates physical $128 \times 64$ Yellow/Blue OLED display.
   - Rotates HMAC QR code every 10 seconds.
   - Displays raw payload breakdown (Session ID, Issued At, Nonce, HMAC-SHA256 signature).
   - "Direct Scan" button for browser testing without hardware.

3. **Admin Dashboard & Attendance Reports**:
   - Create classroom sessions with custom GPS center and radius.
   - Live audit report table showing verified present students, distance from desk, and timestamps.
