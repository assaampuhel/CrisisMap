"""
Admin routes for dashboard.
- GET /api/incidents         -> list processed incidents (with analysis)
- POST /api/generate-plan    -> generate an action plan using AI for one incident
"""

from flask import Blueprint, request, jsonify
from services.firestore_service import get_all_incidents
from services.gemini_service import generate_action_plan

admin_bp = Blueprint("admin", __name__)

@admin_bp.route("/incidents", methods=["GET"])
def incidents():
    try:
        items = get_all_incidents()
        return jsonify(items)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@admin_bp.route("/generate-plan", methods=["POST"])
def generate_plan():
    incident = request.get_json()
    if not incident:
        return jsonify({"error": "incident JSON required"}), 400

    try:
        plan_text = generate_action_plan(incident)
        return jsonify({"plan": plan_text})
    except Exception as e:
        return jsonify({"error": f"AI plan generation failed: {e}"}), 500
