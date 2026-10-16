import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { createAi, isMoveOnOrSkipIntent } from "./ai.js";
import { extractCvText, isAllowedCv } from "./cv.js";
import { createDrive } from "./drive.js";
import { applyIntegrity } from "./integrity.js";
import { adminView, createStore, normalizeSettings, summarize } from "./store.js";

const SESSION_MS = 6 * 60 * 60 * 1000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

export function loadConfig(env = process.env, dataDir = "") {
  return {
    dataDir,
    interviewPassword: env.INTERVIEW_PASSWORD || "",
    adminPassword: env.ADMIN_PASSWORD || "",
    perplexityKey: env.PERPLEXITY_API_KEY || "",
    perplexityModel: env.PERPLEXITY_MODEL || "anthropic/claude-sonnet-4-6",
    perplexityFallbacks: String(env.PERPLEXITY_FALLBACK_MODELS || "openai/gpt-5.6-terra,google/gemini-3.1-pro-preview")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    maxStrikes: clampInt(env.MAX_STRIKES, 1, 8, 3),
    googleClientId: env.GOOGLE_CLIENT_ID || "",
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || "",
    googleRefreshToken: env.GOOGLE_REFRESH_TOKEN || "",
    googleFolderId: env.GOOGLE_DRIVE_FOLDER_ID || "",
    serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON || "",
    seedSettings: normalizeSettings({
      companyName: env.COMPANY_NAME,
      targetRole: env.TARGET_ROLE,
      questionCount: env.QUESTION_COUNT,
      language: env.INTERVIEW_LANGUAGE,
      focusNotes: env.FOCUS_NOTES,
    }),
  };
}

