// frontend/team/dashboard.js
// Team dashboard — show full user report + follow-up questions in dispatch modal
const API_BASE = "http://127.0.0.1:5000";

const token = localStorage.getItem("team_token");
const teamName = localStorage.getItem("team_name") || "";
const teamIdStored = localStorage.getItem("team_id") || "";
if (!token) {
  window.location.href = "login.html";
}

// Elements
const teamLabelEl = document.getElementById("teamLabel");
const logoutBtn = document.getElementById("logoutBtn");
const updateLocationBtn = document.getElementById("updateLocationBtn");
const listEl = document.getElementById("dispatchList");
const archiveListEl = document.getElementById("archiveList"); // may be null if no UI
const modal = document.getElementById("dispatchModal");
const dispatchClose = document.getElementById("dispatchClose");
const dispTitle = document.getElementById("dispTitle");
const dispMeta = document.getElementById("dispMeta");
const dispPlan = document.getElementById("dispPlan");
const dispIncidents = document.getElementById("dispIncidents");
const modalActions = document.getElementById("modalActions");
const sectionTitle = document.getElementById("sectionTitle");

const assignedTabBtn = document.getElementById("assignedTabBtn");
const archiveTabBtn = document.getElementById("archiveTabBtn");

// Show team name
if (teamLabelEl) teamLabelEl.textContent = teamName;

// Logout
logoutBtn?.addEventListener("click", () => {
  localStorage.removeItem("team_token");
  localStorage.removeItem("team_id");
  localStorage.removeItem("team_name");
  window.location.href = "login.html";
});

// Utilities
function escapeHtml(s){
  if (s === 0) return "0";
  if (!s && s !== 0) return "";
  try { s = String(s); } catch(e) { return ""; }
  return s.replace(/[&<>"'`=\/]/g, function (c) {
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;','=':'&#61;','/':'&#47;'})[c];
  });
}
function tryParseJSON(s) {
  if (!s || typeof s !== "string") return s;
  try { return JSON.parse(s); } catch (e) { return s; }
}

// Archive storage (per-team)
const ARCHIVE_KEY = `team_archive_${teamIdStored || "anon"}`;
function loadArchive() {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch (e) {
    console.warn("Failed to load archive", e);
    return [];
  }
}
function saveArchive(arr) {
  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(arr || []));
  } catch (e) {
    console.warn("Failed to save archive", e);
  }
}
function addDispatchToArchive(dispatchDoc) {
  if (!dispatchDoc || !dispatchDoc.dispatch_id) return;
  const arr = loadArchive();
  const exists = arr.find(d => d.dispatch_id === dispatchDoc.dispatch_id);
  if (!exists) {
    const toSave = Object.assign({}, dispatchDoc);
    toSave.archived_at = new Date().toISOString();
    arr.unshift(toSave);
    saveArchive(arr);
  }
  if (archiveTabBtn?.getAttribute("data-active") === "true") renderArchive();
}

// Incident cache (to enrich dispatch entries with full report)
let INCIDENTS_CACHE = { map: {}, ts: 0 };
async function fetchIncidentMap(force = false) {
  // refresh every 30s unless forced
  const now = Date.now();
  if (!force && INCIDENTS_CACHE.ts && (now - INCIDENTS_CACHE.ts) < 30000 && INCIDENTS_CACHE.map && Object.keys(INCIDENTS_CACHE.map).length) {
    return INCIDENTS_CACHE.map;
  }
  try {
    const res = await fetch(`${API_BASE}/api/incidents`);
    if (!res.ok) {
      console.warn("fetchIncidentMap: failed to fetch incidents");
      return INCIDENTS_CACHE.map || {};
    }
    const data = await res.json();
    const map = {};
    if (Array.isArray(data)) {
      data.forEach(i => {
        if (i && i._id) map[i._id] = i;
      });
    }
    INCIDENTS_CACHE = { map, ts: Date.now() };
    return map;
  } catch (e) {
    console.warn("fetchIncidentMap error", e);
    return INCIDENTS_CACHE.map || {};
  }
}

// Human readable plan text
function planToHumanText(planObjOrString, dispatchId, teamId) {
  let out = "";
  out += `Dispatch ID: ${dispatchId || "(n/a)"}\nAssigned team: ${teamId || "Unassigned"}\n\n`;
  if (!planObjOrString) return out + "No plan content\n";
  if (typeof planObjOrString === "string") {
    out += planObjOrString + "\n";
    return out;
  }
  const plan = planObjOrString;
  if (plan.summary) out += `Summary:\n${plan.summary}\n\n`;
  if (Array.isArray(plan.route) && plan.route.length) {
    out += "Route (priority order):\n";
    plan.route.forEach((r, i) => {
      out += `${i+1}. ${r.location || r.name || "Unknown"}\n   - Reason: ${r.reason || r.note || ""}\n   - Coordinates: ${r.lat || ""}, ${r.lng || ""}\n`;
    });
    out += "\n";
  }
  if (Array.isArray(plan.resources) && plan.resources.length) {
    out += "Resources:\n";
    plan.resources.forEach((r) => out += ` - ${r}\n`);
    out += "\n";
  }
  return out;
}

