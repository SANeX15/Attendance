/**
 * OmniPresence by SANeX - Password Reset CLI Utility
 * Usage:
 *   node scripts/reset_password.js admin <username> <new_password>
 *   node scripts/reset_password.js student <username> <new_password>
 *   node scripts/reset_password.js all-students <new_password>
 *   node scripts/reset_password.js all-admins <new_password>
 */

const path = require('path');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'attendance.db');
const db = new Database(dbPath);

const args = process.argv.slice(2);
const type = args[0];
const target = args[1];
const newPassword = args[2];

if (!type) {
    console.log(`
===================================================
 OmniPresence by SANeX - Password Reset Utility
===================================================
Usage:
  node scripts/reset_password.js admin <username> <new_password>
  node scripts/reset_password.js student <username> <new_password>
  node scripts/reset_password.js all-students <new_password>
  node scripts/reset_password.js all-admins <new_password>
    `);
    process.exit(0);
}

try {
    if (type === 'admin') {
        if (!target || !newPassword) {
            console.error("Error: Please provide <username> and <new_password>");
            process.exit(1);
        }
        const hash = bcrypt.hashSync(newPassword, 10);
        const result = db.prepare("UPDATE admins SET password_hash = ? WHERE username = ?").run(hash, target);
        if (result.changes > 0) {
            console.log(`✓ Admin '${target}' password updated successfully!`);
        } else {
            console.error(`✗ Admin '${target}' not found in database.`);
        }

    } else if (type === 'student') {
        if (!target || !newPassword) {
            console.error("Error: Please provide <username> and <new_password>");
            process.exit(1);
        }
        const hash = bcrypt.hashSync(newPassword, 10);
        const result = db.prepare("UPDATE students SET password_hash = ? WHERE username = ?").run(hash, target);
        if (result.changes > 0) {
            console.log(`✓ Student '${target}' password updated successfully!`);
        } else {
            console.error(`✗ Student '${target}' not found in database.`);
        }

    } else if (type === 'all-students') {
        const pass = target; // target argument is password in this case
        if (!pass) {
            console.error("Error: Please provide <new_password>");
            process.exit(1);
        }
        const hash = bcrypt.hashSync(pass, 10);
        const result = db.prepare("UPDATE students SET password_hash = ?").run(hash);
        console.log(`✓ Reset passwords for all ${result.changes} student account(s).`);

    } else if (type === 'all-admins') {
        const pass = target;
        if (!pass) {
            console.error("Error: Please provide <new_password>");
            process.exit(1);
        }
        const hash = bcrypt.hashSync(pass, 10);
        const result = db.prepare("UPDATE admins SET password_hash = ?").run(hash);
        console.log(`✓ Reset passwords for all ${result.changes} admin account(s).`);

    } else {
        console.error("Unknown command type. Options: admin, student, all-students, all-admins");
    }
} catch (err) {
    console.error("Database Error:", err.message);
} finally {
    db.close();
}
