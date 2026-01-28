// server.js
// SmartParking Backend mit Azure SQL Database (SQL ist immer Pflicht!)
require('dotenv').config();
const APP_VERSION = "sql-users-v1";


const express = require("express");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const sql = require("mssql");

const app = express();
const PORT = process.env.PORT || 3000;

// --- kleiner Start-Log
console.log("Starte SmartParking-Server...");

// ---------------------------------------------------------------------
//  SQL-Konfiguration (kommt aus den Umgebungsvariablen in Azure / lokal)
// ---------------------------------------------------------------------
const dbConfig = {
  server: process.env.DB_HOST,          // z.B. smartparking-sqlserver-eu.database.windows.net
  database: process.env.DB_NAME,        // z.B. smartparkingdb
  user: process.env.DB_USER,            // z.B. sp_admin
  password: process.env.DB_PASS,
  port: Number(process.env.DB_PORT) || 1433,
  options: {
    encrypt: true,            // wichtig für Azure SQL
    trustServerCertificate: false
  }
};

console.log("DB-Konfiguration:", {
  server: dbConfig.server,
  database: dbConfig.database,
  user: dbConfig.user,
  port: dbConfig.port
});

// Wenn irgendetwas fehlt -> sofort abbrechen
if (!dbConfig.server || !dbConfig.database || !dbConfig.user || !dbConfig.password) {
  console.error("❌ DB-Konfiguration unvollständig! SQL ist Pflicht, Backend wird beendet.");
  process.exit(1);
}

// Verbindungspool (wird einmal aufgebaut)
let poolPromise = sql
  .connect(dbConfig)
  .then(pool => {
    console.log("✅ Mit SQL-Datenbank verbunden.");
    return pool;
  })
  .catch(err => {
    console.error("❌ Fehler bei SQL-Verbindung:", err);
    process.exit(1); // ebenfalls hart abbrechen
  });

async function getPool() {
  return poolPromise;
}

// ---------------------------------------------------------------------
//  In-Memory Sessions (nur für Login, alles andere liegt in SQL)
// ---------------------------------------------------------------------
const DB = {
  sessions: {} // sessionId -> { userId, email, loginAt }
};

// ---------------------------------------------------------------------
//  Helper-Funktionen
// ---------------------------------------------------------------------
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

function calcAmount(startIso, endIso, pricing) {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  const ms = Math.max(0, end - start);
  const hours = ms / (1000 * 60 * 60);

  const perHour =
    pricing && typeof pricing.perHour === "number" ? pricing.perHour : 2.0;
  const dayMax =
    pricing && typeof pricing.dayMax === "number" ? pricing.dayMax : 12.0;

  const raw = hours * perHour;
  return Math.min(raw, dayMax);
}

// Reservierungen, die abgelaufen sind, in der DB aufräumen
async function cleanupExpiredReservationsDb() {
  const pool = await getPool();
  await pool.request().query(`
    UPDATE dbo.Spots
    SET Status = 'AVAILABLE',
        ReservedBy = NULL,
        ReservedUntil = NULL
    WHERE Status = 'RESERVED'
      AND ReservedUntil IS NOT NULL
      AND ReservedUntil < SYSDATETIME();
  `);
}

// Lot + Spots aus der Datenbank laden
async function loadLotFromDb() {
  const pool = await getPool();

  const lotRes = await pool.request().query(`
    SELECT TOP 1 Id, Name, PerHour, DayMax, ReserveMinutes
    FROM dbo.ParkingLot
    ORDER BY Id;
  `);

  if (lotRes.recordset.length === 0) {
    throw new Error("Kein ParkingLot in der Datenbank gefunden.");
  }

  const lotRow = lotRes.recordset[0];

  const spotsRes = await pool.request().query(`
    SELECT Id, Code, Zone, Type, Status,
           ReservedBy, ReservedUntil,
           OccupiedBy, OccupiedSince
    FROM dbo.Spots
    ORDER BY Id;
  `);

  const spots = spotsRes.recordset.map(r => ({
    id: r.Id,
    code: r.Code,
    zone: r.Zone,
    type: r.Type,
    status: r.Status,
    reservedBy: r.ReservedBy,
    reservedUntil: r.ReservedUntil,
    occupiedBy: r.OccupiedBy,
    occupiedSince: r.OccupiedSince
  }));

  return {
    id: lotRow.Id,
    name: lotRow.Name,
    pricing: {
      perHour: Number(lotRow.PerHour),
      dayMax: Number(lotRow.DayMax)
    },
    reserveMinutes: lotRow.ReserveMinutes,
    spots
  };
}

