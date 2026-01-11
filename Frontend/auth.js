/* Registration + Login über Backend-API (statt localStorage) */

const API_BASE = "http://127.0.0.1:3000";


document.addEventListener("DOMContentLoaded", () => {
  const regForm = document.getElementById("registerForm");
  const loginForm = document.getElementById("loginForm");

  // ---------- REGISTRIERUNG ----------
  if (regForm) {
    regForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const anrede = document.getElementById("anrede").value.trim();
      const vorname = document.getElementById("vorname").value.trim();
      const nachname = document.getElementById("nachname").value.trim();
      const email = document.getElementById("email").value.trim();
      const emailRepeat = document.getElementById("emailRepeat").value.trim();
      const password = document.getElementById("password").value;
      const passwordRepeat = document.getElementById("passwordRepeat").value;
      const geburtsdatum = document.getElementById("geburtsdatum").value;
      const plz = document.getElementById("plz").value.trim();
      const carPlate = document.getElementById("carPlate").value.trim();
      const errorMsg = document.getElementById("errorMsg");

      errorMsg.textContent = "";

      // --- Client-Validierung wie vorher ---
      if (email !== emailRepeat) {
        errorMsg.textContent = "Die E-Mail-Adressen stimmen nicht überein.";
        return;
      }
      if (password !== passwordRepeat) {
        errorMsg.textContent = "Die Passwörter stimmen nicht überein.";
        return;
      }
      if (!/^\d{5}$/.test(plz)) {
        errorMsg.textContent = "Bitte geben Sie eine gültige 5-stellige PLZ ein.";
        return;
      }

      const age = calculateAge(new Date(geburtsdatum));
      if (age < 18) {
        errorMsg.textContent = "Sie müssen mindestens 18 Jahre alt sein.";
        return;
      }

      // --- Request an Backend senden ---
      try {
        const res = await fetch(API_BASE + "/api/register", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          credentials: "include",
          body: JSON.stringify({
            anrede,
            vorname,
            nachname,
            email,
            password,
            geburtsdatum,
            plz,
            carPlate
          })
        });

        if (!res.ok) {
          let msg = "Fehler bei der Registrierung.";
          try {
            const data = await res.json();
            if (data && data.error) msg = data.error;
          } catch (_) {}
          errorMsg.textContent = msg;
          return;
        }

        // Erfolgreich -> Formular ausblenden, Erfolgsbox zeigen
        document.getElementById("registerForm").classList.add("d-none");
        document.getElementById("successMessage").classList.remove("d-none");
      } catch (err) {
        console.error(err);
        errorMsg.textContent = "Netzwerkfehler. Bitte später erneut versuchen.";
      }
    });
  }

  // ---------- LOGIN ----------
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const email = document.getElementById("loginEmail").value.trim();
      const password = document.getElementById("loginPassword").value;
      const loginError = document.getElementById("loginError");
      loginError.textContent = "";

      try {
        const res = await fetch(API_BASE + "/api/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          credentials: "include", // wichtig für Cookie-Session
          body: JSON.stringify({ email, password })
        });

        if (!res.ok) {
          let msg = "Login fehlgeschlagen. Bitte prüfen Sie E-Mail/Passwort.";
          try {
            const data = await res.json();
            if (data && data.error) msg = data.error;
          } catch (_) {}
          loginError.textContent = msg;
          return;
        }

        const data = await res.json();

        // Demo: zusätzlich lokale Session setzen,
        // damit dein bestehendes Frontend (spGetSession) weiter funktioniert
        if (data && data.user) {
          spSetSession({
            userId: data.user.id,
            email: email,
            loginAt: spNowIso()
          });
        }

        window.location.href = "dashboard.html";
      } catch (err) {
        console.error(err);
        loginError.textContent =
          "Netzwerkfehler beim Login. Bitte später erneut versuchen.";
      }
    });
  }
});

function calculateAge(birthday) {
  const today = new Date();
  let age = today.getFullYear() - birthday.getFullYear();
  const m = today.getMonth() - birthday.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthday.getDate())) age--;
  return age;
}
