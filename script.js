const API_BASE = "https://urban-walker-vault-1.onrender.com/api"

// Use localhost for dev if running from localhost
//const API_BASE = (/localhost|127\.0\.0\.1/.test(location.hostname)) ? "http://localhost:3001/api" : RENDER_BASE;

/* ---------- Utilities ---------- */
const utils = {
  token() { return localStorage.getItem("token"); },
  setSession(token, user) {
    if (token) localStorage.setItem("token", token);
    if (user) localStorage.setItem("currentUser", JSON.stringify(user));
  },
  clearSession() {
    localStorage.removeItem("token");
    localStorage.removeItem("currentUser");
  },
  currentUser() {
    try { return JSON.parse(localStorage.getItem("currentUser")); } catch { return null; }
  },
  fetchJson: async (url, opts = {}) => {
    opts.headers = opts.headers || {};
    if (opts.body && !(opts.body instanceof FormData) && !opts.headers['Content-Type']) {
      opts.headers['Content-Type'] = 'application/json';
    }
    // attach jwt if present
    const token = utils.token();
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, opts);
    const text = await res.text();
    if (!text) {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return {};
    }
    try {
      const json = JSON.parse(text);
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return json;
    } catch (e) {
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
      return text;
    }
  },
  showMessage(msg, type = 'info', duration = 3000) {
    try {
      const el = document.createElement('div');
      el.className = `site-message ${type}`;
      el.textContent = msg;
      Object.assign(el.style, {
        position: 'fixed', right: '16px', bottom: '16px', padding: '10px 14px',
        borderRadius: '8px', zIndex: 9999, fontFamily: 'sans-serif'
      });
      if (type === 'error') el.style.background = '#fdecea';
      else if (type === 'success') el.style.background = '#e6ffed';
      else el.style.background = '#eef2ff';
      document.body.appendChild(el);
      setTimeout(()=> el.remove(), duration);
    } catch (e) { console.warn(e); }
  }
};

/* ---------- Cart helpers (localStorage only) ---------- */
const cart = {
  key: 'uwv_cart_v1',
  get() { return JSON.parse(localStorage.getItem(this.key) || '[]'); },
  save(items) { localStorage.setItem(this.key, JSON.stringify(items)); window.dispatchEvent(new Event('cartUpdated')); },
  add(item) {
    const list = this.get();
    list.push(item);
    this.save(list);
  },
  clear() { localStorage.removeItem(this.key); window.dispatchEvent(new Event('cartUpdated')); }
};

/* ---------- Auth helpers ---------- */
function requireAuth(redirect = true, role = null) {
  const u = utils.currentUser();
  if (!u) {
    if (redirect) location.href = 'signin.html';
    return false;
  }
  if (role && u.role !== role) {
    alert('Access denied'); location.href = 'inventory.html'; return false;
  }
  return true;
}

function signOut() {
  utils.clearSession();
  location.href = 'signin.html';
}

/* ---------- Auth forms wiring ---------- */
document.addEventListener('submit', async (ev) => {
  const form = ev.target;
  if (form.id === 'signInForm') {
    ev.preventDefault();
    const email = form.querySelector('#email')?.value;
    const password = form.querySelector('#password')?.value;
    try {
      const data = await utils.fetchJson(`${API_BASE}/login`, { method: 'POST', body: JSON.stringify({ email, password }) });
      utils.setSession(data.token, data.user);
      const next = new URLSearchParams(location.search).get('next');
      location.href = next ? decodeURIComponent(next) : (data.user.role === 'admin' ? 'admin.html' : 'inventory.html');
    } catch (err) {
      utils.showMessage(err.message || 'Login failed', 'error', 5000);
    }
  }

  if (form.id === 'registerForm') {
    ev.preventDefault();
    const username = form.querySelector('#username')?.value;
    const email = form.querySelector('#email')?.value;
    const password = form.querySelector('#password')?.value;
    const confirm = form.querySelector('#confirmPassword')?.value || password;
    const role = form.querySelector('#role')?.value || 'user';
    if (password !== confirm) return utils.showMessage('Passwords do not match', 'error');
    try {
      await utils.fetchJson(`${API_BASE}/register`, { method: 'POST', body: JSON.stringify({ username, email, password, role }) });
      utils.showMessage('Registered — please sign in', 'success');
      setTimeout(()=> location.href = 'signin.html', 1000);
    } catch (err) {
      utils.showMessage(err.message || 'Register failed', 'error', 5000);
    }
  }
});

