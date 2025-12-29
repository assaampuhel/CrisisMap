"""
Main Flask app. Register blueprints and provide a route to serve uploaded images.
Run this file from the backend directory:
    cd backend
    python app.py
"""

import os
from flask import Flask, send_from_directory
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials
from config import UPLOAD_FOLDER

# Initialize Firebase Admin (service account file must be in backend/)
if not os.path.exists("firebase_admin_key.json"):
    raise FileNotFoundError("Place firebase_admin_key.json in backend/ before running.")

cred = credentials.Certificate("firebase_admin_key.json")
firebase_admin.initialize_app(cred)

app = Flask(__name__, static_folder="../frontend", static_url_path="/static")
CORS(app)

# Ensure upload folder exists
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Register modular routes (blueprints)
from routes.reports import reports_bp
from routes.admin import admin_bp

app.register_blueprint(reports_bp, url_prefix="/api")
app.register_blueprint(admin_bp, url_prefix="/api")

# Serve uploaded images at /uploads/<filename>
@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == "__main__":
    app.run(debug=True, port=5000)
