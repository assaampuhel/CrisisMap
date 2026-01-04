// frontend/admin/dashboard.js
// Final corrected admin dashboard.js — defensive, fixes null errors, renders friendly AI plan text.

const API_BASE = "http://127.0.0.1:5000";

const token = localStorage.getItem('admin_token');
if (!token) {
  window.location.href = 'login.html';
}

let ALL_INCIDENTS = [];
let ALL_TEAMS = [];
let CURRENT_ITEM = null;
let SELECTED_TEAM = "";

// DOM handles (graceful null guards)
const teamsListEl = document.getElementById("teamsList");
const refreshTeamsBtnSide = document.getElementById("refreshTeamsBtnSide");

const openCreateTeam = document.getElementById("openCreateTeam");
const createTeamModal = document.getElementById("createTeamModal");
const createTeamClose = document.getElementById("createTeamClose");
const createTeamBtn = document.getElementById("createTeamBtn");
const teamNameInput = document.getElementById("teamNameInput");
const teamContactInput = document.getElementById("teamContactInput");
const teamPasswordInput = document.getElementById("teamPasswordInput");
const createTeamMsg = document.getElementById("createTeamMsg");

const teamSelect = document.getElementById("teamSelect");
const teamGrid = document.getElementById("teamGrid");

const incidentsEl = document.getElementById("incidents");
const searchInput = document.getElementById("searchInput");
const statusFilter = document.getElementById("statusFilter");
const generateBtn = document.getElementById("generateBtn");

const detailModal = document.getElementById("detailModal");
const planModal = document.getElementById("planModal");
const detailClose = document.getElementById("detailClose");
const planClose = document.getElementById("planClose");

const detailTitle = document.getElementById("detailTitle");
const detailSeverity = document.getElementById("detailSeverity");
const detailPeople = document.getElementById("detailPeople");
const detailDesc = document.getElementById("detailDesc");
const detailImage = document.getElementById("detailImage");
const mapFrame = document.getElementById("mapFrame");
const statusSelect = document.getElementById("statusSelect");
const saveStatusBtn = document.getElementById("saveStatusBtn");

const planText = document.getElementById("planText");
const routeBlock = document.getElementById("routeBlock");
const downloadPlanBtn = document.getElementById("downloadPlanBtn");
const refreshTeamsBtn = document.getElementById("refreshTeamsBtn");
const assignInModalBtn = document.getElementById("assignInModalBtn");

const logoutBtn = document.getElementById("logoutBtn");
logoutBtn?.addEventListener("click", () => {
  localStorage.removeItem("admin_token");
  window.location.href = "login.html";
});

// default filter to "new" if present
if (statusFilter) statusFilter.value = "new";

/* small helper */
function escapeHtml(s){
  if (s === 0) return "0";
  if(!s && s !== 0) return "";
  try { s = String(s); } catch(e) { return ""; }
  return s.replace(/[&<>"'`=\/]/g, function (c) {
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;','=':'&#61;','/':'&#47;'})[c];
  });
}

function tryParseJSON(s) {
  if (!s || typeof s !== "string") return s;
  try { return JSON.parse(s); } catch (e) { return s; }
}

/* =========================
   Incidents loading + render
   ========================= */
async function loadIncidents() {
  if (!incidentsEl) return;
  incidentsEl.innerHTML = "<p>Loading…</p>";
  try {
    const res = await fetch(`${API_BASE}/api/incidents`, {
      headers: { 'x-admin-token': token }
    });

    if (res.status === 401) {
      localStorage.removeItem("admin_token");
      window.location.href = "login.html";
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      const errText = (data && data.error) ? data.error : res.statusText;
      incidentsEl.innerHTML = `<p class='muted'>Failed to load incidents: ${escapeHtml(errText)}</p>`;
      console.warn("Failed to load incidents:", errText);
      return;
    }

    ALL_INCIDENTS = Array.isArray(data) ? data : [];
    applyFiltersAndRender();
    if (ALL_TEAMS && ALL_TEAMS.length) renderTeamsSidebar(ALL_TEAMS);
  } catch (err) {
    incidentsEl.innerHTML = "<p>Failed to load incidents.</p>";
    console.error("Network error loading incidents:", err);
  }
}

