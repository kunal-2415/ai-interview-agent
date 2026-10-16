import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createApp, loadConfig, cleanName, safeEqual, presentQuestion } from "../server/app.js";
import { applyIntegrity, STRIKE_TYPES } from "../server/integrity.js";
import { createStore, normalizeSettings } from "../server/store.js";
import { createAi, buildOfflinePlan, assessOfflineAnswer, scoreOfflineSession, detectDomainAndRole, isMoveOnOrSkipIntent } from "../server/ai.js";
import { isAllowedCv } from "../server/cv.js";

test("loadConfig parses env and applies defaults", () => {
  const config = loadConfig({
    INTERVIEW_PASSWORD: "testcandidatepass",
    ADMIN_PASSWORD: "testadminpassword",
    MAX_STRIKES: "4",
    COMPANY_NAME: "Acme Corp",
    QUESTION_COUNT: "5",
  }, "/tmp/test");

  assert.equal(config.interviewPassword, "testcandidatepass");
  assert.equal(config.adminPassword, "testadminpassword");
  assert.equal(config.maxStrikes, 4);
  assert.equal(config.seedSettings.companyName, "Acme Corp");
  assert.equal(config.seedSettings.questionCount, 5);
});

test("cleanName validates candidate names properly", () => {
  assert.equal(cleanName("  Alexandra   Chen "), "Alexandra Chen");
  assert.equal(cleanName("John Doe-Smith"), "John Doe-Smith");
  assert.equal(cleanName("A"), ""); // too short
  assert.equal(cleanName("<script>alert(1)</script>"), ""); // invalid chars
});

test("safeEqual checks password equality safely", () => {
  assert.equal(safeEqual("candidate2026", "candidate2026"), true);
  assert.equal(safeEqual("candidate2026", "wrongpassword"), false);
  assert.equal(safeEqual("", ""), false);
});

test("applyIntegrity tracks strikes, cooldowns, and locks session", () => {
  const session = {
    id: "test_1",
    status: "live",
    strikes: 0,
    integrity: [],
    lastStrikeAt: {},
  };

  const t0 = 1000000;
  // Strike 1: tab_hidden
  const r1 = applyIntegrity(session, { type: "tab_hidden", detail: "Switched tab" }, { now: t0, maxStrikes: 3 });
  assert.equal(r1.strike, true);
  assert.equal(session.strikes, 1);
  assert.equal(session.status, "live");

  // Strike attempt within cooldown (20s) -> ignored for strike
  const r2 = applyIntegrity(session, { type: "tab_hidden", detail: "Switched tab again" }, { now: t0 + 5000, maxStrikes: 3 });
  assert.equal(r2.strike, false);
  assert.equal(session.strikes, 1);

  // Strike 2: window_blur
  const r3 = applyIntegrity(session, { type: "window_blur", detail: "Focus lost" }, { now: t0 + 6000, maxStrikes: 3 });
  assert.equal(r3.strike, true);
  assert.equal(session.strikes, 2);
  assert.equal(session.status, "live");

  // Strike 3: fullscreen_exit -> should lock session!
  const r4 = applyIntegrity(session, { type: "fullscreen_exit", detail: "Exited fullscreen" }, { now: t0 + 7000, maxStrikes: 3 });
  assert.equal(r4.strike, true);
  assert.equal(session.strikes, 3);
  assert.equal(r4.locked, true);
  assert.equal(session.status, "locked");
});

