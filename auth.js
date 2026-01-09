/* Registration + Login (localStorage) */

document.addEventListener("DOMContentLoaded", () => {
  const regForm = document.getElementById("registerForm");
  const loginForm = document.getElementById("loginForm");

  if(regForm){
    regForm.addEventListener("submit", (e) => {
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

      if(email !== emailRepeat){
        errorMsg.textContent = "Die E-Mail-Adressen stimmen nicht überein.";
        return;
      }
      if(password !== passwordRepeat){
        errorMsg.textContent = "Die Passwörter stimmen nicht überein.";
        return;
      }
      if(!/^\d{5}$/.test(plz)){
        errorMsg.textContent = "Bitte geben Sie eine gültige 5-stellige PLZ ein.";
        return;
      }

      const age = calculateAge(new Date(geburtsdatum));
      if(age < 18){
        errorMsg.textContent = "Sie müssen mindestens 18 Jahre alt sein.";
        return;
      }

      const users = spLoad(SP_KEYS.USERS, []);
      if(users.some(u => u.email.toLowerCase() === email.toLowerCase())){
        errorMsg.textContent = "Diese E-Mail ist bereits registriert.";
        return;
      }

      users.push({
        id: crypto.randomUUID(),
        anrede, vorname, nachname, email,
        passwordHash: simpleHash(password), // demo only
        geburtsdatum, plz,
        carPlate
      });
      spSave(SP_KEYS.USERS, users);

      document.getElementById("registerForm").classList.add("d-none");
      document.getElementById("successMessage").classList.remove("d-none");
    });
  }

  if(loginForm){
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();

      const email = document.getElementById("loginEmail").value.trim();
      const password = document.getElementById("loginPassword").value;
      const loginError = document.getElementById("loginError");
      loginError.textContent = "";

      const user = spGetUserByEmail(email);
      if(!user || user.passwordHash !== simpleHash(password)){
        loginError.textContent = "Login fehlgeschlagen. Bitte prüfen Sie E-Mail/Passwort.";
        return;
      }

      spSetSession({ userId: user.id, email: user.email, loginAt: spNowIso() });
      window.location.href = "dashboard.html";
    });
  }
});

function calculateAge(birthday){
  const today = new Date();
  let age = today.getFullYear() - birthday.getFullYear();
  const m = today.getMonth() - birthday.getMonth();
  if(m < 0 || (m === 0 && today.getDate() < birthday.getDate())) age--;
  return age;
}

// NOT cryptographically secure. Demo only.
function simpleHash(str){
  let h = 0;
  for(let i=0;i<str.length;i++){
    h = (h<<5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return String(h);
}
