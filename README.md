# Smart Parking System (University Project) — Frontend Demo

This is a **pure HTML/CSS/JS** demo (no backend) built by adapting your existing multi-page Bootstrap setup
and localStorage logic.

## Pages
- `index.html` — Landing
- `registrierung.html` — Registration
- `login.html` — Login
- `dashboard.html` — Smart Parking dashboard (availability, reservation, check-in/out, pricing)
- `admin.html` — Admin / operator view (simulate sensors/events)

## How to run
Open `index.html` in a browser (Chrome/Firefox recommended).  
For best results run a local server:

### Option A (VS Code)
Use "Live Server" extension.

### Option B (Python)
python -m http.server 8000
Then open http://localhost:8000/smart_parking/index.html

## Data storage
All data is stored in `localStorage`:
- users, session
- parking lot layout
- reservations, tickets, payments


## Backend (Node.js + Express)

Ab dieser Version verwendet das Projekt ein kleines Node.js-Backend als „Fake-Server“
für das University-Projekt.

**Technologie:**

- Node.js + Express
- In-Memory „Datenbank“ (wird beim Server-Start neu initialisiert)
- Session-basierte Authentifizierung über HTTP-Only Cookie (`sid`)

### API-Endpoints (Auszug)

- `POST /api/register`  
  Registriert einen neuen Nutzer. Erwartet JSON-Body mit:
  `anrede, vorname, nachname, email, password, geburtsdatum, plz, carPlate`.

- `POST /api/login`  
  Prüft E-Mail/Passwort, legt Server-Session an und setzt ein Cookie `sid`.

- `GET /api/me`  
  Liefert die aktuellen User-Daten zur aktiven Session zurück.

- `POST /api/logout`  
  Löscht die Session und das Cookie.

- `GET /api/lot`  
  Liefert das aktuelle Parking-Lot mit allen Spots und ihrem Status
  (`AVAILABLE | RESERVED | OCCUPIED`).

- `POST /api/spots/:id/reserve`  
  Reserviert einen freien Spot für den aktuellen Nutzer (Timer im Backend).

- `POST /api/spots/:id/checkin`  
  Check-in auf einen Spot, erzeugt ein Ticket.

- `POST /api/spots/:id/checkout`  
  Check-out, beendet Ticket und berechnet Betrag (€/h mit Tagesmaximum).

- `GET /api/tickets/my`  
  Liefert alle Tickets für den aktuellen Nutzer.

- `POST /api/admin/random-occupy`  
  Simuliert, dass zufällige Plätze belegt werden (Sensor-Simulation).

- `POST /api/admin/random-free`  
  Simuliert zufällige Freigabe.

- `POST /api/admin/random-event`  
  Simuliert ein zufälliges Event (Rush Hour, Regen, etc.).

- `POST /api/admin/reset-demo`  
  Setzt Demo-Daten (Nutzer, Lot, Tickets, Sessions) zurück.

- `GET /api/admin/stats`  
  Kleine Statistik: Anzahl registrierter Nutzer & Tickets.

### Startanleitung (Kurzfassung)

1. **Backend installieren & starten**

   ```bash
   npm install
   npm start
