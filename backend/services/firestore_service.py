"""
Firestore helper functions.
We call firestore.client() inside functions to avoid initialization-order issues.
"""

from firebase_admin import firestore
from datetime import datetime

def save_raw_report(data):
    """
    Save a raw report to `raw_reports` collection.
    """
    db = firestore.client()
    doc_ref = db.collection("raw_reports").add(data)
    return doc_ref

def save_processed_incident(data):
    """
    Save processed incident to `processed_incidents` collection.
    """
    db = firestore.client()
    doc_ref = db.collection("processed_incidents").add(data)
    return doc_ref

def get_all_incidents():
    """
    Return all processed incidents as list of dicts.
    """
    db = firestore.client()
    docs = db.collection("processed_incidents").order_by("timestamp", direction=firestore.Query.DESCENDING).stream()
    items = []
    for d in docs:
        item = d.to_dict()
        # include document id for admin-ui usage
        item["_id"] = d.id
        ts = item.get("timestamp")
        if ts:
            try:
                item["timestamp"] = ts.isoformat()
            except:
                pass
        items.append(item)
    return items
