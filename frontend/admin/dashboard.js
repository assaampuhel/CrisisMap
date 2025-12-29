// Load incidents and render them as cards. Allow generating AI plan via /api/generate-plan

async function loadIncidents() {
  const container = document.getElementById("incidents");
  container.innerHTML = "<p>Loading...</p>";

  try {
    const res = await fetch("http://127.0.0.1:5000/api/incidents");
    const list = await res.json();
    container.innerHTML = "";

    if (!Array.isArray(list) || list.length === 0) {
      container.innerHTML = "<p>No incidents yet.</p>";
      return;
    }

    list.forEach(it => {
      const card = document.createElement("div");
      card.className = "card";

      const title = document.createElement("h3");
      title.textContent = it.location || "Unknown location";

      const summary = document.createElement("p");
      const analysis = it.analysis || {};
      summary.textContent = analysis.summary || "No summary";

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent =
        (it.timestamp ? it.timestamp.split("T").join(" ") : "") +
        " • Severity: " +
        (analysis.severity || "n/a");

      card.appendChild(title);
      card.appendChild(summary);
      card.appendChild(meta);

      // 🔥 IMAGE HANDLING (UPDATED)
      if (it.image_url) {
        // Preferred: Firebase Storage public URL
        const img = document.createElement("img");
        img.src = it.image_url;
        img.alt = "report image";
        card.appendChild(img);
      } else if (it.image_filename) {
        // Fallback: local uploads (debug / backup)
        const img = document.createElement("img");
        img.src = `http://127.0.0.1:5000/uploads/${encodeURIComponent(it.image_filename)}`;
        img.alt = "report image (local fallback)";
        card.appendChild(img);
      }

      const controls = document.createElement("div");
      controls.className = "controls";

      const planBtn = document.createElement("button");
      planBtn.className = "btn btn-primary";
      planBtn.textContent = "Generate Action Plan";
      planBtn.onclick = () => generatePlan(it);

      const viewRaw = document.createElement("button");
      viewRaw.className = "btn btn-ghost";
      viewRaw.textContent = "View raw";
      viewRaw.onclick = () => alert(JSON.stringify(it, null, 2));

      controls.appendChild(planBtn);
      controls.appendChild(viewRaw);
      card.appendChild(controls);

      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = "<p>Failed to load incidents</p>";
    console.error(err);
  }
}

async function generatePlan(incident) {
  try {
    const res = await fetch("http://127.0.0.1:5000/api/generate-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(incident)
    });
    const data = await res.json();
    if (res.ok) {
      showModal(data.plan);
    } else {
      alert("Plan failed: " + (data.error || JSON.stringify(data)));
    }
  } catch (err) {
    alert("Server error while generating plan");
    console.error(err);
  }
}

function showModal(text) {
  const modal = document.getElementById("modal");
  document.getElementById("planText").textContent = text;
  modal.classList.remove("hidden");
}

document.getElementById("modal").addEventListener("click", (e) => {
  if (e.target.id === "modal") {
    e.target.classList.add("hidden");
  }
});

document.getElementById("closeModal").addEventListener("click", () => {
  document.getElementById("modal").classList.add("hidden");
});

// initial load
loadIncidents();
