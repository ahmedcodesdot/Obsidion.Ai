const $ = id => document.getElementById(id);
window.AAI_READY = true;
window.AAI_AUTH = { getToken: async () => null };
const cfg = window.FIREBASE_CONFIG || {};
const startUid = localStorage.getItem("aai_uid") || "";

if (!cfg.apiKey) {
  // No Firebase configured: skip auth entirely, let the app show itself.
  window.AAI_NO_AUTH = true;
} else {
  try {
    const V = "10.14.1";
    const [{ initializeApp }, A] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`)
    ]);
    const auth = A.getAuth(initializeApp(cfg));
    window.AAI_AUTH.getToken = async () => (auth.currentUser ? auth.currentUser.getIdToken() : null);
    let mode = "in";
    const errs = {
      "auth/invalid-credential": "Wrong email or password.",
      "auth/user-not-found": "No account found with this email.",
      "auth/wrong-password": "Wrong password.",
      "auth/email-already-in-use": "This email is already registered. Sign in instead.",
      "auth/weak-password": "Password must be at least 6 characters.",
      "auth/invalid-email": "Enter a valid email.",
      "auth/popup-closed-by-user": "Google window was closed.",
      "auth/too-many-requests": "Too many attempts. Try again later.",
      "auth/network-request-failed": "Network error.",
      "auth/unauthorized-domain": "This website isn't authorised in Firebase."
    };
    const say = (e, ok) => { const el = $("authError"); el.className = "auth-error" + (ok ? " success" : ""); el.textContent = ok ? e : (errs[e.code] || "Error: " + (e.code || e.message)); };
    const setMode = m => {
      mode = m; const up = m === "up";
      $("authTitle").textContent = up ? "Create account" : "Welcome back";
      $("authSubtitle").textContent = up ? "Takes a few seconds" : "Sign in to your account";
      $("authName").style.display = up ? "block" : "none";
      $("authSubmit").textContent = up ? "Sign up" : "Sign in";
      $("authToggle").textContent = up ? "Already have an account? Sign in" : "Don't have an account? Sign up";
      $("authForgot").style.display = up ? "none" : "inline";
      $("authPass").autocomplete = up ? "new-password" : "current-password";
      say("", true);
    };
    $("authToggle").onclick = e => { e.preventDefault(); setMode(mode === "in" ? "up" : "in"); };
    $("authForgot").onclick = async e => {
      e.preventDefault();
      const em = $("authEmail").value.trim();
      if (!em) return say({ code: "auth/invalid-email" });
      try { await A.sendPasswordResetEmail(auth, em); say("Reset link sent to your email.", true); } catch (x) { say(x); }
    };
    $("authForm").onsubmit = async e => {
      e.preventDefault();
      const btn = $("authSubmit"); btn.disabled = true; say("", true);
      const em = $("authEmail").value.trim(), pw = $("authPass").value;
      try {
        if (mode === "up") {
          const c = await A.createUserWithEmailAndPassword(auth, em, pw);
          const n = $("authName").value.trim();
          if (n) { await A.updateProfile(c.user, { displayName: n }); await c.user.reload(); }
          apply(auth.currentUser);
        } else await A.signInWithEmailAndPassword(auth, em, pw);
      } catch (x) { say(x); }
      btn.disabled = false;
    };
    $("googleBtn").onclick = async () => {
      const p = new A.GoogleAuthProvider();
      try { await A.signInWithPopup(auth, p); }
      catch (x) {
        if (x.code === "auth/popup-blocked" || x.code === "auth/operation-not-supported-in-this-environment") { try { await A.signInWithRedirect(auth, p); } catch (y) { say(y); } }
        else say(x);
      }
    };
    // Real Firebase sign-out, exposed so the app's own logout button can call it.
    window.AAI_AUTH.signOut = () => A.signOut(auth);

    function apply(u) {
      if (!u) {
        localStorage.setItem("aai_uid", "");
        if (startUid) { location.reload(); return; }
        window.AAI_USER = null;
        window.dispatchEvent(new CustomEvent("aai-auth-change", { detail: null }));
        return;
      }
      const nm = u.displayName || (u.email || "").split("@")[0] || "User";
      localStorage.setItem("aai_name", nm.split(" ")[0]);
      if (u.uid !== startUid) { localStorage.setItem("aai_uid", u.uid); location.reload(); return; }
      window.AAI_USER = u;
      window.dispatchEvent(new CustomEvent("aai-auth-change", { detail: u }));
    }
    A.onAuthStateChanged(auth, apply);
  } catch (err) {
    console.error(err);
    // Firebase failed to load/initialize: don't trap the user on a dead login screen.
    window.AAI_NO_AUTH = true;
    window.dispatchEvent(new CustomEvent("aai-no-auth"));
  }
}