// ---------------------------------------------------------------------
//  Express Grundkonfiguration
// ---------------------------------------------------------------------
app.use(express.json());
app.use(cookieParser());

// Preflight-Requests (OPTIONS) global behandeln
// CORS-Allow-Origin wird von Azure Portal CORS gemacht
app.options("*", (req, res) => {
  res.sendStatus(204);
});

// ---------------------------------------------------------------------
//  Auth-Middleware (Session liegt im Speicher)
// ---------------------------------------------------------------------
function requireAuth(req, res, next) {
  const sid = req.cookies.sid;
  if (!sid || !DB.sessions[sid]) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  req.session = DB.sessions[sid];
  next();
}

// ---------------------------------------------------------------------
//  API-Routen
// ---------------------------------------------------------------------

// Registrierung
app.post("/api/register", async (req, res) => {
  try {
    const body = req.body || {};
    const anrede = body.anrede;
    const vorname = body.vorname;
    const nachname = body.nachname;
    const email = body.email;
    const password = body.password;
    const geburtsdatumRaw = body.geburtsdatum; // vom <input type="date"> (meist YYYY-MM-DD)
    const plz = body.plz;
    const carPlate = body.carPlate;

    if (!email || !password) {
      return res.status(400).json({ error: "E-Mail und Passwort benötigt" });
    }

    const pool = await getPool();

    // E-Mail doppelt?
    const existsRes = await pool
      .request()
      .input("Email", sql.NVarChar(255), email)
      .query(
        "SELECT 1 AS x FROM dbo.Users WHERE LOWER(Email) = LOWER(@Email);"
      );

    if (existsRes.recordset.length > 0) {
      return res.status(409).json({ error: "E-Mail bereits registriert" });
    }

    const userId = makeId();
    const passwordHash = simpleHash(password);

    // Geburtsdatum robust parsen (falls leer -> null)
    let geburtsdatum = null;
    if (geburtsdatumRaw) {
      const d = new Date(geburtsdatumRaw);
      if (!Number.isNaN(d.getTime())) {
        geburtsdatum = d; // mssql akzeptiert Date-Objekt
      }
    }

    // 🔧 WICHTIG: CreatedAt mit einfügen (Spalte existiert in dbo.Users)
    await pool
      .request()
      .input("Id", sql.NVarChar(50), userId)
      .input("Anrede", sql.NVarChar(50), anrede || "")
      .input("Vorname", sql.NVarChar(100), vorname || "")
      .input("Nachname", sql.NVarChar(100), nachname || "")
      .input("Email", sql.NVarChar(255), email)
      .input("PasswordHash", sql.NVarChar(255), passwordHash)
      .input("Geburtsdatum", sql.Date, geburtsdatum)
      .input("Plz", sql.NVarChar(20), plz || "")
      .input("CarPlate", sql.NVarChar(50), carPlate || "")
      .query(`
        INSERT INTO dbo.Users
          (Id, Anrede, Vorname, Nachname, Email, PasswordHash,
           Geburtsdatum, Plz, CarPlate, CreatedAt)
        VALUES
          (@Id, @Anrede, @Vorname, @Nachname, @Email, @PasswordHash,
           @Geburtsdatum, @Plz, @CarPlate, SYSDATETIME());
      `);

    res.status(201).json({ message: "Registrierung erfolgreich" });
  } catch (err) {
    console.error("Fehler /api/register:", err);
    res.status(500).json({ error: "Interner Fehler bei der Registrierung" });
  }
});



// Login
app.post("/api/login", async (req, res) => {
  try {
    const body = req.body || {};
    const email = body.email;
    const password = body.password;

    if (!email || !password) {
      return res.status(400).json({ error: "E-Mail und Passwort benötigt" });
    }

    const pool = await getPool();

    const userRes = await pool
      .request()
      .input("Email", sql.NVarChar(255), email)
      .query(`
        SELECT TOP 1 Id, Vorname, Nachname, CarPlate, PasswordHash
        FROM dbo.Users
        WHERE LOWER(Email) = LOWER(@Email);
      `);

    if (userRes.recordset.length === 0) {
      return res.status(401).json({ error: "Login fehlgeschlagen" });
    }

    const user = userRes.recordset[0];
    const hash = simpleHash(password);
    if (user.PasswordHash !== hash) {
      return res.status(401).json({ error: "Login fehlgeschlagen" });
    }

    const sid = makeId();
    DB.sessions[sid] = {
      userId: user.Id,
      email: email,
      loginAt: nowIso()
    };

    const isProduction = process.env.WEBSITE_SITE_NAME ? true : false;

    res.cookie("sid", sid, {
      httpOnly: true,
      sameSite: isProduction ? "none" : "lax",
      secure: isProduction
    });

    res.json({
      message: "Login OK",
      user: {
        id: user.Id,
        vorname: user.Vorname,
        nachname: user.Nachname,
        carPlate: user.CarPlate
      }
    });
  } catch (err) {
    console.error("Fehler /api/login:", err);
    res.status(500).json({ error: "Interner Fehler beim Login" });
  }
});

