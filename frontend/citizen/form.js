// Handles form submission to backend API endpoint /api/submit-report
const form = document.getElementById("reportForm");
const statusEl = document.getElementById("status");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  statusEl.textContent = "Submitting...";
  const locationText = document.getElementById("locationInput").value;
  const description = document.getElementById("descriptionInput").value;
  const fileInput = document.getElementById("imageInput");

  // Build form data
  const fd = new FormData();
  fd.append("location", locationText);
  fd.append("description", description);

  // attach current lat/lng if available
  if (window.currentLocation) {
    fd.append("lat", window.currentLocation.lat);
    fd.append("lng", window.currentLocation.lng);
  }

  if (fileInput.files && fileInput.files[0]) {
    fd.append("image", fileInput.files[0]);
  }

  try {
    const res = await fetch("http://127.0.0.1:5000/api/submit-report", {
      method: "POST",
      body: fd
    });

    const data = await res.json();
    if (res.ok) {
      statusEl.style.color = "green";
      statusEl.textContent = "Report submitted — AI analysis: " + (data.analysis.summary || "No summary");
      form.reset();
    } else {
      statusEl.style.color = "crimson";
      statusEl.textContent = "Submit failed: " + (data.error || JSON.stringify(data));
    }
  } catch (err) {
    statusEl.style.color = "crimson";
    statusEl.textContent = "Server unreachable (is backend running?)";
    console.error(err);
  }
});
