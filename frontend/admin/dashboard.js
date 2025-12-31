// frontend/admin/dashboard.js
const token = localStorage.getItem('admin_token');
if (!token) {
  window.location.href = 'login.html';
}

let ALL_INCIDENTS = [];
let CURRENT_ITEM = null;

const incidentsEl = document.getElementById("incidents");
const searchInput = document.getElementById("searchInput");
const statusFilter = document.getElementById("statusFilter");
const generateBtn = document.getElementById("generateBtn");

const detailModal = document.getElementById("detailModal");
const planModal = document.getElementById("planModal");
const detailClose = document.getElementById("detailClose");
const planClose = document.getElementById("planClose");

const detailTitle = document.getElementById("detailTitle");
const detailSummary = document.getElementById("detailSummary");
const detailSeverity = document.getElementById("detailSeverity");
const detailPeople = document.getElementById("detailPeople");
const detailDesc = document.getElementById("detailDesc");
const detailImage = document.getElementById("detailImage");
const mapFrame = document.getElementById("mapFrame");
const statusSelect = document.getElementById("statusSelect");
const saveStatusBtn = document.getElementById("saveStatusBtn");

const planText = document.getElementById("planText");
const routeBlock = document.getElementById("routeBlock");

const logoutBtn = document.getElementById("logoutBtn");
logoutBtn?.addEventListener("click", () => {
  localStorage.removeItem("admin_token");
  window.location.href = "login.html";
});


async function loadIncidents() {
  incidentsEl.innerHTML = "<p>Loading…</p>";
  try {
    const res = await fetch("http://127.0.0.1:5000/api/incidents", {
      headers: { 'x-admin-token': token }
    });
    const data = await res.json();
    ALL_INCIDENTS = Array.isArray(data) ? data : [];
    applyFiltersAndRender();
  } catch (err) {
    incidentsEl.innerHTML = "<p>Failed to load incidents.</p>";
    console.error(err);
  }
}

