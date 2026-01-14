// server.js
// Minimal-Backend für SmartParking (Uni-Demo)

const express = require("express");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// --- kleiner Start-Log, damit wir sicher sehen, dass die Datei läuft
console.log("Starte SmartParking-Server...");

// -------- In-Memory "Datenbank" --------
const DB = {
  users: [],          // { id, anrede, vorname, nachname, email, passwordHash, geburtsdatum, plz, carPlate }
  sessions: {},       // sessionId -> { userId, email, loginAt }
  lot: null,          // { name, pricing, reserveMinutes, spots: [...] }
  tickets: []         // { id, userId, spotCode, start, end, amount }
};

// -------- Helper-Funktionen --------
function nowIso() {
  return new Date().toISOString();
}

function simpleHash(str) {
  // gleiche "unsichere" Demo-Hash-Funktion wie im Frontend
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return String(h);
}

// Fallback falls crypto.randomUUID nicht verfügbar ist (ältere Node-Version)
function makeId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return (
    "id-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).substring(2, 10)
  );
}

// initiales Demo-Lot wie in spEnsureDemoLot
function ensureDemoLot() {
  if (DB.lot) return;

  const zones = ["A", "B", "C"];
  const types = ["STANDARD", "STANDARD", "STANDARD", "EV", "DISABLED"];
  const spots = [];
  let id = 1;

  for (let zi = 0; zi < zones.length; zi++) {
    const z = zones[zi];
    for (let i = 1; i <= 10; i++) {
      const type = types[(id - 1) % types.length];
      spots.push({
        id: "S" + String(id).padStart(2, "0"),
        code: z + "-" + String(i).padStart(2, "0"),
        zone: z,
        type: type,
        status: "AVAILABLE", // AVAILABLE | RESERVED | OCCUPIED
        reservedBy: null,
        reservedUntil: null,
        occupiedBy: null,
        occupiedSince: null
      });
      id++;
    }
  }

  DB.lot = {
    name: "Demo-Lot",
    pricing: { perHour: 2.0, dayMax: 12.0 },
    reserveMinutes: 15,
    spots: spots
  };
  DB.tickets = [];
}

function cleanupExpiredReservations() {
  if (!DB.lot) return;
  const now = Date.now();

  for (let i = 0; i < DB.lot.spots.length; i++) {
    const s = DB.lot.spots[i];
    if (s.status === "RESERVED" && s.reservedUntil) {
      const until = Date.parse(s.reservedUntil);
      if (!Number.isNaN(until) && until < now) {
        s.status = "AVAILABLE";
        s.reservedBy = null;
        s.reservedUntil = null;
      }
    }
  }
}

