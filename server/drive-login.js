import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { google } from "googleapis";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(rootDir, ".env") });

const clientId = process.env.GOOGLE_CLIENT_ID || "";
const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
const port = 53682;
const redirect = `http://127.0.0.1:${port}/callback`;

if (!clientId || !clientSecret) {
  console.error("Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env first.");
  console.error("Google Cloud → APIs & Services → Credentials → Create OAuth client ID → Desktop app.");
  console.error("Also enable the Google Drive API on that project.");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirect);
const url = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/drive.file"],
});

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, redirect);
    if (requestUrl.pathname !== "/callback") {
      res.writeHead(404).end("Not found");
      return;
    }
    const code = requestUrl.searchParams.get("code");
    const oauthError = requestUrl.searchParams.get("error");
    if (oauthError || !code) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("Google did not return a code. Close this tab and try again.");
      console.error(oauthError || "Missing code");
      return;
    }
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("No refresh token. Remove this app's access in your Google Account and run npm run drive-login again.");
      console.error("Google did not return a refresh token.");
      return;
    }
    oauth2.setCredentials(tokens);
    const drive = google.drive({ version: "v3", auth: oauth2 });
    const folder = await drive.files.create({
      requestBody: {
        name: "AI Interview Recordings",
        mimeType: "application/vnd.google-apps.folder",
      },
      fields: "id, webViewLink",
    });
    const dataDir = path.join(rootDir, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "google-oauth.json"),
      JSON.stringify({ refresh_token: tokens.refresh_token, folderId: folder.data.id }, null, 2)
    );
    const link = folder.data.webViewLink || `https://drive.google.com/drive/folders/${folder.data.id}`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(
      `<body style="font-family:sans-serif;padding:40px"><h1>Google Drive connected</h1><p>Recordings will go to <a href="${link}">${link}</a>.</p><p>You can close this tab and restart the interview server.</p></body>`
    );
    console.log("");
    console.log("Drive connected.");
    console.log(`Folder: ${link}`);
    console.log("Restart the interview server: npm start");
    server.close();
    setTimeout(() => process.exit(0), 300);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { "Content-Type": "text/plain" }).end(error.message || "Drive login failed.");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log("Opening Google so you can allow Drive access...");
  console.log(url);
  openBrowser(url);
});

function openBrowser(target) {
  if (process.platform === "win32") exec(`start "" "${target}"`);
  else if (process.platform === "darwin") exec(`open "${target}"`);
  else exec(`xdg-open "${target}"`);
}
