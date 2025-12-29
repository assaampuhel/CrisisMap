"""
Central configuration. Loads environment variables from ../.env.
"""
import os
from dotenv import load_dotenv
from pathlib import Path

# Load .env from project root
root = Path(__file__).resolve().parents[1]
load_dotenv(root / ".env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")

# Firebase Storage bucket name (e.g. "your-project-id.appspot.com")
FIREBASE_STORAGE_BUCKET = os.getenv("FIREBASE_STORAGE_BUCKET")

# Where uploaded images are saved locally (kept for fallback / debugging)
UPLOAD_FOLDER = "uploads"