// Tabs toggling (if present)
function showAssignedTab() {
  if (!assignedTabBtn || !archiveTabBtn) {
    if (sectionTitle) sectionTitle.textContent = "Assigned Missions";
    if (listEl) listEl.style.display = "";
    if (archiveListEl) archiveListEl.style.display = "none";
    return;
  }
  assignedTabBtn.setAttribute("data-active", "true");
  archiveTabBtn.setAttribute("data-active", "false");
  assignedTabBtn.classList.add("btn-primary");
  assignedTabBtn.classList.remove("btn-ghost");
  archiveTabBtn.classList.add("btn-ghost");
  archiveTabBtn.classList.remove("btn-primary");
  if (sectionTitle) sectionTitle.textContent = "Assigned Missions";
  if (listEl) listEl.style.display = "";
  if (archiveListEl) archiveListEl.style.display = "none";
}
function showArchiveTab() {
  if (!assignedTabBtn || !archiveTabBtn) {
    if (sectionTitle) sectionTitle.textContent = "Completed (Archive)";
    if (listEl) listEl.style.display = "none";
    if (archiveListEl) archiveListEl.style.display = "";
    renderArchive();
    return;
  }
  assignedTabBtn.setAttribute("data-active", "false");
  archiveTabBtn.setAttribute("data-active", "true");
  archiveTabBtn.classList.add("btn-primary");
  archiveTabBtn.classList.remove("btn-ghost");
  assignedTabBtn.classList.add("btn-ghost");
  assignedTabBtn.classList.remove("btn-primary");
  if (sectionTitle) sectionTitle.textContent = "Completed (Archive)";
  if (listEl) listEl.style.display = "none";
  if (archiveListEl) archiveListEl.style.display = "";
  renderArchive();
}
assignedTabBtn?.addEventListener("click", showAssignedTab);
archiveTabBtn?.addEventListener("click", showArchiveTab);
assignedTabBtn?.setAttribute("data-active", "true");
archiveTabBtn?.setAttribute("data-active", "false");

// Load dispatches from backend (assigned). Skip archived dispatches.
async function loadDispatches() {
  if (!listEl) return;
  listEl.innerHTML = "<p class='muted'>Loading…</p>";
  try {
    const res = await fetch(`${API_BASE}/api/team/dispatches`, {
      headers: { "x-team-token": token }
    });
    if (res.status === 401) {
      localStorage.removeItem("team_token");
      localStorage.removeItem("team_id");
      localStorage.removeItem("team_name");
      window.location.href = "login.html";
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      console.error("Failed to load dispatches:", data);
      listEl.innerHTML = "<p class='muted'>Failed to load dispatches.</p>";
      return;
    }
    const archived = loadArchive().map(d => d.dispatch_id);
    const dispatches = Array.isArray(data) ? data.filter(dd => !archived.includes(dd.dispatch_id)) : [];
    renderList(dispatches);
  } catch (err) {
    console.error("Network error loading dispatches:", err);
    listEl.innerHTML = "<p class='muted'>Failed to load dispatches.</p>";
  }
}

// Render assigned dispatch cards
function renderList(list) {
  listEl.innerHTML = "";
  if (!list || list.length === 0) {
    listEl.innerHTML = "<p class='muted'>No dispatches assigned.</p>";
    return;
  }
  list.forEach(d => {
    const incidentsArr = Array.isArray(d.incidents) ? d.incidents : [];
    const allClosed = incidentsArr.length > 0 && incidentsArr.every(it => (String((it.status || "")).toLowerCase() === "closed"));
    if (allClosed) {
      addDispatchToArchive(d);
      return;
    }

    const card = document.createElement("div");
    card.className = "card";

    const created = d.created_at ? String(d.created_at).replace("T", " ") : "";
    let previewText = "";
    try {
      const parsed = tryParseJSON(d.plan_text);
      const full = planToHumanText(parsed, d.dispatch_id, d.team_id);
      previewText = (full || "").slice(0, 160);
    } catch (e) {
      previewText = String(d.plan_text || "").slice(0, 160);
    }

    card.innerHTML = `
      <h3>${escapeHtml(d.dispatch_id || "dispatch")}</h3>
      <p class="muted small">${escapeHtml(previewText)}</p>
      <div class="meta-row" style="margin-top:8px">
        <span class="muted">Created: ${escapeHtml(created)}</span>
        <span style="margin-left:12px" class="badge status-${escapeHtml(d.status || "")}">${escapeHtml(d.status || "")}</span>
      </div>
      <div style="margin-top:8px">
        <button class="btn view-btn">View</button>
      </div>
    `;
    const viewBtn = card.querySelector(".view-btn");
    viewBtn?.addEventListener("click", () => openDispatch(d));
    listEl.appendChild(card);
  });
}