function applyFiltersAndRender() {
  const q = (searchInput?.value || "").toLowerCase();
  const status = statusFilter?.value || "";
  let list = ALL_INCIDENTS.slice();

  if (status) list = list.filter(i => (i.status || "").toLowerCase() === status.toLowerCase());
  if (q) list = list.filter(i => {
    const loc = (i.location || "").toLowerCase();
    const desc = (i.description || i.analysis?.summary || "").toLowerCase();
    return loc.includes(q) || desc.includes(q);
  });

  renderList(list);
}

function renderList(list) {
  if (!incidentsEl) return;
  incidentsEl.innerHTML = "";
  if (!list.length) {
    incidentsEl.innerHTML = "<p class='muted'>No incidents found.</p>";
    return;
  }

  list.forEach(i => {
    const card = document.createElement("div");
    card.className = "card";

    const severity = ((i.analysis && i.analysis.severity) ? i.analysis.severity : (i.severity || "medium")) || "medium";
    const status = i.status || "new";

    const reporterName = i.reporter_name || i.name || "Anonymous";
    const reporterPhone = i.reporter_phone || i.phone || "";

    const planSnippet = (i.analysis && i.analysis.summary) ? String(i.analysis.summary).slice(0,110) : String(i.description || "").slice(0,110);

    card.innerHTML = `
      <div class="card-grid">
        <div>
          <h3 class="card-title">${escapeHtml(i.location || "Unknown location")}</h3>
          <p class="muted small">${escapeHtml(planSnippet)}</p>
          <div class="meta-row">
            <span class="badge severity-${escapeHtml(severity)}">Severity: ${escapeHtml(severity)}</span>
            <span class="badge status-${escapeHtml(status)}">${escapeHtml(status)}</span>
          </div>
          <div style="margin-top:8px; font-size:13px; color:#444;">
            Reporter: ${escapeHtml(reporterName)} ${reporterPhone ? `• <a href="tel:${encodeURIComponent(reporterPhone)}">${escapeHtml(reporterPhone)}</a>` : ""}
          </div>
        </div>
        <div class="card-actions">
          <button class="btn btn-primary view-btn">View</button>
        </div>
      </div>
    `;

    const viewBtn = card.querySelector(".view-btn");
    viewBtn?.addEventListener("click", () => openDetails(i));

    incidentsEl.appendChild(card);
  });
}

/* =========================
   Single incident modal
   ========================= */
