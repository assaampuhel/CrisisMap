# backend/routes/team.py
from flask import Blueprint, request, jsonify
from services.firestore_service import get_team_by_name, get_dispatches_by_team, get_db, update_incident_status
import uuid
from werkzeug.security import check_password_hash
from datetime import datetime

team_bp = Blueprint("team", __name__)
from auth_store import ACTIVE_TEAM_TOKENS

def require_team_auth(req):
    token = req.headers.get("x-team-token")
    return ACTIVE_TEAM_TOKENS.get(token)

@team_bp.route("/team/login", methods=["POST"])
def team_login():
    data = request.get_json() or {}
    name = data.get("name")
    password = data.get("password")
    if not name or not password:
        return jsonify({"error": "name and password required"}), 400

    team = get_team_by_name(name)
    if not team:
        return jsonify({"error":"invalid credentials"}), 401

    stored_hash = team.get("password")
    if not stored_hash or not check_password_hash(stored_hash, password):
        return jsonify({"error":"invalid credentials"}), 401

    token = uuid.uuid4().hex
    ACTIVE_TEAM_TOKENS[token] = team["_id"]
    return jsonify({"team_token": token, "team_id": team["_id"], "team_name": team.get("name")})


@team_bp.route("/team/dispatches", methods=["GET"])
def team_dispatches():
    team_id = require_team_auth(request)
    if not team_id:
        return jsonify({"error":"unauthorized"}), 401

    dispatches = get_dispatches_by_team(team_id)
    return jsonify(dispatches)

@team_bp.route("/team/dispatches/<dispatch_id>", methods=["GET"])
def team_dispatch_detail(dispatch_id):
    team_id = require_team_auth(request)
    if not team_id:
        return jsonify({"error":"unauthorized"}), 401

    db = get_db()
    doc = db.collection("dispatches").document(dispatch_id).get()
    if not doc.exists:
        return jsonify({"error":"not found"}), 404
    d = doc.to_dict() or {}
    # ensure this dispatch belongs to the team
    if d.get("team_id") != team_id:
        return jsonify({"error":"forbidden"}), 403
    d["_id"] = doc.id
    return jsonify(d)

@team_bp.route("/team/update-incident-status", methods=["POST"])
def team_update_incident_status():
    """
    Body: { dispatch_id, incident_id, new_status }
    Only allowed if the dispatch belongs to the team token.
    """
    team_id = require_team_auth(request)
    if not team_id:
        return jsonify({"error":"unauthorized"}), 401

    payload = request.get_json() or {}
    dispatch_id = payload.get("dispatch_id")
    incident_id = payload.get("incident_id")
    new_status = payload.get("new_status")

    if not dispatch_id or not incident_id or not new_status:
        return jsonify({"error":"dispatch_id, incident_id and new_status required"}), 400

    # verify dispatch exists and belongs to team
    db = get_db()
    doc = db.collection("dispatches").document(dispatch_id).get()
    if not doc.exists:
        return jsonify({"error":"dispatch not found"}), 404
    dd = doc.to_dict() or {}
    if dd.get("team_id") != team_id:
        return jsonify({"error":"forbidden"}), 403

    # perform status update on incident
    try:
        # use update_incident_status which sets dispatched_at for rescue_dispatched
        update_incident_status(incident_id, new_status)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------------------
# New route: update team's base location
# This uses the team blueprint (team_bp) and the team token auth
# Body: { lat: <float>, lng: <float> }  - both optional; defaults applied
# ---------------------------
@team_bp.route("/team/update-location", methods=["POST"])
def team_update_location():
    """
    Teams can call this endpoint (with x-team-token) to update their base_lat / base_lng.
    """
    team_id = require_team_auth(request)
    if not team_id:
        return jsonify({"error": "unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    try:
        lat = data.get("lat", 13.0108)
        lng = data.get("lng", 74.7943)

        # coerce to float if possible
        try:
            lat = float(lat)
            lng = float(lng)
        except Exception:
            return jsonify({"error": "invalid lat/lng"}), 400

        db = get_db()
        # update the team doc with base location and timestamp
        db.collection("teams").document(team_id).update({
            "base_lat": lat,
            "base_lng": lng,
            "updated_at": datetime.utcnow().isoformat()
        })
        return jsonify({"ok": True, "team_id": team_id, "base_lat": lat, "base_lng": lng})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
