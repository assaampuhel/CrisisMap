# backend/auth_store.py
# Central, shared in-memory token stores (dev-only)
# Keep minimal and import from routes to share tokens across blueprints.
ACTIVE_ADMIN_TOKENS = {}
ACTIVE_TEAM_TOKENS = {}
