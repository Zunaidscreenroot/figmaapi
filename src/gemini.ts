import { GoogleGenAI } from "@google/genai";

export const DEFAULT_GEMINI_MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.8-flash",
  ...(process.env.GEMINI_FALLBACK_MODELS
    ? process.env.GEMINI_FALLBACK_MODELS.split(",").map((model) => model.trim()).filter(Boolean)
    : ["gemini-3.7-flash", "gemini-3.6-flash"])
].filter((model, index, all) => all.indexOf(model) === index);

export function isRetryableGeminiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toUpperCase();

  return (
    normalized.includes("503") ||
    normalized.includes("429") ||
    normalized.includes("UNAVAILABLE") ||
    normalized.includes("RESOURCE_EXHAUSTED") ||
    normalized.includes("TOO MANY REQUESTS") ||
    normalized.includes("HIGH DEMAND") ||
    normalized.includes("OVERLOADED") ||
    normalized.includes("RATE LIMIT")
  );
}

export async function generateWithFallback(
  ai: GoogleGenAI,
  request: Omit<Parameters<GoogleGenAI["models"]["generateContent"]>[0], "model"> & {
    model?: string;
  }
) {
  const errors: Array<{ model: string; message: string }> = [];

  for (const model of DEFAULT_GEMINI_MODELS) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await ai.models.generateContent({
          ...request,
          model
        });

        return {
          response,
          model,
          attemptedModels: errors.map((entry) => entry.model).concat(model)
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "Unknown Gemini error");
        errors.push({ model, message });

        if (!isRetryableGeminiError(error) || attempt === 1) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
      }
    }
  }

  const finalError = new Error(
    errors.map((entry) => "[" + entry.model + "] " + entry.message).join(" | ")
  );

  throw finalError;
}
