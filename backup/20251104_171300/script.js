// script.js - clean replacement
// Provides: auth (signin/register), reCAPTCHA token forwarding (optional), inventory rendering with local fallback,
// product modal open-by-id, grouped cart, checkout with server-first then local fallback, admin create with local fallback,
// and periodic sync of unsynced local sneakers.

const API_BASE = '/api';

/* ---------- small helpers ---------- */
const _ = {
	fetchJson: async (url, opts = {}) => {
		const res = await fetch(url, opts);
		if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
		return res.json();
	},
	safeParse: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
	save: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('ls set failed', e); } },
	groupCart: (list = []) => Object.values((list || []).reduce((acc, it) => {
		const key = `${it.id}::${it.size || ''}`;
		if (!acc[key]) acc[key] = { id: it.id, name: it.name, price: it.price, image: it.image, size: it.size || '', qty: 0 };
		acc[key].qty += Number(it.qty || 1);
		return acc;
	}, {})),
};

/* ---------- auth helpers ---------- */
function checkAuth(role) {
	const u = _.safeParse('currentUser');
	if (!u) { if (!/signin.html|register.html$/.test(window.location.pathname)) window.location.href = 'signin.html'; return false; }
	if (role && u.role !== role) { alert('Access denied'); window.location.href = 'inventory.html'; return false; }
	return true;
}
function signOut() { localStorage.removeItem('currentUser'); localStorage.removeItem('token'); window.location.href = 'signin.html'; }

/* ---------- auth forms (register/signin) ---------- */
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
		if (password !== confirm) return alert('Passwords do not match');

		async function sendRegistration(recaptchaToken = null) {
			try {
				const res = await fetch(`${API_BASE}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, email, password, recaptchaToken }) });
				const data = await res.json();
				if (!res.ok) throw new Error(data.error || 'Registration failed');
				alert('Registered — please sign in');
				window.location.href = 'signin.html';
			} catch (err) { alert(err.message || err); }
		}

		const SITE_KEY = 'REPLACE_WITH_YOUR_SITE_KEY';
		if (window.grecaptcha && SITE_KEY !== 'REPLACE_WITH_YOUR_SITE_KEY') {
			try { const token = await grecaptcha.execute(SITE_KEY, { action: 'register' }); await sendRegistration(token); } catch (e) { alert('reCAPTCHA failed'); }
		} else {
			await sendRegistration(null);
		}
	}
});

/* ---------- cart (grouped) ---------- */
function renderCart() {
	const cartList = document.getElementById('cartList'); if (!cartList) return;
	const totalEl = document.getElementById('totalPrice');
	const checkoutBtn = document.getElementById('checkoutBtn') || document.getElementById('checkoutButton');
	const cart = JSON.parse(localStorage.getItem('cart')) || [];
	const grouped = _.groupCart(cart);
	cartList.innerHTML = '';
	if (!grouped.length) { if (checkoutBtn) checkoutBtn.style.display = 'none'; if (totalEl) totalEl.textContent = '0.00'; cartList.innerHTML = '<p>Your cart is empty</p>'; return; }
	if (checkoutBtn) checkoutBtn.style.display = '';
	let total = 0;
	grouped.forEach(it => {
		total += Number(it.price || 0) * Number(it.qty || 0);
		const li = document.createElement('li'); li.className = 'cart-item';
		li.innerHTML = `
			<div class="cart-item-left"><img src="${it.image || ''}" alt="${it.name || ''}" /><div><div class="cart-item-name">${it.name}</div><div class="cart-item-size">Size: ${it.size || 'M'}</div></div></div>
			<div class="cart-item-right"><div class="cart-item-qty"><button data-key="${it.id}::${it.size}" class="qty-decrease">-</button><span class="qty-count">${it.qty}</span><button data-key="${it.id}::${it.size}" class="qty-increase">+</button></div><div class="cart-item-remove"><button data-key="${it.id}::${it.size}" class="remove-item">Remove</button></div></div>`;
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
	for (let i = 0; i < newQty; i++) list.push({ id: target.id, name: target.name, price: target.price, image: target.image, size: target.size, qty: 1 });
	localStorage.setItem('cart', JSON.stringify(list)); window.dispatchEvent(new Event('cartUpdated')); renderCart();
}
function removeGroupedItem(key) { let list = JSON.parse(localStorage.getItem('cart')) || []; list = list.filter(i => `${i.id}::${i.size || ''}` !== key); localStorage.setItem('cart', JSON.stringify(list)); window.dispatchEvent(new Event('cartUpdated')); renderCart(); }

async function doCheckout() {
	const user = _.safeParse('currentUser'); if (!user) return alert('You must sign in to checkout');
	const cart = JSON.parse(localStorage.getItem('cart')) || []; if (!cart.length) return alert('Cart is empty');
	try {
		const res = await fetch(`${API_BASE}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: user.id, cart }) });
		if (!res.ok) throw new Error('Server checkout failed');
		localStorage.removeItem('cart'); window.dispatchEvent(new Event('cartUpdated')); alert('Checkout completed'); renderCart();
	} catch (err) {
		// offline fallback: persist purchase locally
		const grouped = _.groupCart(cart);
		const purchases = _.safeParse('purchases') || [];
		purchases.push({ user: user.username || user.email || 'guest', items: grouped, total: grouped.reduce((s, i) => s + (i.price * i.qty || 0), 0).toFixed(2), datetime: new Date().toLocaleString(), synced: false });
		_.save('purchases', purchases);
		localStorage.removeItem('cart'); window.dispatchEvent(new Event('cartUpdated')); alert('Checkout stored locally (offline)'); renderCart();
	}
}