/* ---------- Load sneakers (inventory) ---------- */
async function fetchSneakers() {
  try {
    return await utils.fetchJson(`${API_BASE}/sneakers`);
  } catch (err) {
    console.warn('fetchSneakers failed', err);
    return [];
  }
}

/* ---------- Render functions ---------- */
async function renderFeaturedSneakers() {
  const grid = document.getElementById('featuredGrid'); if (!grid) return;
  grid.innerHTML = 'Loading...';
  const list = await fetchSneakers();
  grid.innerHTML = '';
  if (!list.length) { grid.innerHTML = '<div class="placeholder">No products yet</div>'; return; }
  list.forEach(s => {
    const card = document.createElement('div'); card.className = 'card';
    card.innerHTML = `
      <div class="card-img-wrap"><img src="${s.image || ''}" alt="${s.name || ''}" loading="lazy"/></div>
      <h3>${s.name || ''}</h3>
      <p>${s.desc || ''}</p>
      <div class="card-meta">R${Number(s.price||0).toFixed(2)}</div>
      <div class="card-actions">
        <button class="view-btn" data-id="${s.id}">View</button>
      </div>`;
    card.querySelector('.view-btn')?.addEventListener('click', () => openProductModalById(s.id));
    grid.appendChild(card);
  });
}

async function loadInventorySneakers() {
  const grid = document.getElementById('inventoryGrid'); if (!grid) return;
  grid.innerHTML = 'Loading...';
  const list = await fetchSneakers();
  grid.innerHTML = '';
  if (!list.length) { grid.innerHTML = '<div class="placeholder">No products available</div>'; return; }
  const user = utils.currentUser();
  list.forEach(s => {
    const div = document.createElement('div'); div.className = 'card'; div.dataset.id = s.id;
    const addBtn = (!user || user.role !== 'admin') ? `<button class="add-to-cart-btn" data-id="${s.id}" ${s.qty===0?'disabled':''}>${s.qty===0?'Out of Stock':'Add to Cart'}</button>` : '';
    const adminControls = (user && user.role === 'admin') ? `<div class="admin-controls"><button class="edit-sneaker-btn" data-id="${s.id}">Edit</button><button class="delete-sneaker-btn" data-id="${s.id}">Delete</button></div>` : '';
    div.innerHTML = `
      <div class="card-img-wrap"><img src="${s.image||''}" alt="${s.name||''}" loading="lazy"/></div>
      <h3>${s.name||''}</h3>
      <p>${s.desc||''}</p>
      <p>Price: R${Number(s.price||0).toFixed(2)}</p>
      <p>In Stock: ${s.qty!==undefined ? s.qty : 'N/A'}</p>
      ${addBtn}
      ${adminControls}
    `;
    grid.appendChild(div);
  });

  // delegation for add/edit/delete
  grid.addEventListener('click', async (ev) => {
    const t = ev.target;
    if (t.matches('.add-to-cart-btn')) {
      const id = t.dataset.id; openProductModalById(id); return;
    }
    if (t.matches('.edit-sneaker-btn')) {
      const id = t.dataset.id; await openEditSneakerModal(id); return;
    }
    if (t.matches('.delete-sneaker-btn')) {
      const id = t.dataset.id; if (!confirm('Delete?')) return;
      try {
        await utils.fetchJson(`${API_BASE}/sneakers/${id}`, { method: 'DELETE' });
        utils.showMessage('Deleted', 'success');
        loadInventorySneakers();
      } catch (err) { utils.showMessage('Delete failed', 'error'); }
    }
  });
}

