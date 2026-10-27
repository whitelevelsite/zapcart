/* Zapcart – demo quick-commerce storefront. Vanilla JS, no build step, GitHub Pages friendly. */
(function () {
'use strict';

/* ---------- data & helpers ---------- */
const P = window.PRODUCTS, C = window.CATEGORIES;
const byId = Object.fromEntries(P.map(p => [p.id, p]));
const catOf = id => C.find(c => c.id === id);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const disc = p => Math.round((1 - p.price / p.mrp) * 100);
const ls = {
  get(k, d) { try { const v = localStorage.getItem('zc_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('zc_' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
};

const FREE_DELIVERY = 199, DELIVERY_FEE = 25, HANDLING_FEE = 2, MAX_QTY = 10;
const COUPONS = {
  FIRST50: { min: 299, text: 'Flat ₹50 off above ₹299', calc: () => 50 },
  SAVE10: { min: 199, text: '10% off (max ₹100) above ₹199', calc: s => Math.min(100, Math.round(s * 0.1)) },
  FREEDEL: { min: 99, text: 'Free delivery above ₹99', calc: (s, d) => d }
};
const SLOTS = ['Express – 10 mins', 'Today, 6 PM – 8 PM', 'Tomorrow, 8 AM – 10 AM'];
const STEPS = [
  ['Order placed', 'We have received your order', 0],
  ['Packing your items', 'Picking the freshest items', 6],
  ['Out for delivery', 'Your rider is on the way', 18],
  ['Arriving now', 'Rider is at your door', 40],
  ['Delivered', 'Enjoy! 🎉', 70]
];

/* ---------- state ---------- */
const S = {
  cart: ls.get('cart', {}), wish: ls.get('wish', []), user: ls.get('user', null),
  orders: ls.get('orders', []), pin: ls.get('pin', ''), recent: ls.get('recent', []),
  coupon: ls.get('coupon', null), addrs: ls.get('addrs', [])
};
const save = () => Object.keys(S).forEach(k => ls.set(k, S[k]));
// drop cart entries for products that no longer exist
Object.keys(S.cart).forEach(k => { if (!byId[k.split(':')[0]]) delete S.cart[k]; });

/* ---------- small UI helpers ---------- */
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800);
}
function bump(el) { if (!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

/* ---------- cart logic ---------- */
function item(key) {
  const [id, v] = String(key).split(':'); const p = byId[id]; if (!p) return null;
  const two = v === '2';
  return { key, p, name: p.name, unit: two ? 'Pack of 2 · ' + p.unit : p.unit,
    price: two ? Math.round(p.price * 2 * 0.95) : p.price, mrp: two ? p.mrp * 2 : p.mrp };
}
function couponCalc(code, sub, delivery) {
  const c = COUPONS[code]; if (!code || !c) return { amt: 0 };
  if (sub < c.min) return { amt: 0, note: `Add ${inr(c.min - sub)} more to use ${code}` };
  return { amt: Math.min(c.calc(sub, delivery), sub + delivery) };
}
function bill() {
  const lines = Object.keys(S.cart).map(k => ({ it: item(k), q: S.cart[k] })).filter(l => l.it && l.q > 0);
  const sub = lines.reduce((a, l) => a + l.it.price * l.q, 0);
  const mrp = lines.reduce((a, l) => a + l.it.mrp * l.q, 0);
  const delivery = sub && sub < FREE_DELIVERY ? DELIVERY_FEE : 0;
  const handling = sub ? HANDLING_FEE : 0;
  const gst = +((delivery + handling) * 0.05).toFixed(2);
  const cp = couponCalc(S.coupon, sub, delivery);
  const total = Math.max(0, sub + delivery + handling + gst - cp.amt);
  return { lines, sub, mrp, delivery, handling, gst, coupon: cp.amt, note: cp.note, total, saved: mrp - sub + cp.amt };
}
function count() { return Object.values(S.cart).reduce((a, b) => a + b, 0); }

function setQty(key, q) {
  const p = byId[String(key).split(':')[0]]; if (!p) return;
  q = Math.max(0, Math.min(q, MAX_QTY, p.stock));
  const prev = S.cart[key] || 0;
  if (q === 0) delete S.cart[key]; else S.cart[key] = q;
  if (q > prev && prev === 0) toast(`Added ${p.name}`);
  if (q === prev && q === Math.min(MAX_QTY, p.stock)) toast('Maximum quantity reached');
  save(); refreshCtl(); updateCount();
  if ($('#cart').classList.contains('open')) renderCart();
}
function updateCount() {
  const n = count();
  [$('#cartCount'), $('#bnavCnt')].forEach(e => { e.textContent = n; e.dataset.n = n; });
  bump($('#cartBtn')); bump($('#bnavCnt'));
}
function ctl(key) {
  const q = S.cart[key] || 0, p = byId[String(key).split(':')[0]];
  if (p.stock < 1) return '<button class="add" disabled>Sold out</button>';
  return q
    ? `<div class="step" role="group" aria-label="Quantity of ${esc(p.name)}"><button data-dec="${key}" aria-label="Decrease quantity">−</button><span aria-live="polite">${q}</span><button data-inc="${key}" aria-label="Increase quantity">+</button></div>`
    : `<button class="add" data-add="${key}" aria-label="Add ${esc(p.name)} to cart">ADD</button>`;
}
function refreshCtl() { $$('.ctl').forEach(e => { e.innerHTML = ctl(e.dataset.key); }); }

/* ---------- product card ---------- */
function card(p) {
  const d = disc(p), w = S.wish.includes(p.id);
  return `<article class="card">
    ${d ? `<span class="badge-off">${d}% OFF</span>` : ''}
    <button class="wish ${w ? 'on' : ''}" data-wish="${p.id}" aria-pressed="${w}" aria-label="Wishlist ${esc(p.name)}">♥</button>
    <div class="img" style="background:${p.bg}" data-open="${p.id}" role="button" tabindex="0" aria-label="View ${esc(p.name)}"><span>${p.emoji}</span></div>
    <span class="time">⚡ 10 MINS</span>
    <h3 data-open="${p.id}">${esc(p.name)}</h3>
    <p class="unit">${esc(p.unit)}</p>
    <span class="rate">★ ${p.rating}</span>
    <div class="buy"><div class="price"><b>${inr(p.price)}</b>${d ? `<s>${inr(p.mrp)}</s>` : ''}</div>
    <div class="ctl" data-key="${p.id}">${ctl(String(p.id))}</div></div>
  </article>`;
}
const rail = (title, list, link) => list.length ? `<section><div class="rhead"><h2>${title}</h2>${link ? `<a href="${link}">See all</a>` : ''}</div><div class="rail">${list.map(card).join('')}</div></section>` : '';

/* ---------- search (fuzzy) ---------- */
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
function score(p, q) {
  const name = p.name.toLowerCase();
  const hay = (name + ' ' + p.brand + ' ' + p.category.replace(/-/g, ' ') + ' ' + p.tags.join(' ')).toLowerCase();
  if (name.startsWith(q)) return 100;
  if (hay.includes(q)) return 80;
  const words = hay.split(/[^a-z0-9]+/).filter(Boolean); let s = 0;
  for (const t of q.split(/\s+/)) {
    if (words.some(w => w.startsWith(t))) s += 30;
    else if (t.length > 3 && words.some(w => lev(w.slice(0, t.length + 1), t) <= (t.length > 6 ? 2 : 1))) s += 15;
    else return 0;
  }
  return s;
}
function search(q) {
  q = q.toLowerCase().trim(); if (!q) return [];
  return P.map(p => ({ p, s: score(p, q) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s || b.p.rating - a.p.rating).map(x => x.p);
}

/* ---------- modal & drawer ---------- */
let lastFocus = null;
function openModal(html, cls = '') {
  const m = $('#modal'); lastFocus = document.activeElement;
  m.innerHTML = `<div class="mbox ${cls}"><button class="x" data-close aria-label="Close">✕</button>${html}</div>`;
  m.hidden = false; document.body.style.overflow = 'hidden';
  const f = $('input,select,button:not(.x)', m); (f || $('.x', m)).focus();
}
function closeModal() {
  const m = $('#modal'); if (m.hidden) return;
  m.hidden = true; m.innerHTML = ''; document.body.style.overflow = '';
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
function openCart() {
  renderCart(); $('#cart').classList.add('open'); $('#cart').setAttribute('aria-hidden', 'false');
  $('#overlay').hidden = false; document.body.style.overflow = 'hidden';
  const x = $('#cart [data-closecart]'); if (x) x.focus();
}
function closeCart() {
  $('#cart').classList.remove('open'); $('#cart').setAttribute('aria-hidden', 'true');
  $('#overlay').hidden = true; if ($('#modal').hidden) document.body.style.overflow = '';
}

function renderCart() {
  const b = bill(), el = $('#cart');
  const head = `<div class="dhead"><h2 style="font-size:1.15rem">My Cart ${b.lines.length ? `<span class="muted" style="font-size:.85rem">(${count()} items)</span>` : ''}</h2><button class="ibtn" data-closecart aria-label="Close cart" style="background:var(--bg);color:var(--text)">✕</button></div>`;
  if (!b.lines.length) {
    el.innerHTML = head + `<div class="dbody"><div class="empty"><div class="big">🛒</div><h3>Your cart is empty</h3><p>Add some groceries to get started.</p><button class="btn" data-closecart>Browse products</button></div></div>`;
    return;
  }
  const left = FREE_DELIVERY - b.sub, pct = Math.min(100, b.sub / FREE_DELIVERY * 100);
  const lines = b.lines.map(({ it, q }) => `<div class="line"><div class="t" style="background:${it.p.bg}">${it.p.emoji}</div>
    <div class="n">${esc(it.name)}<small>${esc(it.unit)}</small><b>${inr(it.price * q)}</b></div>
    <div class="ctl" data-key="${it.key}">${ctl(it.key)}</div></div>`).join('');
  const hint = Object.entries(COUPONS).map(([k, c]) => `<small class="muted"><b>${k}</b> – ${c.text}</small>`).join('<br>');
  el.innerHTML = head + `<div class="dbody">
    <div class="box"><b>${left > 0 ? `Add ${inr(left)} more for FREE delivery` : '🎉 You unlocked free delivery!'}</b><div class="ship" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div></div>
    <div class="box">${lines}</div>
    <div class="box"><form class="coupon" id="couponForm"><input id="couponIn" placeholder="Coupon code" aria-label="Coupon code" value="${S.coupon ? esc(S.coupon) : ''}"><button class="btn alt" type="submit">${S.coupon ? 'Change' : 'Apply'}</button></form>
      ${S.coupon ? `<p style="margin:8px 0 0">${b.coupon ? `✅ <b>${esc(S.coupon)}</b> applied, you save ${inr(b.coupon)}` : `⚠️ ${esc(b.note || 'Invalid coupon')}`} <button data-rmcoupon class="muted" style="text-decoration:underline">Remove</button></p>` : `<p style="margin:8px 0 0">${hint}</p>`}</div>
    <div class="box bill"><h3 style="margin-bottom:6px">Bill details</h3>
      <div><span>Item total</span><span>${b.mrp > b.sub ? `<s class="muted">${inr(b.mrp)}</s> ` : ''}${inr(b.sub)}</span></div>
      <div><span>Delivery fee</span><span>${b.delivery ? inr(b.delivery) : '<b style="color:var(--green)">FREE</b>'}</span></div>
      <div><span>Handling fee</span><span>${inr(b.handling)}</span></div>
      <div><span>GST on fees (5%)</span><span>₹${b.gst.toFixed(2)}</span></div>
      ${b.coupon ? `<div class="save"><span>Coupon discount</span><span>− ${inr(b.coupon)}</span></div>` : ''}
      <div class="tot"><span>Grand total</span><span>${inr(b.total)}</span></div>
      ${b.saved > 0 ? `<div class="save"><span>🎉 Your total savings</span><span>${inr(b.saved)}</span></div>` : ''}</div>
  </div>
  <div class="dfoot"><button class="btn full" data-checkout>Proceed to checkout · ${inr(b.total)}</button></div>`;
}

/* ---------- auth (mock) ---------- */
function loginModal(after) {
  openModal(`<h2>Login / Sign up</h2><p class="muted">Demo only: no OTP, details stay in your browser.</p>
  <form class="form" id="loginForm" novalidate>
    <label>Your name<input name="name" autocomplete="name"><span class="err"></span></label>
    <label>Mobile number<input name="phone" inputmode="numeric" maxlength="10" autocomplete="tel"><span class="err"></span></label>
    <button class="btn full" type="submit">Continue</button></form>`, 'sm');
  $('#loginForm').addEventListener('submit', e => {
    e.preventDefault(); const f = e.target; let ok = true;
    const chk = (n, t, msg) => { const i = f[n]; const bad = !t(i.value.trim()); i.classList.toggle('bad', bad); i.nextElementSibling.textContent = bad ? msg : ''; if (bad) ok = false; };
    chk('name', v => v.length >= 2, 'Enter your name');
    chk('phone', v => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number');
    if (!ok) return;
    S.user = { name: f.name.value.trim(), phone: f.phone.value.trim() }; save(); closeModal(); renderUser();
    toast(`Welcome, ${S.user.name.split(' ')[0]}!`); if (after) after();
  });
}
function renderUser() { $('#userBtn').textContent = S.user ? '👤 ' + S.user.name.split(' ')[0] : 'Login'; }
function accountModal() {
  openModal(`<h2>👤 ${esc(S.user.name)}</h2><p class="muted">+91 ${esc(S.user.phone)}</p>
  <div class="form"><a class="btn full" style="text-align:center" href="#/orders" data-close>My orders (${S.orders.length})</a>
  <a class="btn ghost full" style="text-align:center" href="#/wishlist" data-close>Wishlist (${S.wish.length})</a>
  <button class="btn ghost full" data-logout>Logout</button></div>`, 'sm');
}
function locationModal() {
  openModal(`<h2>Delivery location</h2><p class="muted">Enter your pincode to check delivery (demo: every pincode is serviceable).</p>
  <form class="form" id="locForm"><label>Pincode<input name="pin" inputmode="numeric" maxlength="6" value="${esc(S.pin)}"><span class="err"></span></label><button class="btn full" type="submit">Confirm</button></form>`, 'sm');
  $('#locForm').addEventListener('submit', e => {
    e.preventDefault(); const i = e.target.pin, v = i.value.trim();
    if (!/^[1-9]\d{5}$/.test(v)) { i.classList.add('bad'); i.nextElementSibling.textContent = 'Enter a valid 6-digit pincode'; return; }
    S.pin = v; save(); renderLoc(); closeModal(); toast('Great, we deliver to ' + v + ' in 10 mins');
  });
}
function renderLoc() { $('#locTxt').textContent = S.pin ? 'Delivering to ' + S.pin + ' ▾' : 'Select location ▾'; }

/* ---------- product detail ---------- */
function openProduct(id) {
  const p = byId[id]; if (!p) return;
  S.recent = [p.id, ...S.recent.filter(x => x !== p.id)].slice(0, 12); save();
  const sim = P.filter(x => x.category === p.category && x.id !== p.id).slice(0, 6);
  const two = Math.round(p.price * 2 * 0.95);
  openModal(`<div class="pd"><div class="big" style="background:${p.bg}">${p.emoji}</div>
  <div><span class="time">⚡ 10 MINS</span><h2 style="margin:6px 0">${esc(p.name)}</h2>
    <p class="muted" style="margin:0">${esc(p.brand)} · ★ ${p.rating} · ${p.stock < 10 ? `Only ${p.stock} left` : 'In stock'}</p>
    <div class="vars" role="radiogroup" aria-label="Pack size">
      <button class="var on" data-var="" role="radio" aria-checked="true"><b>${esc(p.unit)}</b><br>${inr(p.price)}</button>
      <button class="var" data-var="2" role="radio" aria-checked="false"><b>Pack of 2</b><br>${inr(two)} <small class="muted">(5% off)</small></button></div>
    <p>${esc(p.desc)}</p>
    <div class="buy"><div class="price"><b id="pdPrice" style="font-size:1.3rem">${inr(p.price)}</b>${disc(p) ? `<s id="pdMrp">${inr(p.mrp)}</s> <span class="status">${disc(p)}% OFF</span>` : ''}</div>
    <div class="ctl" id="pdCtl" data-key="${p.id}">${ctl(String(p.id))}</div></div>
    <p class="muted" style="font-size:.8rem">Inclusive of all taxes. Image shown is an emoji illustration.</p></div></div>
  ${sim.length ? `<h3 style="margin:16px 0 8px">Similar products</h3><div class="rail">${sim.map(card).join('')}</div>` : ''}`);
  $('#modal').dataset.pid = p.id;
}

/* ---------- checkout ---------- */
function checkout() {
  if (!bill().lines.length) return;
  if (!S.user) { loginModal(checkout); return; }
  closeCart();
  const b = bill(), a = S.addrs[0] || {};
  const saved = S.addrs.length ? `<label>Saved addresses<select id="addrSel"><option value="">Choose…</option>${S.addrs.map((x, i) => `<option value="${i}">${esc(x.house)}, ${esc(x.area)} – ${esc(x.pin)}</option>`).join('')}</select></label>` : '';
  openModal(`<h2>Checkout</h2>
  <form class="form" id="coForm" novalidate>
    ${saved}
    <div class="two"><label>Full name<input name="name" value="${esc(a.name || S.user.name)}"><span class="err"></span></label>
    <label>Mobile<input name="phone" inputmode="numeric" maxlength="10" value="${esc(a.phone || S.user.phone)}"><span class="err"></span></label></div>
    <label>Flat / House no.<input name="house" value="${esc(a.house || '')}"><span class="err"></span></label>
    <label>Area / Street<input name="area" value="${esc(a.area || '')}"><span class="err"></span></label>
    <div class="two"><label>City<input name="city" value="${esc(a.city || '')}"><span class="err"></span></label>
    <label>Pincode<input name="pin" inputmode="numeric" maxlength="6" value="${esc(a.pin || S.pin)}"><span class="err"></span></label></div>
    <label class="opt"><input type="checkbox" name="saveAddr" checked> Save this address</label>
    <h3>Delivery slot</h3>${SLOTS.map((s, i) => `<label class="opt"><input type="radio" name="slot" value="${i}" ${i === 0 ? 'checked' : ''}> ${s}</label>`).join('')}
    <h3>Payment <small class="muted">(simulated, nothing is charged)</small></h3>
    ${['UPI', 'Card', 'Cash on delivery'].map((s, i) => `<label class="opt"><input type="radio" name="pay" value="${s}" ${i === 0 ? 'checked' : ''}> ${s}</label>`).join('')}
    <div class="box bill" style="margin:0"><div><span>${count()} items</span><span>${inr(b.sub)}</span></div>
      <div><span>Fees &amp; GST</span><span>${inr(b.delivery + b.handling + b.gst)}</span></div>
      ${b.coupon ? `<div class="save"><span>Coupon</span><span>− ${inr(b.coupon)}</span></div>` : ''}
      <div class="tot"><span>To pay</span><span>${inr(b.total)}</span></div></div>
    <button class="btn full" type="submit">Place order · ${inr(b.total)}</button>
  </form>`);
  const f = $('#coForm');
  const sel = $('#addrSel');
  if (sel) sel.addEventListener('change', () => { const x = S.addrs[sel.value]; if (x) ['name', 'phone', 'house', 'area', 'city', 'pin'].forEach(k => { f[k].value = x[k] || ''; }); });
  f.addEventListener('submit', e => {
    e.preventDefault(); let ok = true;
    const chk = (n, t, msg) => { const i = f[n]; const bad = !t(i.value.trim()); i.classList.toggle('bad', bad); i.nextElementSibling.textContent = bad ? msg : ''; if (bad) ok = false; };
    chk('name', v => v.length >= 2, 'Enter your name');
    chk('phone', v => /^[6-9]\d{9}$/.test(v), 'Valid 10-digit mobile required');
    chk('house', v => v.length >= 2, 'Enter flat / house no.');
    chk('area', v => v.length >= 3, 'Enter area / street');
    chk('city', v => v.length >= 2, 'Enter city');
    chk('pin', v => /^[1-9]\d{5}$/.test(v), 'Valid 6-digit pincode required');
    if (!ok) { const bad = $('.bad', f); if (bad) bad.focus(); return; }
    const addr = Object.fromEntries(['name', 'phone', 'house', 'area', 'city', 'pin'].map(k => [k, f[k].value.trim()]));
    if (f.saveAddr.checked && !S.addrs.some(x => x.house === addr.house && x.pin === addr.pin)) S.addrs.unshift(addr);
    const bl = bill();
    const order = {
      id: 'ZC' + Date.now().toString(36).toUpperCase().slice(-6) + Math.floor(10 + Math.random() * 90),
      ts: Date.now(), addr, slot: +f.slot.value, pay: f.pay.value, coupon: S.coupon,
      lines: bl.lines.map(({ it, q }) => ({ key: it.key, name: it.name, unit: it.unit, price: it.price, q, emoji: it.p.emoji, bg: it.p.bg })),
      bill: { sub: bl.sub, delivery: bl.delivery, handling: bl.handling, gst: bl.gst, coupon: bl.coupon, total: bl.total }
    };
    S.orders.unshift(order); S.cart = {}; S.coupon = null; S.pin = S.pin || addr.pin; save();
    refreshCtl(); updateCount(); renderLoc(); closeModal();
    location.hash = '#/order/' + order.id; toast('Order placed! 🎉');
  });
}

/* ---------- views ---------- */
let timer = null, heroTimer = null;
const skeleton = () => `<div class="grid">${'<div class="sk"></div>'.repeat(8)}</div>`;

function viewHome() {
  const best = [...P].sort((a, b) => b.rating - a.rating || b.stock - a.stock).slice(0, 10);
  const deals = [...P].sort((a, b) => disc(b) - disc(a)).slice(0, 10);
  const rec = S.recent.map(id => byId[id]).filter(Boolean).slice(0, 10);
  const slides = [
    ['#ffe27a', 'Fresh in 10 minutes', 'Fruits & veggies picked this morning', '🥬', '#/c/fruits-veg'],
    ['#b9f0c1', 'Flat ₹50 off', 'Use code FIRST50 on orders above ₹299', '🛍️', '#/c/staples'],
    ['#ffd0a8', 'Snack time!', 'Chips, cookies & chocolates up to 25% off', '🍫', '#/c/snacks']
  ];
  return `<div class="hero" aria-roledescription="carousel" aria-label="Offers">${slides.map((s, i) => `<div class="slide ${i ? '' : 'on'}" style="background:${s[0]}"><div><h1>${s[1]}</h1><p>${s[2]}</p><a class="cta" href="${s[4]}">Shop now</a></div><div class="big" aria-hidden="true">${s[3]}</div></div>`).join('')}
    <div class="dots">${slides.map((_, i) => `<button data-slide="${i}" class="${i ? '' : 'on'}" aria-label="Slide ${i + 1}"></button>`).join('')}</div></div>
  <section><div class="rhead"><h2>Shop by category</h2></div><div class="cats">${C.map(catTile).join('')}</div></section>
  ${rail('🔥 Best sellers', best)}${rail('💸 Deals today', deals)}${rail('🕘 Recently viewed', rec)}
  ${['fruits-veg', 'dairy', 'snacks'].map(id => rail(catOf(id).name, P.filter(p => p.category === id).slice(0, 8), '#/c/' + id)).join('')}`;
}
const catTile = c => `<a class="cat" href="#/c/${c.id}"><div class="ic" style="background:${c.bg}">${c.emoji}</div><span>${c.name}</span></a>`;
function startHero() {
  const slides = $$('.slide'); if (!slides.length) return; let i = 0;
  const go = n => { i = n; slides.forEach((s, k) => s.classList.toggle('on', k === i)); $$('.dots button').forEach((d, k) => d.classList.toggle('on', k === i)); };
  heroTimer = setInterval(() => go((i + 1) % slides.length), 4500);
  $$('.dots button').forEach(d => d.addEventListener('click', () => go(+d.dataset.slide)));
}

function viewCategories() { return `<h1 style="margin-bottom:14px">All categories</h1><div class="cats">${C.map(catTile).join('')}</div>`; }

function viewCategory(id) {
  const c = catOf(id); if (!c) return notFound();
  const list = P.filter(p => p.category === id), brands = [...new Set(list.map(p => p.brand))];
  const F = { price: 0, brands: [], rating: 0, sort: 'rel', n: 12 };
  setTimeout(() => {
    const draw = () => {
      let r = list.filter(p => (!F.price || p.price <= F.price) && (!F.brands.length || F.brands.includes(p.brand)) && p.rating >= F.rating);
      const s = { rel: 0, plh: (a, b) => a.price - b.price, phl: (a, b) => b.price - a.price, rate: (a, b) => b.rating - a.rating, disc: (a, b) => disc(b) - disc(a) }[F.sort];
      if (s) r = [...r].sort(s);
      $('#cgrid').innerHTML = r.length ? r.slice(0, F.n).map(card).join('') : `<div class="empty" style="grid-column:1/-1"><div class="big">🔎</div><p>No products match these filters.</p></div>`;
      $('#cmore').hidden = r.length <= F.n; $('#ccount').textContent = r.length + ' products';
    };
    $('#filters').addEventListener('change', e => {
      const t = e.target;
      if (t.name === 'price') F.price = +t.value; else if (t.name === 'rating') F.rating = +t.value; else if (t.name === 'sort') F.sort = t.value;
      else if (t.name === 'brand') F.brands = $$('[name=brand]:checked').map(x => x.value);
      F.n = 12; draw();
    });
    $('#cmore').addEventListener('click', () => { F.n += 12; draw(); });
    $('#fReset').addEventListener('click', () => { $('#filters').reset(); Object.assign(F, { price: 0, brands: [], rating: 0, sort: 'rel', n: 12 }); draw(); });
    draw();
  }, 0);
  return `<div class="chips" role="navigation" aria-label="Categories">${C.map(x => `<a class="chip ${x.id === id ? 'on' : ''}" href="#/c/${x.id}">${x.emoji} ${x.name}</a>`).join('')}</div>
  <div class="rhead" style="margin-top:14px"><h1 style="font-size:1.5rem">${c.emoji} ${c.name}</h1><span class="muted" id="ccount"></span></div>
  <div class="cpage"><form class="filters" id="filters" aria-label="Filters">
    <h4>Sort by</h4><select name="sort"><option value="rel">Relevance</option><option value="plh">Price: low to high</option><option value="phl">Price: high to low</option><option value="rate">Rating</option><option value="disc">Discount</option></select>
    <h4>Price</h4>${[['0', 'Any'], ['100', 'Under ₹100'], ['250', 'Under ₹250'], ['500', 'Under ₹500']].map((x, i) => `<label><input type="radio" name="price" value="${x[0]}" ${i ? '' : 'checked'}> ${x[1]}</label>`).join('')}
    <h4>Rating</h4>${[['0', 'Any'], ['4', '4★ & above'], ['4.5', '4.5★ & above']].map((x, i) => `<label><input type="radio" name="rating" value="${x[0]}" ${i ? '' : 'checked'}> ${x[1]}</label>`).join('')}
    <h4>Brand</h4>${brands.map(b => `<label><input type="checkbox" name="brand" value="${esc(b)}"> ${esc(b)}</label>`).join('')}
    <button type="button" class="btn ghost full" id="fReset" style="margin-top:12px">Reset</button></form>
  <div><div class="grid" id="cgrid"></div><button class="more" id="cmore" hidden>Load more</button></div></div>`;
}

function viewSearch(q) {
  q = (q || '').trim();
  const inp = $('#q'); if (inp && inp.value !== q) inp.value = q;
  if (!q) return `<div class="empty"><div class="big">🔍</div><h2>What are you looking for?</h2><p>Try “milk”, “chips” or “atta”.</p></div><div class="cats">${C.map(catTile).join('')}</div>`;
  const r = search(q);
  if (!r.length) return `<div class="empty"><div class="big">😕</div><h2>No results for “${esc(q)}”</h2><p>Check the spelling or browse a category.</p></div><div class="cats">${C.map(catTile).join('')}</div>`;
  return `<div class="rhead"><h1 style="font-size:1.4rem">Results for “${esc(q)}”</h1><span class="muted">${r.length} found</span></div><div class="grid">${r.map(card).join('')}</div>`;
}

function viewWishlist() {
  const l = S.wish.map(id => byId[id]).filter(Boolean);
  return `<h1 style="margin-bottom:14px">❤️ Wishlist</h1>` + (l.length ? `<div class="grid">${l.map(card).join('')}</div>` : `<div class="empty"><div class="big">💝</div><p>Tap the heart on any product to save it here.</p></div>`);
}

const stepIdx = o => o.slot === 0 ? STEPS.reduce((a, s, i) => (Date.now() - o.ts) / 1000 >= s[2] ? i : a, 0) : 0;
function viewOrders() {
  if (!S.orders.length) return `<h1 style="margin-bottom:14px">My orders</h1><div class="empty"><div class="big">📦</div><p>No orders yet. Your orders will show up here.</p><a class="btn" href="#/">Start shopping</a></div>`;
  return `<h1 style="margin-bottom:14px">My orders</h1>` + S.orders.map(o => {
    const st = o.slot === 0 ? STEPS[stepIdx(o)][0] : 'Scheduled';
    return `<div class="ocard"><div class="rhead" style="margin:0"><b>#${o.id}</b><span class="status">${st}</span></div>
    <p class="muted" style="margin:4px 0">${new Date(o.ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · ${o.lines.reduce((a, l) => a + l.q, 0)} items · ${inr(o.bill.total)}</p>
    <p style="font-size:1.6rem;margin:6px 0">${o.lines.slice(0, 8).map(l => l.emoji).join(' ')}</p>
    <a class="btn alt" href="#/order/${o.id}">Track / view</a> <button class="btn ghost" data-reorder="${o.id}">Reorder</button></div>`;
  }).join('');
}

function timeline(o) {
  const idx = stepIdx(o), done = o.slot === 0 && idx === STEPS.length - 1;
  return STEPS.map((s, i) => `<li class="${i <= idx ? 'done' : ''} ${i === idx && !done ? 'now' : ''}"><b>${s[0]}</b><br><small>${s[1]}</small></li>`).join('');
}
function viewOrder(id) {
  const o = S.orders.find(x => x.id === id);
  if (!o) return notFound('Order not found');
  const b = o.bill;
  setTimeout(() => {
    const tick = () => {
      const tl = $('#tl'); if (!tl) return;
      tl.innerHTML = timeline(o);
      const i = stepIdx(o); $('#etaTxt').textContent = o.slot === 0 ? (i >= 4 ? 'Delivered 🎉' : `Arriving in ~${Math.max(1, 10 - Math.floor((Date.now() - o.ts) / 60000))} mins`) : 'Scheduled: ' + SLOTS[o.slot];
      if (o.slot !== 0 || i >= 4) clearInterval(timer);
    };
    tick(); timer = setInterval(tick, 1000);
  }, 0);
  return `<div class="ocard" style="text-align:center"><div style="font-size:3rem">✅</div><h1 style="font-size:1.4rem">Order confirmed</h1>
    <p class="muted">Order ID <b>#${o.id}</b> · ${esc(o.pay)} (simulated)</p><h2 id="etaTxt"></h2></div>
  <div class="ocard"><h3>Live tracking</h3><ul class="tl" id="tl"></ul></div>
  <div class="ocard"><h3>Items</h3>${o.lines.map(l => `<div class="line"><div class="t" style="background:${l.bg}">${l.emoji}</div><div class="n">${esc(l.name)}<small>${esc(l.unit)} × ${l.q}</small></div><b>${inr(l.price * l.q)}</b></div>`).join('')}</div>
  <div class="ocard bill"><div><span>Item total</span><span>${inr(b.sub)}</span></div><div><span>Delivery</span><span>${b.delivery ? inr(b.delivery) : 'FREE'}</span></div><div><span>Handling + GST</span><span>${inr(b.handling + b.gst)}</span></div>${b.coupon ? `<div class="save"><span>Coupon${o.coupon ? ' (' + esc(o.coupon) + ')' : ''}</span><span>− ${inr(b.coupon)}</span></div>` : ''}<div class="tot"><span>Total</span><span>${inr(b.total)}</span></div></div>
  <div class="ocard"><h3>Delivering to</h3><p>${esc(o.addr.name)} · ${esc(o.addr.phone)}<br>${esc(o.addr.house)}, ${esc(o.addr.area)}, ${esc(o.addr.city)} – ${esc(o.addr.pin)}</p><p class="muted">Slot: ${SLOTS[o.slot]}</p></div>
  <a class="btn" href="#/">Continue shopping</a>`;
}
const notFound = (m = 'Page not found') => `<div class="empty"><div class="big">🧭</div><h2>${m}</h2><a class="btn" href="#/">Go home</a></div>`;

/* ---------- router ---------- */
let routeTok = 0;
function route() {
  clearInterval(timer); clearInterval(heroTimer);
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').map(decodeURIComponent);
  const [r, a] = parts, tok = ++routeTok, view = $('#view');
  view.innerHTML = skeleton(); window.scrollTo(0, 0);
  const html = () => {
    switch (r) {
      case '': return viewHome();
      case 'categories': return viewCategories();
      case 'c': return viewCategory(a);
      case 's': return viewSearch(parts.slice(1).join('/'));
      case 'search': return viewSearch('');
      case 'wishlist': return viewWishlist();
      case 'orders': return viewOrders();
      case 'order': return viewOrder(a);
      default: return notFound();
    }
  };
  setTimeout(() => {
    if (tok !== routeTok) return;
    view.innerHTML = html();
    if (r !== 's' && r !== 'search') $('#q').value = '';
    if (!r) startHero();
    if (r === 'search') $('#q').focus();
    document.title = ({ '': 'Zapcart – Groceries delivered in 10 minutes', c: (catOf(a) || {}).name + ' – Zapcart', s: 'Search – Zapcart', orders: 'My orders – Zapcart', order: 'Order – Zapcart', wishlist: 'Wishlist – Zapcart', categories: 'Categories – Zapcart' })[r] || 'Zapcart';
    $$('.bnav [data-nav]').forEach(e => e.classList.toggle('active', e.dataset.nav === (r === '' ? 'home' : r === 's' ? 'search' : r)));
  }, 160);
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-add],[data-inc],[data-dec],[data-wish],[data-open],[data-close],[data-closecart],[data-checkout],[data-rmcoupon],[data-var],[data-reorder],[data-logout]');
  const sug = $('#sugg');
  if (!e.target.closest('.search')) sug.hidden = true;
  if (!t) return;
  const d = t.dataset;
  if (d.add !== undefined) setQty(d.add, 1);
  else if (d.inc !== undefined) setQty(d.inc, (S.cart[d.inc] || 0) + 1);
  else if (d.dec !== undefined) setQty(d.dec, (S.cart[d.dec] || 0) - 1);
  else if (d.wish !== undefined) {
    const id = +d.wish, on = !S.wish.includes(id);
    S.wish = on ? [...S.wish, id] : S.wish.filter(x => x !== id); save();
    $$(`[data-wish="${id}"]`).forEach(b => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); bump(b); });
    toast(on ? 'Saved to wishlist' : 'Removed from wishlist');
    if (location.hash === '#/wishlist') route();
  }
  else if (d.open !== undefined) openProduct(+d.open);
  else if (t.hasAttribute('data-close')) closeModal();
  else if (t.hasAttribute('data-closecart')) closeCart();
  else if (t.hasAttribute('data-checkout')) checkout();
  else if (t.hasAttribute('data-rmcoupon')) { S.coupon = null; save(); renderCart(); }
  else if (d.var !== undefined) {
    const pid = +$('#modal').dataset.pid, p = byId[pid], two = d.var === '2';
    $$('.var').forEach(v => { const on = v === t; v.classList.toggle('on', on); v.setAttribute('aria-checked', on); });
    $('#pdPrice').textContent = inr(two ? Math.round(p.price * 2 * .95) : p.price);
    const m = $('#pdMrp'); if (m) m.textContent = inr(two ? p.mrp * 2 : p.mrp);
    const c = $('#pdCtl'); c.dataset.key = pid + (two ? ':2' : ''); c.innerHTML = ctl(c.dataset.key);
  }
  else if (d.reorder !== undefined) {
    const o = S.orders.find(x => x.id === d.reorder); if (!o) return;
    o.lines.forEach(l => { if (item(l.key)) setQty(l.key, (S.cart[l.key] || 0) + l.q); });
    openCart();
  }
  else if (t.hasAttribute('data-logout')) { S.user = null; save(); renderUser(); closeModal(); toast('Logged out'); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeCart(); $('#sugg').hidden = true; }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.img[data-open]')) { e.preventDefault(); openProduct(+e.target.dataset.open); }
  // keep focus inside open modal / drawer
  if (e.key === 'Tab') {
    const box = !$('#modal').hidden ? $('#modal') : $('#cart').classList.contains('open') ? $('#cart') : null; if (!box) return;
    const f = $$('button,input,select,a[href]', box).filter(x => !x.disabled && x.offsetParent !== null); if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
});
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
$('#overlay').addEventListener('click', closeCart);
$('#cartBtn').addEventListener('click', openCart);
$('#bnavCart').addEventListener('click', openCart);
$('#locBtn').addEventListener('click', locationModal);
$('#userBtn').addEventListener('click', () => S.user ? accountModal() : loginModal());
$('#cart').addEventListener('submit', e => {
  if (e.target.id !== 'couponForm') return; e.preventDefault();
  const code = $('#couponIn').value.trim().toUpperCase();
  if (!COUPONS[code]) { toast('Invalid coupon code'); return; }
  S.coupon = code; save(); renderCart(); if (!bill().coupon) toast(bill().note || 'Coupon not applicable');
});
window.addEventListener('hashchange', () => { closeModal(); closeCart(); route(); });

/* search box */
const qEl = $('#q'), sugg = $('#sugg'); let sIdx = -1;
qEl.addEventListener('input', () => {
  const v = qEl.value.trim(); sIdx = -1;
  if (!v) { sugg.hidden = true; return; }
  sugg.innerHTML = search(v).slice(0, 6).map(p => `<li role="option" data-s="${esc(p.name)}"><span style="font-size:1.6rem">${p.emoji}</span><div><b>${esc(p.name)}</b><br><small class="muted">${esc(p.unit)} · ${inr(p.price)}</small></div></li>`).join('')
    + `<li role="option" data-s="${esc(v)}">🔍 See all results for “${esc(v)}”</li>`;
  sugg.hidden = false;
});
sugg.addEventListener('click', e => { const li = e.target.closest('li'); if (li) go(li.dataset.s); });
qEl.addEventListener('keydown', e => {
  const items = $$('li', sugg); if (sugg.hidden || !items.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); sIdx = (sIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((li, i) => li.setAttribute('aria-selected', i === sIdx));
  } else if (e.key === 'Enter' && sIdx >= 0) { e.preventDefault(); go(items[sIdx].dataset.s); }
});
$('#searchForm').addEventListener('submit', e => { e.preventDefault(); go(qEl.value); });
function go(q) { sugg.hidden = true; qEl.value = q; qEl.blur(); location.hash = '#/s/' + encodeURIComponent(q.trim()); }

/* theme */
function setTheme(t) { document.documentElement.dataset.theme = t; $('#themeBtn').textContent = t === 'dark' ? '☀️' : '🌙'; ls.set('theme', t); }
$('#themeBtn').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
setTheme(ls.get('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

/* init */
$('#ftrCats').innerHTML = C.map(c => `<li><a href="#/c/${c.id}">${c.emoji} ${c.name}</a></li>`).join('');
renderUser(); renderLoc(); updateCount(); route();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost'))
  navigator.serviceWorker.register('sw.js').catch(() => {});
})();
