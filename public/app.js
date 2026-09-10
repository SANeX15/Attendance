// OmniPresence by SANeX - Application Logic
let html5QrcodeScanner = null;
let isScannerActive = false;
let isScanLocked = false;
let currentPosition = null;
let isGpsPermissionGranted = false;

let oledTimerInterval = null;
let oledTokenRotationTimer = null;
let oledCountdownSeconds = 15;
let currentOledToken = "";

let currentStudent = null;
let currentAdmin = null;

// Initialize on DOM Load
document.addEventListener('DOMContentLoaded', () => {
    checkStudentAuth();
    loadSessionsDropdowns();
    startOledSimulator();
});

// =======================================================
// PORTAL & SUB-TAB NAVIGATION
// =======================================================
function switchTab(tabId) {
    document.querySelectorAll('.tab-section').forEach(sec => sec.classList.add('hidden'));
    document.querySelectorAll('.tab-btn, header nav button').forEach(btn => {
        btn.classList.remove('text-black', 'bg-zinc-100', 'font-bold');
        btn.classList.add('text-zinc-400');
    });

    const activeSec = document.getElementById(`tab-${tabId}`);
    if (activeSec) activeSec.classList.remove('hidden');

    const activeBtn = document.getElementById(`tab-${tabId}-btn`);
    if (activeBtn) {
        activeBtn.classList.remove('text-zinc-400');
        activeBtn.classList.add('text-black', 'bg-zinc-100', 'font-bold');
    }

    if (tabId === 'admin') {
        checkAdminAuth();
    }
}

function switchStudentSubTab(subId) {
    document.querySelectorAll('.student-sub-section').forEach(sec => sec.classList.add('hidden'));
    document.querySelectorAll('#student-auth-view nav button, #student-auth-view .flex button').forEach(btn => {
        if (btn.id && btn.id.startsWith('student-sub-')) {
            btn.classList.remove('bg-zinc-100', 'text-black', 'font-bold');
            btn.classList.add('bg-black', 'text-zinc-400');
        }
    });

    const activeSec = document.getElementById(`student-sub-${subId}`);
    if (activeSec) activeSec.classList.remove('hidden');

    const activeBtn = document.getElementById(`student-sub-${subId}-btn`);
    if (activeBtn) {
        activeBtn.classList.remove('bg-black', 'text-zinc-400');
        activeBtn.classList.add('bg-zinc-100', 'text-black', 'font-bold');
    }

    if (subId === 'history') {
        loadStudentAttendanceHistory();
    }
}

function switchAdminSubTab(subId) {
    document.querySelectorAll('.admin-sub-section').forEach(sec => sec.classList.add('hidden'));
    document.querySelectorAll('#admin-auth-view nav button, #admin-auth-view .flex button').forEach(btn => {
        if (btn.id && btn.id.startsWith('admin-sub-')) {
            btn.classList.remove('bg-zinc-100', 'text-black', 'font-bold');
            btn.classList.add('bg-black', 'text-zinc-400');
        }
    });

    const activeSec = document.getElementById(`admin-sub-${subId}`);
    if (activeSec) activeSec.classList.remove('hidden');

    const activeBtn = document.getElementById(`admin-sub-${subId}-btn`);
    if (activeBtn) {
        activeBtn.classList.remove('bg-black', 'text-zinc-400');
        activeBtn.classList.add('bg-zinc-100', 'text-black', 'font-bold');
    }

    if (subId === 'roster') {
        loadAdminRoster();
    } else if (subId === 'reports') {
        loadAttendanceReport();
    }
}

// =======================================================
// AUTHENTICATION LOGIC (STUDENT & ADMIN)
// =======================================================
async function checkStudentAuth() {
    try {
        const res = await fetch('/api/auth/student/me');
        const data = await res.json();

        const loginCard = document.getElementById('student-login-card');
        const authView = document.getElementById('student-auth-view');

        if (res.ok && data.success && data.student) {
            currentStudent = data.student;
            if (loginCard) loginCard.classList.add('hidden');
            if (authView) authView.classList.remove('hidden');

            const badge = document.getElementById('student-profile-badge');
            if (badge) badge.innerText = `Student: ${data.student.display_name} (${data.student.roll_number})`;
        } else {
            currentStudent = null;
            if (loginCard) loginCard.classList.remove('hidden');
            if (authView) authView.classList.add('hidden');
        }
    } catch (e) {
        console.error("Student auth check failed:", e);
    }
}