/* ---------- Product modal ---------- */
function populateProductModal(s) {
  document.getElementById('productImage')?.setAttribute('src', s.image || '');
  document.getElementById('productName')?.textContent = s.name || '';
  document.getElementById('productDesc')?.textContent = s.desc || '';
  document.getElementById('productPrice')?.textContent = s.price ? `Price: R${s.price}` : '';
  const addBtn = document.getElementById('productAddToCart'); if (addBtn) addBtn.dataset.id = s.id;
}
async function openProductModalById(id) {
  const list = await fetchSneakers();
  const s = list.find(x => String(x.id) === String(id));
  if (!s) return utils.showMessage('Product not found', 'error');
  populateProductModal(s);
  const modal = document.getElementById('productModal'); if (modal) modal.style.display = 'flex';
}

/* ---------- Add to cart / Buy ---------- */
document.addEventListener('click', (ev) => {
  const t = ev.target;
  if (t.matches('#productAddToCart')) {
    const id = t.dataset.id; if (!id) return;
    // find product
    fetchSneakers().then(list => {
      const s = list.find(x => String(x.id) === String(id));
      if (!s) return utils.showMessage('Item not found', 'error');
      const sizeEl = document.getElementById('productSize'); const qtyEl = document.getElementById('productQty');
      const size = sizeEl ? sizeEl.value : ''; const qty = qtyEl ? Math.max(1, parseInt(qtyEl.value)||1) : 1;
      for (let i=0;i<qty;i++) cart.add({ id: s.id, name: s.name, desc: s.desc, price: s.price, image: s.image, size, qty: 1 });
      utils.showMessage('Added to cart','success');
      document.getElementById('productModal')?.style.display = 'none';
    }).catch(()=> utils.showMessage('Add failed','error'));
  }
  if (t.matches('#productBuyNow')) {
    document.getElementById('productAddToCart')?.click();
    location.href = 'cart.html';
  }
});

/* ---------- Cart page rendering ---------- */
function renderCartPage() {
  const list = cart.get();
  const grouped = {};
  list.forEach(it => {
    const key = `${it.id}::${it.size||''}`;
    if (!grouped[key]) grouped[key] = { ...it, qty: 0 };
    grouped[key].qty += 1;
  });
  const arr = Object.values(grouped);
  const cartList = document.getElementById('cartList'); if (!cartList) return;
  cartList.innerHTML = '';
  let total = 0;
  if (!arr.length){
    cartList.innerHTML = '<p>Your cart is empty</p>';
    document.getElementById('totalPrice') && (document.getElementById('totalPrice').textContent = '0.00');
    document.getElementById('checkoutBtn') && (document.getElementById('checkoutBtn').style.display = 'none');
    return;
  }
  document.getElementById('checkoutBtn') && (document.getElementById('checkoutBtn').style.display = '');
  arr.forEach(it => {
    const li = document.createElement('div'); li.className = 'cart-row';
    li.innerHTML = `<div class="left"><img src="${it.image||''}" alt="${it.name}"><div><div>${it.name}</div>${it.size?`<div>Size: ${it.size}</div>`:''}</div></div>
      <div class="right"><div>R${Number(it.price||0).toFixed(2)}</div><div>Qty: ${it.qty}</div>
      <div><button class="cart-decrease" data-key="${it.id}::${it.size||''}">-</button>
      <button class="cart-increase" data-key="${it.id}::${it.size||''}">+</button>
      <button class="cart-remove" data-key="${it.id}::${it.size||''}">Remove</button></div></div>`;
    cartList.appendChild(li);
    total += Number(it.price||0) * it.qty;
  });
  document.getElementById('totalPrice') && (document.getElementById('totalPrice').textContent = total.toFixed(2));

  // attach buttons
  cartList.querySelectorAll('.cart-decrease').forEach(b => b.addEventListener('click', () => changeCartQty(b.dataset.key, -1)));
  cartList.querySelectorAll('.cart-increase').forEach(b => b.addEventListener('click', () => changeCartQty(b.dataset.key, +1)));
  cartList.querySelectorAll('.cart-remove').forEach(b => b.addEventListener('click', () => removeCartKey(b.dataset.key)));
}
function changeCartQty(key, delta) {
  let list = cart.get();
  const grouped = {};
  list.forEach(it => {
    const k = `${it.id}::${it.size||''}`;
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(it);
  });
  const arr = grouped[key] || [];
  const newQty = Math.max(0, arr.length + delta);
  // rebuild list
  list = list.filter(it => `${it.id}::${it.size||''}` !== key);
  for (let i=0;i<newQty;i++) list.push({...arr[0] || { id: key.split('::')[0], name:'Item', price:0 }, qty:1});
  cart.save(list);
  renderCartPage();
  updateCartCount();
}
function removeCartKey(key) {
  let list = cart.get();
  list = list.filter(it => `${it.id}::${it.size||''}` !== key);
  cart.save(list);
  renderCartPage();
  updateCartCount();
}

