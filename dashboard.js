/* Dashboard logic */

let selectedSpotId = null;

document.addEventListener("DOMContentLoaded", () => {
  // Access control: require login
  const session = spGetSession();
  if(!session){
    window.location.href = "login.html";
    return;
  }

  const user = spLoad(SP_KEYS.USERS, []).find(u => u.id === session.userId);
  if(user){
    document.getElementById("userGreeting").textContent =
      `Angemeldet als ${user.vorname} ${user.nachname} (${user.carPlate})`;
  }

  // filters
  const zoneFilter = document.getElementById("zoneFilter");
  const typeFilter = document.getElementById("typeFilter");
  zoneFilter.addEventListener("change", renderAll);
  typeFilter.addEventListener("change", renderAll);

  // buttons
  document.getElementById("reserveBtn").addEventListener("click", () => doReserve(user));
  document.getElementById("checkinBtn").addEventListener("click", () => doCheckin(user));
  document.getElementById("checkoutBtn").addEventListener("click", () => doCheckout(user));

  // keep reservations clean every 10s
  setInterval(() => { spCleanupExpiredReservations(); renderAll(false); }, 10000);

  renderAll();
});

function getLot(){
  return spLoad(SP_KEYS.LOT, null);
}

function renderAll(scrollToGrid=true){
  const lot = getLot();
  if(!lot) return;

  const zone = document.getElementById("zoneFilter").value;
  const type = document.getElementById("typeFilter").value;

  // KPIs
  const free = lot.spots.filter(s => s.status === "AVAILABLE").length;
  const reserved = lot.spots.filter(s => s.status === "RESERVED").length;
  const occupied = lot.spots.filter(s => s.status === "OCCUPIED").length;

  document.getElementById("kpiFree").textContent = free;
  document.getElementById("kpiReserved").textContent = reserved;
  document.getElementById("kpiOccupied").textContent = occupied;

  // Grid
  const grid = document.getElementById("grid");
  grid.innerHTML = "";

  const spots = lot.spots.filter(s => (zone==="ALL" || s.zone===zone) && (type==="ALL" || s.type===type));

  for(const s of spots){
    const el = document.createElement("div");
    el.className = "spot " + (s.status==="AVAILABLE" ? "available" : s.status==="RESERVED" ? "reserved" : "occupied");
    el.dataset.id = s.id;

    const badge = s.type==="EV" ? "⚡ EV" : s.type==="DISABLED" ? "♿" : "P";
    const statusText = s.status==="AVAILABLE" ? "frei" : s.status==="RESERVED" ? "reserviert" : "belegt";

    el.innerHTML = `
      <div class="code">${s.code}</div>
      <div class="meta">${badge} · ${statusText}</div>
    `;

    el.addEventListener("click", () => selectSpot(s.id));
    grid.appendChild(el);
  }

  // restore selection if possible
  if(selectedSpotId){
    selectSpot(selectedSpotId, false);
  }else{
    updateActionPanel(null);
  }

  renderHistory();
  if(scrollToGrid && location.hash === "#grid") grid.scrollIntoView({behavior:"smooth"});
}

function selectSpot(spotId, scroll=true){
  selectedSpotId = spotId;
  const lot = getLot();
  const spot = lot.spots.find(s => s.id === spotId);
  updateActionPanel(spot);

  // highlight (simple)
  document.querySelectorAll(".spot").forEach(e => {
    if(e.dataset.id === spotId) e.style.boxShadow = "0 0 0 3px rgba(13,110,253,.35)";
    else e.style.boxShadow = "";
  });

  if(scroll){
    document.getElementById("selectedSpot").scrollIntoView({behavior:"smooth", block:"nearest"});
  }
}

function updateActionPanel(spot){
  const sel = document.getElementById("selectedSpot");
  const details = document.getElementById("spotDetails");
  const reserveBtn = document.getElementById("reserveBtn");
  const checkinBtn = document.getElementById("checkinBtn");
  const checkoutBtn = document.getElementById("checkoutBtn");

  if(!spot){
    sel.textContent = "Kein Parkplatz ausgewählt.";
    details.innerHTML = "";
    reserveBtn.disabled = true;
    checkinBtn.disabled = true;
    checkoutBtn.disabled = true;
    return;
  }

  sel.innerHTML = `<span class="fw-semibold">${spot.code}</span> — Zone ${spot.zone} · Typ ${spot.type}`;
  let extra = "";

  if(spot.status === "RESERVED"){
    extra = `<div class="text-warning">Reserviert bis: ${spFormatDT(spot.reservedUntil)}</div>`;
  }
  if(spot.status === "OCCUPIED"){
    extra = `<div class="text-danger">Belegt seit: ${spFormatDT(spot.occupiedSince)}</div>`;
  }
  details.innerHTML = extra;

  reserveBtn.disabled = spot.status !== "AVAILABLE";
  checkinBtn.disabled = !(spot.status === "AVAILABLE" || spot.status === "RESERVED");
  checkoutBtn.disabled = spot.status !== "OCCUPIED";
}