function openDetails(item) {
  if (!detailModal) return;
  CURRENT_ITEM = item;
  detailModal.classList.remove("hidden");

  detailTitle.textContent = item.location || "Unknown";
  const analysis = item.analysis || {};

  const detailSummaryEl = document.getElementById("detailSummary");
  if (detailSummaryEl) detailSummaryEl.textContent = analysis.summary || "";

  if (detailSeverity) detailSeverity.textContent = analysis.severity || "n/a";
  if (detailPeople) detailPeople.textContent = (analysis.affected_people_estimate != null && analysis.affected_people_estimate !== 0) ? analysis.affected_people_estimate : "Unknown";
  if (detailDesc) detailDesc.textContent = item.description || "";

  try {
    const reporterNameEl = document.getElementById("reporterName");
    const reporterPhoneLink = document.getElementById("reporterPhoneLink");
    const rName = item.reporter_name || item.name || "Anonymous";
    const rPhone = item.reporter_phone || item.phone || "";

    if (reporterNameEl) reporterNameEl.textContent = rName;
    if (reporterPhoneLink) {
      if (rPhone) {
        reporterPhoneLink.textContent = rPhone;
        reporterPhoneLink.href = `tel:${rPhone}`;
      } else {
        reporterPhoneLink.textContent = "—";
        reporterPhoneLink.removeAttribute("href");
      }
    }
  } catch (e) {
    console.warn("Reporter fields not present in modal or error setting them:", e);
  }

  // followups (guarded)
  const followContainer = document.getElementById("followUpContainer");
  if (followContainer) {
    followContainer.innerHTML = "";
    const followQ = analysis.follow_up_questions || [];
    if (followQ.length) {
      const h = document.createElement("div");
      h.innerHTML = "<strong>Follow-up questions:</strong>";
      followContainer.appendChild(h);
      const ul = document.createElement("ul");
      followQ.forEach(q => {
        const li = document.createElement("li");
        li.textContent = q;
        ul.appendChild(li);
      });
      followContainer.appendChild(ul);
    }
  }

  const diagContainer = document.getElementById("diagnosticsContainer");
  if (diagContainer) {
    diagContainer.innerHTML = "";
    const adj = analysis.adjustments || {};
    if (adj.severity_source) {
      diagContainer.textContent = `source: ${adj.severity_source}`;
    } else if (analysis.severity_source) {
      diagContainer.textContent = `source: ${analysis.severity_source}`;
    } else {
      diagContainer.textContent = "";
    }
  }

  if (statusSelect) statusSelect.value = item.status || "new";

  if (item.image_url && detailImage) {
    detailImage.src = item.image_url;
    detailImage.style.display = "block";
  } else if (detailImage) {
    detailImage.src = "";
    detailImage.style.display = "none";
  }

  if (item.lat != null && item.lng != null && mapFrame) {
    // ensure iframe visible by setting src (iframe has inline style in HTML)
    mapFrame.src = `https://www.google.com/maps?q=${item.lat},${item.lng}&z=16&output=embed`;
  } else if (mapFrame) {
    mapFrame.src = "";
  }
}

async function saveStatus() {
  if (!CURRENT_ITEM) return;
  const newStatus = statusSelect?.value || "new";
  try {
    const res = await fetch(`${API_BASE}/api/update-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify({ id: CURRENT_ITEM._id, status: newStatus })
    });

    if (res.status === 401) {
      localStorage.removeItem("admin_token");
      window.location.href = "login.html";
      return;
    }

    if (res.ok) {
      CURRENT_ITEM.status = newStatus;
      const idx = ALL_INCIDENTS.findIndex(x => x._id === CURRENT_ITEM._id);
      if (idx >= 0) ALL_INCIDENTS[idx].status = newStatus;
      applyFiltersAndRender();
      closeDetailModal();
      renderTeamsSidebar(ALL_TEAMS);
    } else {
      const err = await res.json();
      alert("Failed to update status: " + (err.error || res.statusText));
    }
  } catch (err) {
    console.error(err);
    alert("Network error while updating status");
  }
}

function closeDetailModal() {
  if (!detailModal) return;
  detailModal.classList.add("hidden");
  CURRENT_ITEM = null;
  if (mapFrame) mapFrame.src = "";
  if (detailImage) detailImage.src = "";
  const f = document.getElementById("followUpContainer");
  if (f) f.innerHTML = "";
  const d = document.getElementById("diagnosticsContainer");
  if (d) d.innerHTML = "";
  const s = document.getElementById("detailSummary");
  if (s) s.textContent = "";
  const desc = document.getElementById("detailDesc");
  if (desc) desc.textContent = "";
}

detailClose?.addEventListener("click", closeDetailModal);
saveStatusBtn?.addEventListener("click", saveStatus);

searchInput?.addEventListener("input", applyFiltersAndRender);
statusFilter?.addEventListener("change", applyFiltersAndRender);

/* -------------------------
   TEAMS: load, sidebar, grid
   ------------------------- */
async function loadTeams() {
  try {
    const res = await fetch(`${API_BASE}/api/teams`, {
      headers: { "x-admin-token": token }
    });

    if (res.status === 401) {
      localStorage.removeItem("admin_token");
      window.location.href = "login.html";
      return;
    }

    if (!res.ok) {
      console.warn("Failed to load teams:", res.status);
      if (teamsListEl) teamsListEl.innerHTML = "<div class='muted'>No teams</div>";
      if (teamSelect) teamSelect.innerHTML = "<option value=''>No teams</option>";
      return;
    }

    const teams = await res.json();
    ALL_TEAMS = Array.isArray(teams) ? teams : [];

    // fill dropdown (modal) and modal grid
    if (teamSelect) {
      teamSelect.innerHTML = "<option value=''>Unassigned</option>";
      ALL_TEAMS.forEach(t => {
        const opt = document.createElement("option");
        opt.value = t._id;
        opt.textContent = t.name;
        teamSelect.appendChild(opt);
      });
    }

    renderTeamsSidebar(ALL_TEAMS);
    renderTeamsGrid(ALL_TEAMS);
  } catch (err) {
    console.error("Error loading teams", err);
    if (teamsListEl) teamsListEl.innerHTML = "<div class='muted'>Error loading teams</div>";
    if (teamSelect) teamSelect.innerHTML = "<option value=''>Error</option>";
  }
}

function renderTeamsSidebar(teams) {
  if (!teamsListEl) return;
  teamsListEl.innerHTML = "";
  if (!teams || teams.length === 0) {
    teamsListEl.innerHTML = "<div class='muted'>No teams</div>";
    return;
  }
  teams.forEach(t => {
    const activeCount = ALL_INCIDENTS.filter(it => it.assigned_team === t._id && (it.status || "").toLowerCase() !== "closed").length;
    const statusLabel = activeCount > 0 ? "Busy" : "Ready";
    const statusClass = activeCount > 0 ? "badge status-rescue_dispatched" : "badge status-new";

    const item = document.createElement("div");
    item.className = "team-item card";
    item.style.marginBottom = "8px";
    item.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-weight:700">${escapeHtml(t.name)}</div>
          <div class="muted small">${escapeHtml(t.contact || "")}</div>
        </div>
        <div style="text-align:right">
          <div class="${statusClass}" style="padding:6px 8px;border-radius:8px;font-weight:700">${statusLabel}</div>
          <div class="muted small" style="margin-top:6px">${activeCount} active</div>
        </div>
      </div>
    `;
    item.addEventListener("click", () => {
      if (statusFilter) statusFilter.value = "";
      if (searchInput) searchInput.value = "";
      const list = ALL_INCIDENTS.filter(it => it.assigned_team === t._id);
      renderList(list);
    });
    teamsListEl.appendChild(item);
  });
}

