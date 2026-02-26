// frontend.js
// Drop this into your HTML via <script src="frontend.js"></script>
// (or paste into a <script> tag)
//
// Assumes your HTML has the following element IDs:
//   Auth form:        #auth-form, #auth-action (select), #auth-username, #auth-password, #auth-error
//   Dashboard:        #dashboard, #welcome-name, #balance-display, #txn-history
//   Transaction form: #txn-form, #txn-action (select), #txn-amount, #txn-error
//   Logout button:    #logout-btn

const API = {
  auth: "/api/auth",
  transactions: "/api/transactions",
};

// ── Token helpers ─────────────────────────────────────────────
function saveToken(token, username) {
  localStorage.setItem("token", token);
  localStorage.setItem("username", username);
}
function getToken() {
  return localStorage.getItem("token");
}
function clearToken() {
  localStorage.removeItem("token");
  localStorage.removeItem("username");
}

// ── UI helpers ────────────────────────────────────────────────
function showDashboard() {
  document.getElementById("auth-form")?.closest("section")?.classList.add("hidden");
  document.getElementById("dashboard")?.classList.remove("hidden");
  const username = localStorage.getItem("username") ?? "User";
  const el = document.getElementById("welcome-name");
  if (el) el.textContent = username;
}
function showAuthForm() {
  document.getElementById("auth-form")?.closest("section")?.classList.remove("hidden");
  document.getElementById("dashboard")?.classList.add("hidden");
}
function setError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg ?? "";
}

// ── Auth ──────────────────────────────────────────────────────
async function handleAuth(e) {
  e.preventDefault();
  setError("auth-error", "");

  const action   = document.getElementById("auth-action")?.value;   // "signup" | "login"
  const username = document.getElementById("auth-username")?.value?.trim();
  const password = document.getElementById("auth-password")?.value;

  try {
    const res = await fetch(API.auth, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, username, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError("auth-error", data.error ?? "Something went wrong");
      return;
    }

    saveToken(data.token, data.username);
    showDashboard();
    loadDashboard();
  } catch (err) {
    setError("auth-error", "Network error — please try again");
    console.error(err);
  }
}

// ── Load balance + history ────────────────────────────────────
async function loadDashboard() {
  const token = getToken();
  if (!token) return;

  try {
    const res = await fetch(API.transactions, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) { logout(); return; }

    const data = await res.json();

    const balanceEl = document.getElementById("balance-display");
    if (balanceEl) balanceEl.textContent = `$${parseFloat(data.balance).toFixed(2)}`;

    renderHistory(data.transactions ?? []);
  } catch (err) {
    console.error("loadDashboard error:", err);
  }
}

function renderHistory(transactions) {
  const el = document.getElementById("txn-history");
  if (!el) return;

  if (!transactions.length) {
    el.innerHTML = "<p>No transactions yet.</p>";
    return;
  }

  el.innerHTML = transactions
    .map(
      (t) => `
      <div class="txn-item txn-${t.type}">
        <span class="txn-type">${t.type === "deposit" ? "⬆ Deposit" : "⬇ Withdraw"}</span>
        <span class="txn-amount">$${parseFloat(t.amount).toFixed(2)}</span>
        <span class="txn-balance">Balance after: $${parseFloat(t.balance_after).toFixed(2)}</span>
        <span class="txn-date">${new Date(t.created_at).toLocaleString()}</span>
      </div>`
    )
    .join("");
}

// ── Deposit / Withdraw ────────────────────────────────────────
async function handleTransaction(e) {
  e.preventDefault();
  setError("txn-error", "");

  const token  = getToken();
  const action = document.getElementById("txn-action")?.value;  // "deposit" | "withdraw"
  const amount = document.getElementById("txn-amount")?.value;

  try {
    const res = await fetch(API.transactions, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action, amount: parseFloat(amount) }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError("txn-error", data.error ?? "Transaction failed");
      return;
    }

    // Update balance display immediately
    const balanceEl = document.getElementById("balance-display");
    if (balanceEl) balanceEl.textContent = `$${parseFloat(data.balance).toFixed(2)}`;

    document.getElementById("txn-amount").value = "";
    loadDashboard(); // refresh full history
  } catch (err) {
    setError("txn-error", "Network error — please try again");
    console.error(err);
  }
}

// ── Logout ────────────────────────────────────────────────────
function logout() {
  clearToken();
  showAuthForm();
}

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("auth-form")?.addEventListener("submit", handleAuth);
  document.getElementById("txn-form")?.addEventListener("submit", handleTransaction);
  document.getElementById("logout-btn")?.addEventListener("click", logout);

  if (getToken()) {
    showDashboard();
    loadDashboard();
  } else {
    showAuthForm();
  }
});