// Open dispatch modal — enrich incidents with full report from backend and show tick for completed subtasks
async function openDispatch(d) {
  if (!modal) return;
  modal.classList.remove("hidden");

  dispTitle.textContent = `Dispatch ${d.dispatch_id || "(n/a)"}`;
  dispMeta.textContent = `Team: ${d.team_id || "Unassigned"} • Status: ${d.status || ""} • Created: ${d.created_at || ""}`;

  // parse plan object if available
  let parsedPlan = tryParseJSON(d.plan_text);
  if (typeof parsedPlan === "string" && parsedPlan.trim().startsWith("{")) {
    try { parsedPlan = JSON.parse(parsedPlan); } catch (_) {}
  }

  let humanPlanText = planToHumanText(parsedPlan, d.dispatch_id, d.team_id);
  if (dispPlan) dispPlan.textContent = humanPlanText;

  // Fetch full incident map (latest reports)
  const incidentMap = await fetchIncidentMap();

  // Build ordered incidents based on plan.route if available (preserve generated order)
  let orderedIncidentEntries = [];
  const incidentsArr = Array.isArray(d.incidents) ? d.incidents.slice() : [];

  if (parsedPlan && typeof parsedPlan === "object" && Array.isArray(parsedPlan.route) && parsedPlan.route.length) {
    const byId = {};
    incidentsArr.forEach(it => { if (it && it._id) byId[it._id] = it; });
    for (const r of parsedPlan.route) {
      // prefer matching by _id
      if (r._id && byId[r._id]) {
        const raw = byId[r._id];
        // enrich from backend full incident if available
        const full = incidentMap[raw._id] || raw;
        orderedIncidentEntries.push(full);
      } else {
        // match by location string (case-insensitive)
        const loc = (r.location || "").toString().toLowerCase().trim();
        let found = null;
        for (const it of incidentsArr) {
          if (!it) continue;
          if ((String(it.location || "")).toLowerCase().trim() === loc) { found = it; break; }
        }
        if (!found) {
          // try matching against backend incidents for better match
          for (const k in incidentMap) {
            const b = incidentMap[k];
            if (!b || !b.location) continue;
            if ((String(b.location || "")).toLowerCase().includes(loc) || loc.includes((b.location || "").toLowerCase())) { found = b; break; }
          }
        }
        if (found && found._id && incidentMap[found._id]) found = incidentMap[found._id];
        orderedIncidentEntries.push(found || {
          _id: r._id || "",
          location: r.location || r.name || "(unknown)",
          lat: r.lat,
          lng: r.lng,
          severity: r.severity || ""
        });
      }
    }
    // append any incidents that weren't in route for completeness (enrich from backend)
    incidentsArr.forEach(it => {
      const present = orderedIncidentEntries.some(x => x && it && x._id && it._id && x._id === it._id);
      if (!present) {
        const enriched = (it && it._id && incidentMap[it._id]) ? incidentMap[it._id] : it;
        orderedIncidentEntries.push(enriched);
      }
    });
  } else {
    // fallback: use dispatch.incidents but enrich each from backend if possible
    orderedIncidentEntries = incidentsArr.map(it => (it && it._id && incidentMap[it._id]) ? incidentMap[it._id] : it);
  }

  // Render ordered incidents with visual tick for completed subtasks and full user report
  if (dispIncidents) {
    dispIncidents.innerHTML = "";
    orderedIncidentEntries.forEach(it => {
      const div = document.createElement("div");
      div.className = "card";
      div.style.marginBottom = "8px";

      const id = it && (it._id || it.id) ? (it._id || it.id) : "";
      const location = it && (it.location || it.name || it.address) ? (it.location || it.name || it.address) : "(unknown)";
      const severity = it && (it.severity || (it.analysis && it.analysis.severity)) ? (it.severity || (it.analysis && it.analysis.severity)) : "n/a";
      const lat = it && (it.lat || (it.geometry && it.geometry.lat)) ? (it.lat || (it.geometry && it.geometry.lat)) : "";
      const lng = it && (it.lng || (it.geometry && it.geometry.lng)) ? (it.lng || (it.geometry && it.geometry.lng)) : "";
      const status = it && (it.status || "").toString().toLowerCase();

      const mapLink = (lat && lng) ? `<a href="https://www.google.com/maps?q=${lat},${lng}&z=16" target="_blank" class="btn btn-ghost" style="margin-left:8px">Open map</a>` : "";

      // visual tick for completed (small check mark) — inline so no CSS change needed
      const completedTick = (status === "closed") ? `<span title="Completed" style="display:inline-block;margin-left:8px;font-weight:700;color:#0f5132">✓</span>` : "";

      // Reporter info and full user description / AI follow-up questions
      const reporterName = it && (it.reporter_name || it.name) ? (it.reporter_name || it.name) : "";
      const reporterPhone = it && (it.reporter_phone || it.phone) ? (it.reporter_phone || it.phone) : "";
      const description = it && (it.description || (it.analysis && it.analysis.summary)) ? (it.description || (it.analysis && it.analysis.summary)) : "";
      const followUp = (it && it.analysis && Array.isArray(it.analysis.follow_up_questions) && it.analysis.follow_up_questions.length)
                       ? it.analysis.follow_up_questions
                       : (it && Array.isArray(it.follow_up_questions) ? it.follow_up_questions : []);

      // Build follow-up HTML list
      let followUpHtml = "";
      if (Array.isArray(followUp) && followUp.length) {
        followUpHtml = "<div style='margin-top:8px'><strong>Follow-up questions</strong><ul style='margin-top:6px;padding-left:18px'>";
        followUp.forEach(q => {
          followUpHtml += `<li class="muted small">${escapeHtml(q)}</li>`;
        });
        followUpHtml += "</ul></div>";
      }

      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <strong>${escapeHtml(location)} ${completedTick}</strong>
            <div class="muted small">Severity: ${escapeHtml(severity)}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            ${mapLink}
            <button class="btn btn-primary update-btn" data-incident="${escapeHtml(id)}">Mark in_progress</button>
            <button class="btn btn-ghost complete-btn" data-incident="${escapeHtml(id)}">Mark completed</button>
          </div>
        </div>

        <div style="margin-top:10px">
          ${ reporterName || reporterPhone ? `<div class="muted small"><strong>Reporter:</strong> ${escapeHtml(reporterName)} ${reporterPhone ? `• <a href="tel:${encodeURIComponent(reporterPhone)}">${escapeHtml(reporterPhone)}</a>` : ""}</div>` : "" }
          ${ description ? `<div style="margin-top:8px"><strong>Report details</strong><div class="muted small" style="margin-top:6px">${escapeHtml(description)}</div></div>` : "" }
          ${ followUpHtml }
        </div>
      `;

      const upd = div.querySelector(".update-btn");
      const cmp = div.querySelector(".complete-btn");
      if (upd) upd.addEventListener("click", () => teamUpdateIncident(d.dispatch_id, id, "in_progress", it));
      if (cmp) cmp.addEventListener("click", () => teamUpdateIncident(d.dispatch_id, id, "closed", it));

      if (status === "closed") {
        if (upd) upd.disabled = true;
        if (cmp) cmp.disabled = true;
      }

      dispIncidents.appendChild(div);
    });
  }

  // Modal actions
  if (modalActions) {
    modalActions.innerHTML = "";
    const closeBtn = document.createElement("button");
    closeBtn.className = "btn btn-ghost";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => modal.classList.add("hidden"));
    modalActions.appendChild(closeBtn);

    const dl = document.createElement("button");
    dl.className = "btn btn-ghost";
    dl.textContent = "Download plan (text)";
    dl.addEventListener("click", () => {
      const content = typeof parsedPlan === "string" ? parsedPlan : parsedPlan || d.plan_text || d;
      const text = planToHumanText(content, d.dispatch_id, d.team_id);
      const blob = new Blob([text], {type: "text/plain;charset=utf-8"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${d.dispatch_id || "dispatch"}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
    modalActions.appendChild(dl);
  }
}

// Team updates an incident's status
async function teamUpdateIncident(dispatch_id, incident_id, new_status, incidentObj) {
  try {
    const res = await fetch(`${API_BASE}/api/team/update-incident-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-team-token": token },
      body: JSON.stringify({ dispatch_id, incident_id, new_status })
    });
    if (res.status === 401) {
      alert("Unauthorized — please log in again");
      localStorage.removeItem("team_token");
      localStorage.removeItem("team_id");
      localStorage.removeItem("team_name");
      window.location.href = "login.html";
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Update failed");
      return;
    }

    // After updating, check whether entire dispatch should be archived
    await checkAndArchiveDispatch(dispatch_id);

    // Refresh and close modal
    await loadDispatches();
    modal.classList.add("hidden");
  } catch (err) {
    console.error(err);
    alert("Network error");
  }
}