function renderTeamsGrid(teams) {
  if (!teamGrid) return;
  teamGrid.innerHTML = "";
  if (!teams || teams.length === 0) {
    teamGrid.innerHTML = "<div class='muted'>No teams</div>";
    return;
  }
  teams.forEach(t => {
    const card = document.createElement("div");
    card.className = "card team-card";
    card.style.cursor = "pointer";
    card.dataset.teamId = t._id;
    card.innerHTML = `<strong>${escapeHtml(t.name)}</strong><div class="muted small" style="margin-top:6px">${escapeHtml(t.contact || "")}</div>`;
    card.addEventListener("click", () => {
      SELECTED_TEAM = t._id;
      if (teamSelect) teamSelect.value = t._id;
      Array.from(teamGrid.querySelectorAll(".team-card")).forEach(el => el.classList.remove("selected"));
      card.classList.add("selected");
    });
    teamGrid.appendChild(card);
  });
}

refreshTeamsBtn?.addEventListener("click", () => loadTeams());
refreshTeamsBtnSide?.addEventListener("click", () => { loadTeams(); loadIncidents(); });

/* -----------------------
   AUTO-DISPATCH (Generate) flow
   ----------------------- */
generateBtn?.addEventListener("click", async () => {
  if (!generateBtn) return;
  generateBtn.disabled = true;
  const originalText = generateBtn.textContent;
  generateBtn.textContent = "Dispatching…";

  try {
    const body = { statuses: ["new"], max_per_team: 8 };
    const res = await fetch(`${API_BASE}/api/auto-dispatch-ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Auto-dispatch failed");
      return;
    }

    const dispatches = data.dispatches || [];
    renderDispatchesInModal(dispatches);

    await loadIncidents();
    await loadTeams();

    planModal && planModal.classList.remove("hidden");
  } catch (err) {
    console.error("Auto-dispatch error:", err);
    alert("Network error while auto-dispatching");
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = originalText || "Generate Plan";
  }
});

/* Manual assign fallback */
assignInModalBtn?.addEventListener("click", async () => {
  if (!assignInModalBtn) return;
  assignInModalBtn.disabled = true;
  const orig = assignInModalBtn.textContent;
  assignInModalBtn.textContent = "Assigning…";
  try {
    const teamId = (teamSelect && teamSelect.value) ? teamSelect.value : null;
    const body = { statuses: ["new"], team_id: teamId };
    const res = await fetch(`${API_BASE}/api/generate-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Assign failed");
      return;
    }

    if (data.dispatch_id) {
      renderDispatchesInModal([{ team_id: data.team_id, dispatch_id: data.dispatch_id, count: (data.incidents||[]).length, plan_text: data.plan, incidents: (data.incidents || []) }]);
    } else {
      planText.textContent = typeof data.plan === "string" ? data.plan : JSON.stringify(data.plan || data, null, 2);
      planText.style.display = "none";
      renderFriendlyPlan(data);
      planModal && planModal.classList.remove("hidden");
    }

    await loadIncidents();
    await loadTeams();
  } catch (err) {
    console.error("Assign error:", err);
    alert("Network error during assign");
  } finally {
    assignInModalBtn.disabled = false;
    assignInModalBtn.textContent = orig || "Confirm Assignment";
  }
});