async function handleStudentLogin(event) {
    event.preventDefault();
    const username = document.getElementById('student-username-input').value.trim();
    const password = document.getElementById('student-password-input').value;

    try {
        const res = await fetch('/api/auth/student/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (res.ok && data.success) {
            showToast("Student Login Successful!", "success");
            checkStudentAuth();
            loadSessionsDropdowns();
        } else {
            showToast(data.message || "Invalid student credentials", "error");
        }
    } catch (err) {
        showToast(`Login Error: ${err.message}`, "error");
    }
}

async function handleStudentLogout() {
    await fetch('/api/auth/student/logout', { method: 'POST' });
    showToast("Logged out.", "info");
    checkStudentAuth();
}

async function checkAdminAuth() {
    try {
        const res = await fetch('/api/auth/admin/me');
        const data = await res.json();

        const loginCard = document.getElementById('admin-login-card');
        const authView = document.getElementById('admin-auth-view');

        if (res.ok && data.success && data.admin) {
            currentAdmin = data.admin;
            if (loginCard) loginCard.classList.add('hidden');
            if (authView) authView.classList.remove('hidden');

            const badge = document.getElementById('admin-profile-badge');
            if (badge) badge.innerText = `Admin: ${data.admin.username}`;

            loadSessionsDropdowns();
            loadAdminSessionsList();
            loadAttendanceReport();
        } else {
            currentAdmin = null;
            if (loginCard) loginCard.classList.remove('hidden');
            if (authView) authView.classList.add('hidden');
        }
    } catch (e) {
        console.error("Admin auth check failed:", e);
    }
}

async function handleAdminLogin(event) {
    event.preventDefault();
    const username = document.getElementById('admin-username-input').value.trim();
    const password = document.getElementById('admin-password-input').value;

    try {
        const res = await fetch('/api/auth/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (res.ok && data.success) {
            showToast("Admin Login Successful!", "success");
            checkAdminAuth();
        } else {
            showToast(data.message || "Invalid admin credentials", "error");
        }
    } catch (err) {
        showToast(`Admin Login Error: ${err.message}`, "error");
    }
}

async function handleAdminLogout() {
    await fetch('/api/auth/admin/logout', { method: 'POST' });
    showToast("Admin logged out.", "info");
    checkAdminAuth();
}

// =======================================================
// MANDATORY LOCATION PERMISSION MODAL & GPS (Question 4)
// =======================================================
function openLocationModalOrStart() {
    if (isGpsPermissionGranted && currentPosition) {
        startCameraScanner();
    } else {
        const modal = document.getElementById('location-permission-modal');
        if (modal) modal.classList.remove('hidden');
    }
}

function closeLocationModal() {
    const modal = document.getElementById('location-permission-modal');
    if (modal) modal.classList.add('hidden');
    showToast("Location permission denied. Attendance scanner is locked.", "error");
}

