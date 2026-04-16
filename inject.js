const STORAGE_KEY = "btw_enabled";
const BYPASS_KEY = "btw_site_bypass_until";
const BYPASS_ATTEMPTS_KEY = "btw_bypass_attempts";
const OVERLAY_ID = "btw-block-overlay";
const MAX_BYPASS_ATTEMPTS = 3;
let bypassTimeoutId = null;

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function cleanupExpiredBypasses(bypassMap) {
  const now = Date.now();
  const cleaned = {};
  let changed = false;

  Object.entries(bypassMap || {}).forEach(([host, until]) => {
    if (typeof until === "number" && until > now) {
      cleaned[host] = until;
    } else {
      changed = true;
    }
  });

  return { cleaned, changed };
}

function cleanupAttemptEntries(attemptsMap) {
  const today = getTodayKey();
  const cleaned = {};
  let changed = false;

  Object.entries(attemptsMap || {}).forEach(([host, entry]) => {
    const isValid =
      entry &&
      typeof entry === "object" &&
      entry.day === today &&
      typeof entry.count === "number" &&
      entry.count > 0;

    if (isValid) {
      cleaned[host] = { day: today, count: Math.min(MAX_BYPASS_ATTEMPTS, Math.floor(entry.count)) };
      if (cleaned[host].count !== entry.count) {
        changed = true;
      }
      return;
    }

    if (entry !== undefined) {
      changed = true;
    }
  });

  return { cleaned, changed };
}

function getAttemptCountForHost(attemptsMap, hostname) {
  const today = getTodayKey();
  const entry = attemptsMap[hostname];

  if (!entry || entry.day !== today || typeof entry.count !== "number") {
    return 0;
  }

  return Math.max(0, Math.min(MAX_BYPASS_ATTEMPTS, Math.floor(entry.count)));
}

function clearBypassTimer() {
  if (bypassTimeoutId !== null) {
    window.clearTimeout(bypassTimeoutId);
    bypassTimeoutId = null;
  }
}

function syncBypassTimer(enabled, bypassMap) {
  clearBypassTimer();

  if (enabled === false) {
    return;
  }

  const until = bypassMap[window.location.hostname];
  if (typeof until !== "number") {
    return;
  }

  const delay = Math.max(0, until - Date.now());
  bypassTimeoutId = window.setTimeout(() => {
    bypassTimeoutId = null;
    loadAndApplyState();
  }, delay);
}

function updateOverlayAttemptMessage(overlay, attemptsMap) {
  const statusEl = overlay.querySelector("#btw-bypass-status");
  if (!statusEl) {
    return;
  }

  const used = getAttemptCountForHost(attemptsMap, window.location.hostname);
  const remaining = Math.max(0, MAX_BYPASS_ATTEMPTS - used);

  if (remaining > 0) {
    statusEl.textContent = `Bypass attempts left today: ${remaining}/${MAX_BYPASS_ATTEMPTS}`;
  } else {
    statusEl.textContent = `Daily bypass limit reached (${MAX_BYPASS_ATTEMPTS}/${MAX_BYPASS_ATTEMPTS}).`;
  }
}

function setOverlayButtonState(overlay, attemptsMap) {
  const used = getAttemptCountForHost(attemptsMap, window.location.hostname);
  const canBypass = used < MAX_BYPASS_ATTEMPTS;

  const bypassButtons = overlay.querySelectorAll("[data-bypass-minutes]");
  bypassButtons.forEach((button) => {
    button.disabled = !canBypass;
    button.style.opacity = canBypass ? "1" : "0.6";
    button.style.cursor = canBypass ? "pointer" : "not-allowed";
  });

  updateOverlayAttemptMessage(overlay, attemptsMap);
}

function pauseActiveMedia() {
  document.querySelectorAll("video, audio").forEach((mediaElement) => {
    mediaElement.pause();
  });
}

function removeOverlay() {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    existing.remove();
    document.documentElement.style.overflow = "";
  }
}

function setTemporaryBypass(minutes) {
  const durationMs = minutes * 60 * 1000;

  chrome.storage.local.get({ [BYPASS_KEY]: {}, [BYPASS_ATTEMPTS_KEY]: {} }, (result) => {
    const bypassMap = result[BYPASS_KEY] || {};
    const attemptsMap = result[BYPASS_ATTEMPTS_KEY] || {};

    const { cleaned: cleanedBypass } = cleanupExpiredBypasses(bypassMap);
    const { cleaned: cleanedAttempts } = cleanupAttemptEntries(attemptsMap);

    const hostname = window.location.hostname;
    const used = getAttemptCountForHost(cleanedAttempts, hostname);

    if (used >= MAX_BYPASS_ATTEMPTS) {
      const overlay = document.getElementById(OVERLAY_ID);
      if (overlay) {
        setOverlayButtonState(overlay, cleanedAttempts);
      }
      return;
    }

    const today = getTodayKey();
    const updatedAttempts = {
      ...cleanedAttempts,
      [hostname]: { day: today, count: used + 1 }
    };

    cleanedBypass[hostname] = Date.now() + durationMs;

    chrome.storage.local.set(
      {
        [BYPASS_KEY]: cleanedBypass,
        [BYPASS_ATTEMPTS_KEY]: updatedAttempts
      },
      () => {
        removeOverlay();
        window.location.reload();
      }
    );
  });
}

