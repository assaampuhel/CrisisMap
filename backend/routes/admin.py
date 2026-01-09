# backend/routes/admin.py

from flask import Blueprint, request, jsonify
from services.firestore_service import (
    get_all_incidents,
    get_incidents_by_status,
    update_incident_status,
    search_incidents_by_text,
    create_team,
    get_all_teams,
    create_dispatch,
    update_incident_assignment
)
from services.gemini_service import generate_action_plan, load_assignment_model
from datetime import datetime
import uuid
from werkzeug.security import generate_password_hash
from auth_store import ACTIVE_ADMIN_TOKENS
import math
import traceback
import logging

admin_bp = Blueprint("admin", __name__)

ADMIN_USERS = {
    "admin": "password123",
    "ops": "rescue2025"
}

def require_auth(req):
    token = req.headers.get("x-admin-token") or req.args.get("token")
    return token if token in ACTIVE_ADMIN_TOKENS else None

@admin_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json() or {}
    username = data.get("username")
    password = data.get("password")
    if not username or not password:
        return jsonify({"error":"username and password required"}), 400
    if username in ADMIN_USERS and ADMIN_USERS[username] == password:
        token = uuid.uuid4().hex
        ACTIVE_ADMIN_TOKENS[token] = {"user": username, "login_at": datetime.utcnow().isoformat()}
        return jsonify({"token": token, "user": username})
    return jsonify({"error":"invalid credentials"}), 401

@admin_bp.route("/incidents", methods=["GET"])
def incidents():
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
    if not require_auth(request):
        return jsonify({"error":"unauthorized"}), 401
    payload = request.get_json() or {}
    statuses = payload.get("statuses", ["new"])
    team_id = payload.get("team_id")
    try:
        incidents = get_incidents_by_status(statuses)
    except Exception as e:
        return jsonify({"error": f"Failed to fetch incidents: {e}"}), 500
    if not incidents:
        return jsonify({"error":"no incidents for given statuses"}), 400
    try:
        plan_text = generate_action_plan(incidents)
    except Exception as e:
        return jsonify({"error": f"AI plan generation failed: {e}"}), 500
    dispatch_id = f"dispatch_{uuid.uuid4().hex[:10]}"
    dispatch_doc = {
        "dispatch_id": dispatch_id,
        "team_id": team_id,
        "created_by": "admin",
        "created_at": datetime.utcnow().isoformat(),
        "status": "assigned",
        "plan_text": plan_text,
        "incidents": [
            {
                "_id": i.get("_id"),
                "location": i.get("location"),
                "lat": i.get("lat"),
                "lng": i.get("lng"),
                "severity": (i.get("analysis") or {}).get("severity")
            } for i in incidents
        ]
    }
    try:
        create_dispatch(dispatch_doc)
    except Exception as e:
        return jsonify({"error": f"Failed to create dispatch: {e}"}), 500
    failed_updates = []
    for it in incidents:
        try:
            if it.get("_id"):
                update_incident_assignment(it["_id"], dispatch_id=dispatch_id, team_id=team_id, new_status="rescue_dispatched")
        except Exception as e:
            failed_updates.append({"id": it.get("_id"), "error": str(e)})
    coords = [{"_id": i.get("_id"), "lat": i.get("lat"), "lng": i.get("lng"), "severity": (i.get("analysis") or {}).get("severity")} for i in incidents if i.get("lat") is not None and i.get("lng") is not None]
    resp = {"dispatch_id": dispatch_id, "plan": plan_text, "incidents": coords}
    if failed_updates:
        resp["warning"] = {"failed_updates": failed_updates}
    return jsonify(resp)

@admin_bp.route("/teams", methods=["POST"])
def create_team_api():
    if not require_auth(request):
        return jsonify({"error": "unauthorized"}), 401
    data = request.get_json() or {}
    name = data.get("name")
    contact = data.get("contact")
    password = data.get("password")
    if not name or not password:
        return jsonify({"error": "name and password required"}), 400
    pw_hash = generate_password_hash(password)
    team_id = create_team(name, contact, pw_hash)
    return jsonify({"team_id": team_id})

@admin_bp.route("/teams", methods=["GET"])
def list_teams_api():
    if not require_auth(request):
        return jsonify({"error": "unauthorized"}), 401
    teams = get_all_teams()
    return jsonify(teams)

