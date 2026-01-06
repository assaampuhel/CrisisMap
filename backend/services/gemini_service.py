# backend/services/gemini_service.py
"""
Gemini helpers with robust JSON parsing and improved ML severity prediction.
Changes:
- affected_people_estimate defaults to None if unknown (admin UI shows "Unknown")
- persistent ML model: trained vectorizer + classifier saved to disk and loaded at startup
- training uses Firestore labeled dataset if available, otherwise synthetic seed
"""

import os
import json
import re
import logging
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

# Gemini SDK (existing)
import google.generativeai as genai

# Machine learning libraries (optional). If not present, code falls back to heuristics.
try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import train_test_split
    import joblib
    SKLEARN_AVAILABLE = True
except Exception as e:
    SKLEARN_AVAILABLE = False
    # We'll continue with heuristics if sklearn not available
    logging.info("sklearn/joblib not available: %s", e)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY not found in environment")

genai.configure(api_key=GEMINI_API_KEY)
MODEL_NAME = "gemini-2.5-pro"
model = genai.GenerativeModel(MODEL_NAME)

# ML persistence path
MODELS_DIR = Path(__file__).resolve().parents[1] / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)
MODEL_PATH = MODELS_DIR / "severity_model.joblib"

# Globals for ML
ML_MODEL = None
VECTORIZER = None

# ---------- ML training / loading utilities ----------

def load_saved_model():
    global ML_MODEL, VECTORIZER
    if not SKLEARN_AVAILABLE:
        return False
    try:
        if MODEL_PATH.exists():
            data = joblib.load(MODEL_PATH)
            ML_MODEL = data.get("model")
            VECTORIZER = data.get("vectorizer")
            logging.info("Loaded saved severity model from %s", MODEL_PATH)
            return True
    except Exception as e:
        logging.exception("Failed to load saved model: %s", e)
    return False

def save_model_to_disk(model_obj, vectorizer_obj):
    if not SKLEARN_AVAILABLE:
        return False
    try:
        joblib.dump({"model": model_obj, "vectorizer": vectorizer_obj}, MODEL_PATH)
        logging.info("Saved severity model to %s", MODEL_PATH)
        return True
    except Exception as e:
        logging.exception("Failed to save model: %s", e)
        return False

def fetch_labeled_examples_from_firestore(limit=1000):
    """
    Fetch labeled examples from Firestore collection 'labeled_incidents'.
    Expected documents: { description: str, label: 'low'|'medium'|'high'|'critical' }
    Returns lists: texts, labels
    """
    try:
        from firebase_admin import firestore
        db = firestore.client()
        docs = db.collection("labeled_incidents").limit(limit).stream()
        texts = []
        labels = []
        for d in docs:
            doc = d.to_dict()
            txt = doc.get("description") or doc.get("summary") or ""
            lbl = doc.get("label")
            if txt and lbl:
                texts.append(txt)
                labels.append(lbl)
        return texts, labels
    except Exception as e:
        logging.info("Could not fetch labeled examples from Firestore: %s", e)
        return [], []

def build_feature_texts(texts):
    """
    Additional feature engineering: could append simple flags to text (children, water, injured, count)
    For simplicity we just return texts as-is for TF-IDF. Could be extended.
    """
    return texts

def train_and_save_model(force_retrain=False):
    """
    Train severity model:
    - If a saved model exists and not force_retrain: load and return True.
    - Otherwise: attempt to fetch labeled data from Firestore; fall back to synthetic dataset.
    - Train TF-IDF + LogisticRegression, save to disk.
    """
    global ML_MODEL, VECTORIZER

    if not SKLEARN_AVAILABLE:
        logging.info("sklearn not available; skipping ML training")
        return False

    # If model exists and no force, just load it
    if MODEL_PATH.exists() and not force_retrain:
        return load_saved_model()

    # Fetch labeled data
    texts, labels = fetch_labeled_examples_from_firestore()
    if not texts:
        # synthetic seed dataset (small)
        texts = [
            "small crowd, minor water leakage",
            "two people injured, minor bleeding",
            "multiple people trapped in boat, urgent",
            "boat sinking, several children, people drowning",
            "power outage in one building",
            "fire inside market, many trapped",
            "car overturned with injuries",
            "single fall, minor injury",
            "people trapped in collapsed building, many injured",
            "boat stranded, several children and women"
        ]
        labels = ["low","medium","high","critical","low","critical","high","medium","critical","high"]
        logging.info("Using synthetic training dataset (no labeled data found in Firestore)")

    # Feature prep
    X_texts = build_feature_texts(texts)
    VECTORIZER = TfidfVectorizer(ngram_range=(1,2), max_features=4000)
    X = VECTORIZER.fit_transform(X_texts)

    # Train classifier
    try:
        ML_MODEL = LogisticRegression(max_iter=1000)
        ML_MODEL.fit(X, labels)
        # Save
        save_model_to_disk(ML_MODEL, VECTORIZER)
        logging.info("Trained and saved severity ML model (examples=%d)", len(labels))
        return True
    except Exception as e:
        logging.exception("Training failed: %s", e)
        ML_MODEL = None
        VECTORIZER = None
        return False

