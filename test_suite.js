const http = require('http');
const { generateToken, SHARED_SECRET } = require('./token_generator');

const PORT = 3009;
process.env.PORT = PORT;

// Import server after setting PORT
const { app, startServer, stopServer, db } = require('./server');

// Color helpers for stdout
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

function makeApiRequest(method, path, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = http.request({
            hostname: 'localhost',
            port: PORT,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, body: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });

        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

async function runTestSuite() {
    console.log(`${colors.bold}${colors.cyan}Starting Automated Verification Test Suite...${colors.reset}`);
    await startServer(PORT);

    // Wipe test tables to ensure clean, reproducible test runs
    db.prepare("DELETE FROM attendance_records").run();
    db.prepare("DELETE FROM redeemed_tokens").run();

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
        } catch (err) {
            console.log(`  ${colors.red}✗ ERROR${colors.reset}: ${err.message}`);
        }
    }

    logHeader("TEST 1: VALID SCAN");
    const validToken1 = generateToken("SESS_101", SHARED_SECRET, 0);
    await assertTest("Submit valid fresh token within geofence", 200, null, () => 
        makeApiRequest('POST', '/api/attendance/scan', {
            student_id: "STU_1001",
            token: validToken1,
            lat: 37.774929,
            lon: -122.419416
        })
    );

    logHeader("TEST 2: REPLAY ATTACK");
    await assertTest("Re-submit the exact same token again", 409, "TOKEN_ALREADY_USED", () => 
        makeApiRequest('POST', '/api/attendance/scan', {
            student_id: "STU_1002",
            token: validToken1, // Same token string
            lat: 37.774929,
            lon: -122.419416
        })
    );

    logHeader("TEST 3: TAMPERED HMAC SIGNATURE");
    const freshTokenForTamper = generateToken("SESS_101", SHARED_SECRET, 0);
    const tokenParts = freshTokenForTamper.split(':');
    // Mutate signature
    const tamperedSig = tokenParts[3].substring(0, tokenParts[3].length - 2) + "00";
    const tamperedToken = `${tokenParts[0]}:${tokenParts[1]}:${tokenParts[2]}:${tamperedSig}`;

    await assertTest("Submit token with modified signature bytes", 401, "INVALID_SIGNATURE", () => 
        makeApiRequest('POST', '/api/attendance/scan', {
            student_id: "STU_1003",
            token: tamperedToken,
            lat: 37.774929,
            lon: -122.419416
        })
    );

    logHeader("TEST 4: EXPIRED TIMESTAMP");
    // Generate token issued 30 seconds ago (window is 25s)
    const expiredToken = generateToken("SESS_101", SHARED_SECRET, -30);
    await assertTest("Submit token older than 25 seconds window", 400, "TOKEN_EXPIRED", () => 
        makeApiRequest('POST', '/api/attendance/scan', {
            student_id: "STU_1004",
            token: expiredToken,
            lat: 37.774929,
            lon: -122.419416
        })
    );

    logHeader("TEST 5: OUT-OF-BOUNDS GPS");
    const validToken2 = generateToken("SESS_101", SHARED_SECRET, 0);
    // Submit coordinates ~3km away (center is 37.774929, -122.419416)
    await assertTest("Submit location outside 40m geofence radius", 403, "OUT_OF_BOUNDS", () => 
        makeApiRequest('POST', '/api/attendance/scan', {
            student_id: "STU_1005",
            token: validToken2,
            lat: 37.800000,
            lon: -122.400000
        })
    );

    logHeader("TEST 6: DUPLICATE STUDENT CHECK");
    const validToken3 = generateToken("SESS_101", SHARED_SECRET, 0);
    await assertTest("Same student (STU_1001) attempting second scan in same session", 409, "ALREADY_MARKED", () => 
        makeApiRequest('POST', '/api/attendance/scan', {
            student_id: "STU_1001", // already scanned in Test 1
            token: validToken3,
            lat: 37.774929,
            lon: -122.419416
        })
    );

    logHeader("SUMMARY REPORT");
    console.log(`Results: ${passedTests}/${totalTests} tests passed.`);

    await stopServer();

    if (passedTests === totalTests) {
        console.log(`${colors.green}${colors.bold}🎉 ALL REJECTION AND VALIDATION PATHS PASSED SUCCESSFULLY!${colors.reset}\n`);
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
