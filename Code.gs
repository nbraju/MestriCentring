/*************************************************************************
 * MESTRICENTRING.COM — Google Sheets Backend API  (Code.gs)
 * Deploy: Extensions > Apps Script > Deploy > New deployment >
 *         Type: Web app > Execute as: Me > Who has access: Anyone
 * Paste the /exec URL into db.js (API_URL) and into CONFIG sheet.
 *************************************************************************/

const SHEET_ID   = 'PASTE_YOUR_GOOGLE_SHEET_ID';
const API_TOKEN  = 'PASTE_A_LONG_RANDOM_STRING';   // shared secret (obfuscation-level only)

const TABS = {
  CONFIG:           'CONFIG',
  ZONE_MASTER:      'ZONE_MASTER',
  PROJECT_TYPES:    'PROJECT_TYPES',
  RATE_MASTER:      'RATE_MASTER',
  STEEL_DEFAULTS:   'STEEL_DEFAULTS',
  MESTRIS:          'MESTRIS',
  SUPPLIERS:        'SUPPLIERS',
  SUPPLIER_INV:     'SUPPLIER_INVENTORY',
  BUILDERS:         'BUILDERS',
  PROJECTS:         'PROJECTS',
  QUOTES:           'QUOTES',
  ESTIMATE_LOG:     'ESTIMATE_LOG',
  CONTACT_MSG:      'CONTACT_MESSAGES',
  HIRE_DEMAND:      'HIRE_DEMAND'
};

/* ---------------- READ PATH (JSONP-capable for CORS-free browser reads) ---------------- */
function doGet(e) {
  const p  = e.parameter || {};
  const cb = p.callback;
  let out;
  try {
    let data;
    switch (p.action) {
      case 'getBootstrap':   // one call: everything the calculator needs
        data = {
          rates:    readTable_(TABS.RATE_MASTER,   r => r.active === 'TRUE'),
          zones:    readTable_(TABS.ZONE_MASTER,   r => r.active === 'TRUE'),
          projects: readTable_(TABS.PROJECT_TYPES, r => r.active === 'TRUE'),
          steel:    readTable_(TABS.STEEL_DEFAULTS),
          config:   readConfig_()
        };
        break;
      case 'getRates':     data = readTable_(TABS.RATE_MASTER,   r => r.active === 'TRUE'); break;
      case 'getMestris':   data = readTable_(TABS.MESTRIS,       r => r.status === 'ACTIVE'); break;
      case 'getSuppliers': data = readTable_(TABS.SUPPLIERS,     r => r.status === 'ACTIVE'); break;
      case 'getInventory': data = readTable_(TABS.SUPPLIER_INV,  r => r.supplier_id === (p.supplier_id || r.supplier_id) && Number(r.available_qty) > 0); break;
      case 'getProjects':  data = readTable_(TABS.PROJECTS,      r => r.status === 'OPEN'); break;
      case 'getDemand':    data = readTable_(TABS.HIRE_DEMAND);  break;
      default:
        data = { service: 'mestricentring-api', version: '1.0', time: new Date().toISOString() };
    }
    out = { ok: true, data: data };
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  const payload = JSON.stringify(out);
  if (cb)  // JSONP — sidesteps CORS on GitHub Pages
    return ContentService.createTextOutput(cb + '(' + payload + ')')
             .setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- WRITE PATH (no-cors POST from static frontend) ---------------- */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    if (body.token !== API_TOKEN && body.action !== 'ping')
      return json_({ ok: false, error: 'unauthorized' });

    let id;
    switch (body.action) {
      case 'logEstimate':
        id = appendRow_(TABS.ESTIMATE_LOG, {
          log_id: uid_('EST'), timestamp: now_(),
          slab_sqft: body.slab, beam_rft: body.beam, columns: body.cols,
          hire_days: body.days, zone_mult: body.zoneMult, project_mult: body.projMult,
          grand_total: body.grandTotal, per_sqft: body.perSqft,
          steel_kg: body.steelKg, inputs_json: JSON.stringify(body.inputs || {})
        });
        break;
      case 'contactMessage':
        id = appendRow_(TABS.CONTACT_MSG, {
          msg_id: uid_('MSG'), timestamp: now_(),
          name: body.name, contact: body.contact, message: body.message,
          source_page: body.page || 'contact', status: 'NEW'
        });
        break;
      case 'postProject':
        id = appendRow_(TABS.PROJECTS, {
          project_id: uid_('PRJ'), posted_at: now_(),
          builder_contact: body.builderContact, title: body.title,
          location_zone: body.zone, slab_sqft: body.slab, beam_rft: body.beam,
          columns: body.cols, hire_days: body.days,
          status: 'OPEN'
        });
        break;
      case 'submitQuote':
        id = appendRow_(TABS.QUOTES, {
          quote_id: uid_('QT'), created_at: now_(),
          project_id: body.projectId, mestri_id: body.mestriId,
          amount: body.amount, message: body.message, status: 'PENDING'
        });
        break;
      case 'registerMestri':
        id = appendRow_(TABS.MESTRIS, {
          mestri_id: uid_('MST'), joined_at: now_(),
          name: body.name, phone: body.phone, whatsapp: body.whatsapp,
          experience_years: body.experience, zones: body.zones,
          specializations: body.specializations, gang_size: body.gangSize,
          rating: 0, verified: 'FALSE', status: 'PENDING'
        });
        break;
      default:
        return json_({ ok: false, error: 'unknown action' });
    }
    return json_({ ok: true, id: id });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- helpers ---------------- */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
           .setMimeType(ContentService.MimeType.JSON);
}
function uid_(prefix) { return prefix + '-' + Utilities.getUuid().slice(0, 8).toUpperCase(); }
function now_() { return new Date().toISOString(); }

function sheet_(name) {
  const s = SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
  if (!s) throw new Error('Missing tab: ' + name);
  return s;
}
function readTable_(name, filter) {
  const vals = sheet_(name).getDataRange().getValues();
  if (vals.length < 2) return [];
  const hdr = vals[0].map(h => String(h).trim().toLowerCase());
  const rows = vals.slice(1)
    .map(r => Object.fromEntries(hdr.map((h, i) => [h, r[i]])))
    .filter(r => r[hdr[0]] !== '' && r[hdr[0]] != null);
  return filter ? rows.filter(filter) : rows;
}
function readConfig_() {
  const vals = sheet_(TABS.CONFIG).getDataRange().getValues();
  return Object.fromEntries(vals.slice(1).map(r => [r[0], r[1]]));
}
function appendRow_(name, obj) {
  const s = sheet_(name);
  const hdr = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0].map(h => String(h).trim().toLowerCase());
  const row = hdr.map(h => obj[h] !== undefined ? obj[h] : '');
  s.appendRow(row);
  return obj[hdr[0]];
}

