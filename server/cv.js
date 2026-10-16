import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

const ALLOWED = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
]);

export function isAllowedCv(file) {
  const name = String(file?.originalname || "").toLowerCase();
  if (ALLOWED.has(file?.mimetype)) return true;
  return name.endsWith(".pdf") || name.endsWith(".docx") || name.endsWith(".txt") || name.endsWith(".md");
}

export async function extractCvText(file) {
  const name = String(file.originalname || "").toLowerCase();
  let text = "";
  if (file.mimetype === "application/pdf" || name.endsWith(".pdf")) {
    const parsed = await pdfParse(file.buffer);
    text = parsed.text || "";
  } else if (
    file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  ) {
    const mammoth = await import("mammoth");
    const parsed = await mammoth.extractRawText({ buffer: file.buffer });
    text = parsed.value || "";
  } else {
    text = file.buffer.toString("utf8");
  }
  text = text.replace(/\u0000/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 200) {
    const error = new Error("This CV has too little text. Upload a PDF, DOCX, or TXT with your real experience.");
    error.status = 400;
    throw error;
  }
  return text.slice(0, 20000);
}
