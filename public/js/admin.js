/**
 * AI Interview Agent - Admin Dashboard Controller
 * Full Hiring Leadership Portal:
 * - Live System Status & AI Models
 * - Candidate Intelligence Dossier & Multidimensional Rubrics
 * - Audio/Video Stream Playback & Recording Downloader
 * - Turn-by-Turn Q&A Review & Proctoring Audit Trail
 * - Dynamic Pipeline Settings
 */

(function() {
    'use strict';

    const API_BASE = '/api/admin';
    const AUTH_TOKEN_KEY = 'admin_auth_token';

    let allInterviews = [];
    let currentFilter = 'all';
    let searchQuery = '';
    let currentInterviewSession = null;

    // Helper: Centralized Admin API Request
    async function api(endpoint, options = {}) {
        const token = localStorage.getItem(AUTH_TOKEN_KEY);
        const headers = {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        };

        const res = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers: { ...headers, ...(options.headers || {}) },
            body: options.body && typeof options.body === 'object' ? JSON.stringify(options.body) : options.body
        });

        if (res.status === 401) {
            localStorage.removeItem(AUTH_TOKEN_KEY);
            showLoginOverlay();
            throw new Error('Admin authentication required.');
        }

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: `Request error ${res.status}` }));
            throw new Error(err.error || 'Server request failed');
        }

        return res.json();
    }

    // --- Authentication ---
    async function handleLogin(e) {
        e.preventDefault();
        const password = document.getElementById('admin-password').value.trim();
        const errEl = document.getElementById('login-error');
        const submitBtn = document.getElementById('btn-admin-login');

        try {
            if (submitBtn) submitBtn.disabled = true;
            errEl?.classList.add('hidden');

            const res = await fetch(`${API_BASE}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Invalid password' }));
                throw new Error(err.error || 'Login failed');
            }

            const data = await res.json();
            localStorage.setItem(AUTH_TOKEN_KEY, data.token);
            hideLoginOverlay();
            await refreshAllData();
            toast("Dashboard unlocked successfully!", "success");
        } catch (error) {
            if (errEl) {
                errEl.textContent = error.message;
                errEl.classList.remove('hidden');
            }
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    function handleLogout() {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        showLoginOverlay();
        toast("Signed out of admin session.", "info");
    }

    function showLoginOverlay() {
        const overlay = document.getElementById('login-overlay');
        if (overlay) {
            overlay.classList.remove('hidden');
            overlay.style.display = 'flex';
            overlay.style.pointerEvents = 'auto';
        }
        const main = document.getElementById('main-layout');
        if (main) {
            main.classList.add('hidden');
            main.style.display = 'none';
        }
    }

    function hideLoginOverlay() {
        const overlay = document.getElementById('login-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
            overlay.style.display = 'none';
            overlay.style.pointerEvents = 'none';
        }
        const main = document.getElementById('main-layout');
        if (main) {
            main.classList.remove('hidden');
            main.style.display = 'grid';
            main.style.pointerEvents = 'auto';
        }
    }

    // --- Navigation & View Switching ---
    function switchView(viewId) {
        document.querySelectorAll('.admin-view').forEach(v => v.classList.add('hidden'));
        document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));

        const target = document.getElementById(viewId);
        if (target) target.classList.remove('hidden');

        const activeNav = document.querySelector(`.nav-item[data-view="${viewId}"]`);
        if (activeNav) activeNav.classList.add('active');

        if (viewId === 'status-view') loadSystemStatus();
        if (viewId === 'invites-view') loadInvites();
        if (viewId === 'interviews-view') loadInterviews();
        if (viewId === 'settings-view') loadSettings();
    }

    // --- System Status & Connectivity ---
    async function loadSystemStatus() {
        try {
            const data = await api('/status');
            const aiStatusPill = document.getElementById('ai-status-pill');
            const aiModel = document.getElementById('ai-model-name');
            const aiDesc = document.getElementById('ai-status-desc');

            if (data.perplexity) {
                if (aiStatusPill) {
                    aiStatusPill.textContent = "API Connected";
                    aiStatusPill.className = "status-pill status-ready";
                }
                if (aiModel) aiModel.textContent = `Cloud Model: ${data.model || "Perplexity"}`;
                if (aiDesc) aiDesc.textContent = "Live cloud model active for question generation & scoring.";
            } else {
                if (aiStatusPill) {
                    aiStatusPill.textContent = "Offline AI Active";
                    aiStatusPill.className = "status-pill status-ready";
                }
                if (aiModel) aiModel.textContent = "Built-in Intelligent Interview Engine";
                if (aiDesc) aiDesc.textContent = "Autonomous engine extracts CV details, generates dynamic probes, and computes scores.";
            }

            const drivePill = document.getElementById('drive-status-pill');
            const driveFolder = document.getElementById('drive-folder-name');
            const driveDesc = document.getElementById('drive-status-desc');

            if (data.drive && data.drive.configured) {
                if (drivePill) {
                    drivePill.textContent = "Cloud Synced";
                    drivePill.className = "status-pill status-ready";
                }
                if (driveFolder) driveFolder.textContent = data.drive.folderName || "Google Drive Folder";
                if (driveDesc) driveDesc.textContent = "Candidate videos and reports sync automatically to Drive.";
            } else {
                if (drivePill) {
                    drivePill.textContent = "Server Storage";
                    drivePill.className = "status-pill status-neutral";
                }
                if (driveFolder) driveFolder.textContent = "Local Server Disk (data/recordings)";
                if (driveDesc) driveDesc.textContent = "Recordings are saved locally on the server. Connect Drive via npm run drive-login anytime.";
            }

            const proctoringDesc = document.getElementById('proctoring-rule-summary');
            if (proctoringDesc) {
                proctoringDesc.textContent = `Max ${data.maxStrikes || 3} Strikes Allowed`;
            }

            // Quick hiring settings
            if (data.settings) {
                document.getElementById('quick-company').textContent = data.settings.companyName || "—";
                document.getElementById('quick-role').textContent = data.settings.targetRole || "—";
                document.getElementById('quick-qcount').textContent = `${data.settings.questionCount || 5} Questions`;
                document.getElementById('quick-lang').textContent = data.settings.language || "English";
            }
        } catch (err) {
            console.error("Failed to load status:", err);
        }
    }

    // --- Candidate Interviews ---
    async function loadInterviews() {
        try {
            const data = await api('/interviews');
            allInterviews = data.interviews || [];
            updateMetricsRibbon(allInterviews);
            renderInterviewsTable();
        } catch (err) {
            console.error("Failed to load interviews:", err);
            toast("Failed to load interviews: " + err.message, "error");
        }
    }

    function updateMetricsRibbon(items) {
        document.getElementById('stat-total-interviews').textContent = items.length;

        const hires = items.filter(i => i.recommendation === 'strong_hire' || i.recommendation === 'hire').length;
        document.getElementById('stat-hires').textContent = hires;

        const scored = items.filter(i => typeof i.overall === 'number');
        const avg = scored.length > 0
            ? Math.round(scored.reduce((acc, curr) => acc + curr.overall, 0) / scored.length)
            : 0;
        document.getElementById('stat-avg-score').textContent = scored.length > 0 ? `${avg}/100` : "—";

        const flagged = items.filter(i => (i.strikes || 0) > 0 || i.status === 'locked').length;
        document.getElementById('stat-flagged').textContent = flagged;
    }

    function renderInterviewsTable() {
        const tbody = document.getElementById('interviews-body');
        if (!tbody) return;

        let filtered = allInterviews;

        // Filter pills
        if (currentFilter !== 'all') {
            filtered = filtered.filter(item => item.status === currentFilter);
        }

        // Search query
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(item =>
                (item.name || "").toLowerCase().includes(q) ||
                (item.role || "").toLowerCase().includes(q)
            );
        }

        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center empty-state">
                        <div class="empty-icon">📂</div>
                        <p>No candidate interviews found matching the current criteria.</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = filtered.map(item => {
            const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleDateString(undefined, {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            }) : "—";

            const scoreDisplay = typeof item.overall === 'number'
                ? `<div class="table-score-bar">
                     <span class="score-badge-val">${item.overall}</span>
                     <div class="mini-bar"><div class="mini-fill" style="width: ${item.overall}%"></div></div>
                   </div>`
                : `<span class="text-muted">Pending</span>`;

            let recBadge = `<span class="badge-neutral">—</span>`;
            if (item.recommendation === 'strong_hire') {
                recBadge = `<span class="recommendation-badge badge-strong-hire">STRONG HIRE</span>`;
            } else if (item.recommendation === 'hire') {
                recBadge = `<span class="recommendation-badge badge-hire">HIRE</span>`;
            } else if (item.recommendation === 'borderline') {
                recBadge = `<span class="recommendation-badge badge-borderline">BORDERLINE</span>`;
            } else if (item.recommendation === 'no_hire') {
                recBadge = `<span class="recommendation-badge badge-no-hire">NO HIRE</span>`;
            }

            let statusClass = "badge-neutral";
            if (item.status === 'finished') statusClass = "badge-success";
            else if (item.status === 'live') statusClass = "badge-live";
            else if (item.status === 'locked') statusClass = "badge-danger";

            const strikesDisplay = item.strikes > 0
                ? `<span class="strikes-tag strikes-active">⚠️ ${item.strikes} Strike${item.strikes > 1 ? 's' : ''}</span>`
                : `<span class="strikes-tag strikes-clean">✓ Clean</span>`;

            return `
                <tr>
                    <td>
                        <div class="candidate-cell">
                            <strong>${escapeHtml(item.name)}</strong>
                            <small class="text-muted">${escapeHtml(item.role || "Software Engineer")}</small>
                        </div>
                    </td>
                    <td>${dateStr}</td>
                    <td><span class="status-chip ${statusClass}">${item.status.toUpperCase()}</span></td>
                    <td>${recBadge}</td>
                    <td>${scoreDisplay}</td>
                    <td>${strikesDisplay}</td>
                    <td>
                        <div class="table-actions">
                            <button type="button" class="btn-action btn-view" data-id="${item.id}" title="View Full Report">
                                📑 Review Dossier
                            </button>
                            <button type="button" class="btn-action-danger btn-delete" data-id="${item.id}" title="Delete Interview">
                                🗑️
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        // Attach action handlers
        tbody.querySelectorAll('.btn-view').forEach(btn => {
            btn.onclick = () => openInterviewDetail(btn.dataset.id);
        });

        tbody.querySelectorAll('.btn-delete').forEach(btn => {
            btn.onclick = () => deleteInterview(btn.dataset.id);
        });
    }

    async function openInterviewDetail(id) {
        try {
            const data = await api(`/interviews/${id}`);
            const session = data.interview;
            currentInterviewSession = session;

            const modal = document.getElementById('report-modal');
            document.getElementById('report-candidate-name').textContent = session.name;
            document.getElementById('report-candidate-role').textContent = session.settingsSnapshot?.targetRole || "Software Engineer";

            // Recommendation Badge
            const recBadge = document.getElementById('report-recommendation-badge');
            if (recBadge) {
                const rec = session.score?.recommendation || 'borderline';
                recBadge.textContent = rec.replace('_', ' ').toUpperCase();
                recBadge.className = `recommendation-badge badge-${rec.replace('_', '-')}`;
            }

            // Overall Score
            const overallEl = document.getElementById('report-overall-score');
            if (overallEl) {
                overallEl.textContent = session.score?.overall ?? "—";
            }

            // Summary text
            const summaryEl = document.getElementById('report-summary-text');
            if (summaryEl) {
                summaryEl.textContent = session.score?.summary || "Interview is pending evaluation or in progress.";
            }

            // 6 Dimensions Grid
            const metricsGrid = document.getElementById('metrics-grid');
            if (metricsGrid) {
                const score = session.score || {};
                const dims = [
                    { label: "Correctness", val: score.correctness ?? "—", icon: "🎯" },
                    { label: "Technical Depth", val: score.depth ?? "—", icon: "🔬" },
                    { label: "Problem Solving", val: score.problemSolving ?? "—", icon: "💡" },
                    { label: "Communication", val: score.communication ?? "—", icon: "💬" },
                    { label: "CV Honesty", val: score.cvHonesty ?? "—", icon: "📋" },
                    { label: "Integrity", val: score.integrity ?? "—", icon: "🛡️" },
                ];
                metricsGrid.innerHTML = dims.map(d => {
                    const num = Number(d.val);
                    const pct = !isNaN(num) ? num * 10 : 0;
                    return `
                        <div class="metric-card glass-card">
                            <div class="metric-top">
                                <span class="metric-icon">${d.icon}</span>
                                <span class="metric-label">${d.label}</span>
                            </div>
                            <div class="metric-value-row">
                                <strong class="metric-val">${d.val}</strong>
                                <span class="metric-max">/10</span>
                            </div>
                            <div class="dim-bar"><div class="dim-fill" style="width: ${pct}%"></div></div>
                        </div>
                    `;
                }).join('');
            }

            // Strengths and Gaps
            const strengthsList = document.getElementById('report-strengths-list');
            if (strengthsList) {
                const list = session.score?.strengths || ["Articulated fundamental concepts clearly."];
                strengthsList.innerHTML = list.map(s => `<li>${escapeHtml(s)}</li>`).join('');
            }

            const gapsList = document.getElementById('report-gaps-list');
            if (gapsList) {
                const list = session.score?.gaps || ["No major technical deficiencies identified."];
                gapsList.innerHTML = list.map(g => `<li>${escapeHtml(g)}</li>`).join('');
            }

            // Video / Audio Player
            const videoPlayer = document.getElementById('report-video-player');
            const downloadBtn = document.getElementById('btn-download-recording');
            const recordingStatusTag = document.getElementById('recording-status-tag');

            const token = localStorage.getItem(AUTH_TOKEN_KEY);
            const streamUrl = `${API_BASE}/interviews/${id}/recording?token=${encodeURIComponent(token || "")}`;
            const downloadUrl = `${API_BASE}/interviews/${id}/recording?token=${encodeURIComponent(token || "")}&download=1`;

            if (session.recording?.bytes || session.recording?.localPath) {
                recordingStatusTag.textContent = `${(session.recording.bytes / 1024 / 1024).toFixed(2)} MB Recorded`;
                recordingStatusTag.className = "player-status status-ready";
                if (videoPlayer) {
                    videoPlayer.src = session.recording.driveUrl || streamUrl;
                    videoPlayer.load();
                }
                if (downloadBtn) {
                    downloadBtn.href = session.recording.driveUrl || downloadUrl;
                    downloadBtn.style.display = 'inline-flex';
                }
            } else {
                recordingStatusTag.textContent = "No Video Saved";
                recordingStatusTag.className = "player-status status-neutral";
                if (videoPlayer) videoPlayer.removeAttribute('src');
                if (downloadBtn) downloadBtn.style.display = 'none';
            }

            // Re-sync to drive button
            const syncBtn = document.getElementById('btn-sync-drive');
            if (syncBtn) {
                syncBtn.onclick = () => syncInterviewToDrive(id);
            }

            // Transcript Tab
            const transcriptList = document.getElementById('report-transcript-list');
            if (transcriptList) {
                const turns = session.transcript || [];
                if (turns.length === 0) {
                    transcriptList.innerHTML = `<div class="empty-state"><p>No transcript recorded yet.</p></div>`;
                } else {
                    transcriptList.innerHTML = turns.map((turn, i) => `
                        <div class="transcript-card glass-card">
                            <div class="transcript-card-header">
                                <div class="turn-title">
                                    <span class="turn-num">#${i + 1}</span>
                                    <span class="topic-chip">${escapeHtml(turn.topic || "Technical Probe")}</span>
                                    ${turn.kind === 'follow_up' ? '<span class="follow-up-pill">Follow-up</span>' : ''}
                                </div>
                                <div class="turn-scores">
                                    <span class="coverage-pill coverage-${turn.coverage || 'partial'}">${(turn.coverage || 'partial').toUpperCase()}</span>
                                    <span class="turn-score-badge">Score: <strong>${turn.score ?? '—'}</strong>/10</span>
                                </div>
                            </div>

                            <div class="dialogue-block">
                                <div class="dialogue-line dialogue-ai">
                                    <strong class="speaker-tag">🤖 AI Interviewer:</strong>
                                    <p>${escapeHtml(turn.question)}</p>
                                </div>
                                <div class="dialogue-line dialogue-candidate">
                                    <strong class="speaker-tag">👤 Candidate Response:</strong>
                                    <p>${escapeHtml(turn.answer || "(No verbal answer captured)")}</p>
                                </div>
                                ${turn.note ? `
                                <div class="dialogue-note">
                                    <strong>Evaluator Rationale:</strong> ${escapeHtml(turn.note)}
                                </div>` : ''}
                            </div>
                        </div>
                    `).join('');
                }
            }

            // Integrity Audit Tab
            const strikesTotal = document.getElementById('report-strikes-total');
            if (strikesTotal) strikesTotal.textContent = session.strikes || 0;

            const integritySummary = document.getElementById('report-integrity-summary');
            if (integritySummary) {
                integritySummary.textContent = session.score?.integritySummary || (
                    session.strikes > 0 ? `${session.strikes} proctoring violations recorded.` : "Session integrity verified cleanly."
                );
            }

            const integrityTableBody = document.getElementById('report-integrity-log-body');
            if (integrityTableBody) {
                const events = session.integrity || [];
                if (events.length === 0) {
                    integrityTableBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No proctoring events recorded. Clean session.</td></tr>`;
                } else {
                    integrityTableBody.innerHTML = events.map(e => `
                        <tr>
                            <td><small>${new Date(e.at).toLocaleTimeString()}</small></td>
                            <td><code>${escapeHtml(e.type)}</code></td>
                            <td>${escapeHtml(e.detail || "Event logged")}</td>
                            <td>${e.strike ? '<span class="badge-danger">Strike Awarded</span>' : '<span class="badge-neutral">Monitored</span>'}</td>
                        </tr>
                    `).join('');
                }
            }

            // Default to summary tab
            switchReportTab('tab-summary');
            modal.classList.remove('hidden');
            modal.style.display = 'flex';
            modal.style.pointerEvents = 'auto';
        } catch (err) {
            toast("Failed to load interview dossier: " + err.message, "error");
        }
    }

    function switchReportTab(tabId) {
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        document.querySelectorAll('.report-nav-tabs .tab-btn').forEach(b => b.classList.remove('active'));

        const target = document.getElementById(tabId);
        if (target) target.classList.remove('hidden');

        const activeBtn = document.querySelector(`.report-nav-tabs .tab-btn[data-tab="${tabId}"]`);
        if (activeBtn) activeBtn.classList.add('active');
    }

    function closeReportModal() {
        const modal = document.getElementById('report-modal');
        if (modal) {
            modal.classList.add('hidden');
            modal.style.display = 'none';
            modal.style.pointerEvents = 'none';
        }
        const video = document.getElementById('report-video-player');
        if (video) video.pause();
    }

    async function syncInterviewToDrive(id) {
        const btn = document.getElementById('btn-sync-drive');
        try {
            if (btn) {
                btn.disabled = true;
                btn.textContent = "☁ Syncing to Drive...";
            }
            const res = await api(`/interviews/${id}/upload`, { method: 'POST' });
            if (res.driveError) {
                toast("Drive sync notice: " + res.driveError, "error");
            } else {
                toast("Recording & report uploaded to Google Drive!", "success");
            }
        } catch (err) {
            toast("Sync failed: " + err.message, "error");
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = "☁ Re-sync to Google Drive";
            }
        }
    }

    async function deleteInterview(id) {
        if (!confirm("Are you sure you want to permanently delete this interview and its recordings?")) {
            return;
        }

        try {
            await api(`/interviews/${id}`, { method: 'DELETE' });
            toast("Interview successfully deleted.", "info");
            await loadInterviews();
        } catch (err) {
            toast("Failed to delete interview: " + err.message, "error");
        }
    }

    // --- Settings Management ---
    async function loadSettings() {
        try {
            const data = await api('/status');
            const s = data.settings || {};

            setInputValue('companyName', s.companyName);
            setInputValue('targetRole', s.targetRole);
            setInputValue('questionCount', s.questionCount);
            setInputValue('language', s.language);
            setInputValue('focusNotes', s.focusNotes);
        } catch (err) {
            console.error("Failed to load settings:", err);
        }
    }

    async function saveSettings(e) {
        e.preventDefault();
        const form = document.getElementById('settings-form');
        const formData = new FormData(form);
        const settings = Object.fromEntries(formData.entries());

        const btn = document.getElementById('btn-save-settings');
        try {
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = `<span>Saving...</span> <span class="spinner-small"></span>`;
            }

            await api('/settings', {
                method: 'PUT',
                body: settings
            });

            toast("Settings updated and applied to future interviews!", "success");
            await loadSystemStatus();
        } catch (err) {
            toast("Failed to save settings: " + err.message, "error");
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<span>Save & Apply Settings</span> <span class="btn-arrow">✓</span>`;
            }
        }
    }

    async function refreshAllData() {
        await Promise.all([loadSystemStatus(), loadInvites(), loadInterviews(), loadSettings()]);
    }

    // --- Candidate Invites Management ---
    let allInvites = [];

    async function loadInvites() {
        try {
            const data = await api('/invites');
            allInvites = data.invites || [];
            const countEl = document.getElementById('invites-count');
            if (countEl) countEl.textContent = allInvites.length;
            renderInvitesTable(allInvites);
        } catch (err) {
            console.error("Failed to load invites:", err);
            toast("Failed to load candidate invites: " + err.message, "error");
        }
    }

    function renderInvitesTable(invites) {
        const tbody = document.getElementById('invites-table-body');
        if (!tbody) return;

        if (!invites || invites.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding: 2.5rem;">No candidate invitation links generated yet. Create one above!</td></tr>`;
            return;
        }

        tbody.innerHTML = invites.map(inv => {
            const origin = window.location.origin;
            const fullUrl = `${origin}/?invite=${encodeURIComponent(inv.token)}`;

            let statusBadge = '';
            let timeDisplay = '';
            const expiresDate = new Date(inv.expiresAt);
            const now = Date.now();
            const diffHours = Math.round((expiresDate.getTime() - now) / (1000 * 60 * 60));

            if (inv.status === 'completed') {
                statusBadge = `<span class="score-badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3);">Completed</span>`;
                timeDisplay = `<span style="font-size: 0.8rem; color: #94a3b8;">Used ${new Date(inv.usedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>`;
            } else if (inv.status === 'expired' || expiresDate.getTime() < now) {
                statusBadge = `<span class="score-badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3);">Expired</span>`;
                timeDisplay = `<span style="font-size: 0.8rem; color: #ef4444;">Expired on ${expiresDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>`;
            } else {
                statusBadge = `<span class="score-badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);">Active</span>`;
                timeDisplay = `<span style="font-size: 0.8rem; color: #38bdf8;">Expires in ~${Math.max(1, diffHours)}h</span>`;
            }

            return `
                <tr>
                    <td>
                        <div style="font-weight: 600; color: #fff;">${escapeHtml(inv.candidateName)}</div>
                        ${inv.email ? `<div style="font-size: 0.78rem; color: #94a3b8;">${escapeHtml(inv.email)}</div>` : ''}
                    </td>
                    <td>
                        <span style="font-size: 0.85rem; color: #cbd5e1;">${escapeHtml(inv.targetRole)}</span>
                    </td>
                    <td>${statusBadge}</td>
                    <td>${timeDisplay}</td>
                    <td>
                        <div style="display: flex; gap: 0.4rem;">
                            ${inv.status === 'active' ? `
                                <button type="button" class="btn-secondary btn-sm btn-copy-row" data-url="${fullUrl}" title="Copy Link">
                                    📋
                                </button>
                            ` : ''}
                            <button type="button" class="btn-secondary btn-sm text-danger btn-delete-invite" data-id="${inv.id}" title="Delete Invite">
                                🗑️
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        // Bind copy buttons
        tbody.querySelectorAll('.btn-copy-row').forEach(btn => {
            btn.addEventListener('click', () => {
                copyToClipboard(btn.dataset.url, btn);
            });
        });

        // Bind delete buttons
        tbody.querySelectorAll('.btn-delete-invite').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (confirm("Delete this candidate invitation?")) {
                    await deleteInvite(btn.dataset.id);
                }
            });
        });
    }

    async function handleCreateInvite(e) {
        e.preventDefault();
        const nameInput = document.getElementById('inv-candidate-name');
        const roleInput = document.getElementById('inv-target-role');
        const emailInput = document.getElementById('inv-email');
        const durationSelect = document.getElementById('inv-duration');
        const submitBtn = document.getElementById('btn-submit-invite');

        const candidateName = nameInput.value.trim();
        const targetRole = roleInput.value.trim();
        const email = emailInput.value.trim();
        const durationHours = parseInt(durationSelect.value, 10) || 24;

        if (!candidateName) {
            toast("Please enter the candidate's full name.", "error");
            return;
        }

        try {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<span>Creating link...</span>`;

            const res = await api('/invites', {
                method: 'POST',
                body: { candidateName, targetRole, email, durationHours }
            });

            toast(`Invitation link generated for ${res.invite.candidateName}!`, "success");
            nameInput.value = '';
            emailInput.value = '';

            const origin = window.location.origin;
            const fullUrl = `${origin}/?invite=${encodeURIComponent(res.invite.token)}`;

            const resultBox = document.getElementById('new-invite-box');
            const urlInput = document.getElementById('new-invite-url');
            const waBtn = document.getElementById('btn-whatsapp-new-invite');
            const expiryBadge = document.getElementById('new-invite-expiry-badge');

            if (resultBox && urlInput) {
                urlInput.value = fullUrl;
                expiryBadge.textContent = `${durationHours}h Validity`;
                const message = encodeURIComponent(`Hello ${res.invite.candidateName},\n\nYou have been invited to complete your AI technical interview for ${res.invite.targetRole}.\n\nAccess your interview here: ${fullUrl}\n\nNote: This link is valid for ${durationHours} hours and can only be used once.`);
                waBtn.href = `https://api.whatsapp.com/send?text=${message}`;
                resultBox.classList.remove('hidden');
            }

            await loadInvites();
        } catch (err) {
            toast("Failed to generate invite: " + err.message, "error");
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<span>Generate Secure Invite Link</span> <span class="btn-arrow">→</span>`;
        }
    }

    async function deleteInvite(id) {
        try {
            await api(`/invites/${id}`, { method: 'DELETE' });
            toast("Invitation removed.", "info");
            await loadInvites();
        } catch (err) {
            toast("Failed to delete invite: " + err.message, "error");
        }
    }

    function copyToClipboard(text, btnElement) {
        navigator.clipboard.writeText(text).then(() => {
            toast("Link copied to clipboard!", "success");
            if (btnElement) {
                const oldText = btnElement.innerHTML;
                btnElement.innerHTML = "✓ Copied!";
                setTimeout(() => btnElement.innerHTML = oldText, 2000);
            }
        }).catch(() => {
            prompt("Copy this interview link:", text);
        });
    }

    // --- Helper Utilities ---
    function setInputValue(id, val) {
        const el = document.getElementById(id);
        if (el) el.value = val ?? '';
    }

    function escapeHtml(str) {
        return String(str || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function toast(message, type = "info") {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<span class="toast-dot"></span><span>${message}</span>`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    }

    // --- Initialization ---
    function init() {
        const token = localStorage.getItem(AUTH_TOKEN_KEY);
        if (!token) {
            showLoginOverlay();
        } else {
            hideLoginOverlay();
            refreshAllData();
        }

        // Login & Logout
        document.getElementById('login-form')?.addEventListener('submit', handleLogin);
        document.getElementById('logout-btn')?.addEventListener('click', handleLogout);

        // Sidebar Navigation
        document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
            btn.onclick = () => switchView(btn.dataset.view);
        });

        // Refresh buttons
        document.getElementById('btn-refresh-status')?.addEventListener('click', loadSystemStatus);
        document.getElementById('btn-refresh-invites')?.addEventListener('click', loadInvites);
        document.getElementById('btn-refresh-interviews')?.addEventListener('click', loadInterviews);

        // Invite form & copy
        document.getElementById('form-create-invite')?.addEventListener('submit', handleCreateInvite);
        document.getElementById('btn-copy-new-invite')?.addEventListener('click', () => {
            const url = document.getElementById('new-invite-url')?.value;
            if (url) copyToClipboard(url, document.getElementById('btn-copy-new-invite'));
        });

        // Filter pills & Search
        document.querySelectorAll('.filter-pills .filter-pill').forEach(pill => {
            pill.onclick = () => {
                document.querySelectorAll('.filter-pills .filter-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                currentFilter = pill.dataset.filter;
                renderInterviewsTable();
            };
        });

        document.getElementById('filter-search')?.addEventListener('input', (e) => {
            searchQuery = e.target.value.trim();
            renderInterviewsTable();
        });

        // Settings Form
        document.getElementById('settings-form')?.addEventListener('submit', saveSettings);

        // Modal Close & Tabs
        document.getElementById('btn-close-modal')?.addEventListener('click', closeReportModal);
        document.getElementById('report-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'report-modal') closeReportModal();
        });
        document.querySelectorAll('.report-nav-tabs .tab-btn').forEach(btn => {
            btn.onclick = () => switchReportTab(btn.dataset.tab);
        });

        // Close modal on Escape
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeReportModal();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
