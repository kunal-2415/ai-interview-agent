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

        this.init();
    }

    async init() {
        this.initSpeechRecognition();
        this.bindEvents();
        await this.loadAppConfig();
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

        document.getElementById('consent-recording')?.addEventListener('change', (e) => {
            const btn = document.getElementById('btn-start-interview');
            if (btn) btn.disabled = !e.target.checked;
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

        try {
            if (label) label.textContent = "Connecting devices...";
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            this.mediaStream = stream;

            if (video) {
                video.srcObject = stream;
                placeholder?.classList.add('hidden');
            }

            if (label) {
                label.textContent = "Camera & Mic Active";
                label.style.color = "#10b981";
            }

            this.setupAudioVisualizer(stream, 'vu-bar');
            this.toast("Devices connected successfully!");
        } catch (err) {
            console.error(err);
            if (label) {
                label.textContent = "Access Denied / Not Found";
                label.style.color = "#ef4444";
            }
            this.toast("Could not access camera/microphone. Please allow browser permissions.", "error");
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
        const consent = document.getElementById('consent-recording')?.checked;
        if (!consent) {
            this.toast("Please consent to the recording and proctoring rules.", "error");
            return;
        }

        try {
            const data = await this.api('/api/interview/begin', { consent: true });
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
                this.mediaStream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { max: 15 } },
                    audio: true
                }).catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
            }

            const liveVideo = document.getElementById('live-candidate-video');
            if (liveVideo && this.mediaStream.getVideoTracks().length > 0) {
                liveVideo.srcObject = this.mediaStream;
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
            this.toast("Recording started with audio only.", "info");
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
