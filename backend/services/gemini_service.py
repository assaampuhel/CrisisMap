"""
Gemini AI integration for:
- analyze_incident(report): returns Python dict with structured fields
- generate_action_plan(incident): returns a plain-text action plan string

We use google-generativeai SDK.
"""

import os, json
import google.generativeai as genai
from config import GEMINI_API_KEY

# configure gemini key
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY not set in environment (.env)")

genai.configure(api_key=GEMINI_API_KEY)
# Choose the model (adjust if new model names are available)
model = genai.GenerativeModel("gemini-2.5-flash-lite")

def analyze_incident(report):
    """
    Send a prompt summarizing the incident and ask the model to respond with strict JSON.
    Returns parsed dict (with keys: incident_type, severity, urgency_score, affected_people_estimate, summary, follow_up_questions)
    """
    location = report.get("location", "")
    description = report.get("description", "")

    prompt = f"""
You are an emergency response assistant. Analyze the citizen report and return ONLY valid JSON (no markdown).

Report:
Location: {location}
Description: {description}

Return JSON with this structure:
{{
  "incident_type": "flood | medical | power | fire | shelter | other",
  "severity": "low | medium | high | critical",
  "urgency_score": 0.0,
  "affected_people_estimate": 0,
  "follow_up_questions": ["short question 1", "short question 2"],
  "summary": "short explanation"
}}
"""

    # generate
    resp = model.generate_content(prompt)
    raw_text = resp.text.strip()

    # attempt to parse JSON; if fails, fall back to a safe structure
    try:
        parsed = json.loads(raw_text)
    except Exception:
        # fallback: ask model in a more forgiving way or return safe defaults
        parsed = {
            "incident_type": "other",
            "severity": "medium",
            "urgency_score": 0.5,
            "affected_people_estimate": 0,
            "follow_up_questions": [],
            "summary": raw_text[:400]  # include some raw output in fallback
        }

    return parsed

def generate_action_plan(incident):
    """
    Given an incident dict, generate a clear immediate action plan (plain text).
    """
    # ensure incident is JSON-string friendly
    incident_str = json.dumps(incident, default=str, indent=2)

    prompt = f"""
You are a disaster response coordinator AI. Given this incident, produce a concise action plan in plain text.

Incident:
{incident_str}

Output a plan that includes:
- Top immediate actions (ordered)
- Resources required (type & approximate quantity)
- Priority/urgency
- Notes for human operators (e.g., access issues, vulnerable groups)
Return only the action plan text.
"""

    resp = model.generate_content(prompt)
    return resp.text.strip()
