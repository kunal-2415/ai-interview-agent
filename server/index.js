import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createApp, loadConfig, safeEqual } from "./app.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(rootDir, ".env") });

const dataDir = path.join(rootDir, "data");
const config = loadConfig(process.env, dataDir);
config.rootDir = rootDir;

if (config.interviewPassword.length < 8) {
  console.error("Set INTERVIEW_PASSWORD in .env to at least 8 characters, then start again.");
  process.exit(1);
}
if (!config.adminPassword || config.adminPassword.length < 8) {
  console.error("Set ADMIN_PASSWORD in .env to at least 8 characters. It must be different from the candidate password.");
  process.exit(1);
}
if (safeEqual(config.adminPassword, config.interviewPassword)) {
  console.error("ADMIN_PASSWORD must be different from INTERVIEW_PASSWORD. Candidates must not open the score dashboard.");
  process.exit(1);
}

const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || "0.0.0.0";
const app = createApp({ config });
app.listen(port, host, () => {
  console.log("");
  console.log("AI interview agent is running");
  console.log(`Listening on:    http://${host}:${port}`);
  console.log(`Candidate link:  http://localhost:${port}`);
  console.log(`Admin dashboard: http://localhost:${port}/admin`);
  console.log(`Perplexity:      ${config.perplexityKey ? "key found" : "MISSING — add PERPLEXITY_API_KEY"}`);
  console.log("Google Drive:    connect with npm run drive-login if you have not already");
  console.log("");
});
