# backend/app.py

import os
from flask import Flask, send_from_directory
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials
from config import UPLOAD_FOLDER, FIREBASE_STORAGE_BUCKET
from routes.reports import reports_bp
from routes.admin import admin_bp
from routes.team import team_bp
from routes.translate import translate_bp
from routes.speech_stt import speech_bp

# Initialize Firebase Admin (service account file must be in backend/)
if not os.path.exists("./firebase_admin_key.json"):
    raise FileNotFoundError("Place firebase_admin_key.json in backend/ before running.")

# Initialize app with storage bucket if provided
cred = credentials.Certificate("firebase_admin_key.json")
if FIREBASE_STORAGE_BUCKET:
    firebase_admin.initialize_app(cred, {"storageBucket": FIREBASE_STORAGE_BUCKET})
else:
    # initialize without storage bucket (will error if you try to use storage)
    firebase_admin.initialize_app(cred)

app = Flask(__name__, static_folder="../frontend", static_url_path="/static")
CORS(app)

# Ensure upload folder exists (kept for fallback/local debugging)
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Register modular routes (blueprints)
app.register_blueprint(speech_bp, url_prefix="/api/speech")
app.register_blueprint(translate_bp, url_prefix="/api")
app.register_blueprint(team_bp, url_prefix="/api")
app.register_blueprint(reports_bp, url_prefix="/api")
app.register_blueprint(admin_bp, url_prefix="/api")

# Serve uploaded images at /uploads/<filename> (local fallback)
@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == "__main__":
    app.run(debug=True, port=5000)
