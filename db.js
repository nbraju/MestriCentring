/* db.js — MestriCentring data layer (drop into repo, load before main script)
 * Works from GitHub Pages with zero server. Reads via JSONP (CORS-proof),
 * writes via no-cors POST (fire-and-forget, response unreadable by design). */

const API_URL = 'https://script.google.com/macros/s/PASTE_DEPLOYMENT_ID/exec';
const API_TOKEN = 'PASTE_A_LONG_RANDOM_STRING'; // must match Code.gs

/* ---------- READ: JSONP ---------- */
function apiGet(action, params = {}) {
  return new Promise((resolve, reject) => {
    const cb = '__mc_cb_' + Math.random().toString(36).slice(2);
    const qs = new URLSearchParams({ action, callback: cb, ...params });
    const s = document.createElement('script');
    const to = setTimeout(() => { cleanup(); reject(new Error('API timeout')); }, 8000);
    window[cb] = (res) => { clearTimeout(to); cleanup(); res.ok ? resolve(res.data) : reject(res); };
    function cleanup() { delete window[cb]; s.remove(); }
    s.src = API_URL + '?' + qs.toString();
    s.onerror = () => { clearTimeout(to); cleanup(); reject(new Error('API unreachable')); };
    document.body.appendChild(s);
  });
}

/* ---------- WRITE: no-cors POST ---------- */
function apiPost(action, payload = {}) {
  return fetch(API_URL, {
    method: 'POST',
    mode: 'no-cors',                          // required: Apps Script sends no CORS headers
    headers: { 'Content-Type': 'text/plain' }, // keeps it a "simple request"
    body: JSON.stringify({ action, token: API_TOKEN, ...payload })
  }).catch(() => {});                         // resolve silently; readback not possible cross-origin
}

/* ---------- Calculator bootstrap: replace hardcoded rates with live sheet rates ----------
 * Patch in MestriCentring.html, just before updateEstimate() first call: */
async function bootstrapRates() {
  try {
    const b = await apiGet('getBootstrap');
    // 1. rebuild CENTRING_RATES from RATE_MASTER
    b.rates.forEach(r => {
      CENTRING_RATES[r.item_code] = {
        name: r.item_name, cat: r.category,
        unit: r.unit, baseRate: Number(r.base_rate)
      };
    });
    // 2. rebuild zone & project <option>s from masters
    rebuildSelect('zoneSelect',   b.zones.map(z => [z.zone_code, z.zone_name, Number(z.multiplier)]));
    rebuildSelect('projectSelect',b.projects.map(p => [p.type_code, p.type_name, Number(p.multiplier)]));
    // 3. apply steel defaults
    if (b.steel) b.steel.forEach(s => {
      const el = document.getElementById(s.key);          // e.g. steelRate, slabSteelKg...
      if (el && s.value !== '') el.value = s.value;
    });
    updateEstimate();
  } catch (e) {
    console.warn('Sheet API unreachable — using embedded fallback rates.', e);
    // hardcoded CENTRING_RATES already in file act as offline fallback
  }
}
function rebuildSelect(id, rows) {
  const sel = document.getElementById(id);
  sel.innerHTML = rows.map(([v, label, m]) =>
    `<option value="${m}">${label} (×${m})</option>`).join('');
}

/* usage:
 *   window.addEventListener('DOMContentLoaded', () => {
 *     bindGlobalEvents();
 *     updateEstimate();          // instant render w/ embedded rates
 *     bootstrapRates();          // then upgrade from sheet (non-blocking)
 *   });
 * after every updateEstimate():  apiPost('logEstimate', {...window.currentEstimate.geometry, grandTotal: window.currentEstimate.grandTotal, perSqft: window.currentEstimate.perSqft, steelKg: window.currentEstimate.steelKg, inputs: window.currentEstimate.geometry});
 * contact form submit:          apiPost('contactMessage', {name, contact, message, page:'contact'});
 */
