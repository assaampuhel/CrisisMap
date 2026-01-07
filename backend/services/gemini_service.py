# backend/services/gemini_service.py
"""
Runtime gemini_service: Gemini + heuristics + unified severity ML predictor (if model file present).
This file deliberately does NOT train models. It attempts to load joblib models from ../models/.
"""

import os
import json
import re
import logging
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

# Optional Gemini SDK use
try:
    import google.generativeai as genai
except Exception:
    genai = None

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemini-2.5-flash-lite")

if GEMINI_API_KEY and genai is not None:
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel(MODEL_NAME)
    except Exception as e:
        logging.exception("Failed to configure Gemini: %s", e)
        model = None
else:
    model = None
    logging.info("Gemini not configured or SDK not present; running in fallback mode.")

# Models directory and paths
MODELS_DIR = Path(__file__).resolve().parents[1] / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)
SEVERITY_MODEL_PATH = MODELS_DIR / "severity_model.joblib"
ASSIGNMENT_MODEL_PATH = MODELS_DIR / "assignment_model.joblib"

# ML runtime availability
try:
    import joblib
    from sklearn.feature_extraction.text import TfidfVectorizer
    SKLEARN_AVAILABLE = True
except Exception as e:
    SKLEARN_AVAILABLE = False
    logging.info("sklearn/joblib not available: %s", e)

# Globals
SEV_MODEL = None
VECTORIZER = None
ASSIGN_MODEL = None

# ------------------ model loaders (runtime only) ------------------
def load_severity_model():
    """Load the unified severity model (model+vectorizer) if present."""
    global SEV_MODEL, VECTORIZER
    if not SKLEARN_AVAILABLE:
        return False
    if SEV_MODEL is not None and VECTORIZER is not None:
        return True
    try:
        if SEVERITY_MODEL_PATH.exists():
            data = joblib.load(SEVERITY_MODEL_PATH)
            SEV_MODEL = data.get("model")
            VECTORIZER = data.get("vectorizer")
            logging.info("Loaded severity model from %s", SEVERITY_MODEL_PATH)
            return True
    except Exception as e:
        logging.exception("Failed to load severity model: %s", e)
    return False

def load_assignment_model():
    """Load assignment decision model (if exists). Returns model or None."""
    global ASSIGN_MODEL
    if not SKLEARN_AVAILABLE:
        return None
    if ASSIGN_MODEL is not None:
        return ASSIGN_MODEL
    try:
        if ASSIGNMENT_MODEL_PATH.exists():
            ASSIGN_MODEL = joblib.load(ASSIGNMENT_MODEL_PATH)
            logging.info("Loaded assignment model from %s", ASSIGNMENT_MODEL_PATH)
            return ASSIGN_MODEL
    except Exception as e:
        logging.exception("Failed to load assignment model: %s", e)
    return None

# ------------------ utilities ------------------
NUM_WORDS = {
    "zero":0,"one":1,"two":2,"three":3,"four":4,"five":5,"six":6,"seven":7,"eight":8,"nine":9,"ten":10,
    "eleven":11,"twelve":12,"thirteen":13,"fourteen":14,"fifteen":15,"sixteen":16,"seventeen":17,"eighteen":18,"nineteen":19,"twenty":20
}

def extract_count(text):
    if not text:
        return None
    m = re.search(r'(\d{1,4})\s*(people|persons|ppl|victims|on board|individuals)?', text, flags=re.I)
    if m:
        try: return int(m.group(1))
        except: pass
    for w,n in NUM_WORDS.items():
        if re.search(r'\b' + re.escape(w) + r'\b', text, flags=re.I):
            return n
    return None

def has_keyword(text, keywords):
    if not text: return False
    txt = text.lower()
    if isinstance(keywords, (list,tuple)):
        return any(k in txt for k in keywords)
    return re.search(keywords, txt, flags=re.I) is not None

SEV_LABEL_TO_NUM = {"low":1,"medium":2,"high":3,"critical":4}
NUM_TO_SEV_LABEL = {v:k for k,v in SEV_LABEL_TO_NUM.items()}

