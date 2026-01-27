/* SmartParking core utilities + dark mode + Session-Handling
   (Backend hält jetzt Users, Lot, Tickets – hier nur noch UI-Helfer)
*/

// Eigene Backend-URL für dieses File
const BACKEND_URL = "https://smart-parking-backend-e6e9eccqcng5cpda.eastus-01.azurewebsites.net";

const SP_KEYS = {
  SESSION: "sp_session",
  THEME: "sp_theme"
};

function spLoad(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch (e) {
    return fallback;
  }
}

function spSave(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function spNowIso() {
  return new Date().toISOString();
}

function spFormatDT(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("de-DE", { hour12: false });
}

/* Theme / Dark Mode */

function spApplyTheme() {
  const t = localStorage.getItem(SP_KEYS.THEME) || "light";
  if (t === "dark") document.body.classList.add("dark-mode");
  const btn = document.getElementById("toggleDarkMode");
  if (btn)
    btn.textContent = document.body.classList.contains("dark-mode") ? "☀️" : "🌙";
}

function spToggleTheme() {
  document.body.classList.toggle("dark-mode");
  const t = document.body.classList.contains("dark-mode") ? "dark" : "light";
  localStorage.setItem(SP_KEYS.THEME, t);
  spApplyTheme();
}

/* Session (nur für Frontend-Komfort, Backend nutzt Cookie) */

function spGetSession() {
  return spLoad(SP_KEYS.SESSION, null);
}
function spSetSession(session) {
  spSave(SP_KEYS.SESSION, session);
}

/* Logout: Backend-Session + Frontend-Session */

function spLogout(){
  fetch("https://smart-parking-backend-e6e9eccqcng5cpda.eastus-01.azurewebsites.net/api/logout", {
    method: "POST",
    credentials: "include"
  }).catch(() => {}).finally(() => {
    spSetSession(null);
    window.location.href = "login.html";
  });
}


/* Gemeinsame UI verkabeln (Navbar-Buttons) */

function spWireCommonUI() {
  const themeBtn = document.getElementById("toggleDarkMode");
  if (themeBtn) themeBtn.addEventListener("click", spToggleTheme);

  const logoutBtn = document.getElementById("logoutBtn");
  const session = spGetSession();
  if (logoutBtn) {
    if (session) logoutBtn.classList.remove("d-none");
    logoutBtn.addEventListener("click", spLogout);
  }

  spApplyTheme();
}

document.addEventListener("DOMContentLoaded", () => {
  spWireCommonUI();
});
