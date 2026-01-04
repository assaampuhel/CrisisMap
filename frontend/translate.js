// frontend/translate.js
// Robust translator glue: tries Google Translate widget first, falls back to server-side batch translate.
// Usage: ensure a <select id="pageTranslateSelect"> exists in the page header.
// Fallback requires backend /api/translate/batch (POST { target, texts: [...] } -> { translations: [...] }).

(function () {
  const LOG = (...a) => { try { console.debug("[translate.js]", ...a); } catch(e){} };

  // Load Google Translate widget script (if available)
  function loadGTranslateScript(timeout = 4000) {
    return new Promise((resolve) => {
      if (window.google && window.google.translate) {
        resolve(true);
        return;
      }
      // create callback expected by google script
      window.googleTranslateElementInit = function () {
        LOG("googleTranslateElementInit called");
        resolve(true);
      };
      const s = document.createElement("script");
      s.src = "//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
      s.async = true;
      s.defer = true;
      s.onload = () => {
        LOG("translate script loaded (onload)");
        // callback may already fire
      };
      s.onerror = () => {
        LOG("translate script load error");
      };
      document.head.appendChild(s);
      // timeout - if widget not ready after timeout, resolve false
      setTimeout(() => {
        if (window.google && window.google.translate) resolve(true);
        else resolve(false);
      }, timeout);
    });
  }

  // Initialize hidden translate element (Google widget)
  function initHiddenTranslateElement() {
    if (document.getElementById("google_translate_element")) return;
    const div = document.createElement("div");
    div.id = "google_translate_element";
    div.style.display = "none";
    document.body.appendChild(div);
    try {
      new window.google.translate.TranslateElement({
        pageLanguage: 'en',
        autoDisplay: false
      }, 'google_translate_element');
      LOG("Initialized google translate element");
    } catch (e) {
      LOG("Error init Google Translate element:", e);
    }
  }

  // Try to set the language in the injected combo box
  function trySetWidgetLanguage(langCode) {
    LOG("trySetWidgetLanguage", langCode);
    return new Promise((resolve) => {
      if (!(window.google && window.google.translate)) {
        resolve(false);
        return;
      }
      // Attempt to find .goog-te-combo (injected select)
      let attempts = 0;
      const maxAttempts = 20;
      const interval = setInterval(() => {
        attempts++;
        const combo = document.querySelector(".goog-te-combo");
        if (combo) {
          try {
            combo.value = langCode;
            combo.dispatchEvent(new Event("change"));
            LOG("Widget language set via goog-te-combo:", langCode);
            clearInterval(interval);
            setTimeout(() => resolve(true), 600);
            return;
          } catch (e) {
            LOG("Failed to set combo value", e);
          }
        }
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          LOG("goog-te-combo not found after attempts");
          resolve(false);
        }
      }, 200);
    });
  }

  // Hide injected Google UI/banner if present
  function hideInjectedUI() {
    try {
      const selectors = [
        ".goog-te-banner-frame",
        ".goog-te-banner-frame.skiptranslate",
        ".goog-logo-link",
        ".goog-te-gadget",
        "#goog-gt-tt",
        ".goog-te-spinner-pos",
        "iframe.goog-te-banner-frame"
      ];
      selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(n => {
          try { n.style.display = "none"; } catch(e) {}
        });
      });
      
      // --- NEW FIX: FORCE BODY TO TOP ---
      if (document.body.style.top !== "0px") {
        document.body.style.top = "0px";
        document.body.style.position = "static";
      }
      // ----------------------------------

      document.querySelectorAll("iframe").forEach(ifr => {
        try {
          const src = ifr.getAttribute("src") || "";
          if (src.includes("translate.google") || src.includes("translate.googleusercontent")) {
            ifr.style.display = "none";
          }
        } catch(e){}
      });
    } catch(e){ LOG("hideInjectedUI error", e) }
  }

  // Observe DOM and keep hiding elements that reappear
  function observeHide() {
    try {
      const mo = new MutationObserver(() => hideInjectedUI());
      mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
      hideInjectedUI();
      // a few repeat attempts
      let n=0;
      const id = setInterval(()=>{ hideInjectedUI(); if(++n>6) clearInterval(id); }, 700);
    } catch(e){ LOG("observeHide error", e) }
  }

  function collectTranslatableNodes() {
    // We will translate nodes which have visible text and are not inputs/scripts/styles
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        const tag = node.tagName && node.tagName.toLowerCase();
        if (!tag) return NodeFilter.FILTER_REJECT;
        const rejectTags = new Set(['script','style','noscript','iframe','svg','canvas','input','textarea','select','option','button']);
        if (rejectTags.has(tag)) return NodeFilter.FILTER_REJECT;
        // skip elements with no visible text
        const txt = (node.innerText || "").trim();
        if (!txt) return NodeFilter.FILTER_REJECT;
        // ignore nodes that contain only child elements (no own text)
        // but still we'll accept if innerText length small or contains letters
        return NodeFilter.FILTER_ACCEPT;
      }
    }, false);
    const nodes = [];
    while(walker.nextNode()) {
      nodes.push(walker.currentNode);
    }
    return nodes;
  }

  // Build an array of original texts to send to server
  function buildTextsAndStore(nodes) {
    const texts = [];
    nodes.forEach((el, idx) => {
      // store original so we can restore later
      if (!el.dataset._origText) {
        el.dataset._origText = el.innerText;
      }
      // use innerText (keeps order of text, excludes hidden contents)
      texts.push(el.innerText);
    });
    return texts;
  }

  // Apply translations to collected nodes in order
  function applyTranslations(nodes, translations) {
    if (!nodes || !translations) return;
    for (let i = 0; i < nodes.length && i < translations.length; i++) {
      try {
        nodes[i].innerText = translations[i];
      } catch (e) {
        // fallback: set textContent
        try { nodes[i].textContent = translations[i]; } catch(_) {}
      }
    }
  }

  // Restore originals
  function restoreOriginals(nodes) {
    nodes.forEach(el => {
      if (el.dataset._origText) el.innerText = el.dataset._origText;
    });
  }

  // Call server-side batch translate endpoint
  async function serverTranslate(nodes, targetLang) {
    if (!nodes || nodes.length === 0) return false;
    const MAX_BATCH_CHARS = 18000; // safety
    const texts = buildTextsAndStore(nodes);
    // chunk by char count
    const chunks = [];
    let cur = [], curLen = 0;
    for (const t of texts) {
      const s = t || "";
      if (curLen + s.length > MAX_BATCH_CHARS && cur.length) {
        chunks.push(cur);
        cur = [];
        curLen = 0;
      }
      cur.push(s);
      curLen += s.length;
    }
    if (cur.length) chunks.push(cur);

    const allTranslations = [];
    for (const chunk of chunks) {
      try {
        const res = await fetch("/api/translate/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: targetLang, texts: chunk })
        });
        if (!res.ok) {
          const t = await res.text();
          LOG("Server translate error:", res.status, t);
          return false;
        }
        const j = await res.json();
        if (!j.translations || !Array.isArray(j.translations)) {
          LOG("Server returned no translations:", j);
          return false;
        }
        allTranslations.push(...j.translations);
      } catch (err) {
        LOG("Server translate fetch failed:", err);
        return false;
      }
    }
    applyTranslations(nodes, allTranslations);
    return true;
  }

  // ----------------------------
  // Orchestration for a user selection
  // ----------------------------
  async function onSelectLanguage(lang) {
    LOG("Requested language:", lang);
    const sel = document.getElementById("pageTranslateSelect");
    if (!lang) {
      // restore originals
      const nodes = collectTranslatableNodes();
      restoreOriginals(nodes);
      LOG("Restored original text");
      return;
    }

    hideInjectedUI();

    // 1) try widget path
    const scriptLoaded = await loadGTranslateScript(3500);
    if (scriptLoaded && window.google && window.google.translate) {
      try {
        initHiddenTranslateElement();
        const ok = await trySetWidgetLanguage(lang);
        if (ok) {
          hideInjectedUI();
          observeHide();
          LOG("Translation performed by Google widget");
          return;
        }
      } catch (e) {
        LOG("Widget path failed:", e);
      }
    } else {
      LOG("Widget script not available or blocked; attempting fallback");
    }

    // 2) fallback: server-side translation of visible text nodes
    const nodes = collectTranslatableNodes();
    if (nodes.length === 0) {
      LOG("No nodes to translate (fallback)");
      return;
    }
    // show small UI hint
    const prevTitle = document.title;
    document.title = `Translating… (${lang}) ${prevTitle}`;
    const ok = await serverTranslate(nodes, lang);
    document.title = prevTitle;
    if (ok) {
      LOG("Server-side translation applied");
      return;
    } else {
      LOG("Server-side translation failed; restore originals");
      restoreOriginals(nodes);
      alert("Translation failed (server). Check console and backend /api/translate/batch.");
    }
  }

  // Wire dropdown with id 'pageTranslateSelect'
  function wireDropdown() {
    const sel = document.getElementById("pageTranslateSelect");
    if (!sel) {
      LOG("pageTranslateSelect not found — no wiring");
      return;
    }
    sel.addEventListener("change", (e) => {
      const v = (e.target.value || "").trim();
      // google widget expects codes like 'hi', 'ta', 'en', 'en-GB' works too; server expects same target codes
      onSelectLanguage(v);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    wireDropdown();
    // attempt lazy load of translate script to reduce first click latency
    loadGTranslateScript(2500).then(ok => {
      if (ok) {
        initHiddenTranslateElement();
        hideInjectedUI();
      } else {
        LOG("Lazy load of Google Translate script failed/blocked (this is normal on adblockers)");
      }
    });
  });

  // expose helper for manual set from console
  window._crisisTranslate = { onSelectLanguage, loadGTranslateScript, trySetWidgetLanguage, serverTranslate };
})();

function collectTranslatableNodes() {
    // We will translate nodes which have visible text and are not inputs/scripts/styles
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        // 1. Check if the element itself or any parent has 'notranslate'
        if (node.classList && node.classList.contains('notranslate')) return NodeFilter.FILTER_REJECT;
        if (node.closest('.notranslate')) return NodeFilter.FILTER_REJECT;

        const tag = node.tagName && node.tagName.toLowerCase();
        if (!tag) return NodeFilter.FILTER_REJECT;
        const rejectTags = new Set(['script','style','noscript','iframe','svg','canvas','input','textarea','select','option','button']);
        if (rejectTags.has(tag)) return NodeFilter.FILTER_REJECT;

        // skip elements with no visible text
        const txt = (node.innerText || "").trim();
        if (!txt) return NodeFilter.FILTER_REJECT;
        
        return NodeFilter.FILTER_ACCEPT;
      }
    }, false);
    const nodes = [];
    while(walker.nextNode()) {
      nodes.push(walker.currentNode);
    }
    return nodes;
  }