export function createApp(options = {}) {
  const config = options.config;
  if (!config) throw new Error("createApp requires config.");
  const store = options.store || createStore(config.dataDir, config.seedSettings);
  const ai = options.ai || createAi(config);
  const drive = options.drive || createDrive(config);
  const adminTokens = new Set();
  const loginFails = new Map();

  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "no-referrer");
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  const publicDir = path.join(config.rootDir || defaultRoot(), "public");
  app.use(
    express.static(publicDir, {
      etag: false,
      maxAge: 0,
      setHeaders(res) {
        res.set("Cache-Control", "no-store");
      },
    })
  );

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/config", (_req, res) => {
    const settings = store.getSettings();
    res.json({
      companyName: settings.companyName,
      targetRole: settings.targetRole,
      language: settings.language,
    });
  });

  app.post("/api/login", async (req, res) => {
    const ip = req.ip || "local";
    const bucket = loginFails.get(ip) || [];
    const recent = bucket.filter((at) => Date.now() - at < 10 * 60 * 1000);
    if (recent.length >= 8) {
      loginFails.set(ip, recent);
      return res.status(429).json({ error: "Too many tries. Wait a few minutes." });
    }
    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ error: "Enter your full name (2–80 letters)." });
    if (!safeEqual(req.body?.password, config.interviewPassword)) {
      recent.push(Date.now());
      loginFails.set(ip, recent);
      return res.status(401).json({ error: "That password is not correct." });
    }
    loginFails.delete(ip);
    const session = {
      id: `int_${crypto.randomBytes(8).toString("hex")}`,
      token: `iv_${crypto.randomBytes(24).toString("hex")}`,
      name,
      createdAt: new Date().toISOString(),
      status: "entered",
      cvText: "",
      cvFileName: "",
      topics: [],
      seniority: "",
      plan: [],
      qIndex: 0,
      followUps: 0,
      currentSpoken: "",
      currentOnScreen: "",
      transcript: [],
      integrity: [],
      strikes: 0,
      lastStrikeAt: {},
      recording: { localPath: "", bytes: 0, lastChunkId: "", driveFileId: "", driveUrl: "", reportUrl: "", driveError: "" },
      score: null,
      settingsSnapshot: null,
      consentAt: "",
    };
    await store.create(session);
    res.json({ token: session.token, name: session.name });
  });

  app.post("/api/admin/login", (req, res) => {
    if (!config.adminPassword) {
      return res.status(503).json({ error: "Set ADMIN_PASSWORD in the .env file and restart." });
    }
    if (!safeEqual(req.body?.password, config.adminPassword)) {
      return res.status(401).json({ error: "That admin password is not correct." });
    }
    const token = `adm_${crypto.randomBytes(24).toString("hex")}`;
    adminTokens.add(token);
    res.json({ token });
  });

  app.get("/api/admin/status", requireAdmin, async (_req, res) => {
    const driveStatus = await drive.describe();
    res.json({
      settings: store.getSettings(),
      perplexity: Boolean(config.perplexityKey),
      model: config.perplexityModel,
      maxStrikes: config.maxStrikes,
      drive: driveStatus,
    });
  });

  app.put("/api/admin/settings", requireAdmin, async (req, res) => {
    const settings = await store.updateSettings(req.body || {});
    res.json({ settings });
  });

  app.get("/api/admin/interviews", requireAdmin, (_req, res) => {
    const items = store.list().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json({ interviews: items });
  });

  app.get("/api/admin/interviews/:id", requireAdmin, (req, res) => {
    const session = store.get(req.params.id);
    if (!session) return res.status(404).json({ error: "Interview not found." });
    res.json({ interview: adminView(session) });
  });

  app.get("/api/admin/interviews/:id/recording", requireAdmin, (req, res) => {
    const session = store.get(req.params.id);
    if (!session) return res.status(404).json({ error: "Interview not found." });
    const filePath = session.recording?.localPath;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Recording file not found on server." });
    }
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    res.set("Accept-Ranges", "bytes");
    res.set("Content-Type", "video/webm");
    if (req.query?.download === "1") {
      res.set("Content-Disposition", `attachment; filename="${safeFile(session.name)}-recording.webm"`);
    }

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const file = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Length": chunksize,
      });
      file.pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  app.post("/api/admin/interviews/:id/upload", requireAdmin, async (req, res, next) => {
    try {
      const session = store.get(req.params.id);
      if (!session) return res.status(404).json({ error: "Interview not found." });
      await uploadRecording(session);
      if (session.score) await uploadReport(session);
      await store.save(session);
      res.json({ interview: summarize(session), driveError: session.recording.driveError });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/admin/interviews/:id", requireAdmin, async (req, res) => {
    const session = await store.remove(req.params.id);
    if (session?.recording?.localPath && fs.existsSync(session.recording.localPath)) {
      fs.unlinkSync(session.recording.localPath);
    }
    res.json({ ok: true });
  });

  app.get("/api/session", requireCandidate, (req, res) => {
    const session = req.session;
    res.json({
      name: session.name,
      status: session.status,
      topics: session.topics,
      strikes: session.strikes,
    });
  });

  app.post("/api/cv", requireCandidate, (req, res) => {
    upload.single("cv")(req, res, async (error) => {
      if (error) return res.status(400).json({ error: "CV must be a PDF, DOCX, or TXT under 8 MB." });
      try {
        const session = req.session;
        if (session.status === "live" || session.status === "finished" || session.status === "locked") {
          return res.status(409).json({ error: "This interview has already moved past CV upload." });
        }
        if (!req.file || !isAllowedCv(req.file)) {
          return res.status(400).json({ error: "Upload a PDF, DOCX, or TXT CV." });
        }
        const cvText = await extractCvText(req.file);
        const settings = store.getSettings();
        const plan = await ai.buildPlan({ cvText, settings, candidateName: session.name });
        session.cvText = cvText;
        session.cvFileName = path.basename(req.file.originalname || "cv.txt").slice(0, 120);
        session.topics = plan.topics;
        session.seniority = plan.seniority;
        session.plan = plan.questions;
        session.settingsSnapshot = {
          ...settings,
          targetRole: plan.detectedRole || settings.targetRole,
        };
        session.status = "ready";
        await store.save(session);
        res.json({
          ok: true,
          seniority: plan.seniority,
          topics: plan.topics,
          detectedRole: plan.detectedRole || settings.targetRole,
          questionCount: plan.questions.length,
        });
      } catch (err) {
        sendError(res, err);
      }
    });
  });

  app.post("/api/interview/begin", requireCandidate, async (req, res, next) => {
    try {
      const session = req.session;
      if (session.status !== "ready" && !(session.status === "live" && session.transcript.length === 0)) {
        return res.status(409).json({ error: "Upload a CV before starting." });
      }
      if (!req.body?.consent) return res.status(400).json({ error: "Recording consent is required." });
      session.status = "live";
      session.consentAt = session.consentAt || new Date().toISOString();
      session.qIndex = 0;
      session.followUps = 0;
      const first = session.plan[0];
      session.currentSpoken = first.spoken;
      session.currentOnScreen = first.onScreen || "";
      session.recording.localPath = path.join(store.recordingsDir, `${session.id}.webm`);
      await store.save(session);
      res.json(presentQuestion(session));
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/recording/chunk",
    requireCandidate,
    express.raw({ type: "application/octet-stream", limit: "12mb" }),
    async (req, res, next) => {
      try {
        const session = req.session;
        if (session.status !== "live" && session.status !== "locked") {
          return res.status(409).json({ error: "Recording is not active." });
        }
        const chunkId = String(req.header("x-chunk-id") || "");
        if (!chunkId) return res.status(400).json({ error: "Missing chunk id." });
        const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (chunkId === session.recording.lastChunkId) {
          return res.json({ ok: true, bytes: session.recording.bytes, duplicate: true });
        }
        if (!session.recording.localPath) {
          session.recording.localPath = path.join(store.recordingsDir, `${session.id}.webm`);
        }
        if (buf.length) await fs.promises.appendFile(session.recording.localPath, buf);
        session.recording.bytes += buf.length;
        session.recording.lastChunkId = chunkId;
        await store.save(session);
        res.json({ ok: true, bytes: session.recording.bytes });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post("/api/integrity", requireCandidate, async (req, res, next) => {
    try {
      const session = req.session;
      if (session.status !== "live" && session.status !== "locked") {
        return res.status(409).json({ error: "The interview is not live." });
      }
      const result = applyIntegrity(session, req.body || {}, { maxStrikes: config.maxStrikes });
      await store.save(session);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/answer", requireCandidate, async (req, res, next) => {
    try {
      const session = req.session;
      if (session.status !== "live") {
        return res.status(409).json({ error: "The interview is not accepting answers." });
      }
      const answer = String(req.body?.answer || "").trim().slice(0, 8000);
      const answerMs = clampInt(req.body?.answerMs, 0, 30 * 60 * 1000, 0);
      const isSkip = Boolean(req.body?.skip) || isMoveOnOrSkipIntent(answer);
      if (!isSkip && answer.length < 2) return res.status(400).json({ error: "Say an answer before submitting." });
      const question = session.plan[session.qIndex];
      if (!question) return res.json({ done: true });

      if (isSkip) {
        // Human-like transition: respect candidate's wish to move to the next question
        session.transcript.push({
          at: new Date().toISOString(),
          kind: session.followUps > 0 ? "follow_up" : "question",
          topic: question.topic,
          question: session.currentSpoken,
          answer: answer || "Candidate chose to skip this question.",
          answerMs,
          score: 2,
          coverage: "skipped",
          note: "Candidate requested to skip or move on to the next question.",
        });

        session.qIndex += 1;
        session.followUps = 0;
        if (session.qIndex >= session.plan.length) {
          await store.save(session);
          return res.json({ done: true });
        }
        const nextQuestion = session.plan[session.qIndex];
        const candidateFirst = (session.name || "").trim().split(/\s+/)[0] || "there";
        session.currentSpoken = `Understood, ${candidateFirst}, no problem at all! Let's move right along to the next question. ${nextQuestion.spoken}`;
        session.currentOnScreen = nextQuestion.onScreen || "";
        await store.save(session);
        return res.json(presentQuestion(session));
      }

      const assessment = await ai.assessAnswer({
        settings: session.settingsSnapshot,
        question,
        followUps: session.followUps,
        answer,
        answerMs,
      });
      session.transcript.push({
        at: new Date().toISOString(),
        kind: session.followUps > 0 ? "follow_up" : "question",
        topic: question.topic,
        question: session.currentSpoken,
        answer,
        answerMs,
        score: assessment.answerScore,
        coverage: assessment.coverage,
        note: assessment.note,
      });
      const canFollow =
        !assessment.isSkipped &&
        session.followUps < 1 &&
        assessment.coverage !== "strong" &&
        assessment.followUp.length > 10;
      if (canFollow) {
        session.followUps += 1;
        session.currentSpoken = assessment.followUp;
        session.currentOnScreen = "";
        await store.save(session);
        return res.json(presentQuestion(session));
      }
      session.qIndex += 1;
      session.followUps = 0;
      if (session.qIndex >= session.plan.length) {
        await store.save(session);
        return res.json({ done: true });
      }
      const nextQuestion = session.plan[session.qIndex];
      const candidateFirst = (session.name || "").trim().split(/\s+/)[0] || "there";

      let transitionPrefix = "";
      if (session.qIndex === 1) {
        // Natural human acknowledgment after candidate introduces themselves
        transitionPrefix = `Thank you for sharing that, ${candidateFirst}! It's wonderful to learn about your journey and background. Now, let's dive into your technical work. `;
      } else {
        const acknowledgements = [
          `Thanks for walking me through that, ${candidateFirst}. That provides great context. `,
          `Got it, thank you for explaining that clearly. `,
          `That makes a lot of sense, thank you. Let's explore our next area. `,
          `Great insights, ${candidateFirst}. `,
        ];
        transitionPrefix = acknowledgements[(session.qIndex - 1) % acknowledgements.length];
      }
      session.currentSpoken = `${transitionPrefix}${nextQuestion.spoken}`;
      session.currentOnScreen = nextQuestion.onScreen || "";
      await store.save(session);
      res.json(presentQuestion(session));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/finish", requireCandidate, async (req, res, next) => {
    try {
      const session = req.session;
      if (session.status === "finished") return res.json({ ok: true, status: "finished" });
      if (session.status !== "live" && session.status !== "locked") {
        return res.status(409).json({ error: "The interview has not started." });
      }
      const wasLocked = session.status === "locked" || session.strikes >= config.maxStrikes;
      await Promise.all([scoreSession(session, wasLocked), uploadRecording(session)]);
      await uploadReport(session);
      session.status = "finished";
      await store.save(session);
      res.json({ ok: true, status: "finished" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/admin", (_req, res) => {
    res.sendFile(path.join(publicDir, "admin.html"));
  });
  app.get("/favicon.ico", (_req, res) => res.status(204).end());

  app.use((error, _req, res, _next) => {
    sendError(res, error);
  });

  return app;

  function requireCandidate(req, res, next) {
    const token = bearer(req);
    if (!token.startsWith("iv_")) return res.status(401).json({ error: "Sign in again." });
    const session = store.findByToken(token);
    if (!session) return res.status(401).json({ error: "Sign in again." });
    if (Date.now() - new Date(session.createdAt).getTime() > SESSION_MS) {
      return res.status(401).json({ error: "This interview link expired. Sign in again." });
    }
    req.session = session;
    next();
  }

  function requireAdmin(req, res, next) {
    const token = bearer(req) || String(req.query?.token || "").trim();
    if (!token.startsWith("adm_") || !adminTokens.has(token)) {
      return res.status(401).json({ error: "Admin sign-in required." });
    }
    next();
  }

  async function scoreSession(session, wasLocked) {
    if (session.score) return session.score;
    const settings = session.settingsSnapshot || store.getSettings();
    const score = await ai.finalScore({
      settings,
      cvText: session.cvText,
      transcript: session.transcript,
      integrity: session.integrity,
      strikes: session.strikes,
    });
    if (wasLocked) {
      score.recommendation = "no_hire";
      score.integrity = Math.min(Number(score.integrity) || 0, 2);
      score.integrityGate = true;
      score.integritySummary = `Proctoring closed or flagged this interview (${session.strikes} strikes). ${score.integritySummary || ""}`.trim();
    } else {
      score.integrityGate = false;
    }
    session.score = score;
    return score;
  }

  async function uploadRecording(session) {
    const filePath = session.recording?.localPath;
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).size) {
      session.recording.driveError = session.recording.driveError || "No recording file was saved.";
      return;
    }
    if (!drive.isConfigured()) {
      session.recording.driveError = "Google Drive is not connected. The video is still on the server.";
      return;
    }
    if (session.recording.driveFileId) return;
    try {
      const stamp = session.createdAt.slice(0, 16).replace(/[:T]/g, "-");
      const uploaded = await drive.uploadFile({
        filePath,
        name: `${safeFile(session.name)} ${stamp}.webm`,
        mimeType: "video/webm",
      });
      if (uploaded) {
        session.recording.driveFileId = uploaded.fileId;
        session.recording.driveUrl = uploaded.url;
        session.recording.driveError = "";
      }
    } catch (error) {
      session.recording.driveError = error.message || "Drive upload failed.";
      console.error("[drive] video", session.recording.driveError);
    }
  }

  async function uploadReport(session) {
    if (!drive.isConfigured() || session.recording.reportUrl || !session.score) return;
    try {
      const stamp = session.createdAt.slice(0, 16).replace(/[:T]/g, "-");
      const uploaded = await drive.uploadText({
        name: `${safeFile(session.name)} ${stamp} score.json`,
        mimeType: "application/json",
        text: JSON.stringify(adminView(session), null, 2),
      });
      if (uploaded) session.recording.reportUrl = uploaded.url;
    } catch (error) {
      console.error("[drive] report", error.message);
    }
  }
}

export function presentQuestion(session) {
  return {
    done: false,
    questionNumber: session.qIndex + 1,
    questionTotal: session.plan.length,
    followUp: session.followUps > 0,
    spoken: session.currentSpoken,
    onScreen: session.currentOnScreen || "",
    strikes: session.strikes,
  };
}

export function cleanName(value) {
  const name = String(value || "").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 80) return "";
  if (!/^[\p{L}\p{M}\s.'-]+$/u.test(name)) return "";
  return name;
}

export function safeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""));
  const right = Buffer.from(String(rightValue || ""));
  if (!left.length || !right.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function bearer(req) {
  const header = req.get("authorization") || "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function sendError(res, error) {
  const status = error.status || 500;
  const message = status >= 500 && !error.status ? "Something went wrong. Try again." : error.message;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: message || "Request failed." });
}

function safeFile(name) {
  return String(name).replace(/[^\p{L}\p{N}\s-]/gu, "").trim().slice(0, 60) || "candidate";
}

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function defaultRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}
