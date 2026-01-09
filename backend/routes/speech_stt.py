# backend/routes/speech_stt.py

from flask import Blueprint, request, jsonify
from google.cloud import speech

speech_bp = Blueprint("speech_stt", __name__)
client = speech.SpeechClient()

@speech_bp.route("/stt", methods=["POST"])
def speech_to_text():
    """
    POST /api/speech/stt
    Form fields:
      - audio (file) : audio bytes (LINEAR16 / WAV recommended)
      - lang (optional): language code e.g. en-US, hi-IN. Defaults to en-US.
    Returns: { text: "recognized text" }
    """
    if "audio" not in request.files:
        return jsonify({"error": "audio file required (form field 'audio')"}), 400

    audio_file = request.files["audio"]
    audio_bytes = audio_file.read()

    # safe default: user can pass language via 'lang' form field
    lang = request.form.get("lang") or request.form.get("language") or "en-US"

    # Configure recognition; you can extend to use more advanced features later.
    config = speech.RecognitionConfig(
        encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
        sample_rate_hertz=16000,
        language_code=lang,
        enable_automatic_punctuation=True,
        # provide alternative languages if needed
        alternative_language_codes=[]
    )

    audio = speech.RecognitionAudio(content=audio_bytes)

    try:
        response = client.recognize(config=config, audio=audio)
    except Exception as e:
        return jsonify({"error": f"Speech recognition failed: {e}"}), 500

    text = ""
    for result in response.results:
        text += result.alternatives[0].transcript + " "

    return jsonify({"text": text.strip()})
