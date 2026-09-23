# Figma Visual QA API

Gemini-powered backend for a Figma visual consistency checker.

## Workflow

Use two requests instead of sending every reference image together.

### 1. Analyze each reference

POST:

https://figapi.vercel.app/api/analyze-reference

Send ONE reference render per request.

Example:

{
  "name": "Homepage",
  "image": "data:image/jpeg;base64,...",
  "geometry": {
    "width": 1280,
    "height": 3200,
    "nodes": []
  }
}

Response:

{
  "status": "ok",
  "referenceProfile": {
    "overall": "...",
    "patterns": [
      {
        "category": "spacing",
        "pattern": "...",
        "evidence": "...",
        "confidence": 0.92
      }
    ]
  }
}

The plugin should repeat this request for each reference page and keep the returned profiles locally.

### 2. Audit the current design

POST:

https://figapi.vercel.app/api/visual-audit

Send the current render plus the small reference profiles. Do NOT resend the reference images.

Example:

{
  "referenceProfiles": [
    {
      "name": "Homepage",
      "referenceProfile": {
        "overall": "...",
        "patterns": []
      }
    }
  ],
  "current": {
    "name": "Services",
    "image": "data:image/jpeg;base64,...",
    "geometry": {
      "width": 1280,
      "height": 3800,
      "nodes": []
    }
  },
  "options": {
    "check": [
      "layout",
      "alignment",
      "spacing",
      "padding",
      "gaps",
      "grid",
      "whitespace",
      "visual-hierarchy",
      "typography",
      "components",
      "overflow",
      "clipping",
      "overlap",
      "radius",
      "borders",
      "images",
      "visual-consistency"
    ]
  }
}

## Health checks

GET:

https://figapi.vercel.app/api/health

GET:

https://figapi.vercel.app/api/analyze-reference

GET:

https://figapi.vercel.app/api/visual-audit

## Vercel payload limit

Vercel currently limits serverless function request payloads to 4.5 MB. Large Figma renders can exceed this, especially when several base64 images are combined in one request.

Therefore:
- analyze references one at a time
- use JPG renders where possible
- avoid 2x/3x export
- use a width constraint around 1200px
- send compact geometry
- send only reference profiles to the final audit request

## Environment variables

GEMINI_API_KEY=your_gemini_key

Optional:

GEMINI_MODEL=gemini-3.8-flash

Never put the Gemini key in the Figma plugin.

## Safety

Gemini returns structured findings and an allowlisted fix operation. It never receives executable Figma code.

The Figma plugin must:
1. identify the returned layerId
2. show the issue
3. wait for an explicit Fix click
4. execute the operation through the Figma Plugin API
5. re-render
6. re-audit

The audit endpoint is unauthenticated for the Figma plugin, so keep payload limits and rate limiting enabled. For broader production use, add a persistent rate limiter or WAF.