planClose?.addEventListener("click", () => planModal && planModal.classList.add("hidden"));

downloadPlanBtn?.addEventListener("click", () => {
  const content = planText?.textContent || document.getElementById("planFriendly")?.textContent || "No plan to download";
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `plan_${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

/* -----------------------
   Render multiple dispatches inside plan modal
   ----------------------- */
function renderDispatchesInModal(dispatches) {
  const friendly = document.getElementById("planFriendly");
  if (!friendly) return;
  friendly.innerHTML = "";

  if (!dispatches || dispatches.length === 0) {
    friendly.innerHTML = "<div class='muted'>No dispatches were created.</div>";
    return;
  }

  dispatches.forEach(d => {
    const wrapper = document.createElement("div");
    wrapper.className = "card";
    wrapper.style.marginBottom = "10px";

    const teamName = (ALL_TEAMS.find(t => t._id === d.team_id) || {}).name || (d.team_id || "Unassigned");
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";

    const title = document.createElement("div");
    title.innerHTML = `<strong>Dispatch ${escapeHtml(d.dispatch_id || "(n/a)")}</strong><div class="muted small">Team: ${escapeHtml(teamName)} • ${escapeHtml(String(d.count || (d.incidents||[]).length))} incidents</div>`;

    const actions = document.createElement("div");
    const dl = document.createElement("button");
    dl.className = "btn btn-ghost";
    dl.textContent = "Download";
    dl.addEventListener("click", () => {
      const planObj = d.plan_text ? (typeof d.plan_text === "string" ? tryParseJSON(d.plan_text) : d.plan_text) : null;
      const text = planToHumanText(planObj, d.dispatch_id, d.team_id);
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${d.dispatch_id || "dispatch"}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
    actions.appendChild(dl);

    header.appendChild(title);
    header.appendChild(actions);
    wrapper.appendChild(header);

    // incidents list ordered by plan route if available
    const incList = document.createElement("div");
    incList.style.marginTop = "10px";
    incList.innerHTML = "<strong>Incidents in this Dispatch</strong>";
    const ul = document.createElement("div");
    ul.style.marginTop = "8px";

    // Build a mapping by id & by location for matching
    const incidentsArr = Array.isArray(d.incidents) ? d.incidents.slice() : [];
    const byId = {};
    incidentsArr.forEach(it => { if (it && it._id) byId[it._id] = it; });

    // Try to parse plan_text for route ordering
    let ordered = incidentsArr.slice();
    const planObj = d.plan_text ? (typeof d.plan_text === "string" ? tryParseJSON(d.plan_text) : d.plan_text) : null;
    if (planObj && Array.isArray(planObj.route) && planObj.route.length) {
      ordered = [];
      planObj.route.forEach(r => {
        // prefer exact _id match
        if (r._id && byId[r._id]) {
          ordered.push(byId[r._id]);
        } else {
          // match by location text (fallback), case-insensitive
          const loc = (r.location || "").toString().toLowerCase().trim();
          const found = incidentsArr.find(it => ((it.location || "") + "").toLowerCase().trim() === loc);
          if (found) ordered.push(found);
          else {
            // if nothing matched, push a surrogate entry from route
            ordered.push({
              _id: r._id || "",
              location: r.location || "",
              lat: r.lat,
              lng: r.lng,
              severity: r.severity || "",
              description: r.reason || ""
            });
          }
        }
      });
      // append any not-included incidents
      incidentsArr.forEach(it => { if (!ordered.find(x => x._id && it._id && x._id === it._id)) ordered.push(it); });
    }

    (ordered || []).forEach(it => {
      const block = document.createElement("div");
      block.className = "card";
      block.style.padding = "8px";
      block.style.marginBottom = "6px";

      const name = escapeHtml(it.location || it.name || "Unknown");
      const sev = escapeHtml((it.severity || "").toString() || "");
      const coords = (it.lat != null && it.lng != null) ? `<a href="https://www.google.com/maps?q=${it.lat},${it.lng}&z=16" target="_blank" class="btn btn-ghost" style="margin-left:8px">Open map</a>` : "";

      // show original report if available (it.description)
      const originalReport = escapeHtml(it.description || it.report_description || "");

      block.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:700">${name}</div>
            <div class="muted small">Severity: ${sev}</div>
            ${ originalReport ? `<div class="muted small" style="margin-top:6px">${originalReport}</div>` : "" }
          </div>
          <div style="text-align:right">${coords}</div>
        </div>`;
      ul.appendChild(block);
    });

    incList.appendChild(ul);
    wrapper.appendChild(incList);

    friendly.appendChild(wrapper);
  });

  if (planText) planText.style.display = "none";
}