/* One-time setup helper: run once to create all tabs + headers.
   Schema lives in the README / sheet-templates folder. */
function setupTabs() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const schemas = {
    CONFIG:           ['key','value','updated_at'],
    ZONE_MASTER:      ['zone_code','zone_name','multiplier','active'],
    PROJECT_TYPES:    ['type_code','type_name','multiplier','active'],
    RATE_MASTER:      ['item_code','item_name','category','unit','base_rate','active','updated_at'],
    STEEL_DEFAULTS:   ['key','value'],
    MESTRIS:          ['mestri_id','joined_at','name','phone','whatsapp','experience_years','zones','specializations','gang_size','rating','verified','status'],
    SUPPLIERS:        ['supplier_id','company_name','contact_person','phone','email','zones_served','gst_no','verified','status'],
    SUPPLIER_INVENTORY:['item_id','supplier_id','item_name','category','unit','daily_rent','min_qty','available_qty','updated_at'],
    BUILDERS:         ['builder_id','company','contact_person','phone','email','tier'],
    PROJECTS:         ['project_id','posted_at','builder_contact','title','location_zone','slab_sqft','beam_rft','columns','hire_days','status'],
    QUOTES:           ['quote_id','created_at','project_id','mestri_id','amount','message','status'],
    ESTIMATE_LOG:     ['log_id','timestamp','slab_sqft','beam_rft','columns','hire_days','zone_mult','project_mult','grand_total','per_sqft','steel_kg','inputs_json'],
    CONTACT_MESSAGES: ['msg_id','timestamp','name','contact','message','source_page','status'],
    HIRE_DEMAND:      ['item','unit','rent_low','rent_high','demand_zone']
  };
  Object.entries(schemas).forEach(([tab, headers]) => {
    let s = ss.getSheetByName(tab);
    if (!s) s = ss.insertSheet(tab);
    if (s.getLastRow() === 0) s.appendRow(headers);
  });
}
