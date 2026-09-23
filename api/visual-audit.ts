import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";
import { auditResponseSchema } from "../src/schema.js";
import { VISUAL_AUDIT_SYSTEM_PROMPT } from "../src/prompt.js";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const MAX_REFERENCES = 6;
const MAX_IMAGE_CHARS = 8_000_000;
const MAX_GEOMETRY_CHARS = 2_000_000;
const MAX_REQUEST_CHARS = 18_000_000;
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

function parseImage(value: unknown, label: string): { mimeType: string; data: string } {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(label + " image is required.");
  }

  if (value.length > MAX_IMAGE_CHARS) {
    throw new Error(label + " image is too large.");
  }

  if (!value.startsWith("data:")) {
    return { mimeType: "image/png", data: value };
  }

  const match = value.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) {
    throw new Error("Invalid " + label + " image data URL.");
  }

  const mimeType = match[1];
  const data = match[2];

  if (!["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(mimeType.toLowerCase())) {
    throw new Error(label + " must be PNG, JPEG, or WebP.");
  }

  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(data)) {
    throw new Error(label + " image data is not valid base64.");
  }

  return { mimeType, data };
}

function safeString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function geometryValue(value: unknown): unknown {
  const json = JSON.stringify(value ?? {});
  if (json.length > MAX_GEOMETRY_CHARS) {
    throw new Error("Geometry payload is too large.");
  }
  return value ?? {};
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

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      status: "ok",
      service: "figma-visual-qa-api",
      endpoint: "/api/visual-audit",
      message: "Use POST with reference/current renders and Figma geometry to run a visual audit."
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
    return res.status(500).json({
      error: "GEMINI_API_KEY is not configured on the server."
    });
  }

  try {
    const rawBody =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});

    if (rawBody.length > MAX_REQUEST_CHARS) {
      return res.status(413).json({ error: "Request payload is too large." });
    }

    const body =
      (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as any;

    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Invalid JSON body." });
    }

    if (!Array.isArray(body.references) || body.references.length < 1) {
      return res.status(400).json({
        error: "At least one reference is required."
      });
    }

    if (body.references.length > MAX_REFERENCES) {
      return res.status(400).json({
        error: "Maximum " + MAX_REFERENCES + " references are allowed."
      });
    }

    if (!body.current || typeof body.current !== "object") {
      return res.status(400).json({ error: "current is required." });
    }

    const currentImage = parseImage(body.current.image, "Current");
    const currentGeometry = geometryValue(body.current.geometry);

    const references = body.references.map((ref: any, index: number) => ({
      name: safeString(ref?.name, 120) || "Reference " + (index + 1),
      geometry: geometryValue(ref?.geometry),
      image: parseImage(ref?.image, "Reference " + (index + 1))
    }));

    const checks = Array.isArray(body.options?.check)
      ? body.options.check
          .map((x: unknown) => safeString(x, 80))
          .filter(Boolean)
          .slice(0, 40)
      : [];

    const userRequirement = safeString(body.options?.userRequirement, 3000);

    const referenceBlocks = references.flatMap((ref: any) => [
      {
        inlineData: {
          mimeType: ref.image.mimeType,
          data: ref.image.data
        }
      },
      {
        text:
          "REFERENCE NAME: " +
          ref.name +
          "\nREFERENCE GEOMETRY:\n" +
          JSON.stringify(ref.geometry)
      }
    ]);

    const contents = [
      { text: VISUAL_AUDIT_SYSTEM_PROMPT },
      ...referenceBlocks,
      { text: "CURRENT DESIGN RENDER:" },
      {
        inlineData: {
          mimeType: currentImage.mimeType,
          data: currentImage.data
        }
      },
      {
        text:
          "CURRENT DESIGN NAME: " +
          (safeString(body.current.name, 120) || "Current Design") +
          "\nCURRENT DESIGN GEOMETRY:\n" +
          JSON.stringify(currentGeometry) +
          "\nREQUESTED CHECKS:\n" +
          JSON.stringify(checks) +
          "\nADDITIONAL USER REQUIREMENT:\n" +
          (userRequirement || "None") +
          "\nReturn only schema-compliant JSON."
      }
    ];

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: MODEL,
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
        model: MODEL,
        referenceCount: references.length,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("visual-audit error", error);

    return res.status(500).json({
      error: "Visual audit failed.",
      detail: error instanceof Error ? error.message : "Unknown server error."
    });
  }
}