function requestMandatoryLocationPermission() {
    const coordsEl = document.getElementById('gps-coords-display');
    const accEl = document.getElementById('gps-accuracy-display');
    const badge = document.getElementById('gps-status-badge');

    if (!navigator.geolocation) {
        alert("Geolocation API is not supported by your browser.");
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            currentPosition = pos.coords;
            isGpsPermissionGranted = true;
            closeLocationModal();

            if (coordsEl) coordsEl.innerText = `Lat: ${pos.coords.latitude.toFixed(6)}, Lon: ${pos.coords.longitude.toFixed(6)}`;
            if (accEl) accEl.innerText = `Accuracy: ±${Math.round(pos.coords.accuracy)}m (Verified)`;
            if (badge) {
                badge.innerText = "GPS VERIFIED";
                badge.className = "px-2.5 py-1 text-xs font-mono border border-emerald-600 bg-emerald-950 text-emerald-300";
            }

            showToast("GPS Location Verified! Activating Scanner...", "success");
            startCameraScanner();
        },
        (err) => {
            isGpsPermissionGranted = false;
            if (coordsEl) coordsEl.innerText = `GPS Error: ${err.message}`;
            if (accEl) accEl.innerText = "Permission Denied / Timed Out";
            if (badge) {
                badge.innerText = "DENIED";
                badge.className = "px-2.5 py-1 text-xs font-mono border border-rose-800 bg-rose-950 text-rose-300";
            }
            alert(`Location Permission Required: ${err.message}. You cannot scan QR attendance without location verification.`);
        },
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
    );
}

// =======================================================
// CAMERA QR SCANNER & ATTENDANCE PIPELINE
// =======================================================
function startCameraScanner() {
    const placeholder = document.getElementById('scanner-placeholder');
    const startBtn = document.getElementById('start-scan-btn');
    const stopBtn = document.getElementById('stop-scan-btn');

    if (placeholder) placeholder.classList.add('hidden');
    if (startBtn) startBtn.classList.add('hidden');
    if (stopBtn) stopBtn.classList.remove('hidden');

    if (!html5QrcodeScanner) {
        html5QrcodeScanner = new Html5Qrcode("reader");
    }

    const config = { fps: 10, qrbox: { width: 250, height: 250 } };

    html5QrcodeScanner.start(
        { facingMode: "environment" },
        config,
        onQrCodeScanned,
        () => {}
    ).catch(err => {
        console.error("Camera start failed:", err);
        stopCameraScanner();
        renderFeedbackBanner({
            error: "CAMERA_ERROR",
            message: "Unable to access camera. Please verify device permissions."
        });
    });

    isScannerActive = true;
}

function stopCameraScanner() {
    if (html5QrcodeScanner && isScannerActive) {
        html5QrcodeScanner.stop().then(() => {
            isScannerActive = false;
            resetScannerUi();
        }).catch(() => resetScannerUi());
    } else {
        resetScannerUi();
    }
}

function resetScannerUi() {
    const placeholder = document.getElementById('scanner-placeholder');
    const startBtn = document.getElementById('start-scan-btn');
    const stopBtn = document.getElementById('stop-scan-btn');

    if (placeholder) placeholder.classList.remove('hidden');
    if (startBtn) startBtn.classList.remove('hidden');
    if (stopBtn) stopBtn.classList.add('hidden');
}

async function onQrCodeScanned(decodedText) {
    if (isScanLocked) return;
    
    isScanLocked = true;
    showProcessingOverlay("Verifying GPS & TOTP Payload...");

    if (html5QrcodeScanner && isScannerActive) {
        try { html5QrcodeScanner.pause(); } catch(e) {}
    }

    // Refresh GPS coordinates at exact scan moment
    let lat = currentPosition ? currentPosition.latitude : null;
    let lon = currentPosition ? currentPosition.longitude : null;

    try {
        const freshPos = await getCurrentGpsPromise(4000);
        lat = freshPos.coords.latitude;
        lon = freshPos.coords.longitude;
        currentPosition = freshPos.coords;
    } catch (e) {}

    if (!lat || !lon) {
        hideProcessingOverlay();
        renderFeedbackBanner({
            error: "GPS_DISABLED",
            message: "Location permissions required. Please verify GPS access."
        });
        unlockScannerWithDelay();
        return;
    }

    await processAttendancePayload(decodedText, lat, lon);
    hideProcessingOverlay();
    unlockScannerWithDelay();
}

function getCurrentGpsPromise(timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error("Geolocation API unavailable"));
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 });
    });
}

