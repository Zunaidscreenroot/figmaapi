export const auditResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["ok", "partial"] },
    summary: {
      type: "object",
      additionalProperties: false,
      properties: {
        totalIssues: { type: "integer" },
        high: { type: "integer" },
        medium: { type: "integer" },
        low: { type: "integer" },
        fixable: { type: "integer" }
      },
      required: ["totalIssues", "high", "medium", "low", "fixable"]
    },
    referenceProfile: {
      type: "object",
      additionalProperties: false,
      properties: {
        overall: { type: "string" },
        layout: { type: "array", items: { type: "object", additionalProperties: false, properties: { pattern: { type: "string" }, evidence: { type: "string" }, confidence: { type: "number" } }, required: ["pattern", "evidence", "confidence"] } },
        spacing: { type: "array", items: { type: "object", additionalProperties: false, properties: { pattern: { type: "string" }, evidence: { type: "string" }, confidence: { type: "number" } }, required: ["pattern", "evidence", "confidence"] } },
        typography: { type: "array", items: { type: "object", additionalProperties: false, properties: { pattern: { type: "string" }, evidence: { type: "string" }, confidence: { type: "number" } }, required: ["pattern", "evidence", "confidence"] } },
        components: { type: "array", items: { type: "object", additionalProperties: false, properties: { pattern: { type: "string" }, evidence: { type: "string" }, confidence: { type: "number" } }, required: ["pattern", "evidence", "confidence"] } },
        visualPatterns: { type: "array", items: { type: "object", additionalProperties: false, properties: { pattern: { type: "string" }, evidence: { type: "string" }, confidence: { type: "number" } }, required: ["pattern", "evidence", "confidence"] } }
      },
      required: ["overall", "layout", "spacing", "typography", "components", "visualPatterns"]
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
             id: { type: "string" },
          category: { type: "string", enum: ["layout", "alignment", "spacing", "padding", "gaps", "grid", "whitespace", "visual-hierarchy", "typography", "components", "overflow", "clipping", "overlap", "radius", "borders", "images", "visual-consistency"] },
            severity: { type: "string", enum: ["high","medium","low"] },
            confidence: { type: "number" },
            layerId: { type: ["string", "null"] },
            layerName: { type: ["string", "null"] },
            title: { type: "string" },
            description: { type: "string" },
            referenceEvidence: { type: "array", items: { type: "string" } },
            currentObservation: { type: "string" },
            suggestedChange: { type: "string" },
            fixable: { type: "boolean" },
            fix: {
              type: ["object", "null"],
              additionalProperties: false,
            properties: {
                operation: { type: "string", enum: ["SET_X", "SET_Y", "SET_WIDTH", "SET_HEIGHT", "SET_PADDING_TOP", "SET_PADDING_RIGHT", "SET_PADDING_BOTTOM", "SET_PADDING_LEFT", "SET_ITEM_SPACING", "SET_RADIUS", "SET_CLIPS_CONTENT", "SET_AUSO_LAYOUT", "ALIGN_LEFT", "ALIGN_CENTER", "ALIGN_RIGHT", "MATCH_REFERENGE_SPACING", "MATCH_REFERENGE_SIXE"]},
                value: { type: ["number", "boolean", "string", "null"] },
                secondaryValue: { type: ["number", "boolean", "string", "null"] }
              },
              required: ["operation", "value", "secondaryValue"]
            }
        },
        required: ["id","category","severity","confidence","layerId","layerName","title","description","referenceEvidence","currentObservation","suggestedChange","fixable","fix"]
      }
    }
  },
  required: ["status","summary","referenceProfile","issues"]
} as const;