// Aktuelle Session / User
app.get("/api/me", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const userRes = await pool
      .request()
      .input("Id", sql.NVarChar(50), req.session.userId)
      .query(`
        SELECT TOP 1 Id, Anrede, Vorname, Nachname, Email, CarPlate
        FROM dbo.Users
        WHERE Id = @Id;
      `);

    if (userRes.recordset.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const u = userRes.recordset[0];

    res.json({
      user: {
        id: u.Id,
        anrede: u.Anrede,
        vorname: u.Vorname,
        nachname: u.Nachname,
        email: u.Email,
        carPlate: u.CarPlate
      }
    });
  } catch (err) {
    console.error("Fehler /api/me:", err);
    res.status(500).json({ error: "Interner Fehler bei /api/me" });
  }
});

// Logout
app.post("/api/logout", requireAuth, (req, res) => {
  const sid = req.cookies.sid;
  if (sid) delete DB.sessions[sid];
  res.clearCookie("sid");
  res.json({ message: "Logged out" });
});

// Parkplatz-Lot
app.get("/api/lot", requireAuth, async (req, res) => {
  try {
    await cleanupExpiredReservationsDb();
    const lot = await loadLotFromDb();
    res.json(lot);
  } catch (err) {
    console.error("Fehler /api/lot:", err);
    res.status(500).json({ error: "Interner Fehler bei /api/lot" });
  }
});

// Reservieren
app.post("/api/spots/:id/reserve", requireAuth, async (req, res) => {
  try {
    await cleanupExpiredReservationsDb();
    const pool = await getPool();
    const spotId = req.params.id;

    // Lot laden (für reserveMinutes & pricing)
    const lot = await loadLotFromDb();

    const spotRes = await pool
      .request()
      .input("Id", sql.NVarChar(50), spotId)
      .query(`
        SELECT TOP 1 *
        FROM dbo.Spots
        WHERE Id = @Id;
      `);

    if (spotRes.recordset.length === 0) {
      return res.status(404).json({ error: "Spot not found" });
    }

    const spot = spotRes.recordset[0];

    if (spot.Status !== "AVAILABLE") {
      return res.status(400).json({ error: "Spot ist nicht frei" });
    }

    const minutes = lot.reserveMinutes || 15;
    const untilIso = new Date(Date.now() + minutes * 60 * 1000).toISOString();

    await pool
      .request()
      .input("Id", sql.NVarChar(50), spotId)
      .input("UserId", sql.NVarChar(50), req.session.userId)
      .input("Until", sql.DateTime2, untilIso)
      .query(`
        UPDATE dbo.Spots
        SET Status = 'RESERVED',
            ReservedBy = @UserId,
            ReservedUntil = @Until
        WHERE Id = @Id;
      `);

    // aktualisierten Lot zurückgeben
    const updatedLot = await loadLotFromDb();
    const updatedSpot = updatedLot.spots.find(s => s.id === spotId);

    res.json({ message: "Reserviert", spot: updatedSpot });
  } catch (err) {
    console.error("Fehler /reserve:", err);
    res.status(500).json({ error: "Interner Fehler bei der Reservierung" });
  }
});