// Check backend incidents for dispatch and archive whole dispatch if all closed
async function checkAndArchiveDispatch(dispatch_id) {
  try {
    // fetch all incidents to see statuses
    const res = await fetch(`${API_BASE}/api/incidents`);
    if (!res.ok) return;
    const all = await res.json();
    const dispatchIncidents = (Array.isArray(all) ? all : []).filter(i => i && (i.dispatch_id === dispatch_id || i.dispatch === dispatch_id || i._id === (i._id)));
    if (!dispatchIncidents || dispatchIncidents.length === 0) {
      // fallback: check dispatch doc directly
      const docRes = await fetch(`${API_BASE}/api/team/dispatches/${dispatch_id}`, {
        headers: { "x-team-token": token }
      });
      if (!docRes.ok) return;
      const doc = await docRes.json();
      const docInc = Array.isArray(doc.incidents) ? doc.incidents : [];
      const allClosedDoc = docInc.length > 0 && docInc.every(it => String((it.status || "")).toLowerCase() === "closed");
      if (allClosedDoc) addDispatchToArchive(doc);
      return;
    }

    const allClosed = dispatchIncidents.every(it => String((it.status || "")).toLowerCase() === "closed");
    if (allClosed) {
      const docRes = await fetch(`${API_BASE}/api/team/dispatches/${dispatch_id}`, {
        headers: { "x-team-token": token }
      });
      if (!docRes.ok) {
        addDispatchToArchive({
          dispatch_id: dispatch_id,
          created_at: new Date().toISOString(),
          team_id: teamIdStored || "",
          plan_text: "(archived - dispatch doc not available)",
          incidents: dispatchIncidents
        });
        return;
      }
      const dispatchDoc = await docRes.json();
      addDispatchToArchive(dispatchDoc);
    }
  } catch (e) {
    console.warn("checkAndArchiveDispatch failed", e);
  }
}