def heuristic_adjust_severity(parsed, description):
    base_sev_label = (parsed.get("severity") or "medium").lower()
    base_sev = SEV_LABEL_TO_NUM.get(base_sev_label, 2)
    base_urgency = float(parsed.get("urgency_score") or 0.5)

    reported_count = None
    if parsed.get("affected_people_estimate") not in [None, ""]:
        try:
            rc = int(parsed.get("affected_people_estimate"))
            if rc > 0: reported_count = rc
        except:
            reported_count = None
    if reported_count is None:
        reported_count = extract_count(description)

    children = has_keyword(description, ["child","children","kid","kids","infant","baby"])
    women = has_keyword(description, r"woman|women|female|pregnant")
    water = has_keyword(description, ["boat","sea","water","drowning","sinking"])
    fire = has_keyword(description, ["fire","blaze","burning"])
    collapse = has_keyword(description, ["collapsed","collapse","building fell","structural"])
    injured = has_keyword(description, ["injur","bleed","bleeding","hurt","fracture","unconscious"])

    score = base_sev
    if reported_count and reported_count >= 1:
        if reported_count >= 50: score += 2
        elif reported_count >= 10: score += 1
    if children: score += 1
    if water or fire or collapse: score += 1
    if injured: score += 1
    if women: score += 0.5

    urgency_nudge = 0
    if base_urgency > 0.75: urgency_nudge = 1
    elif base_urgency > 0.6: urgency_nudge = 0.5

    score = score + urgency_nudge
    score = max(1, min(5, score))
    if score >= 4.5: final_label = "critical"
    elif score >= 3.2: final_label = "high"
    elif score >= 2.2: final_label = "medium"
    else: final_label = "low"
    final_urgency = min(1.0, max(0.0, base_urgency * 0.6 + (score / 5.0) * 0.6))
    final_count = reported_count if reported_count is not None else None

    parsed_out = dict(parsed)
    parsed_out["severity"] = final_label
    parsed_out["urgency_score"] = round(final_urgency, 3)
    parsed_out["affected_people_estimate"] = int(final_count) if final_count is not None else None
    parsed_out["adjustments"] = {
        "reported_count": final_count,
        "children": bool(children),
        "water": bool(water),
        "fire": bool(fire),
        "injured": bool(injured),
        "women": bool(women),
        "base_severity": base_sev_label,
        "severity_source": "ml+heuristic" if SEV_MODEL else "heuristic"
    }
    return parsed_out

def ml_predict_severity(description):
    """Predict severity label using loaded unified model if available."""
    if not SKLEARN_AVAILABLE: return None, None
    if SEV_MODEL is None or VECTORIZER is None:
        load_severity_model()
    if SEV_MODEL is None or VECTORIZER is None: return None, None
    try:
        X = VECTORIZER.transform([description])
        pred = SEV_MODEL.predict(X)[0]
        prob = None
        try:
            probs = SEV_MODEL.predict_proba(X)[0]
            idx = list(SEV_MODEL.classes_).index(pred)
            prob = float(probs[idx])
        except Exception:
            prob = None
        return pred, prob
    except Exception as e:
        logging.exception("ML predict failed: %s", e)
        return None, None

