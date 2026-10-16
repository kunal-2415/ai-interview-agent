import fs from "node:fs";
import path from "node:path";

const DEFAULT_SETTINGS = {
  companyName: "Your Company",
  targetRole: "Software Engineer",
  questionCount: 6,
  language: "English",
  focusNotes:
    "Probe real project decisions, tradeoffs, failures, and fundamentals. Do not accept buzzwords without a mechanism.",
};

export function createStore(dataDir, seed = {}) {
  const interviewsPath = path.join(dataDir, "interviews.json");
  const settingsPath = path.join(dataDir, "settings.json");
  fs.mkdirSync(path.join(dataDir, "recordings"), { recursive: true });

  let interviews = readJson(interviewsPath, []);
  let settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...seed, ...readJson(settingsPath, {}) });
  if (!fs.existsSync(settingsPath)) atomicWrite(settingsPath, settings);
  let tail = Promise.resolve();

  function locked(fn) {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  function persistInterviews() {
    atomicWrite(interviewsPath, interviews);
  }

  return {
    dataDir,
    recordingsDir: path.join(dataDir, "recordings"),

    getSettings() {
      return { ...settings };
    },

    updateSettings(patch) {
      return locked(async () => {
        settings = normalizeSettings({ ...settings, ...patch });
        atomicWrite(settingsPath, settings);
        return { ...settings };
      });
    },

    list() {
      return interviews.map(summarize);
    },

    get(id) {
      return interviews.find((item) => item.id === id) || null;
    },

    findByToken(token) {
      return interviews.find((item) => item.token === token) || null;
    },

    create(session) {
      return locked(async () => {
        interviews.push(session);
        persistInterviews();
        return session;
      });
    },

    save(session) {
      return locked(async () => {
        const index = interviews.findIndex((item) => item.id === session.id);
        if (index === -1) throw new Error("Interview session not found.");
        interviews[index] = session;
        persistInterviews();
        return session;
      });
    },

    remove(id) {
      return locked(async () => {
        const session = interviews.find((item) => item.id === id) || null;
        interviews = interviews.filter((item) => item.id !== id);
        persistInterviews();
        return session;
      });
    },
  };
}

export function normalizeSettings(input) {
  const questionCount = clampInt(input.questionCount, 4, 10, DEFAULT_SETTINGS.questionCount);
  return {
    companyName: clip(input.companyName, 80) || DEFAULT_SETTINGS.companyName,
    targetRole: clip(input.targetRole, 80) || DEFAULT_SETTINGS.targetRole,
    questionCount,
    language: clip(input.language, 40) || DEFAULT_SETTINGS.language,
    focusNotes: clip(input.focusNotes, 2000) || DEFAULT_SETTINGS.focusNotes,
  };
}

export function summarize(session) {
  return {
    id: session.id,
    name: session.name,
    createdAt: session.createdAt,
    status: session.status,
    strikes: session.strikes || 0,
    role: session.settingsSnapshot?.targetRole || "",
    overall: session.score?.overall ?? null,
    recommendation: session.score?.recommendation ?? null,
    score: session.score || null,
    driveUrl: session.recording?.driveUrl || "",
    driveError: session.recording?.driveError || "",
    hasLocalRecording: Boolean(session.recording?.bytes),
  };
}

export function adminView(session) {
  const { token, ...rest } = session;
  return rest;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function atomicWrite(file, value) {
  const content = JSON.stringify(value, null, 2);
  const tmp = `${file}.${process.pid}.${Date.now()}-${Math.random().toString(36).slice(2, 6)}.tmp`;
  try {
    fs.writeFileSync(tmp, content, "utf8");
    try {
      fs.renameSync(tmp, file);
    } catch {
      // Windows fallback: copyFileSync handles existing files reliably without rename lock
      fs.copyFileSync(tmp, file);
      try { fs.unlinkSync(tmp); } catch (_) {}
    }
  } catch {
    fs.writeFileSync(file, content, "utf8");
  }
}

function clip(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