test("isAllowedCv detects valid CV extensions and mimetypes", () => {
  assert.equal(isAllowedCv({ originalname: "resume.pdf", mimetype: "application/pdf" }), true);
  assert.equal(isAllowedCv({ originalname: "resume.docx", mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), true);
  assert.equal(isAllowedCv({ originalname: "cv.txt", mimetype: "text/plain" }), true);
  assert.equal(isAllowedCv({ originalname: "malicious.exe", mimetype: "application/octet-stream" }), false);
});

test("createStore persists and retrieves sessions and settings", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-interview-store-test-"));
  const store = createStore(tmpDir, { companyName: "Test Org" });

  const settings = store.getSettings();
  assert.equal(settings.companyName, "Test Org");

  await store.updateSettings({ companyName: "Updated Org", questionCount: 7 });
  assert.equal(store.getSettings().companyName, "Updated Org");
  assert.equal(store.getSettings().questionCount, 7);

  const testSession = {
    id: "int_test123",
    token: "iv_token123",
    name: "Jane Dev",
    status: "entered",
    strikes: 0,
    transcript: [],
    recording: { bytes: 0 },
    createdAt: new Date().toISOString(),
  };

  await store.create(testSession);
  assert.equal(store.get("int_test123")?.name, "Jane Dev");
  assert.equal(store.findByToken("iv_token123")?.id, "int_test123");

  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "int_test123");

  await store.remove("int_test123");
  assert.equal(store.get("int_test123"), null);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("createAi built-in offline engine generates plan and evaluates answers", async () => {
  const cvText = `
    Jane Doe - Senior Full Stack Engineer
    Experience: 7+ years in JavaScript, TypeScript, React, Node.js, PostgreSQL, Docker, AWS, Redis.
    Projects: Designed real-time payment settlement engine processing 10k transactions/sec with Redis caching.
  `;

  const settings = {
    companyName: "Tech Corp",
    targetRole: "Senior Engineer",
    questionCount: 5,
    language: "English",
    focusNotes: "Deep dive into production tradeoffs.",
  };

  const plan = buildOfflinePlan({ cvText, settings });
  assert.equal(plan.seniority, "senior");
  assert.ok(plan.questions.length >= 4);
  assert.ok(plan.questions[0].spoken.includes("Tech Corp") || plan.questions[0].spoken.includes("Senior Engineer"));

  const assessment = assessOfflineAnswer({
    question: plan.questions[1],
    followUps: 0,
    answer: "We handled high concurrency by using distributed locks in Redis with Redlock algorithm, and database transactions with optimistic concurrency control using version columns. This prevented race conditions during balance updates.",
    answerMs: 15000,
  });

  assert.ok(assessment.answerScore >= 7);
  assert.ok(["strong", "partial"].includes(assessment.coverage));

  const score = scoreOfflineSession({
    cvText,
    transcript: [
      {
        kind: "question",
        question: plan.questions[0].spoken,
        answer: "Designed microservices architecture with Kafka event streaming and read-replicas in PostgreSQL.",
        score: 8.5,
      },
    ],
    strikes: 0,
  });

  assert.ok(score.overall >= 70);
  assert.ok(["strong_hire", "hire"].includes(score.recommendation));
  assert.equal(score.integrity, 10);
});

test("presentQuestion formats current question for candidate", () => {
  const session = {
    qIndex: 0,
    plan: [{ spoken: "Explain event loops in Node.js.", onScreen: "process.nextTick()" }],
    followUps: 0,
    currentSpoken: "Explain event loops in Node.js.",
    currentOnScreen: "process.nextTick()",
    strikes: 1,
  };

  const presented = presentQuestion(session);
  assert.equal(presented.questionNumber, 1);
  assert.equal(presented.questionTotal, 1);
  assert.equal(presented.followUp, false);
  assert.equal(presented.spoken, "Explain event loops in Node.js.");
  assert.equal(presented.onScreen, "process.nextTick()");
  assert.equal(presented.strikes, 1);
});

test("detectDomainAndRole accurately identifies Data Analyst and DevOps from CV text", () => {
  const daCv = "John Doe, Senior Data Analyst. 5 years experience with SQL, Tableau, Power BI, Python, Pandas, A/B Testing, ETL pipelines and Snowflake.";
  const daResult = detectDomainAndRole(daCv);
  assert.equal(daResult.domain, "data_analyst");
  assert.ok(daResult.roleTitle.toLowerCase().includes("data analyst"));

  const devopsCv = "Jane Smith, DevOps Engineer. Kubernetes, Docker, Terraform, CI/CD pipelines, AWS, Ansible, Prometheus monitoring.";
  const devopsResult = detectDomainAndRole(devopsCv);
  assert.equal(devopsResult.domain, "devops");
  assert.ok(devopsResult.roleTitle.toLowerCase().includes("devops"));
});

test("buildOfflinePlan tailors questions specifically for Data Analyst CV", () => {
  const daCv = "Senior Data Analyst with expertise in SQL window functions, cohort retention, Star Schema data warehousing, and p-value statistical significance.";
  const plan = buildOfflinePlan({ cvText: daCv, settings: { companyName: "Apex Tech", targetRole: "Data Analyst" } });
  
  assert.equal(plan.domain, "data_analyst");
  assert.ok(plan.detectedRole.includes("Data Analyst"));
  assert.ok(plan.topics.some(t => t.includes("SQL") || t.includes("A/B Testing")));
  
  // Make sure questions are about SQL, Star Schema, retention, metrics, and NOT full stack backend Redis or Javascript event loops
  const combinedText = plan.questions.map(q => q.spoken + " " + q.onScreen).join(" ");
  assert.ok(combinedText.includes("SQL") || combinedText.includes("Star Schema") || combinedText.includes("cohort"));
  assert.ok(!combinedText.includes("event loop"));
});

test("isMoveOnOrSkipIntent recognizes candidate skip phrases", () => {
  assert.equal(isMoveOnOrSkipIntent("can we move on to the next question please?"), true);
  assert.equal(isMoveOnOrSkipIntent("move on"), true);
  assert.equal(isMoveOnOrSkipIntent("next question please"), true);
  assert.equal(isMoveOnOrSkipIntent("I don't know the answer, let's skip"), true);
  assert.equal(isMoveOnOrSkipIntent("please skip this question"), true);
  assert.equal(isMoveOnOrSkipIntent("I'd like to pass on this one"), true);
  // Real answer should NOT trigger skip
  assert.equal(isMoveOnOrSkipIntent("In SQL, window functions calculate aggregates without collapsing rows."), false);
});

test("assessOfflineAnswer handles candidate skip without pushing follow-up", () => {
  const question = {
    spoken: "How do you calculate 30-day cohort retention in SQL?",
    onScreen: "SELECT user_id, date ...",
    strongAnswer: "Using window functions and date diff.",
    followUpIfShallow: "Can you write the window function expression?",
  };

  const assessment = assessOfflineAnswer({
    question,
    followUps: 0,
    answer: "I'm not familiar with that, can we move on to the next question?",
    answerMs: 3000,
  });

  assert.equal(assessment.isSkipped, true);
  assert.equal(assessment.coverage, "skipped");
  assert.equal(assessment.followUp, "");
  assert.ok(assessment.note.includes("Candidate requested to move to the next question"));
});

test("buildOfflinePlan starts with warm human greeting, how are you, and tell me about yourself introduction question", () => {
  const plan = buildOfflinePlan({
    cvText: "Aarav Patel, Software Engineer with 4 years experience in Python, FastAPI, and PostgreSQL.",
    settings: { companyName: "Nexus Labs", targetRole: "Full Stack Engineer", questionCount: 5 },
    candidateName: "Aarav Patel",
  });

  const q1 = plan.questions[0];
  assert.equal(q1.id, "q_intro");
  assert.ok(q1.spoken.includes("Hello Aarav!"));
  assert.ok(q1.spoken.includes("How are you doing today?"));
  assert.ok(q1.spoken.includes("tell me a little bit about yourself"));
  assert.ok(q1.spoken.includes("Where are you currently based"));
  assert.ok(q1.spoken.includes("what company or projects"));
  assert.ok(q1.spoken.includes("years of experience"));

  // Check assessment of candidate self-introduction
  const introEval = assessOfflineAnswer({
    question: q1,
    followUps: 0,
    answer: "Hello, I am doing great! I am based in Pune, currently working at FinTech Innovations as a software engineer for the last 4 years.",
    answerMs: 12000,
  });
  assert.ok(introEval.answerScore >= 7.5);
  assert.equal(introEval.followUp, "", "Should not aggressively interrogate candidate on self-introduction");
});

