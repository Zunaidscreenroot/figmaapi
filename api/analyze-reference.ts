import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";
import { referenceProfileSchema } from "../src/reference-schema.js";

const referencePrompt = "You are a senior UI/UX visual analyst.\n\nAnalyze one Figma website reference render.\n\nYour goal is to extract the website's recurring visual language for later comparison.\n\nInspect:\n- layout structure\n- content alignment\n- grid/columns\n- container relationships\n- section spacing\n- element gaps\n- internal padding\n- whitespace\n- visual density\n- typography hierarchy\n- repeated component patterns\n- buttons\n- cards\n- images\n- borders\n- radius\n- header\n- footer\n- CTA treatment\n- visual rhythm\n- section composition\n\nDo not impose a predefined design system.\nDo not judge the page using fixed page dimensions.\nFocus on relationships, proportions and recurring visual patterns visible in this reference.\n\nReturn concise patterns with evidence and confidence.\n";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const MAX_IMAGE_CHARS = 3_200_000;
const MAX_GEOMETRY_CHARS = 450_000;
const MAX_REQUEST_CHARS = 3_800_000;

function cors(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function parseImage(value: unknown): { mimeType: string; data: string } {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Reference image is required.");
  }

  if (value.length > MAX_IMAGE_CHARS) {
    throw new Error("Reference image is too large. Export a smaller JPEG render.");
  }

  if (!value.startsWith("data:")) {
    return { mimeType: "image/jpeg", data: value };
  }

  const match = value.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw new Error("Invalid image data URL.");

  const mimeType = match[1].toLowerCase();
  const data = match[2];

  if (!["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(mimeType)) {
    throw new Error("Reference image must be PNG, JPEG, JPG, or WebP.");
  }

  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(data)) {
    throw new Error("Reference image is not valid base64.");
  }

  return { mimeType, data };
}

function geometry(value: unknown): unknown {
  const serialized = JSON.stringify(value ?? {});
  if (serialized.length > MAX_GEOMETRY_CHARS) {
    throw new Error("Reference geometry is too large.");
  }
  return value ?? {};
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    return res.status(200).json({
      status: "ok",
      service: "figma-visual-qa-api",
      endpoint: "/api/analyze-reference",
      method: "POST"
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("analyze-reference config error: GEMINI_API_KEY missing");
    return res.status(503).json({
      error: "Gemini is not configured on this deployment.",
      code: "GEMINI_API_KEY_MISSING"
    });
  }

  try {
    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
    if (raw.length > MAX_REQUEST_CHARS) {
      return res.status(413).json({ error: "Reference payload is too large." });
    }

    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as any;
    const image = parseImage(body?.image);
    const nodeGeometry = geometry(body?.geometry);

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        { text: "You are a senior UI/UX visual analyst.\n\nAnalyze one Figma website reference render.\n\nYour goal is to extract the website's recurring visual language for later comparison.\n\nInspect:\n- layout structure\n- content alignment\n- grid/columns\n- container relationships\n- section spacing\n- element gaps\n- internal padding\n- whitespace\n- visual density\n- typography hierarchy\n- repeated component patterns\n- buttons\n- cards\n- images\n- borders\n- radius\n- header\n- footer\n- CTA treatment\n- visual rhythm\n- section composition\n\nDo not impose a predefined design system.\nDo not judge the page using fixed page dimensions.\nFocus on relationships, proportions and recurring visual patterns visible in this reference.\n\nReturn concise patterns with evidence and confidence.\n" },
        { inlineData: { mimeType: image.mimeType, data: image.data } },
        {
          text:
            "REFERENCE NAME: " + (typeof body?.name === "string" ? body.name.slice(0, 120) : "Reference") +
            "\nFIGMA GEOMETRY:\n" + JSON.stringify(nodeGeometry)
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: referenceProfileSchema
      }
    });

    if (!response.text) {
      return res.status(502).json({ error: "Gemini returned an empty response." });
    }

    const profile = JSON.parse(response.text.trim());

    return res.status(200).json({
      status: "ok",
      referenceProfile: profile,
      meta: {
        model: MODEL,
        analyzedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("analyze-reference error", error);
    return res.status(502).json({
      error: "Gemini reference analysis request failed.",
      code: "GEMINI_UPSTREAM_ERROR",
      detail: error instanceof Error ? error.message : "Unknown server error.",
      model: MODEL
    });
  }
}
