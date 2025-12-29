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

# Where uploaded images are saved (relative to backend/)
UPLOAD_FOLDER = "uploads"
