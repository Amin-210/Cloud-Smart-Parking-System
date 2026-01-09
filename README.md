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