# -----------------------
# Auto-dispatch (uses assignment model if present; else fall back)
# -----------------------
@admin_bp.route("/auto-dispatch-ai", methods=["POST"])
def auto_dispatch_ai():
    if not require_auth(request):
        return jsonify({"error":"unauthorized"}), 401
    payload = request.get_json() or {}
    statuses = payload.get("statuses", ["new"])
    try:
        max_per_team = int(payload.get("max_per_team", 8))
    except Exception:
        max_per_team = 8

    w_sev = float(payload.get("weights", {}).get("severity", 1.0))
    w_dist = float(payload.get("weights", {}).get("distance", 0.6))
    w_load = float(payload.get("weights", {}).get("load", 0.8))
    DIST_SCALE = float(payload.get("dist_scale_km", 50.0))
    MAX_DISTANCE_KM = float(payload.get("max_distance_km", 40.0))

    # load assignment model (best effort)
    try:
        assign_model = load_assignment_model()
    except Exception:
        assign_model = None

    try:
        incidents = get_incidents_by_status(statuses)
    except Exception as e:
        return jsonify({"error": f"Failed to fetch incidents: {e}"}), 500
    if not incidents:
        return jsonify({"error": "no incidents for given statuses"}), 400
    teams = get_all_teams() or []
    if not teams:
        return jsonify({"error": "no teams available"}), 400

    try:
        all_incidents = get_all_incidents()
    except Exception:
        all_incidents = []

    loads = {t["_id"]: 0 for t in teams}
    for inc in all_incidents:
        at = inc.get("assigned_team")
        st = (inc.get("status") or "").lower()
        if at and at in loads and st != "closed":
            loads[at] = loads.get(at, 0) + 1

    def sev_norm(it):
        sev = (it.get("analysis") or {}).get("severity") or it.get("severity") or "medium"
        m = {"critical":5,"high":4,"medium":3,"low":2}
        val = m.get(str(sev).lower(), 3)
        return (val - 2) / 3.0

    # build team coords map
    team_coords = {}
    for t in teams:
        lat = t.get("base_lat"); lng = t.get("base_lng")
        if lat is not None and lng is not None:
            try: team_coords[t["_id"]] = (float(lat), float(lng))
            except: team_coords[t["_id"]] = None
        else:
            team_coords[t["_id"]] = None

    incidents_sorted = sorted(incidents, key=lambda x: sev_norm(x), reverse=True)
    assignments = {t["_id"]: [] for t in teams}
    team_ids = [t["_id"] for t in teams]

    from math import radians, sin, cos, sqrt, atan2
    def haversine(lat1, lng1, lat2, lng2):
        R = 6371
        dlat = radians(lat2 - lat1); dlng = radians(lng2 - lng1)
        a = sin(dlat/2)**2 + cos(radians(lat1))*cos(radians(lat2))*sin(dlng/2)**2
        return R * 2 * atan2(sqrt(a), sqrt(1-a))

    for inc in incidents_sorted:
        best_team = None; best_score = -1e9
        sev_val = sev_norm(inc)
        lat = inc.get("lat"); lng = inc.get("lng")
        for tid in team_ids:
            load = loads.get(tid,0)
            load_norm = min(load / float(payload.get("load_scale", 10.0)), 5.0)
            coords = team_coords.get(tid)
            if coords and lat is not None and lng is not None:
                try: dist_km = haversine(coords[0], coords[1], lat, lng)
                except: dist_km = DIST_SCALE*2
                dist_norm = min(dist_km / DIST_SCALE, 5.0)
            else:
                dist_km = DIST_SCALE*2; dist_norm = 5.0

            distance_penalty = 0.0
            if dist_km > MAX_DISTANCE_KM:
                distance_penalty = ((dist_km - MAX_DISTANCE_KM) / (DIST_SCALE or 1.0)) * 1.5

            score = -1e9
            if assign_model is not None:
                try:
                    feat = [[sev_val, float(dist_km), float(load)]]
                    if hasattr(assign_model, "predict_proba"):
                        probs = assign_model.predict_proba(feat)[0]
                        pos_idx = 1 if (hasattr(assign_model, "classes_") and 1 in list(assign_model.classes_)) else (1 if len(probs)>1 else 0)
                        score = float(probs[pos_idx])
                    else:
                        sc = assign_model.predict(feat)[0]
                        score = float(sc)
                except Exception:
                    score = -1e9

            if score == -1e9:
                score = (w_sev * sev_val) - (w_dist * dist_norm) - (w_load * load_norm)

            score -= distance_penalty
            if load < max_per_team: score += 0.2

            if score > best_score:
                best_score = score; best_team = tid

        if best_team is None:
            best_team = sorted(team_ids, key=lambda x: loads.get(x,0))[0]
        assignments[best_team].append(inc)
        loads[best_team] = loads.get(best_team,0) + 1

    from services.firestore_service import update_incident_assignment
    created = []
    for tid, inc_list in assignments.items():
        if not inc_list: continue
        try:
            plan_text = generate_action_plan(inc_list)
        except Exception as e:
            plan_text = f"Auto-dispatch for team {tid}: {len(inc_list)} incidents. (Plan generator failed: {e})"
        dispatch_id = f"dispatch_{uuid.uuid4().hex[:10]}"
        dispatch_doc = {
            "dispatch_id": dispatch_id,
            "team_id": tid,
            "created_by": "auto-dispatch-ai",
            "created_at": datetime.utcnow().isoformat(),
            "status": "assigned",
            "plan_text": plan_text,
            "incidents": [{"_id": i.get("_id"), "location": i.get("location"), "lat": i.get("lat"), "lng": i.get("lng"), "severity": (i.get("analysis") or {}).get("severity")} for i in inc_list]
        }
        try:
            create_dispatch(dispatch_doc)
        except Exception as e:
            created.append({"team_id": tid, "dispatch_id": None, "error": str(e), "count": len(inc_list)})
            continue
        failed_updates = []
        for it in inc_list:
            try:
                if it.get("_id"):
                    update_incident_assignment(it["_id"], dispatch_id=dispatch_id, team_id=tid, new_status="rescue_dispatched")
            except Exception as e:
                failed_updates.append({"id": it.get("_id"), "error": str(e)})
        entry = {"team_id": tid, "dispatch_id": dispatch_id, "count": len(inc_list), "plan_text": plan_text, "incidents": dispatch_doc["incidents"]}
        if failed_updates: entry["failed_updates"] = failed_updates
        created.append(entry)

    return jsonify({"ok": True, "dispatches": created})
