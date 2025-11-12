const API_BASE = 
  (/localhost|127\.0\.0\.1/.test(location.hostname))
    ? "http://localhost:3001/api"
    : "https://urban-walker-vault.onrender.com/api";

// --------------------------- UI Feedback Helpers ---------------------------
function showMessage(message, type = 'info', duration = 3000) {
    const container = document.body;
    const messageEl = document.cElement('div');
    messageEl.className = `message ${type}`;
    messageEl.textContent = message;
    container.appendChild(messageEl);
    setTimeout(() => messageEl.remove(), duration);
}
function showLoading(selector) {
    const el = document.querySelector(selector);
    if (!el) return;
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton';
    skeleton.style.height = el.offsetHeight + 'px';
    el.innerHTML = '';
    el.appendChild(skeleton);
}
function hideLoading(selector) {
    const el = document.querySelector(selector);
    if (el && el.querySelector('.skeleton')) el.innerHTML = '';
}

// --------------------------- Small helpers ---------------------------
const _ = {
    // robust fetchJson tolerant of empty or non-JSON responses
    fetchJson: async (url, opts = {}) => {
        const headers = opts.headers || {};
        // if body is present and content-type not set, default to json
        if (opts.body && !headers['Content-Type'] && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
        opts.headers = headers;
        const res = await fetch(url, opts);
        const text = await res.text();
        if (!text) {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return {};
        }
        try {
            const parsed = JSON.parse(text);
            if (!res.ok) throw new Error(parsed?.error || `HTTP ${res.status}`);
            return parsed;
        } catch (e) {
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
            return text;
        }
    },
    safeParse: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    save: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('ls set failed', e); } },
    groupCart: (list = []) => Object.values((list || []).reduce((acc, it) => {
        const key = `${it.id}::${it.size || ''}`;
        if (!acc[key]) acc[key] = { id: it.id, name: it.name, price: it.price, image: it.image, size: it.size || '', qty: 0, desc: it.desc || '' };
        acc[key].qty += Number(it.qty || 1);
        return acc;
    }, {})),
};

// --------------------------- Auth helpers ---------------------------
function checkAuth(role) {
    const u = _.safeParse('currentUser');
    if (!u) {
        if (!/signin.html|register.html$/.test(window.location.pathname)) window.location.href = 'signin.html';
        return false;
    }
    if (role && u.role !== role) {
        alert('Access denied');
        window.location.href = 'inventory.html';
        return false;
    }
    return true;
}
function signOut() {
    localStorage.removeItem('currentUser');
    localStorage.removeItem('token');
    window.location.href = 'signin.html';
}

// --------------------------- Auth forms (signin/register) ---------------------------
document.addEventListener('submit', async (ev) => {
    const form = ev.target;
    if (form.id === 'signInForm') {
        ev.preventDefault();
        const email = form.querySelector('#email').value;
        const password = form.querySelector('#password').value;
        try {
            const res = await fetch(`${API_BASE}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Login failed');
            localStorage.setItem('token', data.token);
            localStorage.setItem('currentUser', JSON.stringify(data.user));
            const next = new URLSearchParams(window.location.search).get('next');
            window.location.href = next ? decodeURIComponent(next) : (data.user.role === 'admin' ? 'admin.html' : 'inventory.html');
        } catch (err) { alert(err.message || err); }
    }

    if (form.id === 'registerForm') {
        ev.preventDefault();
        const username = form.querySelector('#username').value;
        const email = form.querySelector('#email').value;
        const password = form.querySelector('#password').value;
        const confirm = form.querySelector('#confirmPassword') ? form.querySelector('#confirmPassword').value : password;
        const role = form.querySelector('#role') ? form.querySelector('#role').value : 'user';
        if (password !== confirm) return alert('Passwords do not match');

        async function sendRegistration(recaptchaToken = null) {
            try {
                const res = await fetch(`${API_BASE}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, email, password, role, recaptchaToken }) });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Registration failed');
                alert('Registered — please sign in');
                window.location.href = 'signin.html';
            } catch (err) { alert(err.message || err); }
        }

        const SITE_KEY = 'REPLACE_WITH_YOUR_SITE_KEY';
        if (window.grecaptcha && SITE_KEY !== 'REPLACE_WITH_YOUR_SITE_KEY') {
            try {
                const token = await grecaptcha.execute(SITE_KEY, { action: 'register' });
                await sendRegistration(token);
            } catch (e) { alert('reCAPTCHA failed'); }
        } else {
            await sendRegistration(null);
        }
    }
});