// Check-in
app.post("/api/spots/:id/checkin", requireAuth, async (req, res) => {
  try {
    await cleanupExpiredReservationsDb();
    const pool = await getPool();
    const spotId = req.params.id;
    const userId = req.session.userId;

    const lot = await loadLotFromDb();

    const spotRes = await pool
      .request()
      .input("Id", sql.NVarChar(50), spotId)
      .query("SELECT TOP 1 * FROM dbo.Spots WHERE Id = @Id;");

    if (spotRes.recordset.length === 0) {
      return res.status(404).json({ error: "Spot not found" });
    }
    const spot = spotRes.recordset[0];

    if (spot.Status === "OCCUPIED") {
      return res.status(400).json({ error: "Spot bereits belegt" });
    }

    if (
      spot.Status === "RESERVED" &&
      spot.ReservedBy &&
      spot.ReservedBy !== userId
    ) {
      return res
        .status(403)
        .json({ error: "Spot ist von einem anderen Nutzer reserviert" });
    }

    const now = nowIso();

    // Spot belegen
    await pool
      .request()
      .input("Id", sql.NVarChar(50), spotId)
      .input("UserId", sql.NVarChar(50), userId)
      .input("Now", sql.DateTime2, now)
      .query(`
        UPDATE dbo.Spots
        SET Status = 'OCCUPIED',
            OccupiedBy = @UserId,
            OccupiedSince = @Now,
            ReservedBy = NULL,
            ReservedUntil = NULL
        WHERE Id = @Id;
      `);

    // Ticket anlegen
    const ticketId = makeId();
    await pool
      .request()
      .input("Id", sql.NVarChar(50), ticketId)
      .input("UserId", sql.NVarChar(50), userId)
      .input("SpotCode", sql.NVarChar(120), spot.Code)
      .input("StartTime", sql.DateTime2, now)
      .query(`
        INSERT INTO dbo.Tickets (Id, UserId, SpotCode, StartTime)
        VALUES (@Id, @UserId, @SpotCode, @StartTime);
      `);

    const updatedLot = await loadLotFromDb();
    const updatedSpot = updatedLot.spots.find(s => s.id === spotId);

    res.json({
      message: "Eingecheckt",
      spot: updatedSpot,
      ticket: {
        id: ticketId,
        userId,
        spotCode: spot.Code,
        start: now,
        end: null,
        amount: null
      }
    });
  } catch (err) {
    console.error("Fehler /checkin:", err);
    res.status(500).json({ error: "Interner Fehler beim Check-in" });
  }
});

// Check-out
app.post("/api/spots/:id/checkout", requireAuth, async (req, res) => {
  try {
    await cleanupExpiredReservationsDb();
    const pool = await getPool();
    const spotId = req.params.id;
    const userId = req.session.userId;

    const lot = await loadLotFromDb();

    const spotRes = await pool
      .request()
      .input("Id", sql.NVarChar(50), spotId)
      .query("SELECT TOP 1 * FROM dbo.Spots WHERE Id = @Id;");

    if (spotRes.recordset.length === 0) {
      return res.status(404).json({ error: "Spot not found" });
    }
    const spot = spotRes.recordset[0];

    if (spot.Status !== "OCCUPIED") {
      return res.status(400).json({ error: "Spot ist nicht belegt" });
    }
    if (spot.OccupiedBy !== userId) {
      return res.status(403).json({
        error: "Check-out nur für den Nutzer möglich, der eingecheckt hat"
      });
    }

    // aktives Ticket holen
    const ticketRes = await pool
      .request()
      .input("UserId", sql.NVarChar(50), userId)
      .input("SpotCode", sql.NVarChar(120), spot.Code)
      .query(`
        SELECT TOP 1 *
        FROM dbo.Tickets
        WHERE UserId = @UserId
          AND SpotCode = @SpotCode
          AND EndTime IS NULL
        ORDER BY StartTime DESC;
      `);

    if (ticketRes.recordset.length === 0) {
      return res.status(404).json({ error: "Kein aktives Ticket gefunden" });
    }

    const ticketRow = ticketRes.recordset[0];
    const endIso = nowIso();
    const amount = calcAmount(
      ticketRow.StartTime.toISOString(),
      endIso,
      lot.pricing
    );

    // Ticket updaten
    await pool
      .request()
      .input("Id", sql.NVarChar(50), ticketRow.Id)
      .input("EndTime", sql.DateTime2, endIso)
      .input("Amount", sql.Decimal(6, 2), amount)
      .query(`
        UPDATE dbo.Tickets
        SET EndTime = @EndTime,
            Amount = @Amount
        WHERE Id = @Id;
      `);

    // Spot wieder freigeben
    await pool
      .request()
      .input("Id", sql.NVarChar(50), spotId)
      .query(`
        UPDATE dbo.Spots
        SET Status = 'AVAILABLE',
            OccupiedBy = NULL,
            OccupiedSince = NULL
        WHERE Id = @Id;
      `);

    res.json({
      message: "Check-out OK",
      ticket: {
        id: ticketRow.Id,
        userId: ticketRow.UserId,
        spotCode: ticketRow.SpotCode,
        start: ticketRow.StartTime,
        end: endIso,
        amount
      }
    });
  } catch (err) {
    console.error("Fehler /checkout:", err);
    res.status(500).json({ error: "Interner Fehler beim Check-out" });
  }
});

