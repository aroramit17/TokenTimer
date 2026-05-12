const FIVE_HOURS = 5 * 60 * 60 * 1000;
const STORAGE_KEY = "usage-reset-timers";
const SETTINGS_KEY = "usage-reset-settings";
const THEME_KEY = "tokentimer-theme";
const DEFAULT_TITLE = "TokenTimer";
const SOON_THRESHOLD = 30 * 60 * 1000;
const BLINK_THRESHOLD = 60 * 1000;
const ALERT_COLOR = "#22c55e";

const TIMER_CONFIG = {
  codex: {
    label: "Codex",
    short: "Cx",
    color: "#2563eb",
  },
  claude: {
    label: "Claude",
    short: "Cl",
    color: "#f97316",
  },
};

const state = loadState();
const settings = loadSettings();
normalizeSettings();
const timerEls = new Map();
const themeToggle = document.getElementById("theme-toggle");
const themeLabel = document.querySelector("[data-theme-label]");
const themeMeta = document.querySelector("meta[name='theme-color']");
const shareButton = document.getElementById("share-site");

applyTheme(getStoredTheme());

document.querySelectorAll("[data-timer]").forEach((card) => {
  const id = card.dataset.timer;
  timerEls.set(id, {
    card,
    form: card.querySelector("[data-form]"),
    manualForm: card.querySelector("[data-manual-form]"),
    input: card.querySelector("[name='resetText']"),
    hoursInput: card.querySelector("[name='hours']"),
    minutesInput: card.querySelector("[name='minutes']"),
    ring: card.querySelector("[data-ring]"),
    countdown: card.querySelector("[data-countdown]"),
    subtitle: card.querySelector("[data-subtitle]"),
    status: card.querySelector("[data-status]"),
    tabToggle: card.querySelector("[data-tab-toggle]"),
    modeInputs: card.querySelectorAll("[data-mode-toggle] input"),
    hourHand: card.querySelector("[data-hour-hand]"),
    minuteHand: card.querySelector("[data-minute-hand]"),
    secondHand: card.querySelector("[data-second-hand]"),
    resetMarker: card.querySelector("[data-reset-marker]"),
    quickButtons: card.querySelectorAll("[data-quick-minutes]"),
    swatchButtons: card.querySelectorAll("[data-swatch]"),
  });
});

timerEls.forEach((els, id) => {
  applyAccent(id, settings[id]?.color || TIMER_CONFIG[id].color);
  els.tabToggle.checked = settings[id]?.showInTab !== false;
  applyClockMode(id, settings[id]?.clockMode || "digital");

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    startTimerFromText(id, els.input.value);
  });

  els.manualForm.addEventListener("submit", (event) => {
    event.preventDefault();
    startTimerFromManualInputs(id);
  });

  els.input.addEventListener("paste", () => {
    window.setTimeout(() => {
      const reset = parseResetText(els.input.value);
      if (reset) {
        startTimer(id, reset);
      }
    });
  });

  els.quickButtons.forEach((button) => {
    button.addEventListener("click", () => {
      startTimer(id, Number(button.dataset.quickMinutes) * 60 * 1000);
    });
  });

  els.swatchButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setAccent(id, button.dataset.swatch);
    });
  });

  els.tabToggle.addEventListener("change", () => {
    setTabVisibility(id, els.tabToggle.checked);
  });

  els.modeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) {
        setClockMode(id, input.value);
      }
    });
  });
});

document.querySelectorAll("[data-example]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = getPreferredInput();
    target.value = button.dataset.example;
    target.focus();
  });
});

prefillResetTextFromUrl();

document.getElementById("reset-all").addEventListener("click", () => {
  Object.keys(TIMER_CONFIG).forEach((id) => delete state[id]);
  saveState();
  timerEls.forEach((els) => {
    els.input.value = "";
    els.hoursInput.value = "";
    els.minutesInput.value = "";
  });
  render();
});

document.addEventListener("click", (event) => {
  const toggle = event.target.closest("#theme-toggle");
  if (!toggle) return;

  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
});

shareButton.addEventListener("click", shareSite);

render();
window.setInterval(render, 1000);

function startTimerFromText(id, text) {
  const reset = parseResetText(text);
  const els = timerEls.get(id);

  if (!reset) {
    els.input.setCustomValidity("Try text like: Resets in 42 min, Resets 1:57 PM, 1h 20m, or 5 hours.");
    els.input.reportValidity();
    window.setTimeout(() => els.input.setCustomValidity(""), 1600);
    return;
  }

  startTimer(id, reset);
}

