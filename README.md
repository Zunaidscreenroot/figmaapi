# Figma Visual QA API

Gemini-powered backend endpoint for a Figma visual consistency checker.

## Health check

GET:

https://YOUR-VERCEL-DOMAIN/api/health

Expected response:

{
  "status": "ok",
  "service": "figma-visual-qa-api",
  "endpoint": "/api/visual-audit",
  "auditMethod": "POST"
}

## Visual audit

POST:

https://YOUR-VERCEL-DOMAIN/api/visual-audit

The audit endpoint is CORS-enabled and requires no client-side API key.

The Figma plugin sends:
- one or more reference page/frame renders
- the current render
- compact Figma geometry/metadata
- requested audit categories
- optional user requirement

The server sends the multimodal request to Gemini and returns structured JSON findings.

## Important Vercel payload limit

Vercel serverless functions enforce a 4.5 MB request payload limit. The API therefore intentionally keeps requests below that limit.

The plugin should:
- export renders as JPG rather than PNG for visual auditing
- use a width constraint around 1200px to keep long web pages manageable
- send compact geometry only for relevant nodes
- keep the total JSON request under approximately 3.8 MB

Figma supports JPG/PNG export and WIDTH/HEIGHT/SCALE constraints through exportAsync.

## Vercel environment variables

GEMINI_API_KEY=your_gemini_key

Optional:
GEMINI_MODEL=gemini-3.8-flash

Never put the Gemini key in the Figma plugin.

## Response

The endpoint returns:
- summary
- inferred reference visual profile
- issue category
- severity
- confidence
- affected Figma layer ID
- explanation
- reference evidence
- suggested change
- fixable flag
- allowlisted fix operation

The plugin executes fixes itself through the Figma Plugin API only after the user explicitly clicks Fix.

## Safety

Gemini never receives permission to execute Figma code.

The backend never returns executable JavaScript.

Because the audit endpoint is intentionally unauthenticated for the Figma plugin, keep the rate limiter and payload limits enabled. For broad production use, add a persistent rate limiter/WAF.
