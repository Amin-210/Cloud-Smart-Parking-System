/* Admin simulation */

const adminEvents = [
  { name: "📢 Rush Hour: +5 Spots belegt", fn: (lot) => occupyRandom(lot, 5) },
  { name: "🌧️ Regen: +3 Spots belegt", fn: (lot) => occupyRandom(lot, 3) },
  { name: "🎉 Event in der Nähe: +8 Spots belegt", fn: (lot) => occupyRandom(lot, 8) },
  { name: "🚓 Kontrolle: +4 Spots frei", fn: (lot) => freeRandom(lot, 4) },
  { name: "😐 Ruhiger Betrieb: keine Änderung", fn: (lot) => lot }
];

document.addEventListener("DOMContentLoaded", () => {
  const randomOccupyBtn = document.getElementById("randomOccupy");
  const randomFreeBtn = document.getElementById("randomFree");
  const randomEventBtn = document.getElementById("randomEvent");
  const resetBtn = document.getElementById("resetDemo");

  randomOccupyBtn.addEventListener("click", () => {
    const lot = spLoad(SP_KEYS.LOT, null);
    occupyRandom(lot, 4);
    spSave(SP_KEYS.LOT, lot);
    showMsg("🚧 Sensor-Update: Plätze wurden belegt.");
    renderStatus();
  });

  randomFreeBtn.addEventListener("click", () => {
    const lot = spLoad(SP_KEYS.LOT, null);
    freeRandom(lot, 4);
    spSave(SP_KEYS.LOT, lot);
    showMsg("✅ Sensor-Update: Plätze wurden freigegeben.");
    renderStatus();
  });

  randomEventBtn.addEventListener("click", () => {
    const lot = spLoad(SP_KEYS.LOT, null);
    const ev = adminEvents[Math.floor(Math.random() * adminEvents.length)];
    ev.fn(lot);
    spSave(SP_KEYS.LOT, lot);
    showMsg(ev.name);
    renderStatus();
  });

  resetBtn.addEventListener("click", () => {
    if(!confirm("Demo-Daten wirklich zurücksetzen?")) return;
    localStorage.removeItem(SP_KEYS.USERS);
    localStorage.removeItem(SP_KEYS.SESSION);
    localStorage.removeItem(SP_KEYS.LOT);
    localStorage.removeItem(SP_KEYS.TICKETS);
    spEnsureDemoLot();
    showMsg("♻️ Demo-Daten wurden zurückgesetzt.");
    renderStatus();
  });

  renderStatus();
});

function showMsg(text){
  const el = document.getElementById("adminMsg");
  el.textContent = text;
}

function occupyRandom(lot, n){
  if(!lot) return;
  const candidates = lot.spots.filter(s => s.status === "AVAILABLE");
  shuffle(candidates);
  candidates.slice(0, n).forEach(s => {
    s.status = "OCCUPIED";
    s.occupiedBy = "__sensor__";
    s.occupiedSince = spNowIso();
  });
}

function freeRandom(lot, n){
  if(!lot) return;
  const candidates = lot.spots.filter(s => s.status === "OCCUPIED" && s.occupiedBy === "__sensor__");
  shuffle(candidates);
  candidates.slice(0, n).forEach(s => {
    s.status = "AVAILABLE";
    s.occupiedBy = null;
    s.occupiedSince = null;
  });
}

function renderStatus(){
  spCleanupExpiredReservations();
  const lot = spLoad(SP_KEYS.LOT, null);
  const ul = document.getElementById("statusList");
  ul.innerHTML = "";

  const free = lot.spots.filter(s => s.status === "AVAILABLE").length;
  const reserved = lot.spots.filter(s => s.status === "RESERVED").length;
  const occupied = lot.spots.filter(s => s.status === "OCCUPIED").length;

  ul.innerHTML = `
    <li>Freie Plätze: <strong>${free}</strong></li>
    <li>Reserviert: <strong>${reserved}</strong></li>
    <li>Belegt: <strong>${occupied}</strong></li>
    <li>Tickets (gesamt): <strong>${spLoad(SP_KEYS.TICKETS, []).length}</strong></li>
    <li>Nutzer (registriert): <strong>${spLoad(SP_KEYS.USERS, []).length}</strong></li>
  `;
}

function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
