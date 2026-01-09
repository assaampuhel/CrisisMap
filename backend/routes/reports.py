# backend/routes/reports.py

"""
Routes for citizen report submission.
POST /api/submit-report
Accepts multipart/form-data:
- name (required)
- phone (required)
- email (optional)
- location (required)
- description (required)
- lat, lng (optional)
- image (optional file)
"""

from flask import Blueprint, request, jsonify, current_app
import os
import uuid
from datetime import datetime
from config import UPLOAD_FOLDER, FIREBASE_STORAGE_BUCKET
from services.firestore_service import save_raw_report, save_processed_incident
from services.gemini_service import analyze_incident

from firebase_admin import storage as fb_storage

reports_bp = Blueprint("reports", __name__)

def _log(msg, *args):
    try:
        current_app.logger.info(msg % args if args else msg)
    except Exception:
        print(msg % args if args else msg)

@reports_bp.route("/submit-report", methods=["POST"])
def submit_report():
    try:
        # get fields
        name = (request.form.get("name") or "").strip()
        phone = (request.form.get("phone") or "").strip()
        email = (request.form.get("email") or "").strip()
        location = (request.form.get("location") or "").strip()
        description = (request.form.get("description") or "").strip()
        lat = request.form.get("lat")
        lng = request.form.get("lng")
        image = request.files.get("image")

        # basic validation
        if not name:
            return jsonify({"error":"name is required"}), 400
        if not phone:
            return jsonify({"error":"phone is required"}), 400
        if not location:
            return jsonify({"error":"location is required"}), 400
        if not description:
            return jsonify({"error":"description is required"}), 400

        _log("Submit-report received: name=%s phone=%s location=%s image=%s", name, phone, location, bool(image))

        # prepare image upload variables
        image_filename = None
        image_url = None

        if image:
            # ensure uploads directory exists (local fallback)
            os.makedirs(UPLOAD_FOLDER, exist_ok=True)

            # build unique filename
            ext = image.filename.rsplit(".", 1)[-1] if "." in image.filename else "jpg"
            unique_name = f"{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex}.{ext}"
            image_filename = unique_name

            # save locally for debug
            local_path = os.path.join(UPLOAD_FOLDER, unique_name)
            try:
                image.save(local_path)
                _log("Saved image locally to %s", local_path)
            except Exception as e:
                _log("Failed to save image locally: %s", e)

            # upload to Firebase Storage if configured
            try:
                if FIREBASE_STORAGE_BUCKET:
                    bucket = fb_storage.bucket()
                    blob = bucket.blob(f"incidents/{unique_name}")

                    # reset file pointer then upload
                    try:
                        image.stream.seek(0)
                    except Exception:
                        pass

                    blob.upload_from_file(image.stream, content_type=image.content_type)
                    try:
                        blob.make_public()
                        image_url = blob.public_url
                    except Exception:
                        image_url = None
                    _log("Uploaded image to Firebase: %s", image_url or "<no-public-url>")
                else:
                    _log("FIREBASE_STORAGE_BUCKET not configured; skipping cloud upload")
            except Exception as e:
                _log("Firebase Storage upload failed: %s", e)
                # continue - we keep local_path copy
                image_url = None

        # build raw report
        now = datetime.utcnow()
        raw_report = {
            "reporter_name": name,
            "reporter_phone": phone,
            "reporter_email": email or None,
            "location": location,
            "description": description,
            "lat": float(lat) if lat else None,
            "lng": float(lng) if lng else None,
            "image_filename": image_filename,
            "image_url": image_url,
            "timestamp": now,
            "status": "new"
        }

        # save raw report
        try:
            save_raw_report(raw_report)
            _log("Raw report saved to Firestore")
        except Exception as e:
            _log("Failed to save raw report: %s", e)
            return jsonify({"error": f"Failed to save raw report: {e}"}), 500

        # analyze with Gemini (best-effort)
        try:
            analysis = analyze_incident(raw_report)
        except Exception as e:
            _log("AI analysis failed: %s", e)
            analysis = {
                "incident_type": "other",
                "severity": "medium",
                "urgency_score": 0.5,
                "affected_people_estimate": 0,
                "follow_up_questions": [],
                "summary": f"AI analysis failed: {e}"
            }

        processed = { **raw_report, "analysis": analysis }

        # save processed incident
        try:
            save_processed_incident(processed)
            _log("Processed incident saved to Firestore")
        except Exception as e:
            _log("Failed to save processed incident: %s", e)
            return jsonify({"error": f"Failed to save processed incident: {e}"}), 500

        # return success and analysis summary
        return jsonify({
            "ok": True,
            "analysis": analysis,
            "image_url": image_url
        }), 200

    except Exception as unknown:
        _log("Unhandled error in submit_report: %s", unknown)
        return jsonify({"error": f"Unhandled server error: {unknown}"}), 500
