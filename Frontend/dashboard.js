/* Dashboard logic mit Backend-API */

// 👉 Immer Azure-Backend benutzen
const API_BASE = "https://smart-parking-backend-e6e9eccqcng5cpda.eastus-01.azurewebsites.net";

let selectedSpotId = null;
let currentUser = null;
let currentLot = null;

document.addEventListener("DOMContentLoaded", () => {
  initDashboard();
});

async function initDashboard() {
  // 1) User vom Backend holen (Session-Cookie)
  try {
    const meRes = await fetch(API_BASE + "/api/me", {
      credentials: "include"
    });

    if (meRes.status === 401) {
      window.location.href = "login.html";
      return;
    }

    const meData = await meRes.json();
    currentUser = meData.user;

    const greet = document.getElementById("userGreeting");
    if (greet && currentUser) {
      greet.textContent = `Angemeldet als ${currentUser.vorname} ${currentUser.nachname} (${currentUser.carPlate})`;
    }
  } catch (err) {
    console.error("Fehler bei /api/me:", err);
    window.location.href = "login.html";
    return;
  }

  const zoneFilter = document.getElementById("zoneFilter");
  const typeFilter = document.getElementById("typeFilter");
  if (zoneFilter) zoneFilter.addEventListener("change", () => renderAll(true));
  if (typeFilter) typeFilter.addEventListener("change", () => renderAll(true));

  document.getElementById("reserveBtn").addEventListener("click", () => doReserve());
  document.getElementById("checkinBtn").addEventListener("click", () => doCheckin());
  document.getElementById("checkoutBtn").addEventListener("click", () => doCheckout());

  await fetchLotAndRender(true);

  setInterval(() => {
    fetchLotAndRender(false);
  }, 10000);
}

// ----- Backend-Calls -----

async function fetchLotAndRender(scrollToGrid = true) {
  try {
    const res = await fetch(API_BASE + "/api/lot", {
      credentials: "include"
    });

    if (res.status === 401) {
      window.location.href = "login.html";
      return;
    }

    currentLot = await res.json();
    renderAll(scrollToGrid);
  } catch (err) {
    console.error("Fehler bei /api/lot:", err);
  }
}

// ----- Rendering -----

function renderAll(scrollToGrid = true) {
  const lot = currentLot;
  if (!lot) return;

  const zone = document.getElementById("zoneFilter").value;
  const type = document.getElementById("typeFilter").value;

  const free = lot.spots.filter((s) => s.status === "AVAILABLE").length;
  const reserved = lot.spots.filter((s) => s.status === "RESERVED").length;
  const occupied = lot.spots.filter((s) => s.status === "OCCUPIED").length;

  document.getElementById("kpiFree").textContent = free;
  document.getElementById("kpiReserved").textContent = reserved;
  document.getElementById("kpiOccupied").textContent = occupied;

  const grid = document.getElementById("grid");
  grid.innerHTML = "";

  const spots = lot.spots.filter(
    (s) =>
      (zone === "ALL" || s.zone === zone) &&
      (type === "ALL" || s.type === type)
  );

  for (const s of spots) {
    const el = document.createElement("div");
    el.className =
      "spot " +
      (s.status === "AVAILABLE"
        ? "available"
        : s.status === "RESERVED"
        ? "reserved"
        : "occupied");
    el.dataset.id = s.id;

    const badge = s.type === "EV" ? "⚡ EV" : s.type === "DISABLED" ? "♿" : "P";
    const statusText =
      s.status === "AVAILABLE"
        ? "frei"
        : s.status === "RESERVED"
        ? "reserviert"
        : "belegt";

    el.innerHTML = `
      <div class="code">${s.code}</div>
      <div class="meta">${badge} · ${statusText}</div>
    `;

    el.addEventListener("click", () => selectSpot(s.id));
    grid.appendChild(el);
  }

  if (selectedSpotId) {
    selectSpot(selectedSpotId, false);
  } else {
    updateActionPanel(null);
  }

  renderHistory();
  if (scrollToGrid && location.hash === "#grid")
    grid.scrollIntoView({ behavior: "smooth" });
}

