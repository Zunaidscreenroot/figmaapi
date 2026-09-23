import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

function cors(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({
      status: "error",
      code: "GEMINI_API_KEY_MISSING"
    });
  }

  try {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    });

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: "Reply with exactly: GEMINI_OK"
    });

    return res.status(200).json({
      status: "ok",
      model: MODEL,
      response: response.text?.trim() || "",
      message: "Gemini text request succeeded."
    });
  } catch (error) {
    console.error("gemini-test error", error);

    return res.status(502).json({
      status: "error",
      code: "GEMINI_UPSTREAM_ERROR",
      model: MODEL,
      detail: error instanceof Error ? error.message : "Unknown Gemini error."
    });
  }
}