function startTimerFromManualInputs(id) {
  const els = timerEls.get(id);
  const hours = parseWholeNumber(els.hoursInput.value);
  const minutes = parseWholeNumber(els.minutesInput.value);
  const duration = ((hours * 60) + minutes) * 60 * 1000;

  if (hours > 99 || minutes > 59) {
    els.minutesInput.setCustomValidity("Use 0-99 hours and 0-59 minutes.");
    els.minutesInput.reportValidity();
    window.setTimeout(() => els.minutesInput.setCustomValidity(""), 1600);
    return;
  }

  if (duration <= 0) {
    els.minutesInput.setCustomValidity("Enter at least 1 minute.");
    els.minutesInput.reportValidity();
    window.setTimeout(() => els.minutesInput.setCustomValidity(""), 1600);
    return;
  }

  startTimer(id, { duration });
}

function startTimer(id, reset) {
  const now = Date.now();
  const duration = typeof reset === "number" ? reset : reset.duration;
  const endsAt = reset.endsAt || (now + duration);

  state[id] = {
    startedAt: now,
    endsAt,
    durationMs: Math.max(1000, endsAt - now),
    cycleMs: FIVE_HOURS,
  };
  saveState();

  const els = timerEls.get(id);
  els.input.value = "";
  els.hoursInput.value = "";
  els.minutesInput.value = "";
  render();
}

function parseResetText(text) {
  const source = String(text || "").toLowerCase().replace(/,/g, " ").trim();
  const absoluteTime = parseAbsoluteClockTime(source);
  if (absoluteTime) {
    return absoluteTime;
  }

  let total = 0;
  const unitPattern = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|h|minutes?|mins?|min|m|seconds?|secs?|sec|s)\b/g;
  let match;

  while ((match = unitPattern.exec(source))) {
    const value = Number(match[1]);
    const unit = match[2];

    if (unit.startsWith("h")) total += value * 60 * 60 * 1000;
    else if (unit.startsWith("m")) total += value * 60 * 1000;
    else if (unit.startsWith("s")) total += value * 1000;
  }

  if (!total) {
    const colon = source.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
    if (colon) {
      const first = Number(colon[1]);
      const second = Number(colon[2]);
      const third = Number(colon[3] || 0);
      total = colon[3]
        ? (first * 60 * 60 * 1000) + (second * 60 * 1000) + (third * 1000)
        : (first * 60 * 1000) + (second * 1000);
    }
  }

  return total > 0 ? { duration: total } : null;
}

