const STORAGE_KEY = "btw_enabled";
const BYPASS_KEY = "btw_site_bypass_until";
const BYPASS_ATTEMPTS_KEY = "btw_bypass_attempts";
const MAX_BYPASS_ATTEMPTS = 3;

const enabledToggle = document.getElementById("enabled");
const hostnameEl = document.getElementById("hostname");
const statusEl = document.getElementById("status");
const bypassStatusEl = document.getElementById("bypassStatus");
const bypassButtons = Array.from(document.querySelectorAll(".bypass-btn"));
const clearBypassButton = document.getElementById("clearBypass");

let activeHostname = null;

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function setBypassStatus(text) {
  bypassStatusEl.textContent = text;
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

function formatRemaining(until) {
  const remainingMs = Math.max(0, until - Date.now());
  const minutes = Math.ceil(remainingMs / 60000);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function setBypassButtonsEnabled(enabled) {
  bypassButtons.forEach((button) => {
    button.disabled = !enabled;
  });
}

function renderBypassStatus(bypassMap, attemptsMap) {
  if (!activeHostname) {
    setBypassButtonsEnabled(false);
    clearBypassButton.disabled = true;
    setBypassStatus("Open a blocked site tab to use temporary bypass.");
    return;
  }

  clearBypassButton.disabled = false;

  const used = getAttemptCountForHost(attemptsMap, activeHostname);
  const remainingAttempts = Math.max(0, MAX_BYPASS_ATTEMPTS - used);
  setBypassButtonsEnabled(remainingAttempts > 0);

  const until = bypassMap[activeHostname];
  if (typeof until === "number" && until > Date.now()) {
    setBypassStatus(
      `Bypass active for ${formatRemaining(until)}. Attempts left today: ${remainingAttempts}/${MAX_BYPASS_ATTEMPTS}.`
    );
    return;
  }

  if (remainingAttempts === 0) {
    setBypassStatus(`Daily bypass limit reached (${MAX_BYPASS_ATTEMPTS}/${MAX_BYPASS_ATTEMPTS}).`);
    return;
  }

  setBypassStatus(`No temporary bypass active. Attempts left today: ${remainingAttempts}/${MAX_BYPASS_ATTEMPTS}.`);
}

function withStorage(callback) {
  chrome.storage.local.get(
    {
      [STORAGE_KEY]: true,
      [BYPASS_KEY]: {},
      [BYPASS_ATTEMPTS_KEY]: {}
    },
    (result) => {
      const { cleaned: cleanedBypass, changed: bypassChanged } = cleanupExpiredBypasses(result[BYPASS_KEY]);
      const { cleaned: cleanedAttempts, changed: attemptsChanged } = cleanupAttemptEntries(result[BYPASS_ATTEMPTS_KEY]);

      if (bypassChanged || attemptsChanged) {
        chrome.storage.local.set(
          {
            [BYPASS_KEY]: cleanedBypass,
            [BYPASS_ATTEMPTS_KEY]: cleanedAttempts
          },
          () => {
            callback(result[STORAGE_KEY], cleanedBypass, cleanedAttempts);
          }
        );
        return;
      }

      callback(result[STORAGE_KEY], cleanedBypass, cleanedAttempts);
    }
  );
}

function loadState() {
  withStorage((enabled, bypassMap, attemptsMap) => {
    enabledToggle.checked = Boolean(enabled);
    setStatus(enabledToggle.checked ? "Blocking is active." : "Blocking is paused.");
    renderBypassStatus(bypassMap, attemptsMap);
  });
}

function resolveActiveTabHost() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabUrl = tabs[0] && tabs[0].url;

    try {
      const url = new URL(tabUrl);
      activeHostname = url.hostname;
      hostnameEl.textContent = activeHostname;
    } catch (_error) {
      activeHostname = null;
      hostnameEl.textContent = "Unsupported tab";
    }

    loadState();
  });
}

enabledToggle.addEventListener("change", () => {
  const enabled = enabledToggle.checked;
  chrome.storage.local.set({ [STORAGE_KEY]: enabled }, () => {
    setStatus(enabled ? "Blocking is active." : "Blocking is paused.");
  });
});

bypassButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!activeHostname) {
      return;
    }

    const minutes = Number(button.dataset.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return;
    }

    withStorage((_enabled, bypassMap, attemptsMap) => {
      const used = getAttemptCountForHost(attemptsMap, activeHostname);
      if (used >= MAX_BYPASS_ATTEMPTS) {
        renderBypassStatus(bypassMap, attemptsMap);
        return;
      }

      const until = Date.now() + minutes * 60 * 1000;
      const today = getTodayKey();

      const updatedBypass = { ...bypassMap, [activeHostname]: until };
      const updatedAttempts = {
        ...attemptsMap,
        [activeHostname]: {
          day: today,
          count: used + 1
        }
      };

      chrome.storage.local.set(
        {
          [BYPASS_KEY]: updatedBypass,
          [BYPASS_ATTEMPTS_KEY]: updatedAttempts
        },
        () => {
          renderBypassStatus(updatedBypass, updatedAttempts);
        }
      );
    });
  });
});

clearBypassButton.addEventListener("click", () => {
  if (!activeHostname) {
    return;
  }

  withStorage((_enabled, bypassMap, attemptsMap) => {
    if (!bypassMap[activeHostname]) {
      renderBypassStatus(bypassMap, attemptsMap);
      return;
    }

    const updatedBypass = { ...bypassMap };
    delete updatedBypass[activeHostname];

    chrome.storage.local.set({ [BYPASS_KEY]: updatedBypass }, () => {
      renderBypassStatus(updatedBypass, attemptsMap);
    });
  });
});

setBypassButtonsEnabled(false);
clearBypassButton.disabled = true;
resolveActiveTabHost();
