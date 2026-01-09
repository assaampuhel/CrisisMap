// frontend/citizen/form.js

const API_BASE = "http://127.0.0.1:5000"; // adjust if backend is elsewhere

const form = document.getElementById("reportForm");
const statusEl = document.getElementById("status");
const submitBtn = document.getElementById("submitBtn");
const micBtn = document.getElementById("micBtn");
const readBtn = document.getElementById("readBtn");
const descInput = document.getElementById("descriptionInput");

// NOTE: safely grab the actual element (may be null). Do NOT replace this with an object literal.
// We'll use a helper to read its value safely.
const langSelectEl = document.getElementById("langSelect");
const insertTransBtn = document.getElementById("insertTransBtn");

let lastTranscript = "";
let recognition = null;
let recognizing = false;

// small toast helper
function toast(msg){
  const t = document.createElement("div");
  t.className = "toast";
  t.innerText = msg;
  document.body.appendChild(t);
  setTimeout(()=> t.remove(), 3500);
}

// safe getter for chosen language (falls back to en-US if selector missing)
function getLang() {
  try {
    return (langSelectEl && (langSelectEl.value || langSelectEl.getAttribute("data-lang"))) || "en-US";
  } catch (e) {
    return "en-US";
  }
}

/* =========================
   Browser SpeechRecognition
   ========================= */
function initRecognition() {
  if (recognition) return;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    recognition = null;
    if (micBtn) micBtn.style.display = "none";
    return;
  }

  recognition = new SR();
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.lang = getLang();

  recognition.onstart = () => {
    recognizing = true;
    if (micBtn) micBtn.classList.add("listening");
    toast("Listening...");
  };

  recognition.onresult = (event) => {
    try {
      const text = Array.from(event.results)
        .map(r => r[0].transcript)
        .join(" ");
      lastTranscript = text.trim();
      // auto-insert the transcript into description
      if (descInput) {
        descInput.value = descInput.value ? descInput.value + " " + lastTranscript : lastTranscript;
      }
      toast("Transcript added");
    } catch (e) {
      console.warn("Speech onresult error", e);
    }
  };

  recognition.onerror = (err) => {
    console.error("Speech recognition error:", err);
    toast("Voice recognition error");
  };

  recognition.onend = () => {
    recognizing = false;
    if (micBtn) micBtn.classList.remove("listening");
    // recognition may end automatically — that's normal
  };
}

// toggle recognition on mic button click
if (micBtn) {
  micBtn.addEventListener("click", async () => {
    initRecognition();
    if (!recognition) {
      toast("Voice recognition not supported in this browser. Use Chrome.");
      return;
    }

    // update language each time before start
    recognition.lang = getLang();

    if (!recognizing) {
      try {
        recognition.start();
      } catch (e) {
        console.warn("recognition.start() error:", e);
        toast("Could not start voice recognition");
      }
    } else {
      // stop manually
      try { recognition.stop(); } catch (e) { console.warn(e); }
    }
  });
}

// keep recognition language in sync when user changes language (only attach if the element exists)
if (langSelectEl && typeof langSelectEl.addEventListener === "function") {
  langSelectEl.addEventListener("change", () => {
    if (recognition) recognition.lang = getLang();
  });
}

/* =========================
   Insert last transcript
   ========================= */
if (insertTransBtn) {
  insertTransBtn.addEventListener("click", () => {
    if (!lastTranscript) {
      toast("No transcript available yet");
      return;
    }
    if (descInput) {
      descInput.value = descInput.value ? descInput.value + " " + lastTranscript : lastTranscript;
    }
    toast("Inserted last transcript");
  });
}

/* =========================
   Read-back (TTS) using SpeechSynthesis
   ========================= */
if (readBtn) {
  readBtn.addEventListener("click", () => {
    const text = descInput ? descInput.value.trim() : "";
    if (!text) { toast("Nothing to read"); return; }

    const lang = getLang();
    const synth = window.speechSynthesis;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;

    // pick a voice that starts with language code if available
    const voices = synth.getVoices ? synth.getVoices() : [];
    const shortLang = lang.split("-")[0].toLowerCase();
    const langMatch = voices.find(v => v.lang && v.lang.toLowerCase().startsWith(shortLang));
    if (langMatch) utter.voice = langMatch;

    synth.cancel();
    synth.speak(utter);
  });
}

/* =========================
   Submit handler (unchanged core behavior)
   ========================= */
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submitBtn) submitBtn.disabled = true;
    if (statusEl) {
      statusEl.className = "status submitting";
      statusEl.textContent = "Submitting report…";
    }

    const fd = new FormData();
    fd.append("location", (document.getElementById("locationInput") && document.getElementById("locationInput").value) || "");
    fd.append("description", descInput ? descInput.value : "");
    fd.append("name", (document.getElementById("nameInput") && document.getElementById("nameInput").value) || "");
    fd.append("phone", (document.getElementById("phoneInput") && document.getElementById("phoneInput").value) || "");
    fd.append("email", (document.getElementById("emailInput") && document.getElementById("emailInput").value) || "");

    if (window.currentLocation) {
      fd.append("lat", window.currentLocation.lat);
      fd.append("lng", window.currentLocation.lng);
    }

    const imgEl = document.getElementById("imageInput");
    const img = imgEl ? imgEl.files[0] : null;
    if (img) fd.append("image", img);

    try {
      const res = await fetch(`${API_BASE}/api/submit-report`, { method: "POST", body: fd });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "submit failed");

      if (statusEl) {
        statusEl.className = "status success";
        statusEl.textContent = "✅ Report submitted — responders notified.";
      }
      toast("Report submitted. Thank you — help is on the way.");
      if (form) form.reset();
      lastTranscript = "";
    } catch (err) {
      console.error("Submit error:", err);
      if (statusEl) {
        statusEl.className = "status error";
        statusEl.textContent = err.message || "❌ Submission failed";
      }
      toast(err.message || "Submission failed");
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

// initialize recognition object if supported (nice-to-have)
document.addEventListener("DOMContentLoaded", () => {
  initRecognition();
});