function parseAbsoluteClockTime(source) {
  const clock = source.match(/\b(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)\b/i);
  if (!clock) return null;

  let hours = Number(clock[1]);
  const minutes = Number(clock[2] || 0);
  const meridiem = clock[3].replace(/\./g, "");

  if (hours < 1 || hours > 12 || minutes > 59) return null;
  if (meridiem === "pm" && hours !== 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;

  const now = new Date();
  const endsAt = new Date(now);
  endsAt.setHours(hours, minutes, 0, 0);

  if (endsAt.getTime() <= now.getTime()) {
    endsAt.setDate(endsAt.getDate() + 1);
  }

  return {
    endsAt: endsAt.getTime(),
    duration: endsAt.getTime() - now.getTime(),
  };
}

function normalizeTimer(timer, now) {
  if (!timer) return null;

  const cycleMs = timer.cycleMs || FIVE_HOURS;
  timer.durationMs = timer.durationMs || cycleMs;
  timer.startedAt = timer.startedAt || (timer.endsAt - timer.durationMs);

  if (timer.endsAt <= now) {
    const missedCycles = Math.floor((now - timer.endsAt) / cycleMs) + 1;
    const previousEndsAt = timer.endsAt;
    timer.endsAt = previousEndsAt + (missedCycles * cycleMs);
    timer.startedAt = timer.endsAt - cycleMs;
    timer.durationMs = cycleMs;
    timer.cycleMs = cycleMs;
    saveState();
  }

  return timer;
}

function render() {
  const now = Date.now();
  const active = [];

  Object.keys(TIMER_CONFIG).forEach((id) => {
    const timer = normalizeTimer(state[id], now);
    const els = timerEls.get(id);

    if (!timer) {
      renderEmpty(els);
      return;
    }

    const remaining = Math.max(0, timer.endsAt - now);
    const duration = Math.max(1000, timer.durationMs || timer.cycleMs || FIVE_HOURS);
    const progress = (now - timer.startedAt) / duration;
    const endsAt = new Date(timer.endsAt);

    els.card.classList.toggle("is-expired", remaining <= 1000);
    els.card.classList.add("is-running");
    els.countdown.textContent = formatDuration(remaining);
    els.subtitle.textContent = `Resets at ${formatClockTime(endsAt)}`;
    els.status.textContent = "Running";
    els.ring.style.setProperty("--progress", `${Math.max(0, Math.min(1, progress)) * 360}deg`);
    renderAnalogClock(els, now, timer.endsAt);

    active.push({
      id,
      remaining,
      progress,
      color: getAccent(id),
      short: TIMER_CONFIG[id].short,
    });
  });

  renderDocumentChrome(active);
}

function setAccent(id, color) {
  if (!color) return;
  settings[id] = {
    ...settings[id],
    color,
  };
  saveSettings();
  applyAccent(id, color);
  render();
}

function setTabVisibility(id, showInTab) {
  settings[id] = {
    ...settings[id],
    showInTab,
  };
  saveSettings();
  render();
}

function setClockMode(id, clockMode) {
  settings[id] = {
    ...settings[id],
    clockMode,
  };
  saveSettings();
  applyClockMode(id, clockMode);
}

function applyClockMode(id, clockMode) {
  const els = timerEls.get(id);
  const nextMode = clockMode === "analog" ? "analog" : "digital";
  if (!els) return;

  els.card.dataset.clockMode = nextMode;
  els.modeInputs.forEach((input) => {
    input.checked = input.value === nextMode;
  });
}

function getAccent(id) {
  return settings[id]?.color || TIMER_CONFIG[id].color;
}

function applyAccent(id, color) {
  const els = timerEls.get(id);
  if (!els) return;

  els.card.style.setProperty("--accent", color);
  els.swatchButtons.forEach((button) => {
    const isSelected = button.dataset.swatch.toLowerCase() === color.toLowerCase();
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });
}

function renderEmpty(els) {
  els.card.classList.remove("is-expired");
  els.card.classList.remove("is-running");
  els.card.dataset.clockMode = els.card.dataset.clockMode || "digital";
  els.countdown.textContent = "--:--";
  els.subtitle.textContent = "Paste a reset";
  els.status.textContent = "Idle";
  els.ring.style.setProperty("--progress", "0deg");
  renderAnalogClock(els, Date.now(), null);
}

function renderDocumentChrome(active) {
  const visible = active.filter((timer) => settings[timer.id]?.showInTab !== false);

  if (!visible.length) {
    document.title = DEFAULT_TITLE;
    drawFavicon([]);
    return;
  }

  visible.sort((a, b) => a.remaining - b.remaining);
  const soonest = visible[0].remaining;
  const isBlinking = soonest <= BLINK_THRESHOLD;
  const isSoon = soonest <= SOON_THRESHOLD;
  const blinkOn = Math.floor(Date.now() / 1000) % 2 === 0;
  const title = visible.map((timer) => `${formatCompact(timer.remaining)} ${timer.short}`).join(" | ");

  document.title = isBlinking && blinkOn ? `RESET SOON | ${title}` : title;
  drawFavicon(visible, {
    alertColor: isSoon ? ALERT_COLOR : null,
    blink: isBlinking && blinkOn,
  });
}

function getPreferredInput() {
  const activeElement = document.activeElement;
  if (activeElement?.matches?.("[name='resetText']")) {
    return activeElement;
  }

  return timerEls.get("codex").input;
}

function prefillResetTextFromUrl() {
  const resetText = new URLSearchParams(window.location.search).get("resetText");
  if (!resetText) return;

  timerEls.forEach((els) => {
    els.input.value = resetText;
  });
}

function renderAnalogClock(els, nowMs, resetMs) {
  const now = new Date(nowMs);
  const seconds = now.getSeconds();
  const minutes = now.getMinutes();
  const hours = now.getHours() % 12;

  const secondAngle = (seconds * 6) - 90;
  const minuteAngle = ((minutes + (seconds / 60)) * 6) - 90;
  const hourAngle = ((hours + (minutes / 60)) * 30) - 90;

  els.secondHand.style.transform = `rotate(${secondAngle}deg)`;
  els.minuteHand.style.transform = `rotate(${minuteAngle}deg)`;
  els.hourHand.style.transform = `rotate(${hourAngle}deg)`;

  if (!resetMs) {
    els.resetMarker.style.opacity = "0";
    return;
  }

  const reset = new Date(resetMs);
  const resetHours = reset.getHours() % 12;
  const resetMinutes = reset.getMinutes();
  const resetAngle = ((resetHours + (resetMinutes / 60)) * 30) - 90;
  els.resetMarker.style.opacity = "";
  els.resetMarker.style.transform = `rotate(${resetAngle}deg) translateX(88px) translate(-50%, -50%)`;
}

async function shareSite() {
  const shareData = {
    title: "TokenTimer",
    text: "Track Codex and Claude usage reset timers.",
    url: window.location.href.split("#")[0],
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
    } else {
      await navigator.clipboard.writeText(shareData.url);
      flashShareLabel("Copied");
    }
  } catch (error) {
    if (error?.name !== "AbortError") {
      flashShareLabel("Unable");
    }
  }
}