/* ---------- featured & inventory ---------- */
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
	let remote = [];
	let backendOk = false;
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

/* product modal */
function populateProductModal(s) {
	const img = document.getElementById('productImage'); if (img) img.src = s.image || '';
	const name = document.getElementById('productName'); if (name) name.textContent = s.name || '';
	const desc = document.getElementById('productDesc'); if (desc) desc.textContent = s.desc || '';
	const price = document.getElementById('productPrice'); if (price) price.textContent = s.price ? `Price: R${s.price}` : '';
	const add = document.getElementById('productAddToCart'); if (add) add.dataset.id = s.id || '';
}
async function openProductModalById(id) {
	let sneaker = null;
	try { const list = await _.fetchJson(`${API_BASE}/sneakers`); sneaker = list.find(x => String(x.id) === String(id)); } catch (_) { sneaker = null; }
	if (!sneaker) { sneaker = (_.safeParse('sneakers') || []).find(x => String(x.id) === String(id)); }
	if (!sneaker) return;
	populateProductModal(sneaker);
	const modal = document.getElementById('productModal'); if (modal) modal.style.display = 'flex';
}

/* sync local unsynced sneakers to backend periodically */
async function syncLocalSneakersToBackend() {
	const local = _.safeParse('sneakers') || [];
	const unsynced = local.filter(s => !s.synced);
	if (!unsynced.length) return;
	for (const s of unsynced) {
		try {
			const res = await fetch(`${API_BASE}/sneakers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: s.name, image: s.image, price: s.price, desc: s.desc, qty: s.qty }) });
			if (res.ok) s.synced = true; else break;
		} catch (err) { console.warn('sync failed', err); break; }
	}
	_.save('sneakers', local);
}

/* ---------- DOM wiring & events ---------- */
document.addEventListener('DOMContentLoaded', () => {
	const signInBtn = document.getElementById('signInBtn'); if (signInBtn) signInBtn.addEventListener('click', () => window.location.href = 'signin.html');
	const registerBtn = document.getElementById('registerBtn'); if (registerBtn) registerBtn.addEventListener('click', () => window.location.href = 'register.html');
	const shopNowBtn = document.getElementById('shopNowBtn'); if (shopNowBtn) shopNowBtn.addEventListener('click', () => window.location.href = 'inventory.html');

	if (/index.html|\/$/.test(window.location.pathname)) renderFeaturedSneakers();
	if (window.location.pathname.includes('inventory.html')) loadInventorySneakers();

	const close = document.getElementById('closeProductModal'); if (close) close.addEventListener('click', () => { const m = document.getElementById('productModal'); if (m) m.style.display = 'none'; });
	window.addEventListener('click', (ev) => { const m = document.getElementById('productModal'); if (m && ev.target === m) m.style.display = 'none'; });

	const addBtn = document.getElementById('productAddToCart'); if (addBtn) addBtn.addEventListener('click', async function() {
		const id = this.dataset.id; if (!id) return;
		let sneaker = null; try { sneaker = (await _.fetchJson(`${API_BASE}/sneakers`)).find(x => String(x.id) === String(id)); } catch (_) { sneaker = (_.safeParse('sneakers') || []).find(x => String(x.id) === String(id)); }
		if (!sneaker) return alert('Sneaker not found');
		const sizeEl = document.getElementById('productSize'); const qtyEl = document.getElementById('productQty'); const size = sizeEl ? sizeEl.value : ''; const qty = qtyEl ? parseInt(qtyEl.value, 10) || 1 : 1;
		const cart = JSON.parse(localStorage.getItem('cart')) || [];
		for (let i = 0; i < qty; i++) cart.push({ id: sneaker.id, name: sneaker.name, price: sneaker.price, image: sneaker.image, size, qty: 1 });
		localStorage.setItem('cart', JSON.stringify(cart)); window.dispatchEvent(new Event('cartUpdated'));
		const modal = document.getElementById('productModal'); if (modal) modal.style.display = 'none';
	});

	const buyNow = document.getElementById('productBuyNow'); if (buyNow) buyNow.addEventListener('click', () => { const add = document.getElementById('productAddToCart'); if (add) add.click(); window.location.href = 'cart.html'; });

	const grid = document.getElementById('inventoryGrid'); if (grid) {
		grid.addEventListener('click', async (ev) => {
			const t = ev.target;
			if (t.classList.contains('add-to-cart-btn')) {
				const id = t.dataset.id; let list = [];
				try { list = await _.fetchJson(`${API_BASE}/sneakers`); } catch (_) { list = _.safeParse('sneakers') || []; }
				const s = list.find(x => String(x.id) === String(id)); if (!s || s.qty === 0) return;
				const cart = JSON.parse(localStorage.getItem('cart')) || []; cart.push({ id: s.id, name: s.name, price: s.price, image: s.image, qty: 1 }); localStorage.setItem('cart', JSON.stringify(cart)); window.dispatchEvent(new Event('cartUpdated'));
				try { await fetch(`${API_BASE}/sneakers/${s.id}`, { method: 'PUT', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ ...s, qty: (s.qty||0)-1 }) }); } catch (_) {}
				loadInventorySneakers();
			}
			if (t.classList.contains('edit-sneaker-btn')) {
				const id = t.dataset.id; try { const list = await _.fetchJson(`${API_BASE}/sneakers`); const s = list.find(x => x.id == id); if (s) { document.getElementById('editSneakerId').value = s.id; document.getElementById('editSneakerName').value = s.name; document.getElementById('editSneakerPrice').value = s.price; document.getElementById('editSneakerQty').value = s.qty || 0; document.getElementById('editSneakerImage').value = s.image; document.getElementById('editSneakerDesc').value = s.desc; document.getElementById('editSneakerModal').style.display = 'block'; } } catch { alert('Failed to load sneaker'); }
			}
			if (t.classList.contains('delete-sneaker-btn')) { const id = t.dataset.id; if (!confirm('Delete?')) return; try { await fetch(`${API_BASE}/sneakers/${id}`, { method: 'DELETE' }); loadInventorySneakers(); } catch { alert('Delete failed'); } }
			const card = t.closest && t.closest('.card'); if (card && !t.classList.contains('edit-sneaker-btn') && !t.classList.contains('delete-sneaker-btn')) { const id = card.dataset.id; if (id) openProductModalById(id); }
		});
	}

	const checkoutBtn = document.getElementById('checkoutBtn') || document.getElementById('checkoutButton'); if (checkoutBtn) checkoutBtn.addEventListener('click', doCheckout);
	renderCart(); window.addEventListener('cartUpdated', renderCart); window.addEventListener('storage', renderCart);
	syncLocalSneakersToBackend(); setInterval(syncLocalSneakersToBackend, 30000);
});

/* admin add form (fallback to local if backend unreachable) */
const sneakerForm = document.getElementById('sneakerForm');
if (sneakerForm) sneakerForm.addEventListener('submit', async (e) => {
	e.preventDefault();
	const payload = { name: document.getElementById('sneakerName').value, image: document.getElementById('sneakerImage').value, price: parseFloat(document.getElementById('sneakerPrice').value)||0, qty: parseInt(document.getElementById('sneakerQty').value,10)||0, desc: document.getElementById('sneakerDesc').value };
	try {
		const res = await fetch(`${API_BASE}/sneakers`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
		if (!res.ok) throw new Error('Create failed');
		alert('Created');
	} catch (err) {
		const local = _.safeParse('sneakers') || [];
		local.push({ id: Date.now(), ...payload, synced: false }); _.save('sneakers', local);
		alert('Saved locally (offline)');
	}
	sneakerForm.reset(); if (typeof loadInventorySneakers === 'function') loadInventorySneakers();
});

// kick off periodic sync on load
syncLocalSneakersToBackend(); setInterval(syncLocalSneakersToBackend, 30000);

