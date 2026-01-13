/* Admin Simulation */

// BACKEND URLs
const AZURE_BACKEND = "https://smart-parking-backend-e6e9eccqcng5cpda.eastus-01.azurewebsites.net";
const LOCAL_BACKEND = "http://127.0.0.1:3000";

const API_BASE = window.location.hostname.endsWith("azurestaticapps.net")
  ? AZURE_BACKEND
  : LOCAL_BACKEND;




document.addEventListener("DOMContentLoaded", () => {
  const randomOccupyBtn = document.getElementById("randomOccupy");
  const randomFreeBtn = document.getElementById("randomFree");
  const randomEventBtn = document.getElementById("randomEvent");
  const resetBtn = document.getElementById("resetDemo");

  // Erst prüfen, ob User eingeloggt ist
  checkAuthAndInit();

  if (randomOccupyBtn) {
    randomOccupyBtn.addEventListener("click", () =>
      adminAction(
        "/api/admin/random-occupy",
        { count: 4 },
        "🚧 Sensor-Update: Plätze wurden belegt."
      )
    );
  }

  if (randomFreeBtn) {
    randomFreeBtn.addEventListener("click", () =>
      adminAction(
        "/api/admin/random-free",
        { count: 4 },
        "✅ Sensor-Update: Plätze wurden freigegeben."
      )
    );
  }

  if (randomEventBtn) {
    randomEventBtn.addEventListener("click", () =>
      adminAction("/api/admin/random-event", {}, null) // Text kommt vom Server
    );
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (!confirm("Demo-Daten wirklich zurücksetzen?")) return;
      adminAction(
        "/api/admin/reset-demo",
        {},
        "♻️ Demo-Daten wurden zurückgesetzt."
      );
    });
  }
});

// Prüft Login über /api/me und lädt initialen Status
async function checkAuthAndInit() {
  try {
    const res = await fetch(API_BASE + "/api/me", {
      credentials: "include"
    });

    if (res.status === 401) {
      // Nicht eingeloggt -> zum Login
      window.location.href = "login.html";
      return;
    }

    // User-Info könntest du hier nutzen, falls du auf der Admin-Seite etwas anzeigen willst
  } catch (err) {
    console.error("Fehler bei /api/me (Admin):", err);
    window.location.href = "login.html";
    return;
  }

  // Wenn Session ok -> Status anzeigen
  renderStatus();
}

async function adminAction(path, body, fallbackMsg) {
  try {
    const res = await fetch(API_BASE + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify(body || {})
    });

    if (!res.ok) {
      let msg = "Aktion fehlgeschlagen.";
      try {
        const data = await res.json();
        if (data && data.error) msg = data.error;
      } catch (_) {}
      alert(msg);
      return;
    }

    const data = await res.json();
    if (data && data.message) {
      showMsg(data.message);
    } else if (fallbackMsg) {
      showMsg(fallbackMsg);
    }

    renderStatus();
  } catch (err) {
    console.error("Admin-Aktion Fehler:", err);
    alert("Netzwerkfehler bei der Admin-Aktion.");
  }
}

function showMsg(text) {
  const el = document.getElementById("adminMsg");
  if (el) el.textContent = text;
}

async function renderStatus() {
  const ul = document.getElementById("statusList");
  if (!ul) return;
  ul.innerHTML = "";

  try {
    // Lot + Statistik parallel laden
    const [lotRes, statsRes] = await Promise.all([
      fetch(API_BASE + "/api/lot", { credentials: "include" }),
      fetch(API_BASE + "/api/admin/stats", { credentials: "include" })
    ]);

    if (lotRes.status === 401) {
      window.location.href = "login.html";
      return;
    }

    const lot = await lotRes.json();
    let stats = { users: null, tickets: null };
    if (statsRes.ok) {
      stats = await statsRes.json();
    }

    const free = lot.spots.filter((s) => s.status === "AVAILABLE").length;
    const reserved = lot.spots.filter((s) => s.status === "RESERVED").length;
    const occupied = lot.spots.filter((s) => s.status === "OCCUPIED").length;

    let html = `
      <li>Freie Plätze: <strong>${free}</strong></li>
      <li>Reserviert: <strong>${reserved}</strong></li>
      <li>Belegt: <strong>${occupied}</strong></li>
    `;

    if (typeof stats.tickets === "number") {
      html += `<li>Tickets (gesamt): <strong>${stats.tickets}</strong></li>`;
    }
    if (typeof stats.users === "number") {
      html += `<li>Nutzer (registriert): <strong>${stats.users}</strong></li>`;
    }

    ul.innerHTML = html;
  } catch (err) {
    console.error("Fehler bei Admin-Status:", err);
    ul.innerHTML =
      '<li class="text-danger">Status konnte nicht geladen werden.</li>';
  }
}