function flashShareLabel(label) {
  const original = shareButton.textContent;
  shareButton.textContent = label;
  window.setTimeout(() => {
    shareButton.textContent = original;
  }, 1600);
}

function drawFavicon(active, options = {}) {
  const canvas = document.createElement("canvas");
  const size = 128;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, size, size);
  const styles = getComputedStyle(document.documentElement);
  const paper = styles.getPropertyValue("--paper").trim() || "#f7f2ea";
  const line = styles.getPropertyValue("--line").trim() || "#d8cec0";
  const ink = styles.getPropertyValue("--ink").trim() || "#171310";

  if (!active.length) {
    ctx.fillStyle = paper;
    roundedRect(ctx, 10, 10, 108, 108, 26);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = line;
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.font = "900 40px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("TT", 64, 66);
    setFavicon(canvas.toDataURL("image/png"));
    return;
  }

  const timer = active[0];
  const accent = options.alertColor || timer.color;
  const background = options.blink ? ink : accent;
  const foreground = options.blink ? accent : "#ffffff";
  const label = formatFaviconLabel(timer.remaining);

  ctx.fillStyle = background;
  roundedRect(ctx, 8, 8, 112, 112, 28);
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = options.blink ? accent : ink;
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
  roundedRect(ctx, 18, 18, 92, 18, 9);
  ctx.fill();

  ctx.fillStyle = foreground;
  ctx.font = "900 52px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 64, 67);

  ctx.font = "900 18px Arial, sans-serif";
  ctx.fillText(timer.short, 64, 104);

  ctx.fillStyle = options.blink ? accent : "rgba(255, 255, 255, 0.82)";
  roundedRect(ctx, 16, 112, 96 * Math.max(0.05, 1 - timer.progress), 7, 4);
  ctx.fill();

  setFavicon(canvas.toDataURL("image/png"));
}

function formatFaviconLabel(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.ceil(seconds / 60);
  const hours = Math.ceil(minutes / 60);
  const days = Math.ceil(hours / 24);

  if (seconds < 60) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  return `${days}d`;
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function setFavicon(url) {
  let link = document.querySelector("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = url;
}

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  try {
    localStorage.setItem(THEME_KEY, nextTheme);
  } catch {
    document.documentElement.dataset.themeStorage = "unavailable";
  }

  if (themeToggle) {
    themeToggle.setAttribute("aria-pressed", String(nextTheme === "dark"));
  }

  if (themeLabel) {
    themeLabel.textContent = nextTheme === "dark" ? "Light" : "Dark";
  }

  if (themeMeta) {
    themeMeta.setAttribute("content", nextTheme === "dark" ? "#100d0a" : "#f7f2ea");
  }

  if (timerEls.size) {
    render();
  } else {
    renderDocumentChrome([]);
  }
}

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || "light";
  } catch {
    return "light";
  }
}

function formatDuration(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }

  return `${minutes}:${pad(seconds)}`;
}

function formatCompact(ms) {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours && minutes) return `${hours}h${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

function formatClockTime(date) {
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function parseWholeNumber(value) {
  const cleaned = String(value || "").replace(/[^\d]/g, "");
  return Number(cleaned || 0);
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function normalizeSettings() {
  const legacyDefaults = {
    codex: ["#15957a", "#f97316"],
    claude: ["#b75c2d", "#111111"],
  };
  let changed = false;

  Object.keys(TIMER_CONFIG).forEach((id) => {
    const savedColor = settings[id]?.color?.toLowerCase();
    if (legacyDefaults[id]?.includes(savedColor)) {
      settings[id].color = TIMER_CONFIG[id].color;
      changed = true;
    }
  });

  if (changed) {
    saveSettings();
  }
}