# Attempt to load or train at import time (best-effort)
if SKLEARN_AVAILABLE:
    if not load_saved_model():
        # try to train (will fallback to synthetic)
        try:
            train_and_save_model()
        except Exception as e:
            logging.info("Initial train failed: %s", e)

# ---------- existing heuristics and analysis code (minor changes) ----------

NUM_WORDS = {
    "zero":0,"one":1,"two":2,"three":3,"four":4,"five":5,"six":6,"seven":7,"eight":8,"nine":9,"ten":10,
    "eleven":11,"twelve":12,"thirteen":13,"fourteen":14,"fifteen":15,"sixteen":16,"seventeen":17,"eighteen":18,"nineteen":19,"twenty":20
}

def extract_count(text):
    if not text:
        return None
    m = re.search(r'(\d{1,4})\s*(people|persons|ppl|victims|people on board|on board|individuals)?', text, flags=re.I)
    if m:
        try:
            return int(m.group(1))
        except:
            pass
    for w,n in NUM_WORDS.items():
        if re.search(r'\b' + re.escape(w) + r'\b', text, flags=re.I):
            return n
    return None

def has_keyword(text, keywords):
    if not text:
        return False
    txt = text.lower()
    # keywords may be list or single regex-like string
    if isinstance(keywords, (list,tuple)):
        return any(k in txt for k in keywords)
    return re.search(keywords, txt, flags=re.I) is not None

SEV_LABEL_TO_NUM = {"low":1, "medium":2, "high":3, "critical":4}
NUM_TO_SEV_LABEL = {v:k for k,v in SEV_LABEL_TO_NUM.items()}

def heuristic_adjust_severity(parsed, description):
    base_sev_label = (parsed.get("severity") or "medium").lower()
    base_sev = SEV_LABEL_TO_NUM.get(base_sev_label, 2)
    base_urgency = float(parsed.get("urgency_score") or 0.5)

    reported_count = None
    if parsed.get("affected_people_estimate") is not None and parsed.get("affected_people_estimate") != "":
        try:
            # Only accept positive integers
            rc = int(parsed.get("affected_people_estimate"))
            if rc > 0:
                reported_count = rc
        except:
            reported_count = None

    if reported_count is None:
        reported_count = extract_count(description)

    children = has_keyword(description, ["child","children","kid","kids","infant","baby"])
    women = has_keyword(description, r"woman|women|female|pregnant")
    water = has_keyword(description, ["boat","sea","water","drowning","submerged","sinking"])
    fire = has_keyword(description, ["fire","blaze","burning"])
    collapse = has_keyword(description, ["collapsed","collapse","building fell","structural"])
    injured = has_keyword(description, ["injur","bleed","bleeding","hurt","fracture","unconscious","bleeding out"])

    score = base_sev
    if reported_count and reported_count >= 1:
        if reported_count >= 50:
            score += 2
        elif reported_count >= 10:
            score += 1
    if children:
        score += 1
    if water or fire or collapse:
        score += 1
    if injured:
        score += 1
    if women:
        score += 0.5

    urgency_nudge = 0
    if base_urgency > 0.75:
        urgency_nudge = 1
    elif base_urgency > 0.6:
        urgency_nudge = 0.5

    score = score + urgency_nudge
    score = max(1, min(5, score))
    if score >= 6:
        final_label = "critical"
    elif score >= 3.5:
        final_label = "high"
    elif score >= 2.0:
        final_label = "medium"
    else:
        final_label = "low"

    final_urgency = min(1.0, max(0.0, base_urgency * 0.6 + (score / 5.0) * 0.6))

    # final_count: if unknown keep None
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
        "severity_source": "heuristic+model" if ML_MODEL else "heuristic"
    }
    return parsed_out