function selectSpot(spotId, scroll = true) {
  selectedSpotId = spotId;
  const lot = currentLot;
  if (!lot) return;
  const spot = lot.spots.find((s) => s.id === spotId);
  updateActionPanel(spot);

  document.querySelectorAll(".spot").forEach((e) => {
    if (e.dataset.id === spotId)
      e.style.boxShadow = "0 0 0 3px rgba(13,110,253,.35)";
    else e.style.boxShadow = "";
  });

  if (scroll) {
    document
      .getElementById("selectedSpot")
      .scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function updateActionPanel(spot) {
  const sel = document.getElementById("selectedSpot");
  const details = document.getElementById("spotDetails");
  const reserveBtn = document.getElementById("reserveBtn");
  const checkinBtn = document.getElementById("checkinBtn");
  const checkoutBtn = document.getElementById("checkoutBtn");

  if (!spot) {
    sel.textContent = "Kein Parkplatz ausgewählt.";
    details.innerHTML = "";
    reserveBtn.disabled = true;
    checkinBtn.disabled = true;
    checkoutBtn.disabled = true;
    return;
  }

  sel.innerHTML = `<span class="fw-semibold">${spot.code}</span> — Zone ${spot.zone} · Typ ${spot.type}`;
  let extra = "";

  if (spot.status === "RESERVED") {
    extra = `<div class="text-warning">Reserviert bis: ${spFormatDT(
      spot.reservedUntil
    )}</div>`;
  }
  if (spot.status === "OCCUPIED") {
    extra = `<div class="text-danger">Belegt seit: ${spFormatDT(
      spot.occupiedSince
    )}</div>`;
  }
  details.innerHTML = extra;

  reserveBtn.disabled = spot.status !== "AVAILABLE";
  checkinBtn.disabled = !(
    spot.status === "AVAILABLE" || spot.status === "RESERVED"
  );
  checkoutBtn.disabled = spot.status !== "OCCUPIED";
}

// ----- Aktionen -----

async function doReserve() {
  if (!currentUser || !selectedSpotId) return;

  try {
    const res = await fetch(
      API_BASE + "/api/spots/" + encodeURIComponent(selectedSpotId) + "/reserve",
      {
        method: "POST",
        credentials: "include"
      }
    );

    if (!res.ok) {
      let msg = "Reservierung fehlgeschlagen.";
      try {
        const data = await res.json();
        if (data && data.error) msg = data.error;
      } catch (_) {}
      alert(msg);
      return;
    }

    await fetchLotAndRender(false);
  } catch (err) {
    console.error("Fehler bei Reserve:", err);
    alert("Netzwerkfehler bei der Reservierung.");
  }
}

async function doCheckin() {
  if (!currentUser || !selectedSpotId) return;

  try {
    const res = await fetch(
      API_BASE + "/api/spots/" + encodeURIComponent(selectedSpotId) + "/checkin",
      {
        method: "POST",
        credentials: "include"
      }
    );

    if (!res.ok) {
      let msg = "Check-in fehlgeschlagen.";
      try {
        const data = await res.json();
        if (data && data.error) msg = data.error;
      } catch (_) {}
      alert(msg);
      return;
    }

    await fetchLotAndRender(false);
  } catch (err) {
    console.error("Fehler bei Checkin:", err);
    alert("Netzwerkfehler beim Check-in.");
  }
}

async function doCheckout() {
  if (!currentUser || !selectedSpotId) return;

  try {
    const res = await fetch(
      API_BASE +
        "/api/spots/" +
        encodeURIComponent(selectedSpotId) +
        "/checkout",
      {
        method: "POST",
        credentials: "include"
      }
    );

    if (!res.ok) {
      let msg = "Check-out fehlgeschlagen.";
      try {
        const data = await res.json();
        if (data && data.error) msg = data.error;
      } catch (_) {}
      alert(msg);
      return;
    }

    const data = await res.json();
    await fetchLotAndRender(false);

    const ticket = data.ticket;
    alert(
      `Zahlung (Demo): €${Number(ticket.amount || 0).toFixed(
        2
      )}\nTicket: ${ticket.spotCode}\nDanke!`
    );
  } catch (err) {
    console.error("Fehler bei Checkout:", err);
    alert("Netzwerkfehler beim Check-out.");
  }
}

// ----- History -----

async function renderHistory() {
  const tbody = document.getElementById("historyTable");
  if (!tbody) return;

  tbody.innerHTML = "";

  try {
    const res = await fetch(API_BASE + "/api/tickets/my", {
      credentials: "include"
    });

    if (!res.ok) {
      tbody.innerHTML =
        '<tr><td colspan="4" class="text-muted small">Tickets konnten nicht geladen werden.</td></tr>';
      return;
    }

    let tickets = await res.json();
    tickets = tickets.filter((t) => t.end).slice(-8).reverse();

    if (tickets.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="4" class="text-muted small">Noch keine abgeschlossenen Tickets.</td></tr>';
      return;
    }

    for (const t of tickets) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="fw-semibold">${t.spotCode}</td>
        <td class="small">${spFormatDT(t.start)}</td>
        <td class="small">${spFormatDT(t.end)}</td>
        <td class="text-end fw-semibold">€${Number(
          t.amount || 0
        ).toFixed(2)}</td>
      `;
      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error("Fehler bei Tickets:", err);
    tbody.innerHTML =
      '<tr><td colspan="4" class="text-muted small">Fehler beim Laden der Tickets.</td></tr>';
  }
}