/* ========================
   Helpers: text plan -> human readable
   ======================== */
function planToHumanText(planObj, dispatchId, teamId) {
  let out = "";
  out += `Dispatch ID: ${dispatchId || "(n/a)"}\nAssigned team: ${teamId || "Unassigned"}\n\n`;
  if (!planObj) return out + "No plan content\n";
  if (planObj.summary) out += `Summary:\n${planObj.summary}\n\n`;
  if (Array.isArray(planObj.route) && planObj.route.length) {
    out += "Route (priority order):\n";
    planObj.route.forEach((r, i) => {
      out += `${i+1}. ${r.location || r.name || "Unknown"}\n   - Reason: ${r.reason || r.note || ""}\n   - Coordinates: ${r.lat || ""}, ${r.lng || ""}\n`;
    });
    out += "\n";
  }
  if (Array.isArray(planObj.resources) && planObj.resources.length) {
    out += "Resources:\n";
    planObj.resources.forEach((r, i) => out += ` - ${r}\n`);
    out += "\n";
  }
  if (typeof planObj === "string") out += `${planObj}\n`;
  return out;
}

/* -----------------------
   Create team modal wiring (simple)
   ----------------------- */
openCreateTeam?.addEventListener("click", () => {
  if (!createTeamModal) return;
  if (createTeamMsg) createTeamMsg.textContent = "";
  if (teamNameInput) teamNameInput.value = "";
  if (teamContactInput) teamContactInput.value = "";
  if (teamPasswordInput) teamPasswordInput.value = "";
  createTeamModal.classList.remove("hidden");
});
createTeamClose?.addEventListener("click", () => {
  if (!createTeamModal) return;
  createTeamModal.classList.add("hidden");
});
createTeamBtn?.addEventListener("click", async () => {
  if (!createTeamBtn) return;
  const name = (teamNameInput?.value || "").trim();
  const contact = (teamContactInput?.value || "").trim();
  const password = teamPasswordInput?.value || "";

  if (!name || !password) {
    if (createTeamMsg) createTeamMsg.textContent = "Team name and password are required.";
    return;
  }

  createTeamBtn.disabled = true;
  if (createTeamMsg) createTeamMsg.textContent = "Creating team…";

  try {
    const res = await fetch(`${API_BASE}/api/teams`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": token
      },
      body: JSON.stringify({ name, contact, password })
    });

    if (res.status === 401) {
      localStorage.removeItem("admin_token");
      window.location.href = "login.html";
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      if (createTeamMsg) createTeamMsg.textContent = data.error || "Failed to create team";
      return;
    }

    if (createTeamMsg) createTeamMsg.textContent = "Team created successfully ✔";
    await loadTeams();
    setTimeout(() => { if (createTeamModal) createTeamModal.classList.add("hidden"); }, 700);
  } catch (err) {
    console.error(err);
    if (createTeamMsg) createTeamMsg.textContent = "Network error";
  } finally {
    createTeamBtn.disabled = false;
  }
});

