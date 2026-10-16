/**
 * AI Interview Agent - Candidate Client Controller
 * Manages Full Candidate Lifecycle:
 * LOGIN -> CV_UPLOAD -> READY -> LIVE -> FINISHED / LOCKED
 * Includes Real-time Audio/Video Proctoring, Speech Recognition, and Anti-Cheating
 */

class CandidateInterviewApp {
    constructor() {
        this.token = null;
        this.candidateName = "";
        this.state = "LOGIN";
        this.currentQuestionData = null;
        this.questionStartTime = 0;
        this.sessionStartTime = 0;
        this.timerInterval = null;

        // Media & Speech
        this.mediaStream = null;
        this.mediaRecorder = null;
        this.audioContext = null;
        this.analyser = null;
        this.speechSynthesis = window.speechSynthesis;
        this.recognition = null;
        this.isRecognizing = false;
        this.selectedFile = null;

        // Strict Hardware Enforcement State
        this.hardwareVerified = false;
        this.hasCamera = false;
        this.hasMic = false;

        this.init();
    }

    async init() {
        this.initSpeechRecognition();
        this.bindEvents();
        await this.loadAppConfig();
        await this.checkInviteParameter();
    }

    async loadAppConfig() {
        try {
            const res = await fetch('/api/config');
            if (res.ok) {
                const config = await res.json();
                if (config.companyName) {
                    document.getElementById('nav-company-name').textContent = config.companyName;
                }
                if (config.targetRole) {
                    document.getElementById('nav-target-role').textContent = config.targetRole;
                    document.getElementById('login-role-chip').textContent = `${config.targetRole} Assessment`;
                    document.getElementById('live-role-badge').textContent = config.targetRole;
                }
            }
        } catch (e) {
            console.warn("Could not load config", e);
        }
    }

    async checkInviteParameter() {
        const urlParams = new URLSearchParams(window.location.search);
        const inviteToken = urlParams.get('invite');
        if (!inviteToken) return;

        this.inviteToken = inviteToken;
        const loginCard = document.querySelector('.login-card');
        if (!loginCard) return;

        try {
            const res = await fetch(`/api/invite/verify?token=${encodeURIComponent(inviteToken)}`);
            const data = await res.json();

            if (res.ok && data.ok) {
                const expireDate = new Date(data.expiresAt);
                const expireStr = expireDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', ' + expireDate.toLocaleDateString();

                loginCard.innerHTML = `
                    <div class="card-header text-center">
                        <div class="role-chip glow-pill" style="border-color: #38bdf8; color: #38bdf8;">Verified Candidate Invitation</div>
                        <h1 class="card-title" style="margin-top: 12px; font-size: 1.8rem;">Welcome, ${data.candidateName}!</h1>
                        <p class="card-subtitle">You have been personally invited for the <strong>${data.targetRole || 'Technical'}</strong> interview.</p>
                    </div>

                    <div class="invite-info-box" style="margin: 20px 0; padding: 18px; border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 12px; background: rgba(15, 23, 42, 0.65);">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                            <span style="font-size: 0.85rem; color: #94a3b8;">Target Role:</span>
                            <span style="font-weight: 600; color: #38bdf8;">${data.targetRole}</span>
                        </div>
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                            <span style="font-size: 0.85rem; color: #94a3b8;">Link Expiry:</span>
                            <span style="font-weight: 500; color: #f59e0b;">${expireStr}</span>
                        </div>
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <span style="font-size: 0.85rem; color: #94a3b8;">Security:</span>
                            <span style="font-size: 0.82rem; color: #10b981; font-weight: 600;">🔒 Single-Use Verified Token</span>
                        </div>
                    </div>

                    <div class="security-banner" style="margin-bottom: 24px;">
                        <span class="security-icon">🛡️</span>
                        <span>This link is single-use and will expire immediately after you finish. Password is not required.</span>
                    </div>

                    <button type="button" class="btn-primary btn-glow" id="btn-invite-start" style="width: 100%;">
                        <span>Begin Setup & CV Upload</span>
                        <span class="btn-arrow">→</span>
                    </button>
                `;

                document.getElementById('btn-invite-start')?.addEventListener('click', async () => {
                    const btn = document.getElementById('btn-invite-start');
                    btn.disabled = true;
                    btn.innerHTML = `<span>Starting Interview Session...</span>`;
                    try {
                        const loginData = await this.api('/api/invite/login', { token: this.inviteToken });
                        this.token = loginData.token;
                        this.candidateName = loginData.name;
                        this.transitionTo('CV_UPLOAD');
                        this.toast(`Welcome, ${loginData.name}! Please upload your CV.`);
                    } catch (err) {
                        btn.disabled = false;
                        btn.innerHTML = `<span>Begin Setup & CV Upload</span><span class="btn-arrow">→</span>`;
                        this.toast(err.error || "Failed to start interview session.", "error");
                    }
                });
            } else {
                let errorTitle = "Invitation Expired";
                let errorIcon = "⏳";
                let errorMsg = data.error || "This interview invitation is no longer active.";
                let badgeColor = "#ef4444";

                if (data.status === 'completed') {
                    errorTitle = "Interview Already Completed";
                    errorIcon = "✅";
                    badgeColor = "#a855f7";
                }

                loginCard.innerHTML = `
                    <div class="card-header text-center" style="padding: 15px 10px;">
                        <div style="font-size: 3rem; margin-bottom: 12px;">${errorIcon}</div>
                        <div class="role-chip" style="background: rgba(239, 68, 68, 0.15); border-color: ${badgeColor}; color: ${badgeColor};">${errorTitle}</div>
                        <h2 class="card-title" style="margin-top: 14px; font-size: 1.5rem;">${errorTitle}</h2>
                        <p class="card-subtitle" style="color: #cbd5e1; max-width: 440px; margin: 12px auto; line-height: 1.6;">${errorMsg}</p>
                        ${data.candidateName ? `<p style="font-size: 0.9rem; color: #94a3b8;">Candidate: <strong>${data.candidateName}</strong></p>` : ''}
                    </div>

                    <div style="margin: 20px 0; padding: 16px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; background: rgba(15, 23, 42, 0.5); text-align: center;">
                        <p style="font-size: 0.85rem; color: #94a3b8; margin: 0;">
                            If you require a new invitation link or need to reschedule, please contact your recruitment team or hiring manager.
                        </p>
                    </div>

                    <a href="/" class="btn-secondary btn-sm" style="display: block; text-align: center; margin-top: 10px; text-decoration: none;">
                        Return to Portal Homepage
                    </a>
                `;
            }
        } catch (e) {
            console.error("Invite check error:", e);
        }
    }

    initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn("Speech recognition is not supported in this browser. Fallback to manual text.");
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
            let finalTranscript = "";
            let interimTranscript = "";

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript + " ";
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }

            const input = document.getElementById('candidate-answer-text');
            if (input) {
                if (finalTranscript) {
                    input.value = (input.value ? input.value.trim() + " " : "") + finalTranscript.trim();
                }
            }
        };

        recognition.onerror = (event) => {
            console.warn("STT warning:", event.error);
            if (event.error === 'not-allowed') {
                this.isRecognizing = false;
                this.updateMicUi(false);
            }
        };

        recognition.onend = () => {
            if (this.isRecognizing && this.state === 'LIVE') {
                try { recognition.start(); } catch (_) {}
            }
        };

        this.recognition = recognition;
    }

    bindEvents() {
        // --- 1. Login Form ---
        document.getElementById('form-login')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('login-name').value.trim();
            const password = document.getElementById('login-password').value.trim();

            try {
                const data = await this.api('/api/login', { name, password });
                this.token = data.token;
                this.candidateName = data.name;
                this.transitionTo('CV_UPLOAD');
                this.toast(`Welcome, ${data.name}! Please upload your CV.`);
            } catch (err) {
                this.toast(err.error || "Login verification failed.", "error");
            }
        });

        // --- 2. CV Upload & Dropzone ---
        const dropzone = document.getElementById('cv-dropzone');
        const fileInput = document.getElementById('cv-upload');
        const browseBtn = document.getElementById('btn-browse-file');

        browseBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.click();
        });

        dropzone?.addEventListener('click', () => fileInput.click());

        // Drag and drop handlers
        ['dragenter', 'dragover'].forEach(name => {
            dropzone?.addEventListener(name, (e) => {
                e.preventDefault();
                dropzone.classList.add('dragover');
            });
        });

        ['dragleave', 'drop'].forEach(name => {
            dropzone?.addEventListener(name, (e) => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
            });
        });

        dropzone?.addEventListener('drop', (e) => {
            if (e.dataTransfer.files?.length) {
                this.handleFileSelected(e.dataTransfer.files[0]);
            }
        });

        fileInput?.addEventListener('change', (e) => {
            if (e.target.files?.length) {
                this.handleFileSelected(e.target.files[0]);
            }
        });

        document.getElementById('remove-file')?.addEventListener('click', () => {
            this.selectedFile = null;
            fileInput.value = "";
            document.getElementById('file-preview').classList.add('hidden');
            document.getElementById('cv-dropzone').classList.remove('hidden');
            this.checkCvAnalyzeEligibility();
        });

        document.getElementById('cv-text-manual')?.addEventListener('input', () => {
            this.checkCvAnalyzeEligibility();
        });

        document.getElementById('btn-analyze-cv')?.addEventListener('click', async () => {
            await this.uploadAndAnalyzeCv();
        });

        // --- 3. Ready View ---
        document.getElementById('btn-test-devices')?.addEventListener('click', async () => {
            await this.testDevices();
        });

        document.getElementById('consent-recording')?.addEventListener('change', () => {
            this.updateStartButtonState();
        });

        document.getElementById('btn-start-interview')?.addEventListener('click', async () => {
            await this.startInterview();
        });

        // --- 4. Live Interview View ---
        document.getElementById('btn-replay-audio')?.addEventListener('click', () => {
            if (this.currentQuestionData?.spoken) {
                this.speak(this.currentQuestionData.spoken);
            }
        });

        document.getElementById('btn-toggle-mic')?.addEventListener('click', () => {
            this.toggleMic();
        });

        document.getElementById('btn-clear-transcript')?.addEventListener('click', () => {
            const input = document.getElementById('candidate-answer-text');
            if (input) input.value = "";
        });

        document.getElementById('btn-skip-question')?.addEventListener('click', async () => {
            await this.skipQuestion();
        });

        document.getElementById('btn-submit-answer')?.addEventListener('click', async () => {
            await this.submitAnswer();
        });

        document.getElementById('btn-dismiss-strike')?.addEventListener('click', () => {
            document.getElementById('strike-modal')?.classList.add('hidden');
            this.requestFullscreen();
        });

        // Anti-Cheating & Proctoring Listeners
        window.addEventListener('blur', () => this.reportIntegrity('window_blur', 'Window focus lost. Candidate switched application.'));
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.reportIntegrity('tab_hidden', 'Candidate switched tabs or minimized browser window.');
            }
        });

        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement && this.state === 'LIVE') {
                this.reportIntegrity('fullscreen_exit', 'Candidate exited proctored fullscreen mode.');
            }
        });

        // Copy / Cut / Paste & Shortcut Protection
        ['copy', 'cut'].forEach(event => {
            document.addEventListener(event, (e) => {
                if (this.state === 'LIVE') {
                    e.preventDefault();
                    this.reportIntegrity('copy_attempt', 'Attempted to copy content from interview stage.');
                }
            });
        });

        window.addEventListener('keydown', (e) => {
            if (this.state !== 'LIVE') return;
            // Block DevTools shortcuts: F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U
            if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J')) || (e.ctrlKey && e.key === 'u')) {
                e.preventDefault();
                this.reportIntegrity('shortcut_blocked', `Blocked developer shortcut: ${e.key}`);
            }
        });
    }

    handleFileSelected(file) {
        if (!file) return;
        this.selectedFile = file;

        document.getElementById('file-name').textContent = file.name;
        document.getElementById('file-size').textContent = `${(file.size / 1024).toFixed(1)} KB`;
        document.getElementById('file-preview').classList.remove('hidden');
        document.getElementById('cv-dropzone').classList.add('hidden');

        this.checkCvAnalyzeEligibility();
    }

    checkCvAnalyzeEligibility() {
        const manualText = document.getElementById('cv-text-manual')?.value.trim() || "";
        const canAnalyze = Boolean(this.selectedFile || manualText.length >= 50);
        const btn = document.getElementById('btn-analyze-cv');
        if (btn) btn.disabled = !canAnalyze;
    }

    async uploadAndAnalyzeCv() {
        const manualText = document.getElementById('cv-text-manual')?.value.trim() || "";
        let file = this.selectedFile;

        if (!file && manualText) {
            file = new File([manualText], "cv.txt", { type: "text/plain" });
        }

        if (!file) {
            this.toast("Please upload a CV file or paste resume text.", "error");
            return;
        }

        const loader = document.getElementById('cv-loader');
        loader?.classList.remove('hidden');

        try {
            const formData = new FormData();
            formData.append('cv', file);

            const res = await fetch('/api/cv', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token}` },
                body: formData,
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: "CV analysis failed" }));
                throw err;
            }

            const data = await res.json();
            this.transitionTo('READY');
            this.renderReadyProfile(data);
            this.toast("CV analysis complete! Interview plan ready.");
        } catch (err) {
            this.toast(err.error || "CV upload or analysis failed.", "error");
        } finally {
            loader?.classList.add('hidden');
        }
    }

    renderReadyProfile(data) {
        if (data.detectedRole) {
            const roleEl = document.getElementById('summary-detected-role');
            if (roleEl) roleEl.textContent = data.detectedRole;
            const liveBadge = document.getElementById('live-role-badge');
            if (liveBadge) liveBadge.textContent = data.detectedRole;
            const navRole = document.getElementById('nav-target-role');
            if (navRole) navRole.textContent = data.detectedRole;
        }

        const seniorityEl = document.getElementById('summary-seniority');
        if (seniorityEl) {
            seniorityEl.textContent = (data.seniority || "Senior").toUpperCase();
        }

        const countEl = document.getElementById('summary-question-count');
        if (countEl && data.questionCount) {
            countEl.textContent = `${data.questionCount} Questions`;
        }

        const topicsContainer = document.getElementById('summary-topics');
        if (topicsContainer && Array.isArray(data.topics)) {
            topicsContainer.innerHTML = data.topics.map(t => `<span class="tag">${t}</span>`).join('');
        }
    }

    async testDevices() {
        const label = document.getElementById('hw-status-label');
        const video = document.getElementById('camera-test-video');
        const placeholder = document.getElementById('camera-placeholder');
        const cameraPill = document.getElementById('camera-status-pill');
        const micPill = document.getElementById('mic-status-pill');
        const alertBox = document.getElementById('hw-alert-box');

        try {
            if (label) {
                label.textContent = "Checking devices...";
                label.style.color = "#fbbf24";
            }
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error("MediaDevices API is not available or insecure context (HTTPS required).");
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { max: 20 } },
                audio: true,
            });
            this.mediaStream = stream;

            const videoTracks = stream.getVideoTracks();
            const audioTracks = stream.getAudioTracks();

            this.hasCamera = Boolean(videoTracks.length && videoTracks[0].readyState === 'live');
            this.hasMic = Boolean(audioTracks.length && audioTracks[0].readyState === 'live');
            this.hardwareVerified = this.hasCamera && this.hasMic;

            if (video && this.hasCamera) {
                video.srcObject = stream;
                placeholder?.classList.add('hidden');
            }

            if (this.hardwareVerified) {
                if (label) {
                    label.textContent = "Camera & Mic Verified";
                    label.style.color = "#10b981";
                }
                if (cameraPill) {
                    cameraPill.textContent = "✅ Camera: Verified";
                    cameraPill.className = "device-pill pill-verified";
                }
                if (micPill) {
                    micPill.textContent = "✅ Mic: Verified";
                    micPill.className = "device-pill pill-verified";
                }
                alertBox?.classList.add('hidden');
                this.setupAudioVisualizer(stream, 'vu-bar');
                this.toast("Webcam and microphone verified successfully!", "success");
            } else {
                throw new Error("Both camera and microphone are required for proctored interview.");
            }
        } catch (err) {
            console.error("Hardware test failed:", err);
            this.hardwareVerified = false;
            this.hasCamera = false;
            this.hasMic = false;

            if (label) {
                label.textContent = "Verification Failed";
                label.style.color = "#ef4444";
            }
            if (cameraPill) {
                cameraPill.textContent = "❌ Camera: Not Detected";
                cameraPill.className = "device-pill pill-failed";
            }
            if (micPill) {
                micPill.textContent = "❌ Mic: Not Detected";
                micPill.className = "device-pill pill-failed";
            }
            alertBox?.classList.remove('hidden');
            this.toast("Webcam & microphone are strictly required. Please connect devices to proceed.", "error");
        } finally {
            this.updateStartButtonState();
        }
    }

    updateStartButtonState() {
        const consent = document.getElementById('consent-recording')?.checked;
        const btn = document.getElementById('btn-start-interview');
        if (!btn) return;

        if (!this.hardwareVerified) {
            btn.disabled = true;
            btn.classList.remove('btn-glow');
            btn.innerHTML = `<span>🔒 Connect Camera & Mic to Enable</span>`;
        } else if (!consent) {
            btn.disabled = true;
            btn.classList.remove('btn-glow');
            btn.innerHTML = `<span>Check Consent Box to Proceed</span>`;
        } else {
            btn.disabled = false;
            btn.classList.add('btn-glow');
            btn.innerHTML = `<span>Enter Proctored Interview</span> <span class="btn-arrow">🚀</span>`;
        }
    }

    setupAudioVisualizer(stream, barId) {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioCtx();
            const source = this.audioContext.createMediaStreamSource(stream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 64;
            source.connect(this.analyser);

            const bufferLength = this.analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            const bar = document.getElementById(barId);

            const updateMeter = () => {
                if (!this.analyser) return;
                this.analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
                const avg = sum / bufferLength;
                const percent = Math.min(100, Math.round((avg / 128) * 100));
                if (bar) bar.style.width = `${percent}%`;
                requestAnimationFrame(updateMeter);
            };
            updateMeter();
        } catch (e) {
            console.warn("Visualizer init failed", e);
        }
    }

    async startInterview() {
        if (!this.hardwareVerified || !this.mediaStream) {
            this.toast("Webcam and microphone are strictly mandatory. Cannot enter interview without working hardware.", "error");
            document.getElementById('hw-alert-box')?.classList.remove('hidden');
            return;
        }

        const videoTracks = this.mediaStream.getVideoTracks();
        const audioTracks = this.mediaStream.getAudioTracks();
        if (!videoTracks.length || !audioTracks.length) {
            this.toast("Active camera and microphone tracks are required.", "error");
            return;
        }

        const consent = document.getElementById('consent-recording')?.checked;
        if (!consent) {
            this.toast("Please consent to the recording and proctoring rules.", "error");
            return;
        }

        try {
            const data = await this.api('/api/interview/begin', {
                consent: true,
                hasDevices: true,
                hasCamera: true,
                hasMic: true,
            });
            this.transitionTo('LIVE');
            await this.requestFullscreen();
            await this.startMediaRecording();

            this.sessionStartTime = Date.now();
            this.startSessionTimer();

            this.handleNewQuestion(data);
        } catch (err) {
            this.toast(err.error || "Failed to start interview.", "error");
        }
    }

    async startMediaRecording() {
        try {
            if (!this.mediaStream) {
                throw new Error("No media stream available for proctoring");
            }

            const liveVideo = document.getElementById('live-candidate-video');
            if (liveVideo && this.mediaStream.getVideoTracks().length > 0) {
                liveVideo.srcObject = this.mediaStream;
            }

            // Monitor disconnection of camera or mic during live interview
            const videoTrack = this.mediaStream.getVideoTracks()[0];
            const audioTrack = this.mediaStream.getAudioTracks()[0];
            if (videoTrack) {
                videoTrack.onended = () => {
                    this.reportIntegrity('camera_disconnected', 'Webcam was disconnected during interview.');
                    this.toast("CRITICAL: Camera disconnected! Please reconnect immediately.", "error");
                };
            }
            if (audioTrack) {
                audioTrack.onended = () => {
                    this.reportIntegrity('mic_disconnected', 'Microphone was disconnected during interview.');
                    this.toast("CRITICAL: Microphone disconnected! Please reconnect immediately.", "error");
                };
            }

            // Choose mimeType supported by browser
            const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
                ? 'video/webm;codecs=vp8,opus'
                : MediaRecorder.isTypeSupported('video/webm')
                ? 'video/webm'
                : 'audio/webm';

            this.mediaRecorder = new MediaRecorder(this.mediaStream, { mimeType });
            this.mediaRecorder.ondataavailable = async (e) => {
                if (e.data && e.data.size > 0) {
                    await this.uploadRecordingChunk(e.data);
                }
            };
            this.mediaRecorder.start(3000); // chunk every 3 seconds
        } catch (err) {
            console.warn("Recording setup issue:", err);
            this.reportIntegrity('hardware_failure', 'Proctoring recorder failed to initialize.');
            this.toast("Could not start proctoring video stream.", "error");
        }
    }

    async uploadRecordingChunk(blob) {
        if (!this.token) return;
        const chunkId = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        try {
            await fetch('/api/recording/chunk', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'x-chunk-id': chunkId,
                    'Content-Type': 'application/octet-stream'
                },
                body: blob
            });
        } catch (err) {
            console.error("Chunk upload error", err);
        }
    }

    handleNewQuestion(questionData) {
        if (questionData.done) {
            this.finishInterview();
            return;
        }

        this.currentQuestionData = questionData;
        this.questionStartTime = Date.now();

        // Update UI
        document.getElementById('current-question').textContent = questionData.questionNumber;
        document.getElementById('total-questions').textContent = questionData.questionTotal;
        document.getElementById('strike-count').textContent = questionData.strikes;

        const followUpBadge = document.getElementById('follow-up-badge');
        if (followUpBadge) {
            followUpBadge.classList.toggle('hidden', !questionData.followUp);
        }

        const topicBadge = document.getElementById('current-topic-badge');
        if (topicBadge) {
            topicBadge.textContent = questionData.topic || `Technical Domain`;
        }

        document.getElementById('ai-speech-text').textContent = questionData.spoken;

        // Context / Code Snippet
        const codePanel = document.getElementById('prompt-code-panel');
        const codeContent = document.getElementById('on-screen-content');
        if (questionData.onScreen && questionData.onScreen.trim().length > 0) {
            codePanel?.classList.remove('hidden');
            if (codeContent) codeContent.textContent = questionData.onScreen;
        } else {
            codePanel?.classList.add('hidden');
        }

        // Reset Candidate Answer box
        const answerBox = document.getElementById('candidate-answer-text');
        if (answerBox) answerBox.value = "";

        // Start Answer Timer
        this.startAnswerTimer();

        // 1. Speak the AI question
        this.speak(questionData.spoken).then(() => {
            // 2. Automatically activate Speech Recognition after AI finishes speaking
            this.startListening();
        });
    }

    speak(text) {
        return new Promise((resolve) => {
            if (!this.speechSynthesis) {
                resolve();
                return;
            }
            this.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 1.0;
            utterance.pitch = 1.0;

            const voiceStatus = document.getElementById('voice-status-text');
            const voiceLabel = document.getElementById('voice-label');
            if (voiceStatus) voiceStatus.classList.add('speaking');
            if (voiceLabel) voiceLabel.textContent = "Interviewer Speaking...";

            utterance.onend = () => {
                if (voiceStatus) voiceStatus.classList.remove('speaking');
                if (voiceLabel) voiceLabel.textContent = "Listening to Candidate";
                resolve();
            };

            utterance.onerror = () => {
                if (voiceStatus) voiceStatus.classList.remove('speaking');
                if (voiceLabel) voiceLabel.textContent = "Ready";
                resolve();
            };

            this.speechSynthesis.speak(utterance);
        });
    }

    startListening() {
        if (!this.recognition || this.isRecognizing) return;
        try {
            this.recognition.start();
            this.isRecognizing = true;
            this.updateMicUi(true);
        } catch (_) {}
    }

    stopListening() {
        if (!this.recognition || !this.isRecognizing) return;
        try {
            this.recognition.stop();
            this.isRecognizing = false;
            this.updateMicUi(false);
        } catch (_) {}
    }

    toggleMic() {
        if (this.isRecognizing) {
            this.stopListening();
        } else {
            this.startListening();
        }
    }

    updateMicUi(isActive) {
        const btn = document.getElementById('btn-toggle-mic');
        const label = document.getElementById('mic-status-label');
        if (btn) btn.classList.toggle('active', isActive);
        if (label) label.textContent = isActive ? "Listening (Click to Pause)" : "Mic Paused (Click to Speak)";
    }

    startAnswerTimer() {
        const timerEl = document.getElementById('answer-timer');
        if (this.answerInterval) clearInterval(this.answerInterval);
        this.answerInterval = setInterval(() => {
            const elapsedSec = Math.floor((Date.now() - this.questionStartTime) / 1000);
            const m = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
            const s = String(elapsedSec % 60).padStart(2, '0');
            if (timerEl) timerEl.textContent = `${m}:${s}`;
        }, 1000);
    }

    startSessionTimer() {
        const timerEl = document.getElementById('session-timer');
        this.timerInterval = setInterval(() => {
            const elapsedSec = Math.floor((Date.now() - this.sessionStartTime) / 1000);
            const m = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
            const s = String(elapsedSec % 60).padStart(2, '0');
            if (timerEl) timerEl.textContent = `${m}:${s}`;
        }, 1000);
    }

    async submitAnswer() {
        if (this.state !== 'LIVE') return;
        const answer = document.getElementById('candidate-answer-text')?.value.trim() || "";

        if (answer.length < 5) {
            this.toast("Please speak or write your answer before submitting.", "error");
            return;
        }

        const answerMs = Date.now() - this.questionStartTime;
        const submitBtn = document.getElementById('btn-submit-answer');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<span>Evaluating Response...</span> <span class="spinner-small"></span>`;
        }

        try {
            this.stopListening();
            const result = await this.api('/api/answer', {
                answer,
                answerMs,
            });

            if (result.done) {
                await this.finishInterview();
            } else {
                this.handleNewQuestion(result);
            }
        } catch (err) {
            this.toast(err.error || "Failed to submit answer.", "error");
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = `<span>Submit Answer & Continue</span> <span class="btn-arrow">→</span>`;
            }
        }
    }

    async skipQuestion() {
        if (this.state !== 'LIVE') return;
        const skipBtn = document.getElementById('btn-skip-question');
        if (skipBtn) {
            skipBtn.disabled = true;
            skipBtn.textContent = "Moving to next...";
        }
        try {
            this.stopListening();
            const result = await this.api('/api/answer', {
                skip: true,
                answer: "Candidate requested to move to the next question.",
                answerMs: Date.now() - this.questionStartTime,
            });
            if (result.done) {
                await this.finishInterview();
            } else {
                this.handleNewQuestion(result);
            }
        } catch (err) {
            this.toast(err.error || "Could not skip question.", "error");
        } finally {
            if (skipBtn) {
                skipBtn.disabled = false;
                skipBtn.innerHTML = `<span>⏭️ Skip / Move On</span>`;
            }
        }
    }

    async reportIntegrity(type, detail) {
        if (this.state !== 'LIVE') return;
        try {
            const result = await this.api('/api/integrity', { type, detail });
            document.getElementById('strike-count').textContent = result.strikes;

            if (result.locked) {
                this.transitionTo('LOCKED');
                this.stopAllMedia();
                return;
            }

            if (result.strike) {
                const strikeModal = document.getElementById('strike-modal');
                const warningMsg = document.getElementById('strike-warning-message');
                const strikeNum = document.getElementById('modal-strike-num');

                if (warningMsg) warningMsg.textContent = `${detail} Strike recorded!`;
                if (strikeNum) strikeNum.textContent = result.strikes;
                strikeModal?.classList.remove('hidden');
            }
        } catch (err) {
            console.warn("Integrity report error", err);
        }
    }

    async finishInterview() {
        try {
            await this.api('/api/finish');
            this.stopAllMedia();
            this.transitionTo('FINISHED');
        } catch (err) {
            this.toast(err.error || "Error finalizing interview.", "error");
        }
    }

    stopAllMedia() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
        }
        if (this.answerInterval) clearInterval(this.answerInterval);
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.stopListening();
    }

    async requestFullscreen() {
        try {
            if (!document.fullscreenElement) {
                await document.documentElement.requestFullscreen();
            }
        } catch (_) {}
    }

    transitionTo(state) {
        this.state = state;
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

        const viewMap = {
            'LOGIN': 'view-login',
            'CV_UPLOAD': 'view-cv',
            'READY': 'view-ready',
            'LIVE': 'view-live',
            'FINISHED': 'view-finished',
            'LOCKED': 'view-locked'
        };

        const target = document.getElementById(viewMap[state]);
        if (target) target.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });

        if (state === 'READY') {
            this.updateStartButtonState();
            setTimeout(() => this.testDevices(), 300);
        }
    }

    async api(endpoint, body = {}, options = {}) {
        const headers = { 'Content-Type': 'application/json' };
        if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

        const res = await fetch(endpoint, {
            method: options.method || 'POST',
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
            throw err;
        }
        return res.json();
    }

    toast(message, type = "info") {
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
}

// Instantiate Candidate App when DOM is loaded
window.addEventListener('DOMContentLoaded', () => {
    new CandidateInterviewApp();
});
