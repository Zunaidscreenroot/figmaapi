export const referenceProfileSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    overall: { type: "string" },
    patterns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { type: "string" },
          pattern: { type: "string" },
          evidence: { type: "string" },
          confidence: { type: "number" }
        },
        required: ["category", "pattern", "evidence", "confidence"]
      }
    }
  },
  required: ["overall", "patterns"]
} as const;