/* ---------- Checkout ---------- */
async function doCheckout() {
  const user = utils.currentUser();
  if (!user) return location.href = 'signin.html';
  const raw = cart.get();
  if (!raw.length) return utils.showMessage('Cart is empty','info');

  // group
  const grouped = {};
  raw.forEach(it => {
    const key = `${it.id}::${it.size||''}`;
    if (!grouped[key]) grouped[key] = { id: it.id, name: it.name, desc: it.desc, price: it.price, qty: 0 };
    grouped[key].qty += 1;
  });
  const items = Object.values(grouped).map(i => ({ name: i.name, desc: i.desc, price: i.price, qty: i.qty }));
  const payload = { user: user.id || user.email || user.username, items, datetime: new Date().toISOString() };
  try {
    await utils.fetchJson(`${API_BASE}/purchase`, { method: 'POST', body: JSON.stringify(payload) });
    cart.clear();
    utils.showMessage('Checkout complete','success');
    renderCartPage();
  } catch (err) {
    utils.showMessage('Checkout failed: ' + (err.message||''), 'error');
  }
}

/* ---------- Purchase history ---------- */
async function renderPurchaseHistory() {
  const table = document.getElementById('purchaseTable'); if (!table) return;
  const user = utils.currentUser();
  const isAdmin = !!(user && user.role === 'admin');
  const url = isAdmin ? `${API_BASE}/purchase` : `${API_BASE}/purchase/${user?.id}`;
  try {
    const rows = await utils.fetchJson(url);
    const tbody = table.querySelector('tbody'); if (!tbody) return;
    tbody.innerHTML = '';
    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="5">No purchases yet</td></tr>`; return; }
    // rows likely are flat rows; group by date+user
    const groups = {};
    rows.forEach(r => {
      const key = `${r.date}|${r.user_id || r.user || ''}`;
      if (!groups[key]) groups[key] = { date: r.date, user: r.user_id || r.user || 'unknown', items: [], total: 0 };
      groups[key].items.push({ item: r.item, desc: r.item_desc, price: r.price });
      groups[key].total += Number(r.price||0);
    });
    for (const g of Object.values(groups).reverse()) {
      const tr = document.createElement('tr');
      if (isAdmin) tr.innerHTML = `<td>${new Date(g.date).toLocaleString()}</td><td>${g.user}</td><td>${g.items.map(i=>i.item).join(', ')}</td><td>${g.items.map(i=>i.desc).filter(Boolean).join(', ')}</td><td>R${g.total.toFixed(2)}</td>`;
      else tr.innerHTML = `<td>${new Date(g.date).toLocaleString()}</td><td>${g.items.map(i=>i.item).join(', ')}</td><td>${g.items.map(i=>i.desc).filter(Boolean).join(', ')}</td><td>R${g.total.toFixed(2)}</td>`;
      table.querySelector('tbody').appendChild(tr);
    }
  } catch (err) {
    console.warn(err);
    table.querySelector('tbody').innerHTML = `<tr><td colspan="5">Failed to load purchases</td></tr>`;
  }
}

/* ---------- Admin: Add/Edit Sneakers ---------- */
async function openEditSneakerModal(id) {
  try {
    const list = await fetchSneakers();
    const s = list.find(x => String(x.id) === String(id));
    if (!s) return utils.showMessage('Not found','error');
    document.getElementById('editSneakerId').value = s.id;
    document.getElementById('editSneakerName').value = s.name || '';
    document.getElementById('editSneakerPrice').value = s.price || 0;
    document.getElementById('editSneakerQty').value = s.qty || 0;
    document.getElementById('editSneakerImage').value = s.image || '';
    document.getElementById('editSneakerDesc').value = s.desc || '';
    document.getElementById('editSneakerModal').style.display = 'block';
  } catch (err) {
    utils.showMessage('Load failed','error');
  }
}

document.addEventListener('submit', async (ev) => {
  const form = ev.target;
  // create sneaker (admin form id 'sneakerForm')
  if (form.id === 'sneakerForm') {
    ev.preventDefault();
    const payload = {
      name: form.querySelector('#sneakerName').value,
      image: form.querySelector('#sneakerImage').value,
      price: Number(form.querySelector('#sneakerPrice').value)||0,
      qty: Number(form.querySelector('#sneakerQty').value)||0,
      desc: form.querySelector('#sneakerDesc').value||''
    };
    try {
      await utils.fetchJson(`${API_BASE}/sneakers`, { method: 'POST', body: JSON.stringify(payload) });
      utils.showMessage('Sneaker added','success');
      form.reset();
      renderAdminInventoryTable();
    } catch (err) {
      utils.showMessage('Create failed','error');
    }
  }

  // edit sneaker (editSneakerForm)
  if (form.id === 'editSneakerForm') {
    ev.preventDefault();
    const id = form.querySelector('#editSneakerId').value;
    const payload = {
      name: form.querySelector('#editSneakerName').value,
      image: form.querySelector('#editSneakerImage').value,
      price: Number(form.querySelector('#editSneakerPrice').value)||0,
      qty: Number(form.querySelector('#editSneakerQty').value)||0,
      desc: form.querySelector('#editSneakerDesc').value||''
    };
    try {
      await utils.fetchJson(`${API_BASE}/sneakers/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      utils.showMessage('Updated','success');
      document.getElementById('editSneakerModal').style.display = 'none';
      renderAdminInventoryTable();
    } catch (err) {
      utils.showMessage('Update failed','error');
    }
  }
});

