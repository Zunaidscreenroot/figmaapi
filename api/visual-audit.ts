import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";
import { DEFAULT_GEMINI_MODELS, generateWithFallback } from "../src/gemini.js";
import { auditResponseSchema } from "../src/schema.js";
import { VISUAL_AUDIT_SYSTEM_PROMPT } from "../src/prompt.js";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const MAX_IMAGE_CHARS = 3_200_000;
const MAX_GEOMETRY_CHARS = 700_000;
const MAX_PROFILE_CHARS = 500_000;
const MAX_REQUEST_CHARS = 3_800_000;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_IP = 30;

type Bucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, Bucket>();

function cors(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function clientIp(req: VercelRequest): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();

  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.length > 0) return realIp;

  return "unknown";
}

function allowed(req: VercelRequest): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  const bucket = rateBuckets.get(ip);

  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }

  if (bucket.count >= MAX_REQUESTS_PER_IP) return false;

  bucket.count += 1;
  return true;
}

function parseImage(value: unknown): { mimeType: string; data: string } {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Current image is required.");
  }

  if (value.length > MAX_IMAGE_CHARS) {
    throw new Error("Current image is too large. Export a smaller JPG render.");
  }

  if (!value.startsWith("data:")) {
    return { mimeType: "image/jpeg", data: value };
  }

  const match = value.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw new Error("Invalid image data URL.");

  const mimeType = match[1].toLowerCase();
  const data = match[2];

  if (!["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(mimeType)) {
    throw new Error("Current image must be PNG, JPEG, JPG, or WebP.");
  }

  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(data)) {
    throw new Error("Current image data is not valid base64.");
  }

  return { mimeType, data };
}

function boundedJson(value: unknown, maxChars: number, label: string): string {
  const json = JSON.stringify(value ?? {});
  if (json.length > maxChars) {
    throw new Error(label + " is too large.");
  }
  return json;
}

function normalizeSummary(result: any): void {
  const issues = Array.isArray(result.issues) ? result.issues : [];

  result.summary = {
    totalIssues: issues.length,
    high: issues.filter((x: any) => x.severity === "high").length,
    medium: issues.filter((x: any) => x.severity === "medium").length,
    low: issues.filter((x: any) => x.severity === "low").length,
    fixable: issues.filter((x: any) => x.fixable === true && x.fix != null).length
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    return res.status(200).json({
      status: "ok",
      service: "figma-visual-qa-api",
      endpoint: "/api/visual-audit",
      auditMethod: "POST",
      workflow: "analyze-reference -> visual-audit",
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      model: DEFAULT_GEMINI_MODELS.join(", ")
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  if (!allowed(req)) {
    return res.status(429).json({ error: "Rate limit exceeded. Please try again later." });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("visual-audit config error: GEMINI_API_KEY missing");
    return res.status(503).json({
      error: "Gemini is not configured on this deployment.",
      code: "GEMINI_API_KEY_MISSING"
    });
  }

  try {
    const rawBody =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});

    if (rawBody.length > MAX_REQUEST_CHARS) {
      return res.status(413).json({
        error: "Audit payload is too large. Send one compressed current JPG and compact referenceProfile data."
      });
    }

    const body =
      (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as any;

    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Invalid JSON body." });
    }

    if (!body.current || typeof body.current !== "object") {
      return res.status(400).json({ error: "current is required." });
    }

    const currentImage = parseImage(body.current.image);
    const currentGeometry = boundedJson(body.current.geometry, MAX_GEOMETRY_CHARS, "Current geometry");

    const profiles = Array.isArray(body.referenceProfiles) ? body.referenceProfiles : [];

    if (profiles.length === 0) {
      return res.status(400).json({
        error: "referenceProfiles is required. Analyze each reference with /api/analyze-reference first."
      });
    }

    const profileJson = boundedJson(profiles, MAX_PROFILE_CHARS, "Reference profiles");

    const checks = Array.isArray(body.options?.check)
      ? body.options.check.map((x: unknown) => String(x).slice(0, 80)).slice(0, 40)
      : [];

    const userRequirement =
      typeof body.options?.userRequirement === "string"
        ? body.options.userRequirement.slice(0, 3000)
        : "";

    const contents = [
      { text: VISUAL_AUDIT_SYSTEM_PROMPT },
      {
        text:
          "REFERENCE VISUAL PROFILES:\n" +
          profileJson +
          "\n\nCURRENT DESIGN RENDER:"
      },
      {
        inlineData: {
          mimeType: currentImage.mimeType,
          data: currentImage.data
        }
      },
      {
        text:
          "CURRENT DESIGN NAME: " +
          (typeof body.current.name === "string" ? body.current.name.slice(0, 120) : "Current Design") +
          "\nCURRENT DESIGN GEOMETRY:\n" +
          currentGeometry +
          "\nREQUESTED CHECKS:\n" +
          JSON.stringify(checks) +
          "\nADDITIONAL USER REQUIREMENT:\n" +
          (userRequirement || "None") +
          "\nReturn only schema-compliant JSON."
      }
    ];

    const ai = new GoogleGenAI({ apiKey });

    const { response, model: usedModel } = await generateWithFallback(ai, {
      contents,
      config: {
        responseMimeType: "application/json",
        responseSchema: auditResponseSchema
      }
    });

    if (!response.text) {
      return res.status(502).json({
        error: "Gemini returned an empty response."
      });
    }

    let result: any;

    try {
      result = JSON.parse(response.text.trim());
    } catch {
      return res.status(502).json({
        error: "Gemini returned invalid JSON."
      });
    }

    normalizeSummary(result);

    return res.status(200).json({
      ...result,
      meta: {
        model: usedModel,
        referenceCount: profiles.length,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("visual-audit error", error);

    const detail = error instanceof Error ? error.message : "Unknown server error.";

    return res.status(502).json({
      error: "Gemini visual audit request failed.",
      code: "GEMINI_UPSTREAM_ERROR",
      detail,
      model: MODEL
    });
  }
}
