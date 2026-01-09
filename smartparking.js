/* SmartParking core utilities + dark mode + demo initialization */

const SP_KEYS = {
  USERS: "sp_users",
  SESSION: "sp_session",
  LOT: "sp_lot",
  TICKETS: "sp_tickets",
  THEME: "sp_theme"
};

function spLoad(key, fallback){
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch(e){ return fallback; }
}
function spSave(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}

function spNowIso(){
  return new Date().toISOString();
}

function spFormatDT(iso){
  if(!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("de-DE", { hour12:false });
}

function spApplyTheme(){
  const t = localStorage.getItem(SP_KEYS.THEME) || "light";
  if(t === "dark") document.body.classList.add("dark-mode");
  const btn = document.getElementById("toggleDarkMode");
  if(btn) btn.textContent = document.body.classList.contains("dark-mode") ? "☀️" : "🌙";
}

function spToggleTheme(){
  document.body.classList.toggle("dark-mode");
  const t = document.body.classList.contains("dark-mode") ? "dark" : "light";
  localStorage.setItem(SP_KEYS.THEME, t);
  spApplyTheme();
}

function spGetSession(){
  return spLoad(SP_KEYS.SESSION, null);
}
function spSetSession(session){
  spSave(SP_KEYS.SESSION, session);
}
function spLogout(){
  spSetSession(null);
  window.location.href = "login.html";
}

function spGetUserByEmail(email){
  const users = spLoad(SP_KEYS.USERS, []);
  return users.find(u => u.email.toLowerCase() === String(email).toLowerCase());
}

function spEnsureDemoLot(){
  const existing = spLoad(SP_KEYS.LOT, null);
  if(existing) return;

  // Demo lot: 3 zones, 30 spots
  const zones = ["A","B","C"];
  const types = ["STANDARD","STANDARD","STANDARD","EV","DISABLED"];
  const spots = [];

  let id = 1;
  for(const z of zones){
    for(let i=1;i<=10;i++){
      const type = types[(id-1) % types.length];
      spots.push({
        id: `S${String(id).padStart(2,"0")}`,
        code: `${z}-${String(i).padStart(2,"0")}`,
        zone: z,
        type,
        status: "AVAILABLE", // AVAILABLE | RESERVED | OCCUPIED
        reservedBy: null,
        reservedUntil: null,
        occupiedBy: null,
        occupiedSince: null
      });
      id++;
    }
  }

  const lot = {
    name: "Demo-Lot",
    pricing: { perHour: 2.00, dayMax: 12.00 },
    reserveMinutes: 15,
    spots
  };

  spSave(SP_KEYS.LOT, lot);
  spSave(SP_KEYS.TICKETS, []);
}

function spCleanupExpiredReservations(){
  const lot = spLoad(SP_KEYS.LOT, null);
  if(!lot) return;

  const now = Date.now();
  let changed = false;

  for(const s of lot.spots){
    if(s.status === "RESERVED" && s.reservedUntil){
      const until = Date.parse(s.reservedUntil);
      if(!Number.isNaN(until) && until < now){
        s.status = "AVAILABLE";
        s.reservedBy = null;
        s.reservedUntil = null;
        changed = true;
      }
    }
  }
  if(changed) spSave(SP_KEYS.LOT, lot);
}

function spWireCommonUI(){
  const themeBtn = document.getElementById("toggleDarkMode");
  if(themeBtn) themeBtn.addEventListener("click", spToggleTheme);

  const logoutBtn = document.getElementById("logoutBtn");
  const session = spGetSession();
  if(logoutBtn){
    if(session) logoutBtn.classList.remove("d-none");
    logoutBtn.addEventListener("click", spLogout);
  }

  spApplyTheme();
}

document.addEventListener("DOMContentLoaded", () => {
  spEnsureDemoLot();
  spCleanupExpiredReservations();
  spWireCommonUI();
});