// --------------------------- Cart (grouped) ---------------------------
function renderCart() {
    const cartList = document.getElementById('cartList'); if (!cartList) return;
    const totalEl = document.getElementById('totalPrice');
    const checkoutBtn = document.getElementById('checkoutBtn') || document.getElementById('checkoutButton');
    const cart = JSON.parse(localStorage.getItem('cart')) || [];
    const grouped = _.groupCart(cart);
    cartList.innerHTML = '';
    if (!grouped.length) {
        if (checkoutBtn) checkoutBtn.style.display = 'none';
        if (totalEl) totalEl.textContent = '0.00';
        cartList.innerHTML = '<p>Your cart is empty</p>';
        return;
    }
    if (checkoutBtn) checkoutBtn.style.display = '';
    let total = 0;
    grouped.forEach(it => {
        total += Number(it.price || 0) * Number(it.qty || 0);
        const li = document.createElement('li');
        li.className = 'cart-item';
        li.innerHTML = `
            <div class="cart-item-left">
                <img src="${it.image || ''}" alt="${it.name || ''}" />
                <div>
                    <div class="cart-item-name">${it.name}</div>
                    ${it.size ? `<div class="cart-item-size">Size: ${it.size}</div>` : ''}
                </div>
            </div>
            <div class="cart-item-right">
                <div class="cart-item-qty">
                    <button data-key="${it.id}::${it.size || ''}" class="qty-decrease">-</button>
                    <span class="qty-count">${it.qty}</span>
                    <button data-key="${it.id}::${it.size || ''}" class="qty-increase">+</button>
                </div>
                <div class="cart-item-remove"><button data-key="${it.id}::${it.size || ''}" class="remove-item">Remove</button></div>
            </div>`;
        cartList.appendChild(li);
    });
    if (totalEl) totalEl.textContent = total.toFixed(2);
    cartList.querySelectorAll('.qty-decrease').forEach(b => b.addEventListener('click', () => changeQty(b.dataset.key, -1)));
    cartList.querySelectorAll('.qty-increase').forEach(b => b.addEventListener('click', () => changeQty(b.dataset.key, +1)));
    cartList.querySelectorAll('.remove-item').forEach(b => b.addEventListener('click', () => removeGroupedItem(b.dataset.key)));
}
function changeQty(key, delta) {
    let list = JSON.parse(localStorage.getItem('cart')) || [];
    const grouped = _.groupCart(list);
    const target = grouped.find(g => `${g.id}::${g.size}` === key);
    if (!target) return;
    const newQty = Math.max(0, target.qty + delta);
    list = list.filter(i => `${i.id}::${i.size || ''}` !== key);
    for (let i = 0; i < newQty; i++) list.push({ id: target.id, name: target.name, desc: target.desc, price: target.price, image: target.image, size: target.size, qty: 1 });
    localStorage.setItem('cart', JSON.stringify(list));
    window.dispatchEvent(new Event('cartUpdated'));
    renderCart();
}
function removeGroupedItem(key) {
    let list = JSON.parse(localStorage.getItem('cart')) || [];
    list = list.filter(i => `${i.id}::${i.size || ''}` !== key);
    localStorage.setItem('cart', JSON.stringify(list));
    window.dispatchEvent(new Event('cartUpdated'));
    renderCart();
}
async function doCheckout() {
    const user = _.safeParse('currentUser'); if (!user) return alert('You must sign in to checkout');
    const cart = JSON.parse(localStorage.getItem('cart')) || []; if (!cart.length) return alert('Cart is empty');
    try {
        const res = await fetch(`${API_BASE}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: user.id, cart }) });
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.error || 'Server checkout failed');
        }
        localStorage.removeItem('cart'); window.dispatchEvent(new Event('cartUpdated')); alert('Checkout completed');
        if (typeof loadInventorySneakers === 'function') loadInventorySneakers();
        renderCart();
    } catch (err) {
        // offline fallback
        const grouped = _.groupCart(cart);
        const purchases = _.safeParse('purchases') || [];
        purchases.push({
            user: user.username || user.email || 'guest',
            items: grouped,
            total: grouped.reduce((s, i) => s + (Number(i.price || 0) * Number(i.qty || 0)), 0).toFixed(2),
            datetime: new Date().toISOString(),
            synced: false
        });
        _.save('purchases', purchases);
        localStorage.removeItem('cart'); window.dispatchEvent(new Event('cartUpdated'));
        alert('Checkout stored locally (offline) - Inventory not updated');
        renderCart();
    }
}

// --------------------------- Purchases view ---------------------------
async function renderPurchaseHistory() {
    const table = document.getElementById('purchaseTable'); if (!table) return;
    const thead = table.querySelector('thead'); const tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;
    const currentUser = _.safeParse('currentUser');
    const isAdmin = !!(currentUser && currentUser.role === 'admin');

    thead.innerHTML = isAdmin
        ? `<tr><th>Date & Time</th><th>User</th><th>Items</th><th>Description</th><th>Total</th></tr>`
        : `<tr><th>Date & Time</th><th>Items</th><th>Description</th><th>Total</th></tr>`;
    tbody.innerHTML = `<tr><td colspan="${isAdmin ? 5 : 4}">Loading...</td></tr>`;

    let rows = [];
    try {
        const url = isAdmin ? `${API_BASE}/purchase` : `${API_BASE}/purchase/${currentUser?.id}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to load purchases');
        rows = await res.json();
    } catch (e) {
        const local = _.safeParse('purchases') || [];
        rows = [];
        for (const p of local) {
            for (const it of (p.items || [])) {
                rows.push({
                    date: new Date(p.datetime).toISOString(),
                    username: p.user,
                    email: p.user,
                    item: it.name,
                    item_desc: it.desc || '',
                    price: it.price
                });
            }
        }
    }

    const makeKey = r => `${r.date}|${r.username || ''}|${r.email || ''}`;
    const map = new Map();
    for (const r of rows) {
        const k = makeKey(r);
        if (!map.has(k)) map.set(k, { date: r.date, user: r.username || r.email || 'unknown', items: [], total: 0 });
        const g = map.get(k);
        g.items.push({ name: r.item, desc: r.item_desc || '', price: Number(r.price) || 0 });
        g.total += Number(r.price) || 0;
    }

    function summarize(items) {
        const c = new Map();
        for (const it of items) {
            const n = it.name || 'Item';
            const cur = c.get(n) || { name: n, qty: 0 };
            cur.qty += 1; c.set(n, cur);
        }
        return Array.from(c.values()).map(x => `${x.name} x${x.qty}`).join(', ');
    }
    function getDescriptions(items) {
        const descs = items.map(it => it.desc || '').filter(d => d);
        return [...new Set(descs)].join(', ');
    }

    const groups = Array.from(map.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
    tbody.innerHTML = '';
    if (!groups.length) { tbody.innerHTML = `<tr><td colspan="${isAdmin ? 5 : 4}">No purchases yet.</td></tr>`; return; }
    for (const g of groups) {
        const tr = document.createElement('tr');
        const dt = new Date(g.date);
        const human = isNaN(dt) ? g.date : dt.toLocaleString();
        if (isAdmin) {
            tr.innerHTML = `<td>${human}</td><td>${g.user}</td><td>${summarize(g.items)}</td><td>${getDescriptions(g.items)}</td><td>R${g.total.toFixed(2)}</td>`;
        } else {
            tr.innerHTML = `<td>${human}</td><td>${summarize(g.items)}</td><td>${getDescriptions(g.items)}</td><td>R${g.total.toFixed(2)}</td>`;
        }
        tbody.appendChild(tr);
    }
}

// --------------------------- Featured & Inventory ---------------------------
async function renderFeaturedSneakers() {
    const grid = document.getElementById('featuredGrid'); if (!grid) return; grid.innerHTML = '';
    let remote = [];
    try { remote = await _.fetchJson(`${API_BASE}/sneakers`); } catch (_) { remote = []; }
    const local = _.safeParse('sneakers') || [];
    const seen = new Set(remote.map(s => String(s.name).toLowerCase()));
    local.forEach(ls => { if (!seen.has(String(ls.name).toLowerCase())) remote.push(ls); });
    if (!remote.length) { const ph = document.createElement('div'); ph.className = 'featured-placeholder'; ph.textContent = 'No featured sneakers yet.'; grid.appendChild(ph); return; }
    remote.forEach(s => {
        const card = document.createElement('div'); card.className = 'card';
        card.innerHTML = `
            <div style="position:relative;">${s.synced === false ? '<div class="pending-badge">Pending</div>' : ''}<img loading="lazy" src="${s.image || ''}" alt="${s.name || ''}"></div>
            <h3>${s.name || ''}</h3>
            <p>${s.desc || ''}</p>
            <button class="view-btn" data-id="${s.id || ''}">View</button>`;
        grid.appendChild(card);
    });
}
async function loadInventorySneakers() {
    const cardGrid = document.getElementById('inventoryGrid'); if (!cardGrid) return; cardGrid.innerHTML = '';
    let remote = []; let backendOk = false;
    try { const res = await fetch(`${API_BASE}/sneakers`); if (res.ok) { remote = await res.json(); backendOk = true; } } catch (e) { remote = []; }
    const local = _.safeParse('sneakers') || [];
    if (backendOk) { const names = new Set(remote.map(s => String(s.name).toLowerCase())); local.forEach(ls => { if (!names.has(String(ls.name).toLowerCase())) remote.push(ls); }); } else remote = local;
    if (!remote.length) { const ph = document.createElement('div'); ph.className = 'featured-placeholder'; ph.textContent = 'No products available yet.'; cardGrid.appendChild(ph); return; }
    const currentUser = _.safeParse('currentUser');
    remote.forEach(s => {
        const div = document.createElement('div'); div.className = 'card';
        let html = `<div style="position:relative;">${s.synced === false ? '<div class="pending-badge">Pending</div>' : ''}<img loading="lazy" src="${s.image || ''}" alt="${s.name || ''}"></div><h3>${s.name}</h3><p>${s.desc || ''}</p><p>Price: R${s.price}</p><p>In Stock: ${s.qty !== undefined ? s.qty : 'N/A'}</p>`;
        if (!currentUser || currentUser.role !== 'admin') html += `<button class="add-to-cart-btn" data-id="${s.id}" ${s.qty === 0 ? 'disabled' : ''}>${s.qty === 0 ? 'Out of Stock' : 'Add to Cart'}</button>`;
        if (currentUser && currentUser.role === 'admin') html += `<div class="admin-controls"><button class="edit-sneaker-btn" data-id="${s.id}">Edit</button><button class="delete-sneaker-btn" data-id="${s.id}">Delete</button></div>`;
        div.innerHTML = html; if (s.id) div.dataset.id = s.id; cardGrid.appendChild(div);
    });
    try { const target = new URLSearchParams(window.location.search).get('sneaker'); if (target) setTimeout(() => openProductModalById(target), 400); } catch (e) {}
}

// --------------------------- Product modal ---------------------------
function populateProductModal(s) {
    const img = document.getElementById('productImage'); if (img) img.src = s.image || '';
    const name = document.getElementById('productName'); if (name) name.textContent = s.name || '';
    const desc = document.getElementById('productDesc'); if (desc) desc.textContent = s.desc || '';
    const price = document.getElementById('productPrice'); if (price) price.textContent = s.price ? `Price: R${s.price}` : '';
    const add = document.getElementById('productAddToCart'); if (add) add.dataset.id = s.id || '';
    const cu = _.safeParse('currentUser');
    if (cu && cu.role === 'admin') {
        if (add) add.style.display = 'none';
        const buy = document.getElementById('productBuyNow'); if (buy) buy.style.display = 'none';
    } else {
        if (add) add.style.display = '';
        const buy = document.getElementById('productBuyNow'); if (buy) buy.style.display = '';
    }
}
async function openProductModalById(id) {
    let sneaker = null;
    try { const list = await _.fetchJson(`${API_BASE}/sneakers`); sneaker = list.find(x => String(x.id) === String(id)); } catch (_) { sneaker = null; }
    if (!sneaker) sneaker = (_.safeParse('sneakers') || []).find(x => String(x.id) === String(id));
    if (!sneaker) return;
    populateProductModal(sneaker);
    const modal = document.getElementById('productModal'); if (modal) modal.style.display = 'flex';
}

// --------------------------- Sync local unsynced sneakers to backend ---------------------------
async function syncLocalSneakersToBackend() {
    const local = _.safeParse('sneakers') || [];
    const unsynced = local.filter(s => s.synced === false || s.synced === undefined);
    if (!unsynced.length) return;
    for (const s of unsynced) {
        try {
            const res = await fetch(`${API_BASE}/sneakers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: s.name, image: s.image, price: s.price, desc: s.desc, qty: s.qty }) });
            if (res.ok) s.synced = true; else break;
        } catch (err) { console.warn('sync failed', err); break; }
    }
    _.save('sneakers', local);
}

// --------------------------- DOM wiring & events ---------------------------
document.addEventListener('DOMContentLoaded', () => {
    const signInBtn = document.getElementById('signInBtn'); if (signInBtn) signInBtn.addEventListener('click', () => window.location.href = 'signin.html');
    const registerBtn = document.getElementById('registerBtn'); if (registerBtn) registerBtn.addEventListener('click', () => window.location.href = 'register.html');
    const shopNowBtn = document.getElementById('shopNowBtn'); if (shopNowBtn) shopNowBtn.addEventListener('click', () => window.location.href = 'inventory.html');

    // Page-specific initializers
    const path = window.location.pathname;

    if (/index.html|\/$/.test(path)) renderFeaturedSneakers();
    if (path.includes('inventory.html')) loadInventorySneakers();
    if (path.includes('purchase-history.html')) renderPurchaseHistory();
    if (path.includes('admin.html')) {
        // admin protection
        const cu = _.safeParse('currentUser');
        if (!cu || cu.role !== 'admin') {
            alert('Access denied. Admins only.');
            window.location.href = 'signin.html';
            return;
        }
        renderAdminInventoryTable();
        // Dashboard page might be admin.html
        loadDashboardDataIfPresent(); // function defined later
    }

    // Show admin indicator when admin is logged in
    const adminIndicator = document.getElementById('adminIndicator');
    const currentUser = _.safeParse('currentUser');
    if (adminIndicator && currentUser && currentUser.role === 'admin') adminIndicator.style.display = '';

    // Top-left Options tab creation for signed-in users (keeps positions)
    const isExcludedPage = /index\.html|\/$/.test(path) || /signin\.html/.test(path) || /register\.html/.test(path);
    if (currentUser && !isExcludedPage) {
        if (!document.getElementById('uwvOptionsToggle')) {
            const wrap = document.createElement('div');
            wrap.style.position = 'fixed';
            wrap.style.top = '16px';
            wrap.style.left = '16px';
            wrap.style.zIndex = '1500';
            wrap.style.display = 'flex';
            wrap.style.flexDirection = 'column';

            const btn = document.createElement('button');
            btn.id = 'uwvOptionsToggle';
            btn.type = 'button';
            btn.setAttribute('aria-label', 'Menu');
            btn.style.background = '#111';
            btn.style.color = '#fff';
            btn.style.border = 'none';
            btn.style.borderRadius = '10px';
            btn.style.padding = '8px';
            btn.style.cursor = 'pointer';
            btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
            btn.style.width = '40px';
            btn.style.height = '40px';
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';

            const barWrap = document.createElement('div');
            barWrap.style.display = 'grid';
            barWrap.style.gap = '4px';
            for (let i = 0; i < 3; i++) {
                const bar = document.createElement('div');
                bar.style.width = '20px';
                bar.style.height = '2px';
                bar.style.background = '#fff';
                bar.style.borderRadius = '2px';
                barWrap.appendChild(bar);
            }
            btn.appendChild(barWrap);

            const menu = document.createElement('div');
            menu.id = 'uwvOptionsMenu';
            menu.style.position = 'absolute';
            menu.style.top = '46px';
            menu.style.left = '0';
            menu.style.background = '#fff';
            menu.style.border = '1px solid #eee';
            menu.style.borderRadius = '10px';
            menu.style.padding = '8px';
            menu.style.minWidth = '180px';
            menu.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';
            menu.style.display = 'none';

            const itemPH = document.createElement('a');
            itemPH.href = 'purchase-history.html';
            itemPH.textContent = 'Purchase History';
            itemPH.style.display = 'block';
            itemPH.style.padding = '8px 10px';
            itemPH.style.color = '#111';
            itemPH.style.textDecoration = 'none';
            itemPH.style.borderRadius = '6px';
            itemPH.addEventListener('mouseover', () => itemPH.style.background = '#f5f5f5');
            itemPH.addEventListener('mouseout', () => itemPH.style.background = 'transparent');

            const itemDashboard = document.createElement('a');
            itemDashboard.href = 'dashboard.html';
            itemDashboard.textContent = 'Dashboard';
            itemDashboard.style.display = 'block';
            itemDashboard.style.padding = '8px 10px';
            itemDashboard.style.color = '#111';
            itemDashboard.style.textDecoration = 'none';
            itemDashboard.style.borderRadius = '6px';
            itemDashboard.addEventListener('mouseover', () => itemDashboard.style.background = '#f5f5f5');
            itemDashboard.addEventListener('mouseout', () => itemDashboard.style.background = 'transparent');

            menu.appendChild(itemDashboard);
            menu.appendChild(itemPH);
            wrap.appendChild(btn);
            wrap.appendChild(menu);
            document.body.appendChild(wrap);

            const header = document.querySelector('header');
            if (header) header.style.paddingLeft = '5rem';

            btn.addEventListener('click', (e) => { e.stopPropagation(); menu.style.display = menu.style.display === 'none' ? 'block' : 'none'; });
            document.addEventListener('click', (e) => { if (menu.style.display === 'block') menu.style.display = 'none'; });
        }
    }

    // Modal close handlers
    const close = document.getElementById('closeProductModal'); if (close) close.addEventListener('click', () => { const m = document.getElementById('productModal'); if (m) m.style.display = 'none'; });
    window.addEventListener('click', (ev) => { const m = document.getElementById('productModal'); if (m && ev.target === m) m.style.display = 'none'; });

    // product add/buy
    const addBtn = document.getElementById('productAddToCart'); if (addBtn) addBtn.addEventListener('click', async function () {
        const id = this.dataset.id; if (!id) return;
        let sneaker = null;
        try { sneaker = (await _.fetchJson(`${API_BASE}/sneakers`)).find(x => String(x.id) === String(id)); } catch (_) { sneaker = (_.safeParse('sneakers') || []).find(x => String(x.id) === String(id)); }
        if (!sneaker) return alert('Sneaker not found');
        const sizeEl = document.getElementById('productSize'); const qtyEl = document.getElementById('productQty'); const size = sizeEl ? sizeEl.value : ''; const qty = qtyEl ? parseInt(qtyEl.value, 10) || 1 : 1;
        const cart = JSON.parse(localStorage.getItem('cart')) || [];
        for (let i = 0; i < qty; i++) cart.push({ id: sneaker.id, name: sneaker.name, desc: sneaker.desc, price: sneaker.price, image: sneaker.image, size, qty: 1 });
        localStorage.setItem('cart', JSON.stringify(cart)); window.dispatchEvent(new Event('cartUpdated'));
        const modal = document.getElementById('productModal'); if (modal) modal.style.display = 'none';
    });
    const buyNow = document.getElementById('productBuyNow'); if (buyNow) buyNow.addEventListener('click', () => { const add = document.getElementById('productAddToCart'); if (add) add.click(); window.location.href = 'cart.html'; });

    // Inventory grid event delegation
    const grid = document.getElementById('inventoryGrid'); if (grid) {
        grid.addEventListener('click', async (ev) => {
            const t = ev.target;
            if (t.classList.contains('add-to-cart-btn')) {
                const id = t.dataset.id;
                if (id) { openProductModalById(id); }
                return;
            }
            if (t.classList.contains('edit-sneaker-btn')) {
                ev.preventDefault(); ev.stopPropagation();
                const id = t.dataset.id;
                try {
                    let list = [];
                    try { list = await _.fetchJson(`${API_BASE}/sneakers`); }
                    catch (_) { list = _.safeParse('sneakers') || []; }
                    const s = list.find(x => String(x.id) === String(id));
                    if (!s) return alert('Sneaker not found');
                    document.getElementById('editSneakerId').value = s.id;
                    document.getElementById('editSneakerName').value = s.name || '';
                    document.getElementById('editSneakerPrice').value = s.price || 0;
                    document.getElementById('editSneakerQty').value = s.qty || 0;
                    document.getElementById('editSneakerImage').value = s.image || '';
                    document.getElementById('editSneakerDesc').value = s.desc || '';
                    document.getElementById('editSneakerModal').style.display = 'block';
                } catch (e) { alert('Failed to load sneaker'); }
            }
            if (t.classList.contains('delete-sneaker-btn')) { const id = t.dataset.id; if (!confirm('Delete?')) return; try { await fetch(`${API_BASE}/sneakers/${id}`, { method: 'DELETE' }); loadInventorySneakers(); } catch { alert('Delete failed'); } }
            const card = t.closest && t.closest('.card'); if (card && !t.classList.contains('edit-sneaker-btn') && !t.classList.contains('delete-sneaker-btn')) { const id = card.dataset.id; if (id) openProductModalById(id); }
        });
    }

    // Document-level fallback for dynamic edit buttons
    document.addEventListener('click', async (ev) => {
        const t = ev.target;
        if (!(t && t.classList && t.classList.contains('edit-sneaker-btn'))) return;
        ev.preventDefault();
        const id = t.dataset && t.dataset.id;
        if (!id) return;
        try {
            let list = [];
            try { list = await _.fetchJson(`${API_BASE}/sneakers`); }
            catch (_) { list = _.safeParse('sneakers') || []; }
            const s = list.find(x => String(x.id) === String(id));
            if (!s) return alert('Sneaker not found');
            document.getElementById('editSneakerId').value = s.id;
            document.getElementById('editSneakerName').value = s.name || '';
            document.getElementById('editSneakerPrice').value = s.price || 0;
            document.getElementById('editSneakerQty').value = s.qty || 0;
            document.getElementById('editSneakerImage').value = s.image || '';
            document.getElementById('editSneakerDesc').value = s.desc || '';
            document.getElementById('editSneakerModal').style.display = 'block';
        } catch (e) { alert('Failed to load sneaker'); }
    }, true);

    // Edit modal close handler
    const closeEdit = document.getElementById('closeEditModal'); if (closeEdit) closeEdit.addEventListener('click', () => { const m = document.getElementById('editSneakerModal'); if (m) m.style.display = 'none'; });

    // Edit form submit handler (admin)
    const editForm = document.getElementById('editSneakerForm'); if (editForm) editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('editSneakerId').value;
        const name = document.getElementById('editSneakerName').value;
        const price = parseFloat(document.getElementById('editSneakerPrice').value) || 0;
        const qty = parseInt(document.getElementById('editSneakerQty').value, 10) || 0;
        const image = document.getElementById('editSneakerImage').value;
        const desc = document.getElementById('editSneakerDesc').value;
        try {
            const res = await fetch(`${API_BASE}/sneakers/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, image, price, desc, qty }) });
            if (!res.ok) throw new Error('Update failed');
            alert('Sneaker updated');
            const m = document.getElementById('editSneakerModal'); if (m) m.style.display = 'none';
            if (typeof loadInventorySneakers === 'function') loadInventorySneakers();
        } catch (err) {
            alert(err.message || 'Update failed');
        }
    });

    // Hide checkout box and wiring
    const isAdmin = !!(currentUser && currentUser.role === 'admin');
    if (isAdmin) {
        const checkoutTab = document.getElementById('checkoutTab'); if (checkoutTab) checkoutTab.style.display = 'none';
    } else {
        const checkoutBtn = document.getElementById('checkoutBtn') || document.getElementById('checkoutButton'); if (checkoutBtn) checkoutBtn.addEventListener('click', doCheckout);
    }

    // cart render and listeners
    renderCart(); window.addEventListener('cartUpdated', renderCart); window.addEventListener('storage', renderCart);

    // sync unsynced sneakers on load
    syncLocalSneakersToBackend();

    // staff page wiring (if present)
    if (document.getElementById('staffTable') || document.getElementById('addStaffForm')) {
        loadStaff().catch(err => console.warn('loadStaff failed', err));
        const addStaffForm = document.getElementById('addStaffForm');
        if (addStaffForm) addStaffForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fullName = document.getElementById('staffName').value.trim();
            const email = document.getElementById('staffEmail').value.trim();
            const role = document.getElementById('staffRole').value.trim();
            const password = generatePassword();
            const newStaff = { fullName, email, role, password };
            try {
                const res = await fetch(`${API_BASE}/staff`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(newStaff)
                });
                const data = await res.json();
                if (res.ok && data) {
                    document.getElementById('generatedPassword').innerText = `Generated Password: ${password}`;
                    addStaffForm.reset();
                    await loadStaff();
                    showMessage('Staff added', 'success');
                } else {
                    throw new Error(data?.error || 'Add staff failed');
                }
            } catch (err) {
                console.error('Error adding staff:', err);
                showMessage('Failed to add staff', 'error');
            }
        });
    }

    // kick off periodic sync once (avoid double interval)
    if (!window.__uwv_sync_interval_set) {
        window.__uwv_sync_interval_set = true;
        setInterval(syncLocalSneakersToBackend, 30000);
    }
});

