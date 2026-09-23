# Figma Visual QA API

Gemini-powered backend endpoint for a Figma visual consistency checker.

## Endpoint

POST /api/visual-audit

After Vercel deployment:

https://YOUR-VERCEL-DOMAIN/api/visual-audit

The endpoint is CORS-enabled and intentionally requires no client-side API key.

## Vercel environment variable

GEMINI_API_KEY=your_gemini_key

Optional:
GEMINI_MODEL=gemini-3.8-flash

Never put the Gemini key in the Figma plugin.

## What it does

The Figma plugin sends:
- one or more reference page/frame renders
- the current render
- Figma geometry/metadata
- requested audit categories
- optional user requirement

The server sends the multimodal request to Gemini and returns structured JSON findings.

References are analyzed together as the visual source of truth. The current design is compared against recurring visual patterns rather than a fixed design system.

Each issue contains category, severity, confidence, affected layer ID when identifiable, reference evidence, suggested change, fixable flag, and a small allowlisted fix operation.

The plugin should execute fixes itself through the Figma Plugin API only after the user explicitly clicks Fix.

## Safety and limits

Gemini never receives permission to execute Figma code.

Max 6 references, 8 MB image string per image, 2 MB geometry JSON, 18 MB total JSON, and a best-effort 30 requests/hour/IP in-memory rate limit per function instance.

Because the endpoint is unauthenticated, add a persistent rate limiter or WAF before broad production use.
