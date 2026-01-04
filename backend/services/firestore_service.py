# backend/services/firestore_service.py

from firebase_admin import firestore
from datetime import datetime, timedelta
import uuid

# How long before dispatched incidents auto-close (demo): 30 minutes
AUTO_CLOSE_AFTER_SECONDS = 30 * 60  # change as needed

def get_db():
    return firestore.client()

def save_raw_report(data):
    db = get_db()
    return db.collection("raw_reports").add(data)

def save_processed_incident(data):
    db = get_db()
    return db.collection("processed_incidents").add(data)

def _parse_maybe_datetime(val):
    if val is None:
        return None
    if isinstance(val, datetime):
        return val
    try:
        # if ISO string
        return datetime.fromisoformat(str(val))
    except Exception:
        return None

def _close_old_dispatched(doc_ref, doc_data):
    dispatched_at = doc_data.get("dispatched_at")
    dispatched_dt = _parse_maybe_datetime(dispatched_at)
    if dispatched_dt is None:
        return False
    age = datetime.utcnow() - dispatched_dt
    if age.total_seconds() >= AUTO_CLOSE_AFTER_SECONDS:
        doc_ref.update({"status": "closed", "closed_at": datetime.utcnow()})
        return True
    return False

def get_all_incidents():
    db = get_db()
    docs = db.collection("processed_incidents").order_by("timestamp", direction=firestore.Query.DESCENDING).stream()
    items = []
    for d in docs:
        item = d.to_dict() or {}
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
            refreshed = doc_ref.get().to_dict() or {}
            refreshed["_id"] = d.id
            ts = refreshed.get("timestamp")
            if ts:
                try:
                    refreshed["timestamp"] = ts.isoformat()
                except:
                    pass
            items.append(refreshed)
        except Exception:
            items.append(item)
    return items

def get_incidents_by_status(statuses):
    db = get_db()
    if not statuses:
        return get_all_incidents()

    items_map = {}
    # single-status fast path
    if len(statuses) == 1:
        try:
            q = db.collection("processed_incidents").where("status", "==", statuses[0])
            docs = q.order_by("timestamp", direction=firestore.Query.DESCENDING).stream()
        except Exception as e:
            # fallback: stream without ordering and sort in Python
            docs = db.collection("processed_incidents").where("status", "==", statuses[0]).stream()
        for d in docs:
            item = d.to_dict() or {}
            item["_id"] = d.id
            ts = item.get("timestamp")
            if ts:
                try: item["timestamp"] = ts.isoformat()
                except: pass
            items_map[item["_id"]] = item
    else:
        # multiple statuses: query each status separately (no 'in' operator)
        for s in statuses:
            try:
                try:
                    q = db.collection("processed_incidents").where("status", "==", s)
                    docs = q.order_by("timestamp", direction=firestore.Query.DESCENDING).stream()
                except Exception:
                    docs = db.collection("processed_incidents").where("status", "==", s).stream()
                for d in docs:
                    item = d.to_dict() or {}
                    item["_id"] = d.id
                    ts = item.get("timestamp")
                    if ts:
                        try: item["timestamp"] = ts.isoformat()
                        except: pass
                    # dedupe by id (keep latest fetched)
                    items_map[item["_id"]] = item
            except Exception:
                # if query fails for a status, skip gracefully
                pass

    # convert map -> list and sort by timestamp desc (unknown timestamps last)
    items = list(items_map.values())
    def sort_key(x):
        t = x.get("timestamp") or ""
        return t
    items.sort(key=sort_key, reverse=True)
    return items


def update_incident_status(doc_id, new_status):
    """
    Update status; if new_status == rescue_dispatched, set dispatched_at timestamp.
    """
    db = get_db()
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
    db = get_db()
    docs = db.collection("processed_incidents").stream()
    items = []
    qlow = (query_text or "").lower()
    for d in docs:
        item = d.to_dict() or {}
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

# ---------------------------
# Teams and dispatch helpers
# ---------------------------

def create_team(name, contact, password):
    db = get_db()
    team_id = f"team_{uuid.uuid4().hex[:8]}"
    doc = {
        "name": name,
        "contact": contact,
        "password": password,  # dev only
        "created_at": datetime.utcnow().isoformat(),
        # default status = ready
        "status": "ready"
    }
    db.collection("teams").document(team_id).set(doc)
    return team_id

def get_all_teams():
    db = get_db()
    teams = []
    for doc in db.collection("teams").stream():
        d = doc.to_dict() or {}
        d["_id"] = doc.id
        d.pop("password", None)
        teams.append(d)
    return teams

def get_team_by_name(name):
    db = get_db()
    q = db.collection("teams").where("name", "==", name).limit(1).stream()
    for doc in q:
        d = doc.to_dict() or {}
        d["_id"] = doc.id
        return d
    return None

def get_team_by_id(team_id):
    if not team_id:
        return None
    db = get_db()
    doc = db.collection("teams").document(team_id).get()
    if not doc.exists:
        return None
    d = doc.to_dict() or {}
    d["_id"] = doc.id
    d.pop("password", None)
    return d

def set_team_status(team_id, status):
    """
    Mark team status (example values: 'busy', 'ready').
    """
    if not team_id:
        return False
    db = get_db()
    ref = db.collection("teams").document(team_id)
    try:
        ref.update({"status": status, "status_updated_at": datetime.utcnow().isoformat()})
        return True
    except Exception:
        # fallback: if team doc doesn't exist we can set it
        try:
            ref.set({"status": status, "status_updated_at": datetime.utcnow().isoformat()}, merge=True)
            return True
        except Exception:
            return False

def create_dispatch(dispatch):
    db = get_db()
    dispatch_id = dispatch["dispatch_id"]
    db.collection("dispatches").document(dispatch_id).set(dispatch)
    return dispatch_id

def get_dispatches_by_team(team_id):
    db = get_db()
    res = []
    q = db.collection("dispatches").where("team_id", "==", team_id).stream()
    for doc in q:
        d = doc.to_dict() or {}
        d["_id"] = doc.id
        res.append(d)
    return res

def update_incident_assignment(doc_id, dispatch_id=None, team_id=None, new_status=None):
    """
    Update incident assignment fields.

    - If team_id is a non-empty string -> set assigned_team to that string.
    - If team_id is exactly False (boolean False) -> remove the assigned_team field.
      (Use this to intentionally unassign.)
    - If team_id is None -> leave assigned_team unchanged.
    """
    db = get_db()
    ref = db.collection("processed_incidents").document(doc_id)
    update = {}
    if dispatch_id is not None:
        update["dispatch_id"] = dispatch_id

    # Only set assigned_team if team_id is a non-empty string (truthy)
    # If you want to explicitly remove assigned_team, pass team_id=False
    from firebase_admin import firestore as _firestore

    if team_id is False:
        # Explicit remove/unassign
        update["assigned_team"] = _firestore.DELETE_FIELD
    elif team_id is not None:
        # If team_id provided but empty string, treat as "do not set"
        if isinstance(team_id, str) and team_id.strip() != "":
            update["assigned_team"] = str(team_id).strip()
        else:
            # team_id provided but empty or non-string: do not change assigned_team
            pass

    if new_status is not None:
        update["status"] = new_status
        update["status_updated_at"] = datetime.utcnow()
        if new_status == "rescue_dispatched":
            update["dispatched_at"] = datetime.utcnow()

    if update:
        ref.update(update)
    return True

