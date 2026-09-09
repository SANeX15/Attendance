// Global State
let html5QrcodeScanner = null;
let isScannerActive = false;
let isScanLocked = false; // Rate limiting lockout flag
let currentPosition = null;
let oledTimerInterval = null;
let oledTokenRotationTimer = null;
let oledCountdownSeconds = 10;
let currentOledToken = "";

// Initialize App on DOM Load
document.addEventListener('DOMContentLoaded', () => {
    initStudentCredentials();
    loadSessionsDropdowns();
    requestCurrentLocation();
    startOledSimulator();
});

// =======================================================
// TAB NAVIGATION
// =======================================================
function switchTab(tabId) {
    document.querySelectorAll('.tab-section').forEach(sec => sec.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('text-cyan-400', 'bg-cyan-950/60', 'border', 'border-cyan-800/60');
        btn.classList.add('text-slate-400');
    });

    const activeSec = document.getElementById(`tab-${tabId}`);
    if (activeSec) activeSec.classList.remove('hidden');

    const activeBtn = document.getElementById(`tab-${tabId}-btn`);
    if (activeBtn) {
        activeBtn.classList.remove('text-slate-400');
        activeBtn.classList.add('text-cyan-400', 'bg-cyan-950/60', 'border', 'border-cyan-800/60');
    }

    if (tabId === 'admin') {
        loadAttendanceReport();
    }
}

// =======================================================
// STUDENT CREDENTIALS & LOCATION
// =======================================================
function initStudentCredentials() {
    const savedId = localStorage.getItem('attendance_student_id') || 'STU_1001';
    const input = document.getElementById('student-id-input');
    if (input) input.value = savedId;
}

function saveStudentId() {
    const input = document.getElementById('student-id-input');
    if (input && input.value.trim()) {
        const studentId = input.value.trim();
        localStorage.setItem('attendance_student_id', studentId);
        showToast("Student ID saved to local storage!", "success");
    }
}

function requestCurrentLocation() {
    const badge = document.getElementById('gps-status-badge');
    const coordsEl = document.getElementById('gps-coords-display');
    const accEl = document.getElementById('gps-accuracy-display');

    if (!navigator.geolocation) {
        updateGpsBadge("error", "Not Supported");
        if (coordsEl) coordsEl.innerText = "Geolocation API not supported by browser.";
        return;
    }

    updateGpsBadge("loading", "Acquiring GPS...");

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            currentPosition = pos.coords;
            updateGpsBadge("success", "GPS Locked");
            if (coordsEl) coordsEl.innerText = `Lat: ${pos.coords.latitude.toFixed(6)}, Lon: ${pos.coords.longitude.toFixed(6)}`;
            if (accEl) accEl.innerText = `Accuracy: ±${Math.round(pos.coords.accuracy)} meters`;
        },
        (err) => {
            updateGpsBadge("error", "GPS Error");
            if (coordsEl) coordsEl.innerText = `Error: ${err.message}`;
            if (accEl) accEl.innerText = "Check device location permissions.";
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
}