function calcAmount(startIso, endIso, pricing) {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  const ms = Math.max(0, end - start);
  const hours = ms / (1000 * 60 * 60);

  const perHour = (pricing && typeof pricing.perHour === "number") ? pricing.perHour : 2.0;
  const dayMax = (pricing && typeof pricing.dayMax === "number") ? pricing.dayMax : 12.0;

  const raw = hours * perHour;
  return Math.min(raw, dayMax);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

// Admin-Events ähnlich wie in admin.js
const adminEvents = [
  { name: "📢 Rush Hour: +5 Spots belegt", fn: function (lot) { occupyRandom(lot, 5); } },
  { name: "🌧️ Regen: +3 Spots belegt", fn: function (lot) { occupyRandom(lot, 3); } },
  { name: "🎉 Event in der Nähe: +8 Spots belegt", fn: function (lot) { occupyRandom(lot, 8); } },
  { name: "🚓 Kontrolle: +4 Spots frei", fn: function (lot) { freeRandom(lot, 4); } },
  { name: "😐 Ruhiger Betrieb: keine Änderung", fn: function (lot) { return lot; } }
];

function occupyRandom(lot, n) {
  if (!lot) return;
  const candidates = lot.spots.filter(function (s) { return s.status === "AVAILABLE"; });
  shuffle(candidates);
  candidates.slice(0, n).forEach(function (s) {
    s.status = "OCCUPIED";
    s.occupiedBy = "__sensor__";
    s.occupiedSince = nowIso();
  });
}

function freeRandom(lot, n) {
  if (!lot) return;
  const candidates = lot.spots.filter(function (s) {
    return s.status === "OCCUPIED" && s.occupiedBy === "__sensor__";
  });
  shuffle(candidates);
  candidates.slice(0, n).forEach(function (s) {
    s.status = "AVAILABLE";
    s.occupiedBy = null;
    s.occupiedSince = null;
  });
}

// -------- Express Grundkonfiguration --------
app.use(express.json());
app.use(cookieParser());

// -------- Auth-Middleware --------
function requireAuth(req, res, next) {
  const sid = req.cookies.sid;
  if (!sid || !DB.sessions[sid]) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  req.session = DB.sessions[sid];
  next();
}

// -------- API-Routen --------

// Registrierung
app.post("/api/register", function (req, res) {
  const body = req.body || {};
  const anrede = body.anrede;
  const vorname = body.vorname;
  const nachname = body.nachname;
  const email = body.email;
  const password = body.password;
  const geburtsdatum = body.geburtsdatum;
  const plz = body.plz;
  const carPlate = body.carPlate;

  if (!email || !password) {
    return res.status(400).json({ error: "E-Mail und Passwort benötigt" });
  }

  const exists = DB.users.some(function (u) {
    return u.email.toLowerCase() === String(email).toLowerCase();
  });
  if (exists) {
    return res.status(409).json({ error: "E-Mail bereits registriert" });
  }

  const user = {
    id: makeId(),
    anrede: anrede || "",
    vorname: vorname || "",
    nachname: nachname || "",
    email: email,
    passwordHash: simpleHash(password),
    geburtsdatum: geburtsdatum || null,
    plz: plz || "",
    carPlate: carPlate || ""
  };
  DB.users.push(user);

  res.status(201).json({ message: "Registrierung erfolgreich" });
});

// Login
app.post("/api/login", function (req, res) {
  const body = req.body || {};
  const email = body.email;
  const password = body.password;

  if (!email || !password) {
    return res.status(400).json({ error: "E-Mail und Passwort benötigt" });
  }

  const user = DB.users.find(function (u) {
    return u.email.toLowerCase() === String(email).toLowerCase();
  });
  if (!user || user.passwordHash !== simpleHash(password)) {
    return res.status(401).json({ error: "Login fehlgeschlagen" });
  }

  const sid = makeId();
  DB.sessions[sid] = {
    userId: user.id,
    email: user.email,
    loginAt: nowIso()
  };

  // In Azure (HTTPS, andere Domain) brauchen wir SameSite=None + secure
  const isProduction = process.env.WEBSITE_SITE_NAME ? true : false;

  res.cookie("sid", sid, {
    httpOnly: true,
    sameSite: isProduction ? "none" : "lax",
    secure: isProduction
  });

  res.json({
    message: "Login OK",
    user: {
      id: user.id,
      vorname: user.vorname,
      nachname: user.nachname,
      carPlate: user.carPlate
    }
  });
});

// Aktuelle Session / User
app.get("/api/me", requireAuth, function (req, res) {
  const user = DB.users.find(function (u) { return u.id === req.session.userId; });
  if (!user) return res.status(404).json({ error: "User not found" });

  res.json({
    user: {
      id: user.id,
      anrede: user.anrede,
      vorname: user.vorname,
      nachname: user.nachname,
      email: user.email,
      carPlate: user.carPlate
    }
  });
});

// Logout
app.post("/api/logout", requireAuth, function (req, res) {
  const sid = req.cookies.sid;
  if (sid) delete DB.sessions[sid];
  res.clearCookie("sid");
  res.json({ message: "Logged out" });
});

// Parkplatz-Lot
app.get("/api/lot", requireAuth, function (req, res) {
  ensureDemoLot();
  cleanupExpiredReservations();
  res.json(DB.lot);
});

// Reservieren
app.post("/api/spots/:id/reserve", requireAuth, function (req, res) {
  ensureDemoLot();
  cleanupExpiredReservations();
  const lot = DB.lot;
  const spot = lot.spots.find(function (s) { return s.id === req.params.id; });
  if (!spot) return res.status(404).json({ error: "Spot not found" });

  if (spot.status !== "AVAILABLE") {
    return res.status(400).json({ error: "Spot ist nicht frei" });
  }

  const minutes = lot.reserveMinutes || 15;
  const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();

  spot.status = "RESERVED";
  spot.reservedBy = req.session.userId;
  spot.reservedUntil = until;

  res.json({ message: "Reserviert", spot: spot });
});

// Check-in
app.post("/api/spots/:id/checkin", requireAuth, function (req, res) {
  ensureDemoLot();
  cleanupExpiredReservations();
  const lot = DB.lot;
  const spot = lot.spots.find(function (s) { return s.id === req.params.id; });
  if (!spot) return res.status(404).json({ error: "Spot not found" });

  const userId = req.session.userId;

  if (spot.status === "OCCUPIED") {
    return res.status(400).json({ error: "Spot bereits belegt" });
  }

  if (spot.status === "RESERVED" && spot.reservedBy && spot.reservedBy !== userId) {
    return res
      .status(403)
      .json({ error: "Spot ist von einem anderen Nutzer reserviert" });
  }

  spot.status = "OCCUPIED";
  spot.occupiedBy = userId;
  spot.occupiedSince = nowIso();
  spot.reservedBy = null;
  spot.reservedUntil = null;

  const ticket = {
    id: makeId(),
    userId: userId,
    spotCode: spot.code,
    start: spot.occupiedSince,
    end: null,
    amount: null
  };
  DB.tickets.push(ticket);

  res.json({ message: "Eingecheckt", spot: spot, ticket: ticket });
});

// Check-out
app.post("/api/spots/:id/checkout", requireAuth, function (req, res) {
  ensureDemoLot();
  cleanupExpiredReservations();
  const lot = DB.lot;
  const spot = lot.spots.find(function (s) { return s.id === req.params.id; });
  if (!spot) return res.status(404).json({ error: "Spot not found" });

  const userId = req.session.userId;
  if (spot.status !== "OCCUPIED") {
    return res.status(400).json({ error: "Spot ist nicht belegt" });
  }
  if (spot.occupiedBy !== userId) {
    return res
      .status(403)
      .json({ error: "Check-out nur für den Nutzer möglich, der eingecheckt hat" });
  }

  const ticket = DB.tickets
    .slice()
    .reverse()
    .find(function (t) {
      return t.userId === userId && t.spotCode === spot.code && !t.end;
    });
  if (!ticket) {
    return res.status(404).json({ error: "Kein aktives Ticket gefunden" });
  }

  ticket.end = nowIso();
  ticket.amount = calcAmount(ticket.start, ticket.end, lot.pricing);

  spot.status = "AVAILABLE";
  spot.occupiedBy = null;
  spot.occupiedSince = null;

  res.json({
    message: "Check-out OK",
    ticket: ticket
  });
});

// Tickets des eingeloggten Users
app.get("/api/tickets/my", requireAuth, function (req, res) {
  const userId = req.session.userId;
  const tickets = DB.tickets.filter(function (t) { return t.userId === userId; });
  res.json(tickets);
});

// ---- Admin / Simulation ----

// Reset Demo-Daten
app.post("/api/admin/reset-demo", function (req, res) {
  DB.users = [];
  DB.sessions = {};
  DB.lot = null;
  DB.tickets = [];
  ensureDemoLot();
  res.json({ message: "Demo-Daten zurückgesetzt" });
});

// Zufällig belegen
app.post("/api/admin/random-occupy", function (req, res) {
  ensureDemoLot();
  const body = req.body || {};
  const count = Number(body.count || 4);
  occupyRandom(DB.lot, count);
  res.json({ message: "Random occupy", lot: DB.lot });
});

// Zufällig freigeben
app.post("/api/admin/random-free", function (req, res) {
  ensureDemoLot();
  const body = req.body || {};
  const count = Number(body.count || 4);
  freeRandom(DB.lot, count);
  res.json({ message: "Random free", lot: DB.lot });
});

// Zufälliges Event
app.post("/api/admin/random-event", function (req, res) {
  ensureDemoLot();
  const lot = DB.lot;
  const ev = adminEvents[Math.floor(Math.random() * (adminEvents.length))];
  ev.fn(lot);
  res.json({ message: ev.name, lot: lot });
});

// Admin-Statistik (Anzahl Nutzer & Tickets)
app.get("/api/admin/stats", function (req, res) {
  ensureDemoLot();
  cleanupExpiredReservations();
  res.json({
    users: DB.users.length,
    tickets: DB.tickets.length
  });
});

// -------- Server starten --------
ensureDemoLot();

app.listen(PORT, function () {
  console.log("SmartParking backend running on http://localhost:" + PORT);
});