// --------------------------- Admin inventory table renderer ---------------------------
async function renderAdminInventoryTable() {
    const tbody = document.querySelector('#sneakerTable tbody'); if (!tbody) return;
    const formPage = document.querySelector('.form-page');
    if (formPage && document.getElementById('sneakerTable')) {
        formPage.style.maxWidth = '95%';
        formPage.style.width = '95%';
        const form = document.getElementById('sneakerForm');
        if (form) { form.style.maxWidth = '400px'; form.style.margin = '0 auto'; }
    }
    tbody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';
    let sneakers = [];
    try {
        sneakers = await _.fetchJson(`${API_BASE}/sneakers`);
    } catch (e) {
        sneakers = _.safeParse('sneakers') || [];
    }
    tbody.innerHTML = '';
    if (!sneakers.length) { tbody.innerHTML = '<tr><td colspan="5">No sneakers yet.</td></tr>'; return; }
    sneakers.forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${s.name || ''}</td>
            <td>${s.desc || ''}</td>
            <td>R${Number(s.price || 0).toFixed(2)}</td>
            <td>${s.qty !== undefined ? s.qty : 0}</td>
            <td>
                <button type="button" class="admin-edit-sneaker-btn" data-id="${s.id}">Edit</button>
                <button type="button" class="admin-delete-sneaker-btn" data-id="${s.id}">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    tbody.querySelectorAll('.admin-edit-sneaker-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            try {
                let list = []; try { list = await _.fetchJson(`${API_BASE}/sneakers`); } catch (_) { list = _.safeParse('sneakers') || []; }
                const s = list.find(x => String(x.id) === String(id));
                if (!s) return alert('Sneaker not found');
                window.location.href = `inventory.html?sneaker=${id}`;
            } catch (e) { alert('Failed to load sneaker'); }
        });
    });
    tbody.querySelectorAll('.admin-delete-sneaker-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            if (!confirm('Delete this sneaker?')) return;
            try {
                await fetch(`${API_BASE}/sneakers/${id}`, { method: 'DELETE' });
                renderAdminInventoryTable();
            } catch (e) { alert('Delete failed'); }
        });
    });
}

