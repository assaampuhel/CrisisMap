"""
Firestore helper functions.
We call firestore.client() inside functions to avoid initialization-order issues.
"""

from firebase_admin import firestore
from datetime import datetime, timedelta

db = firestore.client()

# How long before dispatched incidents auto-close (demo): 30 minutes
AUTO_CLOSE_AFTER_SECONDS = 30 * 60  # change as needed

def save_raw_report(data):
    return db.collection("raw_reports").add(data)

def save_processed_incident(data):
    return db.collection("processed_incidents").add(data)

def _close_old_dispatched(doc_ref, doc_data):
    """
    If a document is 'rescue_dispatched' and older than threshold, set to 'closed'.
    This mutates Firestore (safe to call during reads).
    """
    dispatched_at = doc_data.get("dispatched_at")
    if dispatched_at is None:
        return False
    try:
        # Firestore timestamp is usually datetime
        age = datetime.utcnow() - dispatched_at
    except Exception:
        # if dispatched_at isn't datetime, skip
        return False
    if age.total_seconds() >= AUTO_CLOSE_AFTER_SECONDS:
        doc_ref.update({"status": "closed", "closed_at": datetime.utcnow()})
        return True
    return False

def get_all_incidents():
    """
    Returns list of processed_incidents, but also auto-closes old dispatched incidents.
    """
    docs = db.collection("processed_incidents").order_by("timestamp", direction=firestore.Query.DESCENDING).stream()
    items = []
    for d in docs:
        item = d.to_dict()
        item["_id"] = d.id

        # convert Firestore timestamp to iso string if present
        ts = item.get("timestamp")
        if ts:
            try:
                item["timestamp"] = ts.isoformat()
            except Exception:
                pass

        # attempt to auto-close if dispatched long ago
        try:
            doc_ref = db.collection("processed_incidents").document(d.id)
            _close_old_dispatched(doc_ref, item)
            # refresh status after potential update
            item = doc_ref.get().to_dict()
            item["_id"] = d.id
            ts = item.get("timestamp")
            if ts:
                try:
                    item["timestamp"] = ts.isoformat()
                except:
                    pass
        except Exception:
            pass

        items.append(item)
    return items

def get_incidents_by_status(statuses):
    """
    statuses: list of status strings
    """
    if not statuses:
        return get_all_incidents()

    # use queries where possible (if single status) otherwise fallback
    if len(statuses) == 1:
        q = db.collection("processed_incidents").where("status", "==", statuses[0])
        docs = q.order_by("timestamp", direction=firestore.Query.DESCENDING).stream()
    else:
        # Firestore 'in' queries support up to 10 items
        q = db.collection("processed_incidents").where("status", "in", statuses)
        docs = q.order_by("timestamp", direction=firestore.Query.DESCENDING).stream()

    items = []
    for d in docs:
        item = d.to_dict()
        item["_id"] = d.id
        ts = item.get("timestamp")
        if ts:
            try: item["timestamp"] = ts.isoformat()
            except: pass
        items.append(item)
    return items

def update_incident_status(doc_id, new_status):
    """
    Update status; if new_status == rescue_dispatched, set dispatched_at timestamp.
    """
    ref = db.collection("processed_incidents").document(doc_id)
    update = {"status": new_status, "status_updated_at": datetime.utcnow()}
    if new_status == "rescue_dispatched":
        update["dispatched_at"] = datetime.utcnow()
    ref.update(update)
    return True

def search_incidents_by_text(query_text):
    """
    Simple substring search on location + description/summary. Not scalable but fine for MVP.
    """
    docs = db.collection("processed_incidents").stream()
    items = []
    qlow = (query_text or "").lower()
    for d in docs:
        item = d.to_dict()
        loc = str(item.get("location","")).lower()
        desc = str(item.get("description","") or item.get("analysis", {}).get("summary","")).lower()
        if qlow in loc or qlow in desc:
            item["_id"] = d.id
            ts = item.get("timestamp")
            if ts:
                try: item["timestamp"] = ts.isoformat()
                except: pass
            items.append(item)
    # latest first
    items.sort(key=lambda x: x.get("timestamp",""), reverse=True)
    return items