async function processAttendancePayload(token, lat, lon) {
    try {
        const response = await fetch('/api/attendance/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, lat, lon })
        });

        const data = await response.json();
        
        if (response.ok && data.success) {
            renderFeedbackBanner({
                isSuccess: true,
                message: data.message,
                distance: data.distance_meters,
                sessionId: data.session_id,
                studentId: data.student_id
            });
        } else {
            renderFeedbackBanner(data);
        }
    } catch (err) {
        renderFeedbackBanner({
            error: "NETWORK_ERROR",
            message: `Server Connection Failed: ${err.message}`
        });
    }
}

function unlockScannerWithDelay() {
    setTimeout(() => {
        isScanLocked = false;
        if (html5QrcodeScanner && isScannerActive) {
            try { html5QrcodeScanner.resume(); } catch(e) {}
        }
    }, 3000);
}

function showProcessingOverlay(text) {
    const overlay = document.getElementById('processing-overlay');
    const textEl = document.getElementById('processing-status-text');
    if (overlay) overlay.classList.remove('hidden');
    if (textEl) textEl.innerText = text;
}

function hideProcessingOverlay() {
    const overlay = document.getElementById('processing-overlay');
    if (overlay) overlay.classList.add('hidden');
}

// =======================================================
// FEEDBACK BANNER DISPLAY (MONOCHROME HIGH CONTRAST)
// =======================================================
function renderFeedbackBanner(data) {
    const banner = document.getElementById('feedback-banner');
    if (!banner) return;

    banner.classList.remove('hidden');
    banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    if (data.isSuccess) {
        banner.innerHTML = `
            <div class="bg-black border-2 border-white p-6 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-4 font-mono">
                <div class="space-y-1">
                    <div class="flex items-center gap-2">
                        <span class="px-2 py-0.5 bg-white text-black font-bold text-xs">200 SUCCESS</span>
                        <h3 class="text-base font-bold text-white uppercase tracking-wider">Attendance Marked Present</h3>
                    </div>
                    <p class="text-xs text-zinc-300">${data.message}</p>
                </div>
                <div class="bg-zinc-900 border border-zinc-700 px-4 py-2 text-center">
                    <span class="block text-[10px] uppercase text-zinc-400">Distance</span>
                    <span class="text-base font-bold text-white">${data.distance}m</span>
                </div>
            </div>
        `;
        return;
    }

    const errorCode = data.error || "REJECTED";
    banner.innerHTML = `
        <div class="bg-black border-2 border-zinc-600 p-6 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-4 font-mono">
            <div class="space-y-1">
                <div class="flex items-center gap-2">
                    <span class="px-2 py-0.5 bg-zinc-800 text-white font-bold text-xs border border-zinc-600">${errorCode}</span>
                    <h3 class="text-base font-bold text-white uppercase tracking-wider">Scan Verification Failed</h3>
                </div>
                <p class="text-xs text-zinc-400">${data.message}</p>
            </div>
            <button onclick="document.getElementById('feedback-banner').classList.add('hidden')" class="px-4 py-2 btn-mono-outline text-xs uppercase">
                Dismiss
            </button>
        </div>
    `;
}

// =======================================================
// STUDENT ATTENDANCE HISTORY
// =======================================================
async function loadStudentAttendanceHistory() {
    const tbody = document.getElementById('student-history-tbody');
    if (!tbody) return;

    try {
        const res = await fetch('/api/student/history');
        const data = await res.json();

        if (res.ok && data.success) {
            if (data.records.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-zinc-500 italic">No attendance records found.</td></tr>`;
                return;
            }

            let rows = "";
            data.records.forEach((r, idx) => {
                const dateStr = new Date(r.scanned_at).toLocaleString();
                rows += `
                    <tr class="hover:bg-zinc-900">
                        <td class="p-3 text-zinc-500">${idx + 1}</td>
                        <td class="p-3 font-bold text-white">${r.session_name} (${r.session_id})</td>
                        <td class="p-3 text-zinc-300">${r.distance_meters}m</td>
                        <td class="p-3 text-zinc-400">${dateStr}</td>
                    </tr>
                `;
            });
            tbody.innerHTML = rows;
        } else {
            tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-rose-400">${data.message}</td></tr>`;
        }
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-rose-400">Failed to load history.</td></tr>`;
    }
}