function addOverlay() {
  if (document.getElementById(OVERLAY_ID)) {
    return;
  }

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.setAttribute(
    "style",
    [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "background:linear-gradient(135deg,#fdf2f2,#ffe4e6)",
      "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
      "color:#111827",
      "text-align:center",
      "padding:24px"
    ].join(";")
  );

  overlay.innerHTML = `
    <div style="max-width:560px;background:#ffffff;border:1px solid #fecaca;border-radius:16px;padding:28px;box-shadow:0 10px 30px rgba(0,0,0,0.12)">
      <h1 style="margin:0 0 10px;font-size:36px;line-height:1.1;color:#991b1b">Back to Work</h1>
      <p style="margin:0;font-size:18px;line-height:1.5;color:#374151">
        This site is blocked so you can stay focused.
      </p>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:16px;flex-wrap:wrap">
        <button type="button" data-bypass-minutes="5" style="border:1px solid #fca5a5;background:#fff1f2;color:#9f1239;border-radius:8px;padding:8px 12px;cursor:pointer">Bypass 5m</button>
        <button type="button" data-bypass-minutes="15" style="border:1px solid #fca5a5;background:#fff1f2;color:#9f1239;border-radius:8px;padding:8px 12px;cursor:pointer">Bypass 15m</button>
        <button type="button" data-bypass-minutes="30" style="border:1px solid #fca5a5;background:#fff1f2;color:#9f1239;border-radius:8px;padding:8px 12px;cursor:pointer">Bypass 30m</button>
      </div>
      <p id="btw-bypass-status" style="margin:10px 0 0;font-size:13px;line-height:1.4;color:#9f1239"></p>
    </div>
  `;

  document.documentElement.style.overflow = "hidden";
  document.documentElement.appendChild(overlay);
  pauseActiveMedia();

  chrome.storage.local.get({ [BYPASS_ATTEMPTS_KEY]: {} }, (result) => {
    const { cleaned, changed } = cleanupAttemptEntries(result[BYPASS_ATTEMPTS_KEY] || {});

    if (changed) {
      chrome.storage.local.set({ [BYPASS_ATTEMPTS_KEY]: cleaned });
    }

    setOverlayButtonState(overlay, cleaned);
  });

  const bypassButtons = overlay.querySelectorAll("[data-bypass-minutes]");
  bypassButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const minutes = Number(button.getAttribute("data-bypass-minutes"));
      if (!Number.isFinite(minutes) || minutes <= 0) {
        return;
      }
      setTemporaryBypass(minutes);
    });
  });
}

function isBypassed(hostname, bypassMap) {
  const until = bypassMap[hostname];
  return typeof until === "number" && until > Date.now();
}

function applyState(enabled, bypassMap) {
  if (enabled === false || isBypassed(window.location.hostname, bypassMap)) {
    removeOverlay();
    return;
  }

  addOverlay();
}

function loadAndApplyState() {
  chrome.storage.local.get({ [STORAGE_KEY]: true, [BYPASS_KEY]: {}, [BYPASS_ATTEMPTS_KEY]: {} }, (result) => {
    const bypassMap = result[BYPASS_KEY] || {};
    const attemptsMap = result[BYPASS_ATTEMPTS_KEY] || {};

    const { cleaned: cleanedBypass, changed: bypassChanged } = cleanupExpiredBypasses(bypassMap);
    const { cleaned: cleanedAttempts, changed: attemptsChanged } = cleanupAttemptEntries(attemptsMap);

    if (bypassChanged || attemptsChanged) {
      chrome.storage.local.set({
        [BYPASS_KEY]: cleanedBypass,
        [BYPASS_ATTEMPTS_KEY]: cleanedAttempts
      });
    }

    syncBypassTimer(result[STORAGE_KEY], cleanedBypass);
    applyState(result[STORAGE_KEY], cleanedBypass);

    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
      setOverlayButtonState(overlay, cleanedAttempts);
    }
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (!changes[STORAGE_KEY] && !changes[BYPASS_KEY] && !changes[BYPASS_ATTEMPTS_KEY]) {
    return;
  }

  loadAndApplyState();
});

document.addEventListener("play", (event) => {
  if (!document.getElementById(OVERLAY_ID)) {
    return;
  }

  if (event.target instanceof HTMLMediaElement) {
    event.target.pause();
  }
}, true);

window.addEventListener("focus", loadAndApplyState);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    loadAndApplyState();
  }
});

loadAndApplyState();
