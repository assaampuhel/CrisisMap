# backend/routes/translate.py

from flask import Blueprint, request, jsonify
import os
import math

# Use the official google cloud library for Translate v3
from google.cloud import translate_v3 as translate

translate_bp = Blueprint("translate", __name__)

PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GCLOUD_PROJECT") or os.environ.get("GOOGLE_CLOUD_PROJECT_ID")
# You may set LOCATION to "global" or a regional endpoint like "us-central1"
LOCATION = os.environ.get("GOOGLE_TRANSLATE_LOCATION", "global")

def make_client():
    # Requires GOOGLE_APPLICATION_CREDENTIALS env var pointing to service account JSON
    return translate.TranslationServiceClient()

@translate_bp.route("/translate/batch", methods=["POST"])
def translate_batch():
    """
    POST JSON:
      { "target": "hi", "texts": ["one", "two", ...] }
    Response:
      { "translations": ["ek","do",...], "warnings": [] }
    """
    try:
        data = request.get_json(force=True)
        if not data:
            return jsonify({"error":"JSON body required"}), 400
        target = data.get("target")
        texts = data.get("texts")
        if not target or not texts or not isinstance(texts, list):
            return jsonify({"error":"target and texts[] required"}), 400

        if not PROJECT_ID:
            return jsonify({"error":"Server not configured with project ID (set GOOGLE_CLOUD_PROJECT)"}), 500

        client = make_client()
        parent = f"projects/{PROJECT_ID}/locations/{LOCATION}"

        MAX_CHARS = 20000
        chunks = []
        current = []
        cur_len = 0
        for t in texts:
            tstr = "" if t is None else str(t)
            if cur_len + len(tstr) > MAX_CHARS and current:
                chunks.append(list(current))
                current = []
                cur_len = 0
            current.append(tstr)
            cur_len += len(tstr)
        if current:
            chunks.append(list(current))

        all_translations = []
        warnings = []
        for chunk in chunks:
            request_obj = {
                "parent": parent,
                "contents": chunk,
                "mime_type": "text/plain",
                "target_language_code": target
            }
            resp = client.translate_text(request=request_obj)
            for tr in resp.translations:
                all_translations.append(tr.translated_text)
        return jsonify({"translations": all_translations, "warnings": warnings}), 200

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