/* ---------- Admin Inventory Table ---------- */
async function renderAdminInventoryTable() {
  const tbody = document.querySelector('#sneakerTable tbody'); if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';
  try {
    const list = await fetchSneakers();
    tbody.innerHTML = '';
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="5">No sneakers</td></tr>'; return; }
    list.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${s.name||''}</td><td>${s.desc||''}</td><td>R${Number(s.price||0).toFixed(2)}</td><td>${s.qty||0}</td>
        <td><button class="admin-edit" data-id="${s.id}">Edit</button> <button class="admin-delete" data-id="${s.id}">Delete</button></td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('.admin-edit').forEach(b=>b.addEventListener('click', e=> openEditSneakerModal(e.target.dataset.id)));
    tbody.querySelectorAll('.admin-delete').forEach(b=> b.addEventListener('click', async (e)=>{
      if (!confirm('Delete?')) return;
      try { await utils.fetchJson(`${API_BASE}/sneakers/${e.target.dataset.id}`, { method: 'DELETE' }); renderAdminInventoryTable(); utils.showMessage('Deleted','success'); }
      catch { utils.showMessage('Delete failed','error'); }
    }));
  } catch { tbody.innerHTML = '<tr><td colspan="5">Failed to load</td></tr>'; }
}

/* ---------- Staff management ---------- */
async function loadStaff() {
  const tbody = document.querySelector('#staffTable tbody'); if (!tbody) return;
  try {
    const list = await utils.fetchJson(`${API_BASE}/staff`);
    tbody.innerHTML = '';
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="5">No staff</td></tr>'; return; }
    list.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${s.id}</td><td>${s.fullName}</td><td>${s.email}</td><td>${s.role}</td><td><button class="remove-staff" data-id="${s.id}">Remove</button></td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('.remove-staff').forEach(b => b.addEventListener('click', async (e) => {
      if (!confirm('Remove staff?')) return;
      try { await utils.fetchJson(`${API_BASE}/staff/${e.target.dataset.id}`, { method: 'DELETE' }); loadStaff(); utils.showMessage('Removed','success'); }
      catch { utils.showMessage('Remove failed','error'); }
    }));
  } catch (err) { tbody.innerHTML = '<tr><td colspan="5">Failed to load</td></tr>'; }
}