// Tickets des eingeloggten Users
app.get("/api/tickets/my", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const userId = req.session.userId;

    const ticketsRes = await pool
      .request()
      .input("UserId", sql.NVarChar(50), userId)
      .query(`
        SELECT Id, UserId, SpotCode, StartTime, EndTime, Amount
        FROM dbo.Tickets
        WHERE UserId = @UserId
        ORDER BY StartTime DESC;
      `);

    const tickets = ticketsRes.recordset.map(t => ({
      id: t.Id,
      userId: t.UserId,
      spotCode: t.SpotCode,
      start: t.StartTime,
      end: t.EndTime,
      amount: t.Amount
    }));

    res.json(tickets);
  } catch (err) {
    console.error("Fehler /api/tickets/my:", err);
    res.status(500).json({ error: "Interner Fehler beim Laden der Tickets" });
  }
});

// ---------------------------------------------------------------------
//  Admin / Simulation
// ---------------------------------------------------------------------

// Reset Demo-Daten (Lot, Spots, Tickets)
app.post("/api/admin/reset-demo", async (req, res) => {
  try {
    const pool = await getPool();

    await pool.request().query(`
      DELETE FROM dbo.Tickets;
      DELETE FROM dbo.Spots;
      DELETE FROM dbo.ParkingLot;
    `);

    // Demo-Lot anlegen
    await pool
      .request()
      .input("Id", sql.NVarChar(50), "DemoLot")
      .input("Name", sql.NVarChar(100), "Demo-Lot")
      .input("PerHour", sql.Decimal(6, 2), 2.0)
      .input("DayMax", sql.Decimal(6, 2), 12.0)
      .input("ReserveMinutes", sql.Int, 15)
      .query(`
        INSERT INTO dbo.ParkingLot (Id, Name, PerHour, DayMax, ReserveMinutes)
        VALUES (@Id, @Name, @PerHour, @DayMax, @ReserveMinutes);
      `);

    // Spots wie im ursprünglichen Demo-Lot
    const zones = ["A", "B", "C"];
    const types = ["STANDARD", "STANDARD", "STANDARD", "EV", "DISABLED"];
    let idCounter = 1;

    for (let zi = 0; zi < zones.length; zi++) {
      const z = zones[zi];
      for (let i = 1; i <= 10; i++) {
        const type = types[(idCounter - 1) % types.length];
        const spotId = "S" + String(idCounter).padStart(2, "0");
        const code = z + "-" + String(i).padStart(2, "0");

        await pool
          .request()
          .input("Id", sql.NVarChar(50), spotId)
          .input("LotId", sql.NVarChar(50), "DemoLot")
          .input("Code", sql.NVarChar(20), code)
          .input("Zone", sql.NVarChar(10), z)
          .input("Type", sql.NVarChar(20), type)
          .input("Status", sql.NVarChar(20), "AVAILABLE")
          .query(`
            INSERT INTO dbo.Spots
              (Id, LotId, Code, Zone, Type, Status)
            VALUES
              (@Id, @LotId, @Code, @Zone, @Type, @Status);
          `);

        idCounter++;
      }
    }

    res.json({ message: "Demo-Daten zurückgesetzt" });
  } catch (err) {
    console.error("Fehler /api/admin/reset-demo:", err);
    res.status(500).json({ error: "Interner Fehler beim Reset" });
  }
});

// Zufällig belegen
app.post("/api/admin/random-occupy", async (req, res) => {
  try {
    const body = req.body || {};
    const count = Number(body.count || 4);
    const pool = await getPool();

    await pool
      .request()
      .input("Count", sql.Int, count)
      .query(`
        ;WITH c AS (
          SELECT TOP (@Count) Id
          FROM dbo.Spots
          WHERE Status = 'AVAILABLE'
          ORDER BY NEWID()
        )
        UPDATE s
        SET Status = 'OCCUPIED',
            OccupiedBy = '__sensor__',
            OccupiedSince = SYSDATETIME()
        FROM dbo.Spots s
        INNER JOIN c ON s.Id = c.Id;
      `);

    const lot = await loadLotFromDb();
    res.json({ message: "Random occupy", lot });
  } catch (err) {
    console.error("Fehler /api/admin/random-occupy:", err);
    res.status(500).json({ error: "Interner Fehler bei random-occupy" });
  }
});