// --------------------------- Admin add form (fallback to local) ---------------------------
const sneakerForm = document.getElementById('sneakerForm');
if (sneakerForm) sneakerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
        name: document.getElementById('sneakerName').value,
        image: document.getElementById('sneakerImage').value,
        price: parseFloat(document.getElementById('sneakerPrice').value) || 0,
        qty: parseInt(document.getElementById('sneakerQty').value, 10) || 0,
        desc: document.getElementById('sneakerDesc').value
    };
    try {
        const res = await fetch(`${API_BASE}/sneakers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error('Create failed');
        alert('Sneaker added successfully!');
        renderAdminInventoryTable();
    } catch (err) {
        const local = _.safeParse('sneakers') || [];
        local.push({ id: Date.now(), ...payload, synced: false });
        _.save('sneakers', local);
        alert('Sneaker added successfully! (saved locally)');
        renderAdminInventoryTable();
    }
    sneakerForm.reset();
});

// --------------------------- Dashboard functionality ---------------------------

// animate number counters
function animateCount(el, newValue) {
    if (!el) return;
    const oldValue = parseInt(el.textContent.replace(/\D/g, '')) || 0;
    const duration = 800;
    const start = performance.now();
    function update(now) {
        const progress = Math.min((now - start) / duration, 1);
        const value = Math.floor(oldValue + (newValue - oldValue) * progress);
        el.textContent = value;
        if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
}
let previousLowStockIds = [];
async function loadDashboardData() {
    const totalSneakersEl = document.getElementById('totalSneakers');
    const totalStaffEl = document.getElementById('totalStaff');
    const totalUsersEl = document.getElementById('totalUsers');
    const lowStockAlertsEl = document.getElementById('lowStockList');
    if (!document.querySelector('.dashboard-page')) return;
    try {
        const sneakers = await _.fetchJson(`${API_BASE}/sneakers`);
        const users = await _.fetchJson(`${API_BASE}/users`);
        const totalSneakers = sneakers.reduce((sum, s) => sum + (Number(s.qty) || 0), 0);
        const totalStaff = users.filter(u => u.role === 'admin' || u.role === 'staff').length;
        const totalUsers = users.length;
        animateCount(totalSneakersEl, totalSneakers);
        animateCount(totalStaffEl, totalStaff);
        animateCount(totalUsersEl, totalUsers);
        const lowStock = sneakers.filter(s => (Number(s.qty) || 0) < 5);
        const lowStockIds = lowStock.map(s => s.id || s.name);
        const newLowStock = lowStockIds.filter(id => !previousLowStockIds.includes(id));
        previousLowStockIds = lowStockIds;
        if (lowStockAlertsEl) {
            if (!lowStock.length) {
                lowStockAlertsEl.innerHTML = '<li>No low stock alerts.</li>';
            } else {
                lowStockAlertsEl.innerHTML = lowStock.map(s => `<li class="low-stock-item flash-alert"><strong>${s.name}</strong> — Qty: ${s.qty || 0}</li>`).join('');
                setTimeout(() => { document.querySelectorAll('.flash-alert').forEach(el => el.classList.remove('flash-alert')); }, 1500);
            }
        }
        if (newLowStock.length > 0) {
            const alertSound = new Audio('/assets/sounds/alert.mp3');
            alertSound.volume = 0.6;
            alertSound.play().catch(err => console.warn('Audio play blocked:', err));
        }
    } catch (err) {
        console.error('Error loading dashboard data:', err);
        const totalSneakersEl = document.getElementById('totalSneakers');
        const totalStaffEl = document.getElementById('totalStaff');
        const totalUsersEl = document.getElementById('totalUsers');
        const lowStockAlertsEl = document.getElementById('lowStockList');
        if (totalSneakersEl) totalSneakersEl.textContent = '—';
        if (totalStaffEl) totalStaffEl.textContent = '—';
        if (totalUsersEl) totalUsersEl.textContent = '—';
        if (lowStockAlertsEl) lowStockAlertsEl.innerHTML = '<li>Could not load data.</li>';
    }
}
function loadDashboardDataIfPresent() {
    if (!document.querySelector('.dashboard-page')) return;
    loadDashboardData();
    // once every 60s only if present
    if (!window.__uwv_dashboard_interval_set) {
        window.__uwv_dashboard_interval_set = true;
        setInterval(loadDashboardData, 60000);
    }
}
document.getElementById('refreshDashboard')?.addEventListener('click', loadDashboardData);

// --------------------------- Password generator (for staff) ---------------------------
function generatePassword() {
    const length = 10;
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let pass = "";
    for (let i = 0; i < length; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
    return pass;
}

// --------------------------- Staff management ---------------------------
async function loadStaff() {
    try {
        const res = await fetch(`${API_BASE}/staff`);
        if (!res.ok) throw new Error('Failed to load staff');
        const staff = await res.json();
        const tbody = document.querySelector("#staffTable tbody");
        if (!tbody) return;
        tbody.innerHTML = "";
        staff.forEach(member => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${member.id}</td>
                <td>${member.fullName}</td>
                <td>${member.email}</td>
                <td>${member.role}</td>
                <td><button type="button" data-id="${member.id}" class="remove-staff-btn btn-danger">Remove</button></td>
            `;
            tbody.appendChild(tr);
        });
        tbody.querySelectorAll('.remove-staff-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                if (!confirm('Are you sure you want to remove this staff member?')) return;
                try {
                    const res = await fetch(`${API_BASE}/staff/${id}`, { method: 'DELETE' });
                    const data = await res.json();
                    if (res.ok) loadStaff();
                    else throw new Error(data?.error || 'Delete failed');
                } catch (err) { console.error('Error deleting staff:', err); alert('Delete failed'); }
            });
        });
    } catch (err) {
        console.error("Error loading staff:", err);
    }
}

// --------------------------- Periodic tasks (attempt to sync purchases/un-synced resources if backend available) ---------------------------
async function syncLocalPurchasesToBackend() {
    const purchases = _.safeParse('purchases') || [];
    if (!purchases.length) return;
    const unsynced = purchases.filter(p => !p.synced);
    if (!unsynced.length) return;
    for (const p of unsynced) {
        try {
            const res = await fetch(`${API_BASE}/purchase`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
            if (res.ok) p.synced = true;
        } catch (err) { console.warn('purchase sync failed', err); break; }
    }
    _.save('purchases', purchases);
}
// set an interval for syncing purchases (attempt)
if (!window.__uwv_purchase_sync_interval_set) {
    window.__uwv_purchase_sync_interval_set = true;
    setInterval(() => { syncLocalPurchasesToBackend(); syncLocalSneakersToBackend(); }, 30000);
}