function applyFiltersAndRender() {
  const q = (searchInput.value || "").toLowerCase();
  const status = statusFilter.value;
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
  incidentsEl.innerHTML = "";
  if (!list.length) {
    incidentsEl.innerHTML = "<p class='muted'>No incidents found.</p>";
    return;
  }

  list.forEach(i => {
    const card = document.createElement("div");
    card.className = "card";

    const severity = (i.analysis && i.analysis.severity) ? i.analysis.severity : "medium";
    const status = i.status || "new";

    // ---- ADDED: reporter info extraction ----
    const reporterName = i.reporter_name || i.name || "Anonymous";
    const reporterPhone = i.reporter_phone || i.phone || "";
    // -----------------------------------------

    card.innerHTML = `
      <div class="card-grid">
        <div>
          <h3 class="card-title">${escapeHtml(i.location || "Unknown location")}</h3>
          <p class="muted small">${escapeHtml((i.analysis && i.analysis.summary) || i.description || "")}</p>
          <div class="meta-row">
            <span class="badge severity-${severity}">Severity: ${severity}</span>
            <span class="badge status-${status}">${status}</span>
          </div>
          <!-- ADDED: show reporter name & phone in card -->
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
    viewBtn.addEventListener("click", () => openDetails(i));

    incidentsEl.appendChild(card);
  });
}

function openDetails(item) {
  CURRENT_ITEM = item;
  detailModal.classList.remove("hidden");

  // Basic fields
  detailTitle.textContent = item.location || "Unknown";
  const analysis = item.analysis || {};

  // Summary
  document.getElementById("detailSummary").textContent = analysis.summary || "";

  // Key fields
  detailSeverity.textContent = analysis.severity || "n/a";
  detailPeople.textContent = (analysis.affected_people_estimate != null ? analysis.affected_people_estimate : "Unknown");
  detailDesc.textContent = item.description || "";

  // ---- ADDED: populate reporter fields in modal if they exist ----
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
    // safe-fail: don't break modal if elements missing
    console.warn("Reporter fields not present in modal or error setting them:", e);
  }
  // -----------------------------------------------------------------

  // Follow-up questions (clear then add)
  const followContainer = document.getElementById("followUpContainer");
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

  // Diagnostics (clear then add)
  const diagContainer = document.getElementById("diagnosticsContainer");
  diagContainer.innerHTML = "";
  const adj = analysis.adjustments || {};
  if (adj.severity_source) {
    diagContainer.textContent = `source: ${adj.severity_source}`;
  } else if (analysis.severity_source) {
    diagContainer.textContent = `source: ${analysis.severity_source}`;
  } else {
    diagContainer.textContent = "";
  }

  // Status select (set value but DO NOT rebind click handlers here)
  statusSelect.value = item.status || "new";

  // Image: set src (overwrite, not append)
  if (item.image_url) {
    detailImage.src = item.image_url;
    detailImage.style.display = "block";
  } else {
    detailImage.src = "";
    detailImage.style.display = "none";
  }

  // Map iframe: set src (overwrite)
  if (item.lat && item.lng) {
    mapFrame.src = `https://www.google.com/maps?q=${item.lat},${item.lng}&z=16&output=embed`;
  } else {
    mapFrame.src = "";
  }
}


async function saveStatus() {
  if (!CURRENT_ITEM) return;
  const newStatus = statusSelect.value;
  try {
    const res = await fetch("http://127.0.0.1:5000/api/update-status", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify({ id: CURRENT_ITEM._id, status: newStatus })
    });
    if (res.ok) {
      CURRENT_ITEM.status = newStatus;
      const idx = ALL_INCIDENTS.findIndex(x => x._id === CURRENT_ITEM._id);
      if (idx >= 0) ALL_INCIDENTS[idx].status = newStatus;
      applyFiltersAndRender();
      closeDetailModal();
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
  detailModal.classList.add("hidden");
  CURRENT_ITEM = null;
  mapFrame.src = "";
  detailImage.src = "";
  // clear follow-up and diagnostics to avoid stale content
  document.getElementById("followUpContainer").innerHTML = "";
  document.getElementById("diagnosticsContainer").innerHTML = "";
  // optionally clear summary/desc
  document.getElementById("detailSummary").textContent = "";
  document.getElementById("detailDesc").textContent = "";
}


detailClose.addEventListener("click", closeDetailModal);
saveStatusBtn.addEventListener("click", saveStatus);

searchInput.addEventListener("input", applyFiltersAndRender);
statusFilter.addEventListener("change", applyFiltersAndRender);

// BULK PLAN (for statuses e.g. ["new"])
generateBtn.addEventListener("click", async () => {
  try {
    generateBtn.disabled = true;
    generateBtn.textContent = "Generating…";

    const res = await fetch("http://127.0.0.1:5000/api/generate-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify({ statuses: ["new"] })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Plan generation failed");
      return;
    }

    planText.textContent = data.plan || "(no plan returned)";
    routeBlock.innerHTML = "";

    // Build route link from returned incidents or local incidents
    const routeIncidents = (data.incidents && data.incidents.length) ? data.incidents
        : ALL_INCIDENTS.filter(i => (i.status||"new")==="new" && i.lat && i.lng)
            .map(i => ({ lat: i.lat, lng: i.lng, _id: i._id }));

    if (routeIncidents && routeIncidents.length > 0) {
      const ordered = orderIncidentsForRoute(routeIncidents);
      const mapsUrl = buildGoogleMapsDirectionsUrl(ordered);
      const link = document.createElement("a");
      link.href = mapsUrl;
      link.target = "_blank";
      link.textContent = "Open route in Google Maps (driver)";
      link.className = "btn btn-ghost";
      routeBlock.appendChild(link);
    } else {
      routeBlock.innerHTML = "<div class='muted'>No geocoded 'new' incidents to route.</div>";
    }

    planModal.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    alert("Failed to generate plan");
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "Generate Dispatch Plan";
  }
});

// helpers (same as before)
function orderIncidentsForRoute(list) {
  const items = list.slice();
  const score = s => {
    if (!s) return 1;
    s = s.toLowerCase();
    if (s.includes("critical")) return 5;
    if (s.includes("high")) return 4;
    if (s.includes("medium")) return 3;
    if (s.includes("low")) return 2;
    return 1;
  };
  items.sort((a,b) => (b.severity ? score(b.severity) : 0) - (a.severity ? score(a.severity) : 0));

  const ordered = [items.shift()];
  while (items.length) {
    const last = ordered[ordered.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    items.forEach((c, idx) => {
      const dx = (c.lat - last.lat);
      const dy = (c.lng - last.lng);
      const d = dx*dx + dy*dy;
      if (d < bestDist) { bestDist = d; bestIdx = idx; }
    });
    ordered.push(items.splice(bestIdx,1)[0]);
  }
  return ordered;
}

function buildGoogleMapsDirectionsUrl(ordered) {
  if (!ordered || ordered.length === 0) return "";
  const origin = `${ordered[0].lat},${ordered[0].lng}`;
  const dest = `${ordered[ordered.length-1].lat},${ordered[ordered.length-1].lng}`;
  const waypoints = ordered.slice(1, ordered.length-1).map(o => `${o.lat},${o.lng}`).join("|");
  let url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}&travelmode=driving`;
  if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`;
  return url;
}

function escapeHtml(s){
  if(!s) return "";
  return s.replace(/[&<>"'`=\/]/g, function (c) {
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;','=':'&#61;','/':'&#47;'})[c];
  });
}

// Plan modal close
planClose.addEventListener("click", () => planModal.classList.add("hidden"));

loadIncidents();