// =======================================================
// OLED SIMULATOR (15s STEP)
// =======================================================
function startOledSimulator() {
    fetchNewOledToken();

    oledTokenRotationTimer = setInterval(() => {
        oledCountdownSeconds = 15;
        fetchNewOledToken();
    }, 15000);

    oledTimerInterval = setInterval(() => {
        oledCountdownSeconds -= 0.1;
        if (oledCountdownSeconds < 0) oledCountdownSeconds = 15;

        const progressPercent = (oledCountdownSeconds / 15) * 100;
        const bar = document.getElementById('oled-progress-bar');
        const timerText = document.getElementById('oled-timer-text');
        
        if (bar) bar.style.width = `${progressPercent}%`;
        if (timerText) timerText.innerText = `STEP: ${Math.ceil(oledCountdownSeconds)}s`;
    }, 100);
}

async function fetchNewOledToken() {
    const sessionSelect = document.getElementById('session-select');
    const sessionId = sessionSelect ? sessionSelect.value : 'SESS_101';

    try {
        const res = await fetch(`/api/token/generate?session_id=${sessionId}`);
        if (!res.ok) return;
        const data = await res.json();
        currentOledToken = data.token;
        renderOledDisplay(data.token, sessionId, data.time_step);
    } catch (err) {}
}

function renderOledDisplay(token, sessionId, timeStep) {
    const container = document.getElementById('oled-qrcode-container');
    const shortEl = document.getElementById('oled-payload-short');
    const fullEl = document.getElementById('oled-full-token-display');
    const sessEl = document.getElementById('oled-session-id');
    const stepEl = document.getElementById('oled-time-step');

    if (container) {
        container.innerHTML = "";
        new QRCode(container, {
            text: token,
            width: 120,
            height: 120,
            colorDark : "#000000",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.L
        });
    }

    if (shortEl) shortEl.innerText = token;
    if (fullEl) fullEl.innerText = token;
    if (sessEl) sessEl.innerText = sessionId;
    if (stepEl) stepEl.innerText = timeStep || "--";
}

function copyOledToken() {
    if (currentOledToken) {
        navigator.clipboard.writeText(currentOledToken);
        showToast("OLED TOTP token copied!", "info");
    }
}

// =======================================================
// ADMIN DASHBOARD & ROSTER RESET ACTIONS (Question 2)
// =======================================================
async function loadSessionsDropdowns() {
    try {
        const res = await fetch('/api/sessions');
        const data = await res.json();

        if (data.success && data.sessions) {
            const studentSelect = document.getElementById('session-select');
            const reportSelect = document.getElementById('report-session-select');

            let html = "";
            data.sessions.forEach(s => {
                const statusStr = s.is_active ? 'Active' : 'Closed';
                html += `<option value="${s.id}">${s.name} (${s.id}) [${statusStr}]</option>`;
            });

            if (studentSelect) {
                studentSelect.innerHTML = html;
                studentSelect.onchange = updateSessionGeofenceInfo;
                updateSessionGeofenceInfo();
            }
            if (reportSelect) {
                reportSelect.innerHTML = html;
            }
        }
    } catch (e) {}
}

function updateSessionGeofenceInfo() {
    const studentSelect = document.getElementById('session-select');
    const infoEl = document.getElementById('session-geofence-info');
    if (!studentSelect || !infoEl) return;

    const selectedId = studentSelect.value;
    fetch('/api/sessions').then(res => res.json()).then(data => {
        const sess = data.sessions.find(s => s.id === selectedId);
        if (sess) {
            infoEl.innerText = `Radius: ${sess.radius_meters}m | Lat: ${sess.center_lat.toFixed(4)}, Lon: ${sess.center_lon.toFixed(4)}`;
        }
    });
}