// Render archive tab content
function renderArchive() {
  if (!archiveListEl) return;
  archiveListEl.innerHTML = "";
  const arr = loadArchive();
  if (!arr.length) {
    archiveListEl.innerHTML = "<p class='muted'>No archived dispatches.</p>";
    return;
  }
  arr.forEach(d => {
    const card = document.createElement("div");
    card.className = "card";
    const created = d.created_at || d.archived_at || "";
    const incidentsCount = Array.isArray(d.incidents) ? d.incidents.length : "";
    card.innerHTML = `
      <h3>${escapeHtml(d.dispatch_id || "(archived)")}</h3>
      <div class="meta-row" style="margin-top:8px">
        <span class="muted small">Team: ${escapeHtml(d.team_id || "")} • Incidents: ${escapeHtml(String(incidentsCount))}</span>
        <span style="margin-left:12px" class="badge status-closed" title="Completed">Archived</span>
      </div>
      <div style="margin-top:8px">
        <div class="muted small">Completed: ${escapeHtml(d.archived_at || created)}</div>
      </div>
    `;
    card.addEventListener("click", () => {
      openDispatch(d);
    });
    archiveListEl.appendChild(card);
  });
}

// Team location update
async function teamUpdateLocation(lat = 13.0108, lng = 74.7943) {
  try {
    const res = await fetch(`${API_BASE}/api/team/update-location`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-team-token": token },
      body: JSON.stringify({ lat, lng })
    });
    const j = await res.json();
    if (!res.ok) {
      alert(j.error || "Failed to update location");
      return null;
    }
    alert("Location updated");
    // clear incident cache so distance-aware logic sees new base coords
    INCIDENTS_CACHE = { map: {}, ts: 0 };
    return j;
  } catch (e) {
    console.error("Update location error", e);
    alert("Network error while updating location");
    return null;
  }
}

// Close modal
dispatchClose?.addEventListener("click", () => modal.classList.add("hidden"));

// Wire updateLocationBtn
updateLocationBtn?.addEventListener("click", () => {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      teamUpdateLocation(pos.coords.latitude, pos.coords.longitude);
    }, (err) => {
      teamUpdateLocation(13.0108, 74.7943);
    }, { timeout: 8000 });
  } else {
    teamUpdateLocation(13.0108, 74.7943);
  }
});

// Initial load
showAssignedTab();
loadDispatches();
renderArchive();
