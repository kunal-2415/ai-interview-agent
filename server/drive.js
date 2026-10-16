import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { google } from "googleapis";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FULL = "https://www.googleapis.com/auth/drive";

export function createDrive(config) {
  let cached = null;
  let checkedAt = 0;

  function oauthFile() {
    return path.join(config.dataDir, "google-oauth.json");
  }

  function readOauthFile() {
    try {
      return JSON.parse(fs.readFileSync(oauthFile(), "utf8"));
    } catch {
      return null;
    }
  }

  function resolve() {
    const fromFile = readOauthFile();
    const refreshToken = config.googleRefreshToken || fromFile?.refresh_token || "";
    const folderId = config.googleFolderId || fromFile?.folderId || "";
    if (config.googleClientId && config.googleClientSecret && refreshToken) {
      return { mode: "oauth", refreshToken, folderId, fromFile: Boolean(fromFile) };
    }
    const service = loadServiceAccount(config.serviceAccountJson);
    if (service && config.googleFolderId) {
      return { mode: "service", credentials: service, folderId: config.googleFolderId };
    }
    return null;
  }

  async function session() {
    const creds = resolve();
    if (!creds) return null;
    if (creds.mode === "oauth") {
      const auth = new google.auth.OAuth2(config.googleClientId, config.googleClientSecret);
      auth.setCredentials({ refresh_token: creds.refreshToken });
      const drive = google.drive({ version: "v3", auth });
      let folderId = creds.folderId;
      if (!folderId) {
        const created = await drive.files.create({
          requestBody: {
            name: "AI Interview Recordings",
            mimeType: "application/vnd.google-apps.folder",
          },
          fields: "id",
        });
        folderId = created.data.id;
        const previous = readOauthFile() || {};
        fs.writeFileSync(
          oauthFile(),
          JSON.stringify({ ...previous, refresh_token: creds.refreshToken, folderId }, null, 2)
        );
      }
      return { drive, folderId, mode: "oauth" };
    }
    const auth = new google.auth.GoogleAuth({
      credentials: creds.credentials,
      scopes: [DRIVE_FULL],
    });
    return { drive: google.drive({ version: "v3", auth }), folderId: creds.folderId, mode: "service" };
  }

  async function upload({ name, mimeType, body }) {
    const active = await session();
    if (!active) return null;
    const created = await active.drive.files.create({
      requestBody: {
        name,
        parents: [active.folderId],
        mimeType,
      },
      media: { mimeType, body },
      fields: "id, webViewLink",
      supportsAllDrives: true,
    });
    const id = created.data.id;
    return {
      fileId: id,
      url: created.data.webViewLink || `https://drive.google.com/file/d/${id}/view`,
      folderId: active.folderId,
    };
  }

  return {
    scope: DRIVE_SCOPE,
    isConfigured() {
      return Boolean(resolve());
    },
    async describe() {
      if (Date.now() - checkedAt < 15000 && cached) return cached;
      const creds = resolve();
      if (!creds) {
        cached = { configured: false, mode: "", folderId: "", folderUrl: "", error: "" };
        checkedAt = Date.now();
        return cached;
      }
      try {
        const active = await session();
        const folder = await active.drive.files.get({
          fileId: active.folderId,
          fields: "id, name",
          supportsAllDrives: true,
        });
        cached = {
          configured: true,
          mode: active.mode,
          folderId: active.folderId,
          folderName: folder.data.name || "AI Interview Recordings",
          folderUrl: `https://drive.google.com/drive/folders/${active.folderId}`,
          error: "",
        };
      } catch (error) {
        cached = {
          configured: false,
          mode: creds.mode,
          folderId: creds.folderId || "",
          folderUrl: "",
          error: error.message || "Google Drive connection failed.",
        };
      }
      checkedAt = Date.now();
      return cached;
    },
    async uploadFile({ filePath, name, mimeType }) {
      return upload({ name, mimeType, body: fs.createReadStream(filePath) });
    },
    async uploadText({ name, mimeType, text }) {
      return upload({ name, mimeType, body: Readable.from(Buffer.from(text)) });
    },
  };
}

function loadServiceAccount(value) {
  if (!value) return null;
  const raw = String(value).trim();
  try {
    if (raw.startsWith("{")) return JSON.parse(raw);
    if (fs.existsSync(raw)) return JSON.parse(fs.readFileSync(raw, "utf8"));
  } catch {
    return null;
  }
  return null;
}