/* -----------------------
   Plan rendering (single plan responses) — kept for compatibility
   ----------------------- */
function renderFriendlyPlan(data) {
  const friendly = document.getElementById("planFriendly");
  if (!friendly) return;
  friendly.innerHTML = "";

  const planObj = (typeof data.plan === "string") ? tryParseJSON(data.plan) : (data.plan || data);
  const summary = (planObj && planObj.summary) ? planObj.summary : (typeof planObj === "string" ? planObj : "No summary available");
  const route = (planObj && planObj.route && Array.isArray(planObj.route)) ? planObj.route : [];
  const resources = (planObj && planObj.resources && Array.isArray(planObj.resources)) ? planObj.resources : [];

  const firstSentence = String(summary).split(/(?<=[.!?])\s+/)[0] || String(summary);
  const header = document.createElement("div");
  header.innerHTML = `<strong>Summary</strong><div style="margin-top:6px">${escapeHtml(firstSentence)}</div>`;
  friendly.appendChild(header);

  if (route.length) {
    const rblock = document.createElement("div");
    rblock.style.marginTop = "10px";
    rblock.innerHTML = "<strong>Route (priority)</strong>";
    const ol = document.createElement("ol");
    ol.style.marginTop = "6px";
    ol.style.paddingLeft = "18px";
    route.forEach(r => {
      const li = document.createElement("li");
      li.style.marginBottom = "6px";
      const mapLink = (r.lat && r.lng) ? `<a href="https://www.google.com/maps?q=${r.lat},${r.lng}&z=16" target="_blank" class="btn btn-ghost" style="margin-left:8px">Open map</a>` : "";
      li.innerHTML = `<div style="font-weight:700">${escapeHtml(r.location || r.name || "Unknown")}${mapLink}</div>
                      <div class="muted small">${escapeHtml(r.reason || r.note || "")}</div>`;
      ol.appendChild(li);
    });
    rblock.appendChild(ol);
    friendly.appendChild(rblock);
  }

  if (resources.length) {
    const resBlock = document.createElement("div");
    resBlock.style.marginTop = "10px";
    resBlock.innerHTML = "<strong>Top resources</strong>";
    const ul = document.createElement("ul");
    ul.style.marginTop = "6px";
    ul.style.paddingLeft = "18px";
    resources.slice(0, 8).forEach(r => {
      const li = document.createElement("li");
      li.textContent = r;
      ul.appendChild(li);
    });
    resBlock.appendChild(ul);
    if (resources.length > 8) {
      const more = document.createElement("div");
      more.className = "muted small";
      more.style.marginTop = "6px";
      more.textContent = `+ ${resources.length - 8} more resources`;
      resBlock.appendChild(more);
    }
    friendly.appendChild(resBlock);
  }

  const meta = document.createElement("div");
  meta.className = "muted";
  meta.style.marginTop = "12px";
  meta.textContent = `Dispatch ID: ${data.dispatch_id || "(n/a)"} • Assigned team: ${data.team_id || "Unassigned"}`;
  friendly.appendChild(meta);
}

/* -----------------------
   initial load
   ----------------------- */
loadIncidents();
loadTeams();