def ml_predict_severity(description):
    """
    Use the persisted model if available. Returns (label, confidence) or (None, None).
    """
    if not SKLEARN_AVAILABLE or ML_MODEL is None or VECTORIZER is None:
        return None, None
    try:
        X = VECTORIZER.transform([description])
        pred = ML_MODEL.predict(X)[0]
        # get probability if available
        prob = None
        try:
            probs = ML_MODEL.predict_proba(X)[0]
            # map label to index in classes_
            label_idx = list(ML_MODEL.classes_).index(pred)
            prob = float(probs[label_idx])
        except Exception:
            prob = None
        return pred, prob
    except Exception as e:
        logging.exception("ML predict failed: %s", e)
        return None, None

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
        resp = model.generate_content(prompt)
        raw_text = resp.text.strip()
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

    # ML prediction using persisted model
    ml_label, ml_conf = ml_predict_severity(description)
    if ml_label:
        parsed_safe["severity_ml"] = ml_label
        parsed_safe["severity_ml_confidence"] = ml_conf

    parsed_adjusted = heuristic_adjust_severity(parsed_safe, description)

    # if ML predicted and more severe than heuristic, prefer it
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

# small helper (unchanged)
def pretty_format(parsed):
    out = []
    out.append(f"Type: {parsed.get('incident_type')}")
    out.append(f"Severity: {parsed.get('severity')} (urgency {parsed.get('urgency_score')})")
    out.append(f"Affected: {parsed.get('affected_people_estimate')}")
    out.append("Follow up questions:")
    for q in parsed.get("follow_up_questions", []):
        out.append(f"  - {q}")
    out.append("Summary:")
    out.append(parsed.get("summary",""))
    return "\n".join(out)


def generate_action_plan(incidents: list) -> dict:
    """
    Generate a consolidated action plan for multiple incidents.
    Expects a list of incident dicts (already analyzed).
    Returns a dict with keys: summary, route (list), resources (list).
    On Gemini failure, returns a reasonable fallback plan built locally.
    """
    if not incidents:
        return {
            "summary": "No active incidents to generate a plan.",
            "route": [],
            "resources": []
        }

    # Sort by severity + urgency
    severity_rank = {"critical": 4, "high": 3, "medium": 2, "low": 1}
    incidents_sorted = sorted(
        incidents,
        key=lambda x: (
            severity_rank.get(x.get("analysis", {}).get("severity", "medium"), 2),
            x.get("analysis", {}).get("urgency_score", 0)
        ),
        reverse=True
    )

    # Build simplified input for Gemini
    simplified = []
    for it in incidents_sorted:
        a = it.get("analysis", {})
        simplified.append({
            "location": it.get("location"),
            "lat": it.get("lat"),
            "lng": it.get("lng"),
            "severity": a.get("severity"),
            "affected": a.get("affected_people_estimate"),
            "summary": a.get("summary")
        })

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
        resp = model.generate_content(prompt)
        text = resp.text.strip()

        # extract JSON safely
        match = re.search(r'(\{.*\})', text, re.S)
        if match:
            parsed = json.loads(match.group(1))
            return parsed

        # if not JSON, still return text summary
        return {"summary": text, "route": [], "resources": []}

    except Exception as e:
        # fallback plan generator (local)
        try:
            route = []
            for it in incidents_sorted:
                a = it.get("analysis", {})
                route.append({
                    "location": it.get("location"),
                    "lat": it.get("lat"),
                    "lng": it.get("lng"),
                    "reason": f"Priority {a.get('severity','n/a')}"
                })
            resources = ["Ambulance", "Rescue Boat"] if any(has_keyword((i.get("description") or ""), ["boat","drowning","sinking","sea"]) for i in incidents_sorted) else ["Ambulance", "Medical Kit"]
            return {
                "summary": f"(Fallback plan) Model failed: {str(e)}",
                "route": route,
                "resources": resources
            }
        except Exception as e2:
            return {"summary": f"Failed to generate plan: {e2}", "route": [], "resources": []}