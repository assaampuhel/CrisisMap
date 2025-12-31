# backend/routes/admin.py
from flask import Blueprint, request, jsonify
from services.firestore_service import get_all_incidents, get_incidents_by_status, update_incident_status, search_incidents_by_text
from services.gemini_service import generate_action_plan  # expects list of incidents
from datetime import datetime
import uuid

admin_bp = Blueprint("admin", __name__)

# --- Simple hardcoded auth for demo (do NOT use in production) ---
ADMIN_USERS = {
    "admin": "password123",
    "ops": "rescue2025"
}
# store simple tokens in memory
ACTIVE_TOKENS = {}

def require_auth(req):
    token = req.headers.get("x-admin-token") or req.args.get("token")
    return token if token in ACTIVE_TOKENS else None

@admin_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json() or {}
    username = data.get("username")
    password = data.get("password")
    if not username or not password:
        return jsonify({"error":"username and password required"}), 400
    if username in ADMIN_USERS and ADMIN_USERS[username] == password:
        token = uuid.uuid4().hex
        ACTIVE_TOKENS[token] = {"user": username, "login_at": datetime.utcnow().isoformat()}
        return jsonify({"token": token, "user": username})
    return jsonify({"error":"invalid credentials"}), 401

@admin_bp.route("/incidents", methods=["GET"])
def incidents():
    # optional auth; uncomment to require
    # if not require_auth(request): return jsonify({"error":"unauthorized"}), 401

    status = request.args.get("status")
    q = request.args.get("q")
    if q:
        items = search_incidents_by_text(q)
    elif status:
        statuses = [s.strip() for s in status.split(",")]
        items = get_incidents_by_status(statuses)
    else:
        items = get_all_incidents()
    return jsonify(items)

@admin_bp.route("/update-status", methods=["POST"])
def update_status():
    if not require_auth(request):
        return jsonify({"error":"unauthorized"}), 401

    payload = request.get_json() or {}
    doc_id = payload.get("id")
    new_status = payload.get("status")
    if not doc_id or not new_status:
        return jsonify({"error":"id and status required"}), 400
    try:
        update_incident_status(doc_id, new_status)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@admin_bp.route("/generate-plan", methods=["POST"])
def generate_plan():
    # require admin token
    if not require_auth(request):
        return jsonify({"error":"unauthorized"}), 401

    payload = request.get_json() or {}
    statuses = payload.get("statuses", ["new"])

    # Call generate_action_plan with statuses dict so service can fetch Firestore itself
    try:
        plan_text = generate_action_plan({"statuses": statuses})  # returns a string (pretty JSON or text)
    except Exception as e:
        return jsonify({"error": f"AI plan generation failed: {e}"}), 500

    # Also return incidents with coords so frontend can build route
    try:
        incidents = get_incidents_by_status(statuses)
        coords = [
            {
                "_id": i.get("_id"),
                "lat": i.get("lat"),
                "lng": i.get("lng"),
                "severity": (i.get("analysis") or {}).get("severity")
            }
            for i in incidents if i.get("lat") is not None and i.get("lng") is not None
        ]
    except Exception as e:
        # if fetching incidents for coords fails, still return the plan (but note missing coords)
        coords = []
        # log server-side (Flask logger will show this)
        print("Warning: failed to fetch incident coords for plan response:", e)

    return jsonify({"plan": plan_text, "incidents": coords})
