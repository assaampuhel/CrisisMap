"""
Routes for citizen report submission.

Endpoint:
POST /api/submit-report

Form fields (multipart/form-data):
- location (string, required)
- description (string, required)
- lat (float, optional)
- lng (float, optional)
- image (file, optional)
"""

from flask import Blueprint, request, jsonify
import os
import uuid
from datetime import datetime

from config import UPLOAD_FOLDER, FIREBASE_STORAGE_BUCKET
from services.firestore_service import save_raw_report, save_processed_incident
from services.gemini_service import analyze_incident

# Firebase Storage
from firebase_admin import storage as fb_storage

reports_bp = Blueprint("reports", __name__)


@reports_bp.route("/submit-report", methods=["POST"])
def submit_report():
    location = request.form.get("location", "").strip()
    description = request.form.get("description", "").strip()
    lat = request.form.get("lat")
    lng = request.form.get("lng")
    image = request.files.get("image")

    if not location or not description:
        return jsonify({"error": "location and description are required"}), 400

    image_filename = None
    image_url = None

    if image:
        # Create unique filename
        ext = image.filename.rsplit(".", 1)[-1] if "." in image.filename else "jpg"
        unique_name = f"{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex}.{ext}"
        image_filename = unique_name

        # Local fallback save (for debugging)
        os.makedirs(UPLOAD_FOLDER, exist_ok=True)
        local_path = os.path.join(UPLOAD_FOLDER, unique_name)
        image.save(local_path)

        # Upload to Firebase Storage
        try:
            if FIREBASE_STORAGE_BUCKET:
                bucket = fb_storage.bucket()
                blob = bucket.blob(f"incidents/{unique_name}")

                # Ensure stream pointer is reset
                try:
                    image.stream.seek(0)
                except Exception:
                    pass

                blob.upload_from_file(
                    image.stream,
                    content_type=image.content_type
                )

                # Public URL for hackathon/demo
                try:
                    blob.make_public()
                    image_url = blob.public_url
                except Exception:
                    image_url = None
        except Exception as e:
            print("Firebase Storage upload failed:", e)
            image_url = None

    # Raw report document
    raw_report = {
        "location": location,
        "description": description,
        "lat": float(lat) if lat else None,
        "lng": float(lng) if lng else None,
        "image_filename": image_filename,
        "image_url": image_url,
        "timestamp": datetime.utcnow(),
        "status": "new"
    }

    # Save raw report
    try:
        save_raw_report(raw_report)
    except Exception as e:
        return jsonify({"error": f"Failed to save raw report: {e}"}), 500

    # Analyze incident with Gemini
    try:
        analysis = analyze_incident(raw_report)
    except Exception as e:
        analysis = {
            "incident_type": "other",
            "severity": "medium",
            "urgency_score": 0.5,
            "affected_people_estimate": 0,
            "summary": f"AI analysis failed: {str(e)}"
        }

    processed_incident = {
        **raw_report,
        "analysis": analysis
    }

    # Save processed incident
    try:
        save_processed_incident(processed_incident)
    except Exception as e:
        return jsonify({"error": f"Failed to save processed incident: {e}"}), 500

    return jsonify({
        "message": "Report submitted successfully",
        "analysis": analysis,
        "image_url": image_url
    }), 200
