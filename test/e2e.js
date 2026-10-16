import assert from "node:assert/strict";

const BASE = "http://localhost:8787";

async function main() {
  console.log("Starting End-to-End API verification on", BASE);

  // 1. Config
  const configRes = await fetch(`${BASE}/api/config`);
  assert.equal(configRes.status, 200);
  const config = await configRes.json();
  console.log("✓ /api/config returned:", config.companyName, "-", config.targetRole);

  // 2. Candidate Login
  const loginRes = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Alexandra Chen", password: "candidate2026" }),
  });
  assert.equal(loginRes.status, 200);
  const loginData = await loginRes.json();
  const token = loginData.token;
  assert.ok(token.startsWith("iv_"));
  console.log("✓ Candidate logged in successfully, token:", token.slice(0, 10) + "...");

  // 3. Upload CV
  const formData = new FormData();
  const cvBlob = new Blob([
    `Alexandra Chen - Senior Full Stack Engineer.
    6+ years experience with JavaScript, TypeScript, React, Node.js, PostgreSQL, Docker, AWS, Redis.
    Architected financial settlement system with Redis caching and PostgreSQL transactions processing 5,000 tx/sec.`
  ], { type: "text/plain" });
  formData.append("cv", cvBlob, "resume.txt");

  const cvRes = await fetch(`${BASE}/api/cv`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  assert.equal(cvRes.status, 200);
  const cvData = await cvRes.json();
  console.log("✓ CV Analyzed:", cvData.seniority, "topics:", cvData.topics);
  assert.ok(["senior", "staff"].includes(cvData.seniority));
  assert.ok(cvData.topics.length > 0);

  // 4. Begin Interview
  const beginRes = await fetch(`${BASE}/api/interview/begin`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ consent: true }),
  });
  assert.equal(beginRes.status, 200);
  const q1 = await beginRes.json();
  console.log(`✓ Question 1: [${q1.questionNumber}/${q1.questionTotal}] "${q1.spoken.slice(0, 60)}..."`);
  assert.equal(q1.questionNumber, 1);

  // 5. Stream Recording Chunk
  const chunkRes = await fetch(`${BASE}/api/recording/chunk`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-chunk-id": "chunk_test_1",
      "Content-Type": "application/octet-stream",
    },
    body: Buffer.from("RIFF....WEBM_DUMMY_AUDIO_VIDEO_DATA"),
  });
  assert.equal(chunkRes.status, 200);
  const chunkData = await chunkRes.json();
  console.log("✓ Recording chunk saved, total bytes:", chunkData.bytes);

  // 6. Test Integrity Strike
  const strikeRes = await fetch(`${BASE}/api/integrity`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "tab_hidden", detail: "Switched to browser search" }),
  });
  assert.equal(strikeRes.status, 200);
  const strikeData = await strikeRes.json();
  console.log("✓ Integrity monitored, strikes:", strikeData.strikes, "locked:", strikeData.locked);
  assert.equal(strikeData.strikes, 1);

  // 7. Answer Question 1 (Self-Introduction & Background)
  const ansRes = await fetch(`${BASE}/api/answer`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      answer: "Hello, I am doing great, thank you! I'm currently based in San Francisco, working as a Senior Full Stack Engineer at FinTech Corp with over 6 years of experience building distributed systems, PostgreSQL databases, and high-throughput transaction pipelines.",
      answerMs: 14000,
    }),
  });
  assert.equal(ansRes.status, 200);
  const nextQ = await ansRes.json();
  console.log("✓ Introduction answer submitted, next stage:", nextQ.done ? "Finished" : `Question ${nextQ.questionNumber}`);
  assert.ok(nextQ.spoken.includes("Thank you for sharing that, Alexandra!") || nextQ.spoken.includes("Thank you"),
    "AI must acknowledge candidate's self-introduction warmly!");

  // 7b. Candidate tests "Move on to next question" (Human interviewer behavior - no pushy follow-up!)
  const skipAnsRes = await fetch(`${BASE}/api/answer`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      answer: "I don't know the exact answer to this, can we please move on to the next question?",
      answerMs: 3500,
    }),
  });
  assert.equal(skipAnsRes.status, 200);
  const skipQ = await skipAnsRes.json();
  assert.equal(skipQ.followUp, false, "AI must not force a follow-up when candidate requests to move on!");
  assert.ok(skipQ.spoken.includes("Understood, let's move right along") || skipQ.spoken.includes("Understood"), "AI must use polite human transition");
  console.log("✓ Skip intent respected gracefully:", skipQ.spoken.slice(0, 60) + "...");

  // 7c. Data Analyst CV Upload Verification
  console.log("\n--- Testing Data Analyst CV Tailored Domain Flow ---");
  const daLoginRes = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Rohan Sharma", password: "candidate2026" }),
  });
  assert.equal(daLoginRes.status, 200);
  const daToken = (await daLoginRes.json()).token;

  const daFormData = new FormData();
  const daCvBlob = new Blob([
    `Rohan Sharma - Senior Data Analyst.
    5+ years experience in SQL (PostgreSQL, Snowflake, BigQuery), Tableau, Power BI, Python, Pandas.
    Spearheaded customer retention cohort analysis and A/B testing frameworks across 2M active users.
    Designed Star Schema reporting marts and resolved discrepancy between Marketing and Finance revenue metrics.`
  ], { type: "text/plain" });
  daFormData.append("cv", daCvBlob, "rohan_data_analyst.txt");

  const daCvRes = await fetch(`${BASE}/api/cv`, {
    method: "POST",
    headers: { Authorization: `Bearer ${daToken}` },
    body: daFormData,
  });
  assert.equal(daCvRes.status, 200);
  const daCvData = await daCvRes.json();
  assert.ok(daCvData.detectedRole.includes("Data Analyst"), `Expected Data Analyst role, got: ${daCvData.detectedRole}`);
  console.log("✓ Data Analyst CV detected role:", daCvData.detectedRole);

  const daBeginRes = await fetch(`${BASE}/api/interview/begin`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${daToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ consent: true }),
  });
  assert.equal(daBeginRes.status, 200);
  const daQ1 = await daBeginRes.json();
  console.log(`✓ Data Analyst Q1: "${daQ1.spoken.slice(0, 70)}..."`);
  assert.ok(daQ1.spoken.includes("Data Analyst") || daQ1.spoken.includes("analytics background") || daQ1.onScreen.includes("Data Analytics"),
    "Question must be tailored to Data Analytics, not full-stack engineering!");
  console.log("✓ Confirmed Data Analyst candidate receives targeted SQL/Analytics questions!");

  // 8. Finish Interview
  const finishRes = await fetch(`${BASE}/api/finish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(finishRes.status, 200);
  const finishData = await finishRes.json();
  console.log("✓ Interview finalized:", finishData.status);

  // 9. Admin Login
  const adminLoginRes = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "adminsecret2026" }),
  });
  assert.equal(adminLoginRes.status, 200);
  const adminData = await adminLoginRes.json();
  const adminToken = adminData.token;
  console.log("✓ Admin logged in, token:", adminToken.slice(0, 10) + "...");

  // 10. Admin Status
  const statusRes = await fetch(`${BASE}/api/admin/status`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(statusRes.status, 200);
  const statusData = await statusRes.json();
  console.log("✓ Admin status fetched, model:", statusData.model, "drive:", statusData.drive.configured);

  // 11. Admin Interviews List
  const listRes = await fetch(`${BASE}/api/admin/interviews`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  console.log("✓ Admin interview list count:", listData.interviews.length);
  const candidateRecord = listData.interviews.find((i) => i.name === "Alexandra Chen");
  assert.ok(candidateRecord);
  console.log("✓ Candidate record score:", candidateRecord.overall, "recommendation:", candidateRecord.recommendation);

  // 12. Admin Interview Detail Dossier
  const detailRes = await fetch(`${BASE}/api/admin/interviews/${candidateRecord.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(detailRes.status, 200);
  const detailData = await detailRes.json();
  console.log("✓ Full dossier fetched. Dimensions:", {
    correctness: detailData.interview.score.correctness,
    depth: detailData.interview.score.depth,
    integrity: detailData.interview.score.integrity,
  });

  // 13. Admin Recording Stream via Query Token
  const recStreamRes = await fetch(`${BASE}/api/admin/interviews/${candidateRecord.id}/recording?token=${adminToken}`);
  assert.equal(recStreamRes.status, 200);
  assert.equal(recStreamRes.headers.get("content-type"), "video/webm");
  const recBuf = await recStreamRes.arrayBuffer();
  assert.ok(recBuf.byteLength > 0);
  console.log("✓ Recording streamed successfully via ?token= param, byte length:", recBuf.byteLength);

  // 14. Admin Recording Download Attachment Header Verification
  const recDownloadRes = await fetch(`${BASE}/api/admin/interviews/${candidateRecord.id}/recording?token=${adminToken}&download=1`);
  assert.equal(recDownloadRes.status, 200);
  const disposition = recDownloadRes.headers.get("content-disposition");
  assert.ok(disposition && disposition.includes("attachment"), `Expected attachment disposition, got: ${disposition}`);
  console.log("✓ Recording download header verified:", disposition);

  console.log("\n==========================================");
  console.log("🎉 ALL END-TO-END VERIFICATION CHECKS PASSED!");
  console.log("==========================================");
}

main().catch((err) => {
  console.error("E2E test failed:", err);
  process.exit(1);
});
