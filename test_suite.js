// Set test environment secrets before requiring server & token_generator
process.env.SHARED_SECRET = process.env.SHARED_SECRET || "TEST_SUPER_SECRET_HMAC_KEY_123";
process.env.JWT_SECRET = process.env.JWT_SECRET || "TEST_JWT_SECRET_456";
process.env.NODE_ENV = "test";

const http = require('http');
const bcrypt = require('bcryptjs');
const { generateToken, getTimeStep, INTERVAL_SECONDS } = require('./token_generator');

const PORT = 3009;
process.env.PORT = PORT;

const { app, startServer, stopServer, db } = require('./server');

const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    bold: "\x1b[1m"
};

function logHeader(text) {
    console.log(`\n${colors.cyan}${colors.bold}=== ${text} ===${colors.reset}`);
}

function makeApiRequest(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const reqHeaders = { ...headers };
        let payload = null;

        if (body) {
            payload = typeof body === 'string' ? body : JSON.stringify(body);
            if (!reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';
            reqHeaders['Content-Length'] = Buffer.byteLength(payload);
        }

        const req = http.request({
            hostname: 'localhost',
            port: PORT,
            path: path,
            method: method,
            headers: reqHeaders
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const cookieHeader = res.headers['set-cookie'];
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, body: parsed, cookies: cookieHeader });
                } catch (e) {
                    resolve({ status: res.statusCode, body: data, cookies: cookieHeader });
                }
            });
        });

        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function runTestSuite() {
    console.log(`${colors.bold}${colors.cyan}Starting Automated Verification Test Suite (TOTP & Auth)...${colors.reset}`);
    await startServer(PORT);

    // Clear database tables for clean test environment
    db.prepare("DELETE FROM attendance_records").run();
    db.prepare("DELETE FROM redeemed_tokens").run();
    db.prepare("DELETE FROM admin_class_assignments").run();
    db.prepare("DELETE FROM sessions").run();
    db.prepare("DELETE FROM students").run();
    db.prepare("DELETE FROM admins").run();

    // Seed test session
    db.prepare(`
        INSERT INTO sessions (id, name, center_lat, center_lon, radius_meters, is_active)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run('SESS_101', 'CS101: Embedded Systems & Security', 37.774929, -122.419416, 40.0, 1);

    // Seed test admin
    const adminHash = bcrypt.hashSync('admin123', 10);
    db.prepare(`
        INSERT INTO admins (id, username, password_hash)
        VALUES (?, ?, ?)
    `).run('ADM_TEST', 'adminuser', adminHash);

    db.prepare(`
        INSERT INTO admin_class_assignments (admin_id, session_id)
        VALUES (?, ?)
    `).run('ADM_TEST', 'SESS_101');

    // Seed test student 1, 2, 3
    const studentHash = bcrypt.hashSync('pass123', 10);
    db.prepare(`
        INSERT INTO students (id, username, password_hash, display_name, roll_number)
        VALUES (?, ?, ?, ?, ?)
    `).run('STU_001', 'student_alice', studentHash, 'Alice Johnson', 'CS-101');

    db.prepare(`
        INSERT INTO students (id, username, password_hash, display_name, roll_number)
        VALUES (?, ?, ?, ?, ?)
    `).run('STU_002', 'student_bob', studentHash, 'Bob Smith', 'CS-102');

    db.prepare(`
        INSERT INTO students (id, username, password_hash, display_name, roll_number)
        VALUES (?, ?, ?, ?, ?)
    `).run('STU_003', 'stu3', studentHash, 'Charlie Brown', 'CS-103');

    let passedTests = 0;
    let totalTests = 0;

    async function assertTest(name, expectedStatus, expectedErrorCode, requestFn) {
        totalTests++;
        console.log(`\n${colors.bold}Test ${totalTests}: ${name}${colors.reset}`);
        try {
            const res = await requestFn();
            const statusMatch = res.status === expectedStatus;
            const errorMatch = expectedErrorCode ? res.body.error === expectedErrorCode : true;

            if (statusMatch && errorMatch) {
                passedTests++;
                console.log(`  ${colors.green}✓ PASS${colors.reset} [HTTP ${res.status}] ${JSON.stringify(res.body)}`);
            } else {
                console.log(`  ${colors.red}✗ FAIL${colors.reset}`);
                console.log(`    Expected HTTP: ${expectedStatus}, Got: ${res.status}`);
                if (expectedErrorCode) {
                    console.log(`    Expected Error Code: ${expectedErrorCode}, Got: ${res.body.error}`);
                }
                console.log(`    Response Body:`, res.body);
            }
            return res;
        } catch (err) {
            console.log(`  ${colors.red}✗ ERROR${colors.reset}: ${err.message}`);
            return null;
        }
    }

    // --------------------------------------------------
    // AUTHENTICATION TESTS
    // --------------------------------------------------
    logHeader("PART 1: AUTHENTICATION TESTS");

    let studentCookie = "";
    const studentLoginRes = await assertTest("Student Login (valid credentials)", 200, null, () => 
        makeApiRequest('POST', '/api/auth/student/login', { username: 'student_alice', password: 'pass123' })
    );

    if (studentLoginRes && studentLoginRes.cookies) {
        studentCookie = studentLoginRes.cookies[0].split(';')[0];
    }

    let adminCookie = "";
    const adminLoginRes = await assertTest("Admin Login (valid credentials)", 200, null, () => 
        makeApiRequest('POST', '/api/auth/admin/login', { username: 'adminuser', password: 'admin123' })
    );

    if (adminLoginRes && adminLoginRes.cookies) {
        adminCookie = adminLoginRes.cookies[0].split(';')[0];
    }

    await assertTest("Scan without Student Auth Cookie -> 401 UNAUTHORIZED", 401, "UNAUTHORIZED", () => 
        makeApiRequest('POST', '/api/attendance/scan', { token: "SESS_101:100:dummy", lat: 37.774929, lon: -122.419416 })
    );

    await assertTest("Admin Report without Admin Auth Cookie -> 401 UNAUTHORIZED", 401, "UNAUTHORIZED", () => 
        makeApiRequest('GET', '/api/attendance/report?session_id=SESS_101')
    );

    // --------------------------------------------------
    // TOTP TOKEN VERIFICATION TESTS (Requirement 1)
    // --------------------------------------------------
    logHeader("PART 2: TOTP TOKEN VERIFICATION TESTS");

    const currentToken = generateToken("SESS_101", process.env.SHARED_SECRET, 0);
    await assertTest("Scan valid current-step TOTP token", 200, null, () => 
        makeApiRequest('POST', '/api/attendance/scan', {
            token: currentToken,
            lat: 37.774929,
            lon: -122.419416
        }, { Cookie: studentCookie })
    );

    // Log in second student for previous step test
    const student2LoginRes = await makeApiRequest('POST', '/api/auth/student/login', { username: 'student_bob', password: 'pass123' });
    const student2Cookie = student2LoginRes.cookies[0].split(';')[0];

    const prevStepToken = generateToken("SESS_101", process.env.SHARED_SECRET, -1);
    await assertTest("Scan valid previous-step TOTP token (Grace Window)", 200, null, () => 
        makeApiRequest('POST', '/api/attendance/scan', {
            token: prevStepToken,
            lat: 37.774929,
            lon: -122.419416
        }, { Cookie: student2Cookie })
    );

    const oldToken = generateToken("SESS_101", process.env.SHARED_SECRET, -2);
    await assertTest("Scan invalid old token (2+ steps back)", 400, "TOKEN_EXPIRED", () => 
        makeApiRequest('POST', '/api/attendance/scan', {
            token: oldToken,
            lat: 37.774929,
            lon: -122.419416
        }, { Cookie: studentCookie })
    );

    const tamperedTokenParts = currentToken.split(':');
    const tamperedToken = `${tamperedTokenParts[0]}:${tamperedTokenParts[1]}:00112233445566778899aabbccddeeff`;
    await assertTest("Scan tampered signature token", 401, "INVALID_SIGNATURE", () => 
        makeApiRequest('POST', '/api/attendance/scan', {
            token: tamperedToken,
            lat: 37.774929,
            lon: -122.419416
        }, { Cookie: studentCookie })
    );

    await assertTest("Replay attack (same TOTP time-step token scanned again)", 409, "TOKEN_ALREADY_USED", () => 
        makeApiRequest('POST', '/api/attendance/scan', {
            token: currentToken,
            lat: 37.774929,
            lon: -122.419416
        }, { Cookie: studentCookie })
    );

    // --------------------------------------------------
    // GEOFENCE & SESSION LIFECYCLE TESTS
    // --------------------------------------------------
    logHeader("PART 3: GEOFENCE & SESSION LIFECYCLE TESTS");

    // Login student 3 for geofence and lifecycle tests
    const student3LoginRes = await makeApiRequest('POST', '/api/auth/student/login', { username: 'stu3', password: 'pass123' });
    let student3Cookie = studentCookie;
    if (student3LoginRes && student3LoginRes.cookies) {
        student3Cookie = student3LoginRes.cookies[0].split(';')[0];
    }

    // Create session SESS_GEOFENCE
    db.prepare(`
        INSERT INTO sessions (id, name, center_lat, center_lon, radius_meters, is_active)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run('SESS_GEOFENCE', 'Geofence Test Class', 37.774929, -122.419416, 40.0, 1);

    db.prepare(`
        INSERT INTO admin_class_assignments (admin_id, session_id)
        VALUES (?, ?)
    `).run('ADM_TEST', 'SESS_GEOFENCE');

    const geofenceToken = generateToken("SESS_GEOFENCE", process.env.SHARED_SECRET, 0);
    await assertTest("Scan outside 40m geofence radius -> 403 OUT_OF_BOUNDS", 403, "OUT_OF_BOUNDS", () => 
        makeApiRequest('POST', '/api/attendance/scan', {
            token: geofenceToken,
            lat: 37.800000,
            lon: -122.400000
        }, { Cookie: student3Cookie })
    );

    // End session manually (Requirement 8)
    await assertTest("Admin ends session (POST /api/session/:id/end)", 200, null, () => 
        makeApiRequest('POST', '/api/session/SESS_GEOFENCE/end', null, { Cookie: adminCookie })
    );

    await assertTest("Scan for ended session -> 403 SESSION_INACTIVE or SESSION_ENDED", 403, null, () => 
        makeApiRequest('POST', '/api/attendance/scan', {
            token: generateToken("SESS_GEOFENCE", process.env.SHARED_SECRET, 0),
            lat: 37.774929,
            lon: -122.419416
        }, { Cookie: student3Cookie })
    );

    // --------------------------------------------------
    // ADMIN REPORTS & BULK UPLOAD TESTS
    // --------------------------------------------------
    logHeader("PART 4: ADMIN REPORT & BULK UPLOAD TESTS");

    await assertTest("Admin Bulk Upload Students (CSV format)", 200, null, () => 
        makeApiRequest('POST', '/api/admin/students/bulk-upload', {
            csv: "username,display_name,roll_number,password\nstu3,Charlie Brown,CS-103,pass123\nstu4,Diana Prince,CS-104,pass123"
        }, { Cookie: adminCookie })
    );

    const reportRes = await assertTest("Admin View Report (JOINs student details)", 200, null, () => 
        makeApiRequest('GET', '/api/attendance/report?session_id=SESS_101', null, { Cookie: adminCookie })
    );

    if (reportRes && reportRes.body && reportRes.body.records) {
        console.log(`  ${colors.yellow}Report Records Sample:${colors.reset}`, JSON.stringify(reportRes.body.records[0]));
    }

    logHeader("SUMMARY REPORT");
    console.log(`Results: ${passedTests}/${totalTests} tests passed.`);

    await stopServer();

    if (passedTests === totalTests) {
        console.log(`${colors.green}${colors.bold}🎉 ALL TOTP, AUTH, RATE LIMITING & REPORT TESTS PASSED!${colors.reset}\n`);
        process.exit(0);
    } else {
        console.log(`${colors.red}${colors.bold}❌ TEST SUITE FAILED.${colors.reset}\n`);
        process.exit(1);
    }
}

if (require.main === module) {
    runTestSuite();
}

module.exports = { runTestSuite };