function doReserve(user){
  const lot = getLot();
  const spot = lot.spots.find(s => s.id === selectedSpotId);
  if(!spot || spot.status !== "AVAILABLE") return;

  const minutes = lot.reserveMinutes ?? 15;
  const until = new Date(Date.now() + minutes*60*1000).toISOString();

  spot.status = "RESERVED";
  spot.reservedBy = user.id;
  spot.reservedUntil = until;

  spSave(SP_KEYS.LOT, lot);
  renderAll(false);
}

function doCheckin(user){
  const lot = getLot();
  const spot = lot.spots.find(s => s.id === selectedSpotId);
  if(!spot) return;

  if(spot.status === "OCCUPIED") return;

  // If reserved by someone else -> block
  if(spot.status === "RESERVED" && spot.reservedBy && spot.reservedBy !== user.id){
    alert("Dieser Platz ist von einem anderen Nutzer reserviert.");
    return;
  }

  spot.status = "OCCUPIED";
  spot.occupiedBy = user.id;
  spot.occupiedSince = spNowIso();
  // clear reservation
  spot.reservedBy = null;
  spot.reservedUntil = null;

  // create active ticket
  const tickets = spLoad(SP_KEYS.TICKETS, []);
  tickets.push({
    id: crypto.randomUUID(),
    userId: user.id,
    spotCode: spot.code,
    start: spot.occupiedSince,
    end: null,
    amount: null
  });
  spSave(SP_KEYS.TICKETS, tickets);

  spSave(SP_KEYS.LOT, lot);
  renderAll(false);
}

function doCheckout(user){
  const lot = getLot();
  const spot = lot.spots.find(s => s.id === selectedSpotId);
  if(!spot || spot.status !== "OCCUPIED") return;

  if(spot.occupiedBy !== user.id){
    alert("Check-out ist nur für den Nutzer möglich, der eingecheckt hat (Demo-Regel).");
    return;
  }

  const tickets = spLoad(SP_KEYS.TICKETS, []);
  const active = [...tickets].reverse().find(t => t.userId === user.id && t.spotCode === spot.code && !t.end);
  if(!active){
    alert("Kein aktives Ticket gefunden.");
    return;
  }

  active.end = spNowIso();
  active.amount = calcAmount(active.start, active.end, lot.pricing);

  // free spot
  spot.status = "AVAILABLE";
  spot.occupiedBy = null;
  spot.occupiedSince = null;

  spSave(SP_KEYS.TICKETS, tickets);
  spSave(SP_KEYS.LOT, lot);
  renderAll(false);

  alert(`Zahlung (Demo): €${active.amount.toFixed(2)}\nTicket: ${spot.code}\nDanke!`);
}

function calcAmount(startIso, endIso, pricing){
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  const ms = Math.max(0, end - start);
  const hours = ms / (1000*60*60);

  const perHour = pricing?.perHour ?? 2.0;
  const dayMax = pricing?.dayMax ?? 12.0;

  const raw = hours * perHour;
  return Math.min(raw, dayMax);
}

function renderHistory(){
  const session = spGetSession();
  if(!session) return;

  const tickets = spLoad(SP_KEYS.TICKETS, [])
    .filter(t => t.userId === session.userId && t.end)
    .slice(-8)
    .reverse();

  const tbody = document.getElementById("historyTable");
  tbody.innerHTML = "";

  if(tickets.length === 0){
    tbody.innerHTML = `<tr><td colspan="4" class="text-muted small">Noch keine abgeschlossenen Tickets.</td></tr>`;
    return;
  }

  for(const t of tickets){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="fw-semibold">${t.spotCode}</td>
      <td class="small">${spFormatDT(t.start)}</td>
      <td class="small">${spFormatDT(t.end)}</td>
      <td class="text-end fw-semibold">€${Number(t.amount ?? 0).toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  }
}
