# 🤖 AI Technical Interview Agent

An enterprise-grade, autonomous AI technical interviewer and proctoring suite built with Node.js and modern vanilla web technologies. Features real-time resume parsing, speech recognition, anti-cheating monitoring, multidimensional candidate scoring, and an executive hiring dashboard.

---

## 🌟 Key Features

### 👤 Candidate Experience (`/`)
- **Smart CV Ingestion**: Supports `.pdf`, `.docx`, and `.txt` resume uploads (or direct text paste). Automatically extracts candidate seniority, core technical competencies, and architectural domains.
- **Hardware Calibration**: Interactive camera and microphone test with real-time VU meter audio visualizer before the interview begins.
- **Interactive AI Interviewer**:
  - Spoken voice synthesis (Text-to-Speech) with dynamic audio waveform visualizer and "Replay Voice" controls.
  - Contextual code/system design prompts displayed in a syntax-styled console.
  - Continuous Speech-to-Text (STT) recognition with an editable response station so candidates can review, refine, or type answers.
- **Proctoring & Anti-Cheat Engine**:
  - Fullscreen enforcement throughout the live stage.
  - Real-time strike tracking for window blur, tab switching, and unauthorized shortcuts (F12, DevTools).
  - Configurable strike threshold (default: 3 strikes) before automatic session termination.
  - Live candidate webcam feed and chunked media recording (`.webm`) streamed to the backend.

### 🛡️ Admin Intelligence Dashboard (`/admin`)
- **Executive Metrics Ribbon**: Real-time totals for candidate volume, hiring recommendation rates, average technical scores, and flagged proctoring incidents.
- **Candidate Dossier Review**:
  - **Overall Score (0–100)** and recommendation badge (`STRONG HIRE`, `HIRE`, `BORDERLINE`, `NO HIRE`).
  - **6-Dimension Rubric**: Correctness, Technical Depth, Problem Solving, Communication, CV Honesty, and Proctoring Integrity.
  - **Hiring Manager Summary**: AI-generated executive narrative with bulleted technical strengths and gaps.
  - **Integrated Recording Playback**: Stream candidate video/audio directly in the browser or download the raw `.webm` file.
  - **Turn-by-Turn Q&A Transcript**: Review each question, candidate answer, individual score (0–10), coverage level (`Strong`, `Partial`, `Shallow`), and evaluator notes.
  - **Proctoring Incident Audit Trail**: Chronological event logs with timestamps, violation types, and strike flags.
- **Dynamic Interview Settings**: Update company name, target role, question count (4–10), language, and customized hiring manager focus notes directly from the dashboard.
- **Google Drive Integration**: Optional automatic sync of candidate recordings and JSON reports to a Google Drive folder.

---

## 🚀 Quick Start

### 1. Requirements
- Node.js `>= 20.0.0`

### 2. Configuration (`.env`)
The application comes pre-configured with a `.env` file:
```env
# Candidate Access Password (at least 8 chars)
INTERVIEW_PASSWORD=candidate2026

# Admin Dashboard Password (must differ from candidate password)
ADMIN_PASSWORD=adminsecret2026

# Server Port
PORT=8787

# Role & Pipeline Settings
COMPANY_NAME=Apex Global Tech
TARGET_ROLE=Senior Full Stack Engineer
INTERVIEW_LANGUAGE=English
QUESTION_COUNT=5
MAX_STRIKES=3

# Optional: Perplexity or OpenAI-compatible API Key
# If left empty, the built-in offline intelligent AI engine will power all interviews!
PERPLEXITY_API_KEY=
PERPLEXITY_MODEL=sonar-pro
```

### 3. Run the Application
```bash
# Start server
npm start

# Or with automatic reload during development
npm run dev
```

- **Candidate Portal**: [http://localhost:8787](http://localhost:8787)
  - Access Code: `candidate2026`
- **Admin Dashboard**: [http://localhost:8787/admin](http://localhost:8787/admin)
  - Admin Password: `adminsecret2026`

---

## 🧪 Testing

Run the automated test suite (including unit tests, proctoring tests, CV extraction tests, and full end-to-end integration flows):

```bash
npm test
```

---

## 📁 Project Architecture

```
.
├── .env                  # Environment & authentication credentials
├── package.json          # Node.js dependencies and run scripts
├── server/
│   ├── index.js          # Server entry point & startup validation
│   ├── app.js            # Express API routing & recording stream
│   ├── ai.js             # Dual-engine AI (Cloud API + Offline Intelligence)
│   ├── cv.js             # PDF / DOCX / TXT resume text parser
│   ├── integrity.js      # Anti-cheating & strike tracking state machine
│   ├── store.js          # File-backed persistence for interviews and settings
│   ├── drive.js          # Google Drive OAuth & upload service
│   └── drive-login.js    # CLI helper for Google Drive OAuth desktop login
├── public/
│   ├── index.html        # Candidate portal interface
│   ├── admin.html        # Executive hiring dashboard interface
│   ├── css/
│   │   └── style.css     # Luxury obsidian & neon glassmorphic design system
│   └── js/
│       ├── candidate.js  # Candidate state machine, STT, camera & proctoring
│       └── admin.js      # Admin dashboard controller & dossier modal
└── test/
    ├── app.test.js       # Unit & integration test suites
    └── e2e.js            # Comprehensive 13-stage end-to-end verification
```

---

## ☁️ Optional: Google Drive Setup

To upload candidate videos and evaluation reports directly into your Google Drive:
1. Create a Desktop OAuth Client ID in Google Cloud Console with Google Drive API enabled.
2. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`.
3. Run:
   ```bash
   npm run drive-login
   ```
4. Follow the browser authorization prompt.

---

## 🌐 1-Click Free Cloud Deployment (Render.com)

This repository includes `render.yaml` and `Dockerfile` pre-configured for free permanent deployment:

1. **Push to GitHub**:
   - Create a repository on GitHub (e.g., `ai-interview-agent`).
   - Push your code to GitHub:
     ```bash
     git remote add origin https://github.com/YOUR_USERNAME/ai-interview-agent.git
     git push -u origin main
     ```
2. **Deploy on Render**:
   - Go to [dashboard.render.com](https://dashboard.render.com/) and click **New +** -> **Web Service** (or **Blueprint**).
   - Connect your GitHub repository.
   - Render automatically detects `render.yaml` and deploys your service.
3. **Share Link**:
   - You will get a permanent, secure link: `https://your-app-name.onrender.com`.
   - Never blocked by corporate firewalls. Candidates and admins can open it 24/7!
