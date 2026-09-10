# OmniPresence by SANeX

A high-security, time-based dynamic TOTP QR code classroom attendance system featuring TOTP 15-second rotation, server-side bcrypt account authentication, mandatory high-accuracy GPS geofencing, and class-scoped admin management.

---

## 🔒 System Architecture & TOTP Formula

### TOTP Token Formula
$$\text{time\_step} = \left\lfloor \frac{\text{unix\_time\_sec}}{15} \right\rfloor$$
$$\text{payload} = \text{session\_id} + ":" + \text{time\_step}$$
$$\text{hex\_signature} = \text{HMAC-SHA256}(\text{SHARED\_SECRET},\ \text{payload})$$

### QR Token Payload String
```text
<session_id>:<time_step>:<hex_signature>
```
Example: `SESS_101:119265280:7f8a9b0c...`

---

## 🚀 5-Stage Verification Pipeline (`POST /api/attendance/scan`)

Every scan request is executed against a strict 5-stage verification pipeline:

1. **TOTP Signature & Grace Window Verification**:
   Validates signature against current time-step (`current_step`) AND previous time-step (`current_step - 1`) to tolerate network latency or clock drift. Returns `401 INVALID_SIGNATURE` or `400 TOKEN_EXPIRED` if invalid.
2. **Replay Attack Protection**:
   Stores redeemed `(session_id, time_step)` in SQLite database (`redeemed_tokens`). Prevents any time-step QR code from being redeemed twice by anyone. Returns `409 TOKEN_ALREADY_USED` if found.
3. **Session Lifecycle & Active Check**:
   Verifies `session.is_active === 1` and `datetime('now') <= end_time`. Returns `403 SESSION_INACTIVE` or `403 SESSION_ENDED` if closed.
4. **Duplicate Student Check**:
   Ensures student has not already been marked present for the session. Returns `409 ALREADY_MARKED` if found.
5. **Mandatory Geofence Haversine Check**:
   Calculates physical distance between student's verified GPS position and classroom center $(lat, lon)$. Returns `403 OUT_OF_BOUNDS` if distance $> \text{radius\_meters}$.

---

## 🔑 Password Reset Options (Admin & Student)

### 1. Admin Dashboard Action
Logged-in administrators can view the full class roster under **Admin Portal $\to$ Roster & Password Reset** and click **Reset Password** next to any student to update credentials immediately.

### 2. Command-Line CLI Reset Tool (`scripts/reset_password.js`)
Reset any account directly from the server CLI:
```bash
# Reset specific admin password
node scripts/reset_password.js admin adminuser newpassword123

# Reset specific student password
node scripts/reset_password.js student student1 newpassword123

# Emergency reset for ALL student accounts
node scripts/reset_password.js all-students defaultpass123
```

---

## 📁 Repository Structure

```text
.
├── schema.sql                   # Database schema (sessions, students, admins, assignments, tokens, records)
├── server.js                   # Express REST API backend with JWT cookies & rate limiting
├── token_generator.js          # TOTP 15s QR generator module & CLI tool
├── test_suite.js               # Automated test runner testing all 14 test paths
├── scripts/
│   └── reset_password.js      # CLI utility for resetting admin/student passwords
├── public/                     # Sharp Monochrome Single-Page Web App
│   ├── index.html              # Multi-subview portal layout with location modal & admin roster
│   ├── app.js                  # Sub-navigation, camera scanner, GPS modal, OLED simulator
│   └── styles.css              # Sharp-corner ($90^\circ$) monochrome styling
└── README.md
```

---

## 🛠️ Environment Setup & Execution

1. Copy `.env.example` to `.env` and set `SHARED_SECRET`:
```bash
cp .env.example .env
```

2. Install dependencies:
```bash
npm install
```

3. Run automated verification tests:
```bash
node test_suite.js
```

4. Start production/dev server:
```bash
node server.js
```
The server will run on `http://localhost:3000`.

---

## 🎨 UI Features

- **OmniPresence by SANeX Branding**: High-impact monochrome design system with sharp 0px border-radius corners for all interactive elements.
- **Mandatory Location Permission Modal**: Full-screen blocking modal enforcing high-accuracy GPS permissions before camera activation.
- **Isolated Sub-Views**: Clean separation between Student Scanner/History, Admin Sessions/Roster/Reports, and Virtual OLED Simulator.
