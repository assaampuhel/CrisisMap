# backend/services/storage_service.py

import uuid
from firebase_admin import storage

def upload_image_to_firebase(file):
    """
    Uploads an image to Firebase Storage and returns:
    - unique filename
    - public download URL
    """

    bucket = storage.bucket()

    unique_name = f"{uuid.uuid4()}.{file.filename.split('.')[-1]}"
    blob = bucket.blob(f"incidents/{unique_name}")

    blob.upload_from_file(
        file,
        content_type=file.content_type
    )

    # Make public for dashboard access
    blob.make_public()

    return unique_name, blob.public_url