/* ---------- Dashboard stats ---------- */
async function loadDashboardData() {
  const elUsers = document.getElementById('totalUsers'); const elStaff = document.getElementById('totalStaff'); const elProducts = document.getElementById('totalSneakers'); const elRevenue = document.getElementById('totalRevenue');
  if (!elUsers && !elStaff && !elProducts && !elRevenue) return;
  try {
    const [u, st, pr, rv] = await Promise.all([
      utils.fetchJson(`${API_BASE}/stats/users`),
      utils.fetchJson(`${API_BASE}/stats/staff`),
      utils.fetchJson(`${API_BASE}/stats/products`),
      utils.fetchJson(`${API_BASE}/stats/revenue`)
    ]);
    if (elUsers) elUsers.textContent = u.total || 0;
    if (elStaff) elStaff.textContent = st.total || 0;
    if (elProducts) elProducts.textContent = pr.total || 0;
    if (elRevenue) elRevenue.textContent = `R${Number(rv.total||0).toFixed(2)}`;
  } catch (err) { console.warn('dashboard load failed', err); }
}

/* ---------- Page init & event wiring ---------- */
function updateCartCount() {
  const el = document.getElementById('cartCount'); if (!el) return;
  const count = cart.get().length || 0; el.textContent = count;
}
window.addEventListener('cartUpdated', updateCartCount);
window.addEventListener('storage', updateCartCount);
updateCartCount();

document.addEventListener('DOMContentLoaded', () => {
  // header links
  document.getElementById('signOutBtn')?.addEventListener('click', signOut);
  document.getElementById('signInBtn')?.addEventListener('click', ()=> location.href = 'signin.html');
  document.getElementById('registerBtn')?.addEventListener('click', ()=> location.href = 'register.html');

  const path = location.pathname;
  if (/index.html|\/$/.test(path)) renderFeaturedSneakers();
  if (path.includes('inventory.html')) loadInventorySneakers();
  if (path.includes('cart.html')) renderCartPage();
  if (path.includes('purchase-history.html')) renderPurchaseHistory();
  if (path.includes('admin.html')) { if (!requireAuth(true,'admin')) return; renderAdminInventoryTable(); loadDashboardData(); }
  if (path.includes('staff.html')) { if (!requireAuth(true,'admin')) return; loadStaff(); }
  if (path.includes('dashboard.html')) { if (!requireAuth(true,'admin')) return; loadDashboardData(); setInterval(loadDashboardData,60000); }

  // wire checkout
  document.getElementById('checkoutBtn')?.addEventListener('click', doCheckout);

  // basic modal close wiring (product + edit)
  document.querySelectorAll('.modal .close-btn').forEach(b => b.addEventListener('click', ()=> b.closest('.modal').style.display = 'none'));
});

/* ---------- Expose some functions for templates (if needed) ---------- */
window.openProductModalById = openProductModalById;
window.renderAdminInventoryTable = renderAdminInventoryTable;
window.loadInventorySneakers = loadInventorySneakers;
window.loadDashboardData = loadDashboardData;
window.loadStaff = loadStaff;

