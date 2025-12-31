// form.js — submission, toast, speech-to-text
const form = document.getElementById("reportForm");
const statusEl = document.getElementById("status");
const submitBtn = document.getElementById("submitBtn");
const micBtn = document.getElementById("micBtn");
const descInput = document.getElementById("descriptionInput");

// small toast helper
function toast(msg){
  const t = document.createElement("div");
  t.className = "toast";
  t.innerText = msg;
  document.body.appendChild(t);
  setTimeout(()=> t.remove(), 3500);
}

/* Speech recognition (browser) */
let recognition = null;
if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = "en-US";
  recognition.interimResults = false;

  recognition.onresult = e => {
    const text = e.results[0][0].transcript;
    descInput.value = descInput.value ? descInput.value + " " + text : text;
  };
  recognition.onerror = () => toast("Voice recognition error");
} else {
  micBtn.style.display = "none";
}

micBtn.addEventListener("click", () => {
  if (!recognition) { toast("Voice not supported"); return; }
  micBtn.classList.add("listening");
  try {
    recognition.start();
    setTimeout(()=> {
      recognition.stop();
      micBtn.classList.remove("listening");
    }, 8000);
  } catch(e){
    console.warn(e);
    micBtn.classList.remove("listening");
  }
});

/* Submit handler */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  statusEl.className = "status submitting";
  statusEl.textContent = "Submitting report…";

  const fd = new FormData();
  fd.append("location", document.getElementById("locationInput").value);
  fd.append("description", descInput.value);
  fd.append("name", document.getElementById("nameInput").value);
  fd.append("phone", document.getElementById("phoneInput").value);
  fd.append("email", document.getElementById("emailInput").value || "");

  if (window.currentLocation) {
    fd.append("lat", window.currentLocation.lat);
    fd.append("lng", window.currentLocation.lng);
  }

  const img = document.getElementById("imageInput").files[0];
  if (img) fd.append("image", img);

  try {
    const res = await fetch("http://127.0.0.1:5000/api/submit-report", { method: "POST", body: fd });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "submit failed");

    statusEl.className = "status success";
    statusEl.textContent = "✅ Report submitted — responders notified.";
    toast("Report submitted. Thank you — help is on the way.");
    form.reset();
  } catch (err) {
  console.error("Submit error:", err);
  statusEl.className = "status error";
  statusEl.textContent = err.message || "❌ Submission failed";
  toast(err.message || "Submission failed");
  } finally {
    submitBtn.disabled = false;
  }
});