function updateGpsBadge(type, text) {
    const badge = document.getElementById('gps-status-badge');
    if (!badge) return;

    if (type === 'success') {
        badge.className = "inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 font-mono";
        badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> ${text}`;
    } else if (type === 'loading') {
        badge.className = "inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full bg-yellow-950/80 text-yellow-400 border border-yellow-800/60 font-mono";
        badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-ping"></span> ${text}`;
    } else {
        badge.className = "inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full bg-rose-950/80 text-rose-400 border border-rose-800/60 font-mono";
        badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span> ${text}`;
    }
}

// =======================================================
// CAMERA QR SCANNER & PIPELINE EXECUTION
// =======================================================
function startCameraScanner() {
    const placeholder = document.getElementById('scanner-placeholder');
    const startBtn = document.getElementById('start-scan-btn');
    const stopBtn = document.getElementById('stop-scan-btn');
    const stateInd = document.getElementById('scanner-state-indicator');

    if (placeholder) placeholder.classList.add('hidden');
    if (startBtn) startBtn.classList.add('hidden');
    if (stopBtn) stopBtn.classList.remove('hidden');

    if (stateInd) {
        stateInd.innerText = "Scanning Active";
        stateInd.className = "text-xs font-mono font-normal px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800";
    }

    if (!html5QrcodeScanner) {
        html5QrcodeScanner = new Html5Qrcode("reader");
    }

    const config = { fps: 10, qrbox: { width: 250, height: 250 } };

    html5QrcodeScanner.start(
        { facingMode: "environment" },
        config,
        onQrCodeScanned,
        (errorMessage) => {
            // Scanner frame scan loop (ignore non-code frames)
        }
    ).catch(err => {
        console.error("Camera start failed:", err);
        stopCameraScanner();
        renderFeedbackBanner({
            error: "CAMERA_ERROR",
            message: "Unable to access camera. Please check permissions or select another device."
        });
    });

    isScannerActive = true;
}

function stopCameraScanner() {
    if (html5QrcodeScanner && isScannerActive) {
        html5QrcodeScanner.stop().then(() => {
            isScannerActive = false;
            resetScannerUi();
        }).catch(err => {
            console.error("Error stopping scanner:", err);
            resetScannerUi();
        });
    } else {
        resetScannerUi();
    }
}

function resetScannerUi() {
    const placeholder = document.getElementById('scanner-placeholder');
    const startBtn = document.getElementById('start-scan-btn');
    const stopBtn = document.getElementById('stop-scan-btn');
    const stateInd = document.getElementById('scanner-state-indicator');

    if (placeholder) placeholder.classList.remove('hidden');
    if (startBtn) startBtn.classList.remove('hidden');
    if (stopBtn) stopBtn.classList.add('hidden');

    if (stateInd) {
        stateInd.innerText = "Idle";
        stateInd.className = "text-xs font-mono font-normal px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700";
    }
}

/**
 * Triggered automatically when a QR code is detected by camera
 */
async function onQrCodeScanned(decodedText, decodedResult) {
    if (isScanLocked) return; // Rate limiting lockout
    
    // Lock scanner to prevent duplicate triggers
    isScanLocked = true;
    showProcessingOverlay("High-Accuracy GPS Acquisition...");

    // Pause camera scanning temporarily
    if (html5QrcodeScanner && isScannerActive) {
        try { html5QrcodeScanner.pause(); } catch(e) {}
    }

    const studentIdInput = document.getElementById('student-id-input');
    const studentId = studentIdInput ? studentIdInput.value.trim() : 'STU_1001';

    if (!studentId) {
        hideProcessingOverlay();
        renderFeedbackBanner({
            error: "MISSING_STUDENT_ID",
            message: "Please enter your Student ID before scanning."
        });
        unlockScannerWithDelay();
        return;
    }

    // Step: Capture GPS at the exact moment of scan
    let lat = null, lon = null;
    try {
        const pos = await getCurrentGpsPromise(5000);
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
        currentPosition = pos.coords;
        updateGpsBadge("success", "GPS Captured");
    } catch (gpsErr) {
        hideProcessingOverlay();
        console.warn("GPS Acquisition failed at scan time:", gpsErr);
        renderFeedbackBanner({
            error: "GPS_DISABLED",
            message: `GPS Acquisition Failed: ${gpsErr.message || 'Permission denied or timed out'}. Geolocation is required for attendance.`
        });
        unlockScannerWithDelay();
        return;
    }

    // Step: Submit payload to Backend REST API
    updateProcessingText("Submitting Payload & Verifying HMAC...");
    await processAttendancePayload(studentId, decodedText, lat, lon);
    
    hideProcessingOverlay();
    unlockScannerWithDelay();
}

function getCurrentGpsPromise(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            return reject(new Error("Geolocation API not available"));
        }
        navigator.geolocation.getCurrentPosition(
            resolve,
            reject,
            { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
        );
    });
}

async function processAttendancePayload(studentId, token, lat, lon) {
    try {
        const response = await fetch('/api/attendance/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                student_id: studentId,
                token: token,
                lat: lat,
                lon: lon
            })
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
            message: `Failed to connect to backend server: ${err.message}`
        });
    }
}

function submitManualToken() {
    const input = document.getElementById('manual-token-input');
    if (!input || !input.value.trim()) return;
    
    const token = input.value.trim();
    const studentIdInput = document.getElementById('student-id-input');
    const studentId = studentIdInput ? studentIdInput.value.trim() : 'STU_1001';

    showProcessingOverlay("Fetching GPS & Submitting...");
    
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            processAttendancePayload(studentId, token, pos.coords.latitude, pos.coords.longitude)
                .finally(() => hideProcessingOverlay());
        },
        (err) => {
            // Fallback to default demo center if GPS denied in test env
            processAttendancePayload(studentId, token, 37.774929, -122.419416)
                .finally(() => hideProcessingOverlay());
        },
        { enableHighAccuracy: true, timeout: 4000 }
    );
}

function unlockScannerWithDelay() {
    setTimeout(() => {
        isScanLocked = false;
        if (html5QrcodeScanner && isScannerActive) {
            try { html5QrcodeScanner.resume(); } catch(e) {}
        }
    }, 3000); // 3-second lockout rate limiting
}

function showProcessingOverlay(text) {
    const overlay = document.getElementById('processing-overlay');
    const textEl = document.getElementById('processing-status-text');
    if (overlay) overlay.classList.remove('hidden');
    if (textEl) textEl.innerText = text;
}

function updateProcessingText(text) {
    const textEl = document.getElementById('processing-status-text');
    if (textEl) textEl.innerText = text;
}

function hideProcessingOverlay() {
    const overlay = document.getElementById('processing-overlay');
    if (overlay) overlay.classList.add('hidden');
}

// =======================================================
// FEEDBACK BANNER DISPLAY (HANDLES ALL 6 REJECTION CODES)
// =======================================================
function renderFeedbackBanner(data) {
    const banner = document.getElementById('feedback-banner');
    if (!banner) return;

    banner.classList.remove('hidden');
    banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    if (data.isSuccess) {
        banner.innerHTML = `
            <div class="bg-gradient-to-r from-emerald-950/90 to-slate-900 border-2 border-emerald-500/80 rounded-3xl p-6 shadow-2xl shadow-emerald-950/50 flex flex-col md:flex-row items-center justify-between gap-4">
                <div class="flex items-center space-x-4">
                    <div class="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-400 text-emerald-400 flex items-center justify-center shrink-0">
                        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <h3 class="text-xl font-bold text-white">Attendance Marked Present!</h3>
                            <span class="text-xs px-2.5 py-0.5 rounded-full bg-emerald-900 text-emerald-300 font-mono font-semibold">200 OK</span>
                        </div>
                        <p class="text-sm text-emerald-200 mt-1 font-medium">${data.message}</p>
                        <p class="text-xs text-slate-400 mt-0.5 font-mono">Student: ${data.studentId} | Session: ${data.sessionId}</p>
                    </div>
                </div>
                <div class="bg-emerald-900/40 px-4 py-2 rounded-2xl border border-emerald-700/50 text-center shrink-0">
                    <span class="block text-[10px] uppercase tracking-wider text-emerald-300 font-bold">Geofence Distance</span>
                    <span class="text-lg font-mono font-bold text-emerald-200">${data.distance}m</span>
                </div>
            </div>
        `;
        return;
    }

    // Error Codes Mapping
    const errorCode = data.error || "REJECTED";
    let theme = {
        bg: "from-rose-950/90 to-slate-900",
        border: "border-rose-500/80",
        text: "text-rose-300",
        badgeBg: "bg-rose-900",
        badgeText: "text-rose-300",
        title: "Scan Rejected",
        icon: `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`
    };

    if (errorCode === "INVALID_SIGNATURE") {
        theme.title = "401 INVALID SIGNATURE";
        theme.bg = "from-red-950/90 to-slate-900";
        theme.border = "border-red-500";
        theme.badgeBg = "bg-red-900";
        theme.badgeText = "text-red-300";
    } else if (errorCode === "TOKEN_EXPIRED") {
        theme.title = "400 TOKEN EXPIRED";
        theme.bg = "from-amber-950/90 to-slate-900";
        theme.border = "border-amber-500";
        theme.badgeBg = "bg-amber-900";
        theme.badgeText = "text-amber-300";
    } else if (errorCode === "TOKEN_ALREADY_USED") {
        theme.title = "409 REPLAY ATTACK (ALREADY USED)";
        theme.bg = "from-purple-950/90 to-slate-900";
        theme.border = "border-purple-500";
        theme.badgeBg = "bg-purple-900";
        theme.badgeText = "text-purple-300";
    } else if (errorCode === "ALREADY_MARKED") {
        theme.title = "409 ALREADY MARKED";
        theme.bg = "from-blue-950/90 to-slate-900";
        theme.border = "border-blue-500";
        theme.badgeBg = "bg-blue-900";
        theme.badgeText = "text-blue-300";
    } else if (errorCode === "OUT_OF_BOUNDS") {
        theme.title = "403 OUT OF BOUNDS";
        theme.bg = "from-orange-950/90 to-slate-900";
        theme.border = "border-orange-500";
        theme.badgeBg = "bg-orange-900";
        theme.badgeText = "text-orange-300";
    } else if (errorCode === "GPS_DISABLED") {
        theme.title = "GPS DISABLED / ERROR";
        theme.bg = "from-rose-950/90 to-slate-900";
        theme.border = "border-rose-500";
    }

    banner.innerHTML = `
        <div class="bg-gradient-to-r ${theme.bg} border-2 ${theme.border} rounded-3xl p-6 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-4">
            <div class="flex items-center space-x-4">
                <div class="w-14 h-14 rounded-2xl bg-slate-900/60 border border-slate-700 ${theme.text} flex items-center justify-center shrink-0">
                    ${theme.icon}
                </div>
                <div>
                    <div class="flex items-center gap-2">
                        <h3 class="text-xl font-bold text-white">${theme.title}</h3>
                        <span class="text-xs px-2.5 py-0.5 rounded-full ${theme.badgeBg} ${theme.badgeText} font-mono font-semibold">${errorCode}</span>
                    </div>
                    <p class="text-sm ${theme.text} mt-1 font-medium">${data.message}</p>
                    ${data.distance_meters ? `<p class="text-xs text-slate-400 mt-1 font-mono">Distance: ${data.distance_meters}m | Max Radius: ${data.radius_meters}m</p>` : ''}
                </div>
            </div>
            <button onclick="document.getElementById('feedback-banner').classList.add('hidden')" class="px-4 py-2 bg-slate-900/80 hover:bg-slate-900 text-slate-300 text-xs font-semibold rounded-xl border border-slate-700 transition">
                Dismiss
            </button>
        </div>
    `;
}

// =======================================================
// VIRTUAL OLED SIMULATOR (ESP32 DISPLAY) LOGIC
// =======================================================
function startOledSimulator() {
    fetchNewOledToken();

    // Rotate token every 10 seconds
    oledTokenRotationTimer = setInterval(() => {
        oledCountdownSeconds = 10;
        fetchNewOledToken();
    }, 10000);

    // Update progress bar smooth countdown
    oledTimerInterval = setInterval(() => {
        oledCountdownSeconds -= 0.1;
        if (oledCountdownSeconds < 0) oledCountdownSeconds = 10;

        const progressPercent = (oledCountdownSeconds / 10) * 100;
        const bar = document.getElementById('oled-progress-bar');
        const timerText = document.getElementById('oled-timer-text');
        
        if (bar) bar.style.width = `${progressPercent}%`;
        if (timerText) timerText.innerText = `ROTATING: ${Math.ceil(oledCountdownSeconds)}s`;
    }, 100);
}

async function fetchNewOledToken() {
    const sessionSelect = document.getElementById('session-select');
    const sessionId = sessionSelect ? sessionSelect.value : 'SESS_101';

    try {
        const res = await fetch(`/api/token/generate?session_id=${sessionId}`);
        const data = await res.json();
        currentOledToken = data.token;
        renderOledDisplay(data.token, sessionId);
    } catch (err) {
        console.error("Failed to generate OLED token:", err);
    }
}

function renderOledDisplay(token, sessionId) {
    const container = document.getElementById('oled-qrcode-container');
    const shortEl = document.getElementById('oled-payload-short');
    const fullEl = document.getElementById('oled-full-token-display');
    const sessEl = document.getElementById('oled-session-id');
    const issuedEl = document.getElementById('oled-issued-at');
    const nonceEl = document.getElementById('oled-nonce');

    if (container) {
        container.innerHTML = "";
        // Use QRCode.js library to render visual QR pattern
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

    const parts = token.split(':');
    if (parts.length === 4) {
        if (sessEl) sessEl.innerText = parts[0];
        if (issuedEl) issuedEl.innerText = new Date(parseInt(parts[1]) * 1000).toLocaleTimeString();
        if (nonceEl) nonceEl.innerText = parts[2];
    }
}

function simulateDirectScanFromOled() {
    if (!currentOledToken) return;
    
    switchTab('student');
    const manualInput = document.getElementById('manual-token-input');
    if (manualInput) manualInput.value = currentOledToken;

    submitManualToken();
}

function copyOledToken() {
    if (currentOledToken) {
        navigator.clipboard.writeText(currentOledToken);
        showToast("OLED Token copied to clipboard!", "info");
    }
}

// =======================================================
// ADMIN & SESSIONS MANAGEMENT
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
                html += `<option value="${s.id}">${s.name} (${s.id})</option>`;
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
    } catch (e) {
        console.error("Failed to load sessions:", e);
    }
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
            showToast(`Session '${data.session.name}' created successfully!`, "success");
            loadSessionsDropdowns();
            document.getElementById('create-session-form').reset();
        } else {
            showToast(`Error: ${data.message}`, "error");
        }
    } catch (err) {
        showToast(`Server Error: ${err.message}`, "error");
    }
}

function fillAdminGpsLocation() {
    navigator.geolocation.getCurrentPosition((pos) => {
        document.getElementById('admin-sess-lat').value = pos.coords.latitude;
        document.getElementById('admin-sess-lon').value = pos.coords.longitude;
        showToast("Filled center coordinates with current GPS location!", "info");
    }, (err) => {
        showToast(`GPS Error: ${err.message}`, "error");
    });
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
                tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-6 text-center text-slate-500 italic">No students marked present yet for this session.</td></tr>`;
                return;
            }

            let rows = "";
            data.records.forEach((r, idx) => {
                const dateStr = new Date(r.scanned_at).toLocaleTimeString();
                rows += `
                    <tr class="hover:bg-slate-900/60 transition">
                        <td class="px-4 py-3 text-slate-500">${idx + 1}</td>
                        <td class="px-4 py-3 font-semibold text-cyan-400">${r.student_id}</td>
                        <td class="px-4 py-3 text-emerald-400 font-bold">${r.distance_meters}m</td>
                        <td class="px-4 py-3 text-slate-400 text-[11px]">${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}</td>
                        <td class="px-4 py-3 text-slate-400">${dateStr}</td>
                    </tr>
                `;
            });
            tbody.innerHTML = rows;
        } else {
            if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-6 text-center text-rose-400 font-medium">${data.message}</td></tr>`;
        }
    } catch (err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-6 text-center text-rose-400">Failed to fetch report: ${err.message}</td></tr>`;
    }
}

// Toast Helper
function showToast(msg, type = "info") {
    const toast = document.createElement('div');
    let bg = type === 'success' ? 'bg-emerald-600' : type === 'error' ? 'bg-rose-600' : 'bg-cyan-600';
    toast.className = `fixed bottom-5 right-5 z-50 ${bg} text-white px-4 py-2.5 rounded-xl shadow-2xl text-xs font-semibold flex items-center gap-2 transition-all transform translate-y-2 opacity-0`;
    toast.innerText = msg;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
    }, 10);

    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}