// Zufällig freigeben
app.post("/api/admin/random-free", async (req, res) => {
  try {
    const body = req.body || {};
    const count = Number(body.count || 4);
    const pool = await getPool();

    await pool
      .request()
      .input("Count", sql.Int, count)
      .query(`
        ;WITH c AS (
          SELECT TOP (@Count) Id
          FROM dbo.Spots
          WHERE Status = 'OCCUPIED'
            AND OccupiedBy = '__sensor__'
          ORDER BY NEWID()
        )
        UPDATE s
        SET Status = 'AVAILABLE',
            OccupiedBy = NULL,
            OccupiedSince = NULL
        FROM dbo.Spots s
        INNER JOIN c ON s.Id = c.Id;
      `);

    const lot = await loadLotFromDb();
    res.json({ message: "Random free", lot });
  } catch (err) {
    console.error("Fehler /api/admin/random-free:", err);
    res.status(500).json({ error: "Interner Fehler bei random-free" });
  }
});

// Zufälliges Event (nur Name + eine der beiden Aktionen)
app.post("/api/admin/random-event", async (req, res) => {
  try {
    const events = [
      { name: "📢 Rush Hour: +5 Spots belegt", type: "occupy", count: 5 },
      { name: "🌧️ Regen: +3 Spots belegt", type: "occupy", count: 3 },
      { name: "🎉 Event in der Nähe: +8 Spots belegt", type: "occupy", count: 8 },
      { name: "🚓 Kontrolle: +4 Spots frei", type: "free", count: 4 },
      { name: "😐 Ruhiger Betrieb: keine Änderung", type: "none", count: 0 }
    ];

    const ev = events[Math.floor(Math.random() * events.length)];

    if (ev.type === "occupy") {
      const pool = await getPool();
      await pool
        .request()
        .input("Count", sql.Int, ev.count)
        .query(`
          ;WITH c AS (
            SELECT TOP (@Count) Id
            FROM dbo.Spots
            WHERE Status = 'AVAILABLE'
            ORDER BY NEWID()
          )
          UPDATE s
          SET Status = 'OCCUPIED',
              OccupiedBy = '__sensor__',
              OccupiedSince = SYSDATETIME()
          FROM dbo.Spots s
          INNER JOIN c ON s.Id = c.Id;
        `);
    } else if (ev.type === "free") {
      const pool = await getPool();
      await pool
        .request()
        .input("Count", sql.Int, ev.count)
        .query(`
          ;WITH c AS (
            SELECT TOP (@Count) Id
            FROM dbo.Spots
            WHERE Status = 'OCCUPIED'
              AND OccupiedBy = '__sensor__'
            ORDER BY NEWID()
          )
          UPDATE s
          SET Status = 'AVAILABLE',
              OccupiedBy = NULL,
              OccupiedSince = NULL
          FROM dbo.Spots s
          INNER JOIN c ON s.Id = c.Id;
        `);
    }

    const lot = await loadLotFromDb();
    res.json({ message: ev.name, lot });
  } catch (err) {
    console.error("Fehler /api/admin/random-event:", err);
    res.status(500).json({ error: "Interner Fehler bei random-event" });
  }
});
app.get("/api/version", (req, res) => {
  res.json({
    version: APP_VERSION,
    dbHost: process.env.DB_HOST || null,
    dbName: process.env.DB_NAME || null
  });
});


// Admin-Statistik (Anzahl Nutzer & Tickets)
app.get("/api/admin/stats", async (req, res) => {
  try {
    const pool = await getPool();

    const usersRes = await pool.request().query("SELECT COUNT(*) AS c FROM dbo.Users;");
    const ticketsRes = await pool.request().query("SELECT COUNT(*) AS c FROM dbo.Tickets;");

    res.json({
      users: usersRes.recordset[0].c,
      tickets: ticketsRes.recordset[0].c
    });
  } catch (err) {
    console.error("Fehler /api/admin/stats:", err);
    res.status(500).json({ error: "Interner Fehler bei /api/admin/stats" });
  }
});

// ---------------------------------------------------------------------
//  Server starten
// ---------------------------------------------------------------------
app.listen(PORT, () => {
  console.log("SmartParking backend running on http://localhost:" + PORT);
});