async function loadAdminSessionsList() {
    const container = document.getElementById('admin-sessions-list');
    if (!container) return;

    try {
        const res = await fetch('/api/sessions');
        const data = await res.json();

        if (res.ok && data.sessions) {
            if (data.sessions.length === 0) {
                container.innerHTML = `<p class="text-zinc-500 italic">No assigned sessions.</p>`;
                return;
            }

            let html = "";
            data.sessions.forEach(s => {
                const statusBadge = s.is_active ? `<span class="text-emerald-400 font-bold">[ACTIVE]</span>` : `<span class="text-zinc-500">[CLOSED]</span>`;
                html += `
                    <div class="p-3 bg-black border border-zinc-800 flex justify-between items-center">
                        <div>
                            <div class="font-bold text-white">${s.name} (${s.id})</div>
                            <div class="text-[11px] text-zinc-500 mt-0.5">Geofence: ${s.radius_meters}m | Lat: ${s.center_lat}, Lon: ${s.center_lon}</div>
                        </div>
                        <div class="flex items-center space-x-2">
                            ${statusBadge}
                            ${s.is_active ? `<button onclick="endSessionById('${s.id}')" class="px-2.5 py-1 btn-mono-outline text-[10px] uppercase text-rose-400 border-rose-800">End</button>` : ''}
                        </div>
                    </div>
                `;
            });
            container.innerHTML = html;
        }
    } catch (e) {}
}

async function handleCreateSession(event) {
    event.preventDefault();
    const id = document.getElementById('admin-sess-id').value.trim();
    const name = document.getElementById('admin-sess-name').value.trim();
    const lat = document.getElementById('admin-sess-lat').value.trim();
    const lon = document.getElementById('admin-sess-lon').value.trim();
    const radius = document.getElementById('admin-sess-radius').value.trim();

    try {
        const res = await fetch('/api/session/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: id || undefined,
                name,
                center_lat: parseFloat(lat),
                center_lon: parseFloat(lon),
                radius_meters: parseFloat(radius)
            })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            showToast(`Session '${data.session.name}' created!`, "success");
            loadSessionsDropdowns();
            loadAdminSessionsList();
            document.getElementById('create-session-form').reset();
        } else {
            showToast(`Error: ${data.message}`, "error");
        }
    } catch (err) {
        showToast(`Server Error: ${err.message}`, "error");
    }
}

async function endSessionById(sessionId) {
    if (!confirm(`End session '${sessionId}'?`)) return;

    try {
        const res = await fetch(`/api/session/${sessionId}/end`, { method: 'POST' });
        const data = await res.json();

        if (res.ok && data.success) {
            showToast(data.message, "success");
            loadSessionsDropdowns();
            loadAdminSessionsList();
            loadAttendanceReport();
        } else {
            showToast(`Error: ${data.message}`, "error");
        }
    } catch (err) {
        showToast(`Error: ${err.message}`, "error");
    }
}

async function endSelectedSession() {
    const select = document.getElementById('report-session-select');
    if (select && select.value) endSessionById(select.value);
}

async function loadAdminRoster() {
    const tbody = document.getElementById('admin-roster-tbody');
    if (!tbody) return;

    try {
        const res = await fetch('/api/admin/students');
        const data = await res.json();

        if (res.ok && data.students) {
            if (data.students.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-zinc-500 italic">No students provisioned yet.</td></tr>`;
                return;
            }

            let rows = "";
            data.students.forEach(s => {
                rows += `
                    <tr class="hover:bg-zinc-900">
                        <td class="p-3 text-white font-bold">${s.username}</td>
                        <td class="p-3 text-zinc-300">${s.display_name}</td>
                        <td class="p-3 text-zinc-400 font-mono">${s.roll_number}</td>
                        <td class="p-3 text-right">
                            <button onclick="openResetPasswordModal('${s.username}', '${s.display_name}')" class="px-2.5 py-1 btn-mono-outline text-[11px] uppercase">
                                Reset Password
                            </button>
                        </td>
                    </tr>
                `;
            });
            tbody.innerHTML = rows;
        } else {
            tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-rose-400">${data.message}</td></tr>`;
        }
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-rose-400">Failed to load roster.</td></tr>`;
    }
}