# ------------------ analyze_incident (Gemini + ML + heuristics) ------------------
def analyze_incident(raw_report: dict) -> dict:
    location = raw_report.get("location", "")
    description = raw_report.get("description", "")

    prompt = f"""
You are an emergency response assistant. Analyze the citizen report below and return ONLY valid JSON.

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
    try:
        if model:
            resp = model.generate_content(prompt)
            raw_text = resp.text.strip()
        else:
            raw_text = "{}"
        parsed = {}
        try:
            parsed = json.loads(raw_text)
        except Exception:
            m = re.search(r'(\{.*\})', raw_text, flags=re.S)
            if m:
                try:
                    parsed = json.loads(m.group(1))
                except Exception:
                    parsed = {}
            else:
                parsed = {}
        parsed_safe = {
            "incident_type": parsed.get("incident_type", "other"),
            "severity": parsed.get("severity", "medium"),
            "urgency_score": float(parsed.get("urgency_score") or 0.5),
            "affected_people_estimate": parsed.get("affected_people_estimate") if parsed.get("affected_people_estimate") not in [None, ""] else None,
            "follow_up_questions": parsed.get("follow_up_questions") or [],
            "summary": (parsed.get("summary") or "").strip()
        }
    except Exception as e:
        logging.exception("Gemini call failed")
        parsed_safe = {
            "incident_type": "other",
            "severity": "medium",
            "urgency_score": 0.5,
            "affected_people_estimate": None,
            "follow_up_questions": [],
            "summary": f"(AI error) {str(e)}"
        }

    # ML prediction using the unified severity model
    ml_label, ml_conf = ml_predict_severity(description)
    if ml_label:
        parsed_safe["severity_ml"] = ml_label
        parsed_safe["severity_ml_confidence"] = ml_conf

    parsed_adjusted = heuristic_adjust_severity(parsed_safe, description)

    # If ML predicted more severe than heuristic, prefer it
    if ml_label:
        try:
            ml_num = SEV_LABEL_TO_NUM.get(ml_label, 2)
            heur_num = SEV_LABEL_TO_NUM.get(parsed_adjusted["severity"], 2)
            if ml_num > heur_num:
                parsed_adjusted["severity"] = ml_label
                parsed_adjusted["adjustments"]["severity_source"] = "ml_override"
                parsed_adjusted["adjustments"]["ml_confidence"] = ml_conf
        except:
            pass

    return parsed_adjusted

# ------------------ generate_action_plan (unchanged behavior) ------------------
def generate_action_plan(incidents: list) -> dict:
    if not incidents:
        return {"summary":"No active incidents to generate a plan.","route":[],"resources":[]}
    severity_rank = {"critical":4,"high":3,"medium":2,"low":1}
    incidents_sorted = sorted(
        incidents,
        key=lambda x: (severity_rank.get(x.get("analysis",{}).get("severity","medium"),2), x.get("analysis",{}).get("urgency_score",0)),
        reverse=True
    )
    simplified = []
    for it in incidents_sorted:
        a = it.get("analysis",{})
        simplified.append({"location": it.get("location"), "lat": it.get("lat"), "lng": it.get("lng"), "severity": a.get("severity"), "affected": a.get("affected_people_estimate"), "summary": a.get("summary")})
    prompt = f"""
You are an emergency operations planner.

Given these active incidents (sorted by priority), generate:
1. An optimal visitation order (route)
2. Required resources (vehicles, medical kits, boats, food, etc.)
3. A concise execution summary

Incidents:
{json.dumps(simplified, indent=2)}

Return ONLY valid JSON in this format:
{{
  "summary": "overall strategy",
  "route": [
    {{
      "location": "name",
      "lat": 0.0,
      "lng": 0.0,
      "reason": "why this order"
    }}
  ],
  "resources": ["item1", "item2"]
}}
"""
    try:
        if model:
            resp = model.generate_content(prompt)
            text = resp.text.strip()
        else:
            # fallback: route equals incidents_sorted order
            text = json.dumps({
                "summary": "(fallback) No Gemini available - route ordered by severity",
                "route": [{"location": it.get("location"), "lat": it.get("lat"), "lng": it.get("lng"), "reason": f"Priority {it.get('analysis',{}).get('severity','n/a')}"} for it in incidents_sorted],
                "resources": ["Ambulance","Medical Kit"]
            })
        match = re.search(r'(\{.*\})', text, re.S)
        if match:
            parsed = json.loads(match.group(1))
            return parsed
        return {"summary": text, "route": [], "resources": []}
    except Exception as e:
        # safe fallback
        try:
            route = []
            for it in incidents_sorted:
                a = it.get("analysis",{})
                route.append({"location": it.get("location"), "lat": it.get("lat"), "lng": it.get("lng"), "reason": f"Priority {a.get('severity','n/a')}"})
            resources = ["Ambulance", "Rescue Boat"] if any(has_keyword((i.get("description") or ""), ["boat","drowning","sinking","sea"]) for i in incidents_sorted) else ["Ambulance", "Medical Kit"]
            return {"summary": f"(Fallback plan) Model failed: {e}", "route": route, "resources": resources}
        except Exception as e2:
            return {"summary": f"Failed to generate plan: {e2}", "route": [], "resources": []}
