"""
Routes for citizen report submission.
Endpoint:
- POST /api/submit-report
    form fields: location, description, optional file "image", optional lat, lng
"""

from flask import Blueprint, request, jsonify
import os, uuid
from datetime import datetime
from config import UPLOAD_FOLDER
from services.firestore_service import save_raw_report, save_processed_incident
from services.gemini_service import analyze_incident

reports_bp = Blueprint("reports", __name__)

@reports_bp.route("/submit-report", methods=["POST"])
def submit_report():
    # get fields from multipart/form-data
    location = request.form.get("location", "")
    description = request.form.get("description", "")
    lat = request.form.get("lat", None)
    lng = request.form.get("lng", None)
    image = request.files.get("image", None)

    if not location or not description:
        return jsonify({"error": "location and description are required"}), 400

    # save image with timestamp + uuid to avoid collisions
    image_filename = None
    if image:
        ext = image.filename.rsplit(".", 1)[-1] if "." in image.filename else "jpg"
        timestamp_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        unique_id = uuid.uuid4().hex
        image_filename = f"{timestamp_str}_{unique_id}.{ext}"
        save_path = os.path.join(UPLOAD_FOLDER, image_filename)
        image.save(save_path)

    # raw report structure
    raw_report = {
        "location": location,
        "description": description,
        "lat": float(lat) if lat else None,
        "lng": float(lng) if lng else None,
        "image_filename": image_filename,
        "timestamp": datetime.utcnow(),
        "status": "new"
    }

    # save raw report to Firestore
    try:
        save_raw_report(raw_report)
    except Exception as e:
        return jsonify({"error": f"Failed to save raw report: {e}"}), 500

    # analyze with Gemini (returns parsed dict)
    try:
        analysis = analyze_incident(raw_report)
    except Exception as e:
        # don't fail hard — store fallback analysis
        analysis = {
            "incident_type": "other",
            "severity": "medium",
            "urgency_score": 0.5,
            "affected_people_estimate": 0,
            "summary": f"AI analysis failed: {str(e)}"
        }

    # save processed incident
    processed = { **raw_report, "analysis": analysis }
    try:
        save_processed_incident(processed)
    except Exception as e:
        return jsonify({"error": f"Failed to save processed incident: {e}"}), 500

    # respond with analysis summary for client UI
    return jsonify({
        "message": "Report submitted and analyzed",
        "analysis": analysis
    }), 200