function openResetPasswordModal(username, displayName) {
    const modal = document.getElementById('reset-password-modal');
    const userField = document.getElementById('reset-modal-username');
    const label = document.getElementById('reset-modal-student-name');
    const passInput = document.getElementById('reset-modal-password-input');

    if (userField) userField.value = username;
    if (label) label.innerText = `Student: ${displayName} (${username})`;
    if (passInput) passInput.value = "";
    if (modal) modal.classList.remove('hidden');
}

function closeResetPasswordModal() {
    const modal = document.getElementById('reset-password-modal');
    if (modal) modal.classList.add('hidden');
}

async function handleAdminResetPasswordSubmit(event) {
    event.preventDefault();
    const username = document.getElementById('reset-modal-username').value;
    const new_password = document.getElementById('reset-modal-password-input').value;

    try {
        const res = await fetch('/api/admin/students/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, new_password })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            showToast(`Password reset successfully for student '${username}'!`, "success");
            closeResetPasswordModal();
        } else {
            showToast(`Error: ${data.message}`, "error");
        }
    } catch (err) {
        showToast(`Reset Error: ${err.message}`, "error");
    }
}

async function handleBulkStudentUpload(event) {
    event.preventDefault();
    const csvData = document.getElementById('bulk-csv-input').value.trim();
    if (!csvData) return;

    try {
        const res = await fetch('/api/admin/students/bulk-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ csv: csvData })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            showToast(data.message, "success");
            document.getElementById('bulk-csv-input').value = "";
            loadAdminRoster();
        } else {
            showToast(`Upload Error: ${data.message}`, "error");
        }
    } catch (err) {
        showToast(`Upload Error: ${err.message}`, "error");
    }
}

function fillAdminGpsLocation() {
    navigator.geolocation.getCurrentPosition((pos) => {
        document.getElementById('admin-sess-lat').value = pos.coords.latitude;
        document.getElementById('admin-sess-lon').value = pos.coords.longitude;
        showToast("Filled GPS position!", "info");
    }, (err) => showToast(`GPS Error: ${err.message}`, "error"));
}

async function loadAttendanceReport() {
    const select = document.getElementById('report-session-select');
    const sessionId = select ? select.value : 'SESS_101';
    const tbody = document.getElementById('attendance-report-body');
    const metaEl = document.getElementById('report-meta-text');

    if (!sessionId) return;

    try {
        const res = await fetch(`/api/attendance/report?session_id=${sessionId}`);
        const data = await res.json();

        if (res.ok && data.success) {
            if (metaEl) {
                metaEl.innerText = `Session: ${data.session.name} | Total Present: ${data.total_present} student(s)`;
            }

            if (data.records.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-zinc-500 italic">No attendance records found.</td></tr>`;
                return;
            }

            let rows = "";
            data.records.forEach((r, idx) => {
                const dateStr = new Date(r.scanned_at).toLocaleString();
                rows += `
                    <tr class="hover:bg-zinc-900">
                        <td class="p-3 text-zinc-500">${idx + 1}</td>
                        <td class="p-3 font-bold text-white">${r.student_id}</td>
                        <td class="p-3 text-zinc-200">${r.display_name || 'N/A'}</td>
                        <td class="p-3 text-zinc-400 font-mono text-xs">${r.roll_number || 'N/A'}</td>
                        <td class="p-3 text-white font-bold">${r.distance_meters}m</td>
                        <td class="p-3 text-zinc-400">${dateStr}</td>
                    </tr>
                `;
            });
            tbody.innerHTML = rows;
        } else {
            if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-rose-400">${data.message}</td></tr>`;
        }
    } catch (err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-rose-400">Failed to load report.</td></tr>`;
    }
}

// Toast Helper
function showToast(msg, type = "info") {
    const toast = document.createElement('div');
    toast.className = `fixed bottom-5 right-5 z-50 bg-white text-black px-4 py-2 border border-black font-mono text-xs font-bold uppercase shadow-2xl transition-all transform translate-y-2 opacity-0`;
    toast.innerText = msg;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.remove('translate-y-2', 'opacity-0'), 10);
    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}
