/* ---------- API BASE ---------- */
const API_BASE = "https://urban-walker-vault-1.onrender.com/api";

/* ---------- QUICK UTILITIES ---------- */
const utils = {
  fetchJson: async (url, opts = {}) => {
    opts.headers = { "Content-Type": "application/json" };
    const token = localStorage.getItem("token");
    if (token) opts.headers["Authorization"] = "Bearer " + token;

    const res = await fetch(url, opts);
    const data = await res.json().catch(() => null);

    if (!res.ok) throw new Error(data?.error || "Request failed");
    return data;
  },
  msg: (t) => alert(t)
};

/* ---------- BASIC BUTTON HANDLERS ---------- */
document.addEventListener("DOMContentLoaded", () => {

  // Register
  const regBtn = document.getElementById("registerBtn");
  if (regBtn) regBtn.addEventListener("click", () => {
    location.href = "register.html";
  });

  // Sign In
  const signInBtn = document.getElementById("signInBtn");
  if (signInBtn) signInBtn.addEventListener("click", () => {
    location.href = "signin.html";
  });

  // Shop Now
  const shopBtn = document.getElementById("shopNowBtn");
  if (shopBtn) shopBtn.addEventListener("click", () => {
    location.href = "inventory.html";
  });

  // Logout
  const logoutLinks = document.querySelectorAll("[onClick='signOut()']");
  logoutLinks.forEach(btn => btn.addEventListener("click", signOut));

  // Load Sneakers (simple)
  if (document.getElementById("featuredGrid")) loadFeatured();
  if (document.getElementById("inventoryGrid")) loadInventory();
});

/* ---------- SIMPLE SNEAKER LOADERS ---------- */

// Home page featured
async function loadFeatured() {
  try {
    const data = await utils.fetchJson(`${API_BASE}/sneakers`);
    const grid = document.getElementById("featuredGrid");

    if (!data.length) {
      document.getElementById("featuredEmptyMsg").style.display = "block";
      return;
    }

    grid.innerHTML = "";
    data.forEach(s => {
      const div = document.createElement("div");
      div.className = "sneaker-card";
      div.innerHTML = `
        <img src="${s.image}" class="sneaker-img">
        <h3>${s.name}</h3>
        <p>${s.desc}</p>
        <p><strong>R${s.price}</strong></p>
      `;
      grid.appendChild(div);
    });

  } catch {
    utils.msg("Failed to load featured sneakers");
  }
}

// Inventory page
async function loadInventory() {
  try {
    const data = await utils.fetchJson(`${API_BASE}/sneakers`);
    const grid = document.getElementById("inventoryGrid");

    grid.innerHTML = "";
    data.forEach(s => {
      const div = document.createElement("div");
      div.className = "sneaker-card";
      div.innerHTML = `
        <img src="${s.image}" class="sneaker-img">
        <h3>${s.name}</h3>
        <p>${s.desc}</p>
        <p><strong>R${s.price}</strong></p>
      `;
      grid.appendChild(div);
    });

  } catch {
    utils.msg("Failed to load inventory");
  }
}

/* ---------- SIGN OUT ---------- */
function signOut() {
  localStorage.clear();
  location.href = "index.html";
}
