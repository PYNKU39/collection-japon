// ============================================================
// PWA & INSTALLATION
// ============================================================
(function(){
  const m={name:"Collection Japon",short_name:"CollectJP",start_url:"./",display:"standalone",background_color:"#0a0a0f",theme_color:"#0a0a0f",icons:[{src:"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect width='192' height='192' rx='40' fill='%23f43f5e'/%3E%3Ctext y='148' x='28' font-size='140'%3E🎌%3C/text%3E%3C/svg%3E",sizes:"192x192",type:"image/svg+xml"}]};
  document.getElementById('pwa-manifest').href=URL.createObjectURL(new Blob([JSON.stringify(m)],{type:'application/json'}));
})();
if('serviceWorker' in navigator){
  const sw=`const C='cj-v6';self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(['./','index.html','styles.css','app.js']).catch(()=>{}))));self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));`;
  navigator.serviceWorker.register(URL.createObjectURL(new Blob([sw],{type:'application/javascript'}))).catch(()=>{});
}

// ============================================================
// INDEXEDDB — STOCKAGE PERSISTANT (survit au vidage du cache)
// ============================================================
const IDB_NAME = 'collectjp-db';
const IDB_VERSION = 1;
const IDB_STORE = 'keyval';
let _idb = null;

function openIDB() {
  if(_idb) return Promise.resolve(_idb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess = e => { _idb = e.target.result; resolve(_idb); };
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, value) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(key) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ============================================================
// STATE & CRYPTO (AES-GCM WebCrypto API)
// ============================================================
const KEY_DATA = 'cj-data-encrypted';   // clé IDB pour les données chiffrées
const KEY_CONF = 'cj-config';           // localStorage : config cloud (non sensible)
const SETTINGS_KEY = 'cj-settings-v2'; // localStorage : préférences UI
let items = [];
let liveRate = 160;
let editingId = null;
let appPassword = null;
let currentViewMode = 'cards'; // 'cards' | 'list' | 'hidden'

const PRESETS=[
  {name:'Cerise',c1:'#f43f5e',c2:'#ec4899'},
  {name:'Violet',c1:'#8b5cf6',c2:'#a78bfa'},
  {name:'Bleu',c1:'#3b82f6',c2:'#60a5fa'},
  {name:'Cyan',c1:'#06b6d4',c2:'#22d3ee'},
  {name:'Vert',c1:'#10b981',c2:'#34d399'},
  {name:'Ambre',c1:'#f59e0b',c2:'#fbbf24'},
  {name:'Orange',c1:'#f97316',c2:'#fb923c'},
  {name:'Indigo',c1:'#6366f1',c2:'#818cf8'},
];

// Niveaux de taille : scale factor
const SIZE_LEVELS = {1: 0.80, 2: 0.90, 3: 1.00, 4: 1.12, 5: 1.25};
const SIZE_BAR_W  = {1: '20%', 2: '40%', 3: '60%', 4: '80%', 5: '100%'};

// ============================================================
// TAILLE D'INTERFACE
// ============================================================
function setUiSize(level) {
  const scale = SIZE_LEVELS[level] || 1;
  document.documentElement.style.setProperty('--ui-scale', scale);
  // Taille de police de base
  document.documentElement.style.setProperty('--base-font', (14 * scale) + 'px');
  // Barre de progression
  document.getElementById('size-bar').style.width = SIZE_BAR_W[level];
  // Boutons actifs
  document.querySelectorAll('.size-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.level) === level);
  });
  // Persistance
  const s = loadSettings(); s.uiSize = level; saveSettings(s);
}

function applySavedUiSize() {
  const s = loadSettings();
  const level = s.uiSize || 3;
  setUiSize(level);
}

// ============================================================
// MODE AFFICHAGE COLLECTION
// ============================================================
function setViewMode(mode) {
  currentViewMode = mode;
  ['cards','list','hidden'].forEach(m => {
    document.getElementById('vbtn-'+m).classList.toggle('active', m === mode);
  });
  const s = loadSettings(); s.viewMode = mode; saveSettings(s);
  renderItems();
}

function applySavedViewMode() {
  const s = loadSettings();
  const mode = s.viewMode || 'cards';
  currentViewMode = mode;
  ['cards','list','hidden'].forEach(m => {
    document.getElementById('vbtn-'+m).classList.toggle('active', m === mode);
  });
}

// ============================================================
// SETTINGS TABS
// ============================================================
function switchSettingsTab(tab) {
  document.querySelectorAll('.stab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.stab-panel').forEach(p => p.classList.toggle('active', p.id === 'stab-'+tab));
  if(tab==='donnees') refreshDataSummary();
}

// ============================================================
// DISPLAY SETTINGS (toggles)
// ============================================================
const DISPLAY_DEFAULTS = {
  showSearch: true, showSort: true, showProfit: true, showNotes: true, showLinks: true
};

function loadDisplaySettings() {
  const s = loadSettings();
  return { ...DISPLAY_DEFAULTS, ...(s.display || {}) };
}

function saveDisplaySettings() {
  const s = loadSettings();
  const disp = loadDisplaySettings();
  // View default
  const defView = document.getElementById('set-default-view');
  if(defView) disp._defaultView = defView.value;
  const currDisp = document.getElementById('set-currency-disp');
  if(currDisp) disp._currency = currDisp.value;
  s.display = disp;
  saveSettings(s);
  applyDisplaySettings();
}

function toggleSetting(key) {
  const s = loadSettings();
  const disp = loadDisplaySettings();
  disp[key] = !disp[key];
  s.display = disp;
  saveSettings(s);
  applyToggleUI(key, disp[key]);
  applyDisplaySettings();
}

function applyToggleUI(key, on) {
  const tog = document.getElementById('tog-'+key);
  if(!tog) return;
  tog.style.background = on ? 'var(--c1)' : 'var(--border2)';
  tog.querySelector('.toggle-knob').style.transform = on ? 'translateX(18px)' : 'translateX(0)';
}

function applyDisplaySettings() {
  const d = loadDisplaySettings();
  document.getElementById('search-wrap').style.display = d.showSearch ? '' : 'none';
  document.getElementById('sort-row').style.display = d.showSort ? '' : 'none';
  const banner = document.getElementById('profit-banner');
  if(banner && !d.showProfit) banner.classList.add('hidden');
  renderItems();
}

function initDisplaySettingsUI() {
  const d = loadDisplaySettings();
  ['showSearch','showSort','showProfit','showNotes','showLinks'].forEach(k => applyToggleUI(k, d[k]));
  const defView = document.getElementById('set-default-view');
  if(defView && d._defaultView) defView.value = d._defaultView;
  const currDisp = document.getElementById('set-currency-disp');
  if(currDisp && d._currency) currDisp.value = d._currency;
  applyDisplaySettings();
}

function refreshDataSummary() {
  const s = computeStats();
  const el1 = document.getElementById('data-summary-items');
  const el2 = document.getElementById('data-summary-spent');
  const el3 = document.getElementById('data-summary-value');
  if(el1) el1.textContent = `${items.length} objet${items.length>1?'s':''} en collection`;
  if(el2) el2.textContent = `Total investi : ${fEUR(s.totalSpent)}`;
  if(el3) el3.textContent = `Valeur estimée (mieux) : ${fEUR(Math.max(s.totalEur, s.totalJpyEur))}`;
}

function resetAllData() {
  if(!confirm('⚠️ Supprimer TOUS les objets ? Cette action est irréversible.')) return;
  items = [];
  saveItems();
  render();
  toast('Collection effacée','ok');
}

function resetSettings() {
  if(!confirm('Réinitialiser toutes les préférences visuelles ?')) return;
  localStorage.removeItem(SETTINGS_KEY);
  location.reload();
}

// ============================================================
// CRYPTO (AES-GCM WebCrypto API)
// ============================================================
async function deriveKey(pwd) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(pwd), {name:"PBKDF2"}, false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {name:"PBKDF2", salt:enc.encode("CollectJP_Salt"), iterations:100000, hash:"SHA-256"},
    keyMaterial, {name:"AES-GCM", length:256}, false, ["encrypt","decrypt"]
  );
}
async function encryptData(data, pwd) {
  const key = await deriveKey(pwd);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, new TextEncoder().encode(JSON.stringify(data)));
  return btoa(JSON.stringify({iv:Array.from(iv), cipher:Array.from(new Uint8Array(cipher))}));
}
async function decryptData(b64, pwd) {
  const key = await deriveKey(pwd);
  const {iv, cipher} = JSON.parse(atob(b64));
  const dec = await crypto.subtle.decrypt({name:"AES-GCM", iv:new Uint8Array(iv)}, key, new Uint8Array(cipher));
  return JSON.parse(new TextDecoder().decode(dec));
}

// ============================================================
// CLOUD SYNC (GIST) — config en localStorage (non sensible)
// ============================================================
function loadConfig() { try{ return JSON.parse(localStorage.getItem(KEY_CONF)||'{}'); }catch{ return {}; } }
function saveAppConfig() {
  const conf = loadConfig();
  conf.gh_token = document.getElementById('gh-token').value;
  conf.gist_id = document.getElementById('gist-id').value;
  localStorage.setItem(KEY_CONF, JSON.stringify(conf));
}
function initConfigUI() {
  const conf = loadConfig();
  if(conf.gh_token) document.getElementById('gh-token').value = conf.gh_token;
  if(conf.gist_id) document.getElementById('gist-id').value = conf.gist_id;
}

// ============================================================
// PERSONNALISATION (COULEURS) — en localStorage (pas sensible)
// ============================================================
function loadSettings(){try{return JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}')}catch{return{}}}
function saveSettings(s){localStorage.setItem(SETTINGS_KEY,JSON.stringify(s))}
function hexToRgba(hex,a){
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return`rgba(${r},${g},${b},${a})`;
}
function applyColor(key,val){
  const root=document.documentElement;
  root.style.setProperty(`--${key}`,val);
  if(key==='c1'){
    root.style.setProperty('--c1-15',hexToRgba(val,.15));
    root.style.setProperty('--c1-08',hexToRgba(val,.08));
    document.getElementById('c1-hex').textContent=val;
    document.getElementById('pick-c1').value=val;
    document.querySelectorAll('label.color-swatch').forEach(l=>{if(l.contains(document.getElementById('pick-c1')))l.style.background=val});
    document.getElementById('prev-badge').style.background=hexToRgba(val,.1);
    document.getElementById('prev-badge').style.color=val;
  }else{
    document.getElementById('c2-hex').textContent=val;
    document.getElementById('pick-c2').value=val;
    document.querySelectorAll('label.color-swatch').forEach(l=>{if(l.contains(document.getElementById('pick-c2')))l.style.background=val});
  }
  const s=loadSettings();s.c1=document.getElementById('pick-c1').value;s.c2=document.getElementById('pick-c2').value;
  saveSettings(s);
  if(typeof render==='function')render();
}
function applyPreset(p){applyColor('c1',p.c1);applyColor('c2',p.c2);renderPresets();}
function renderPresets(){
  const c1=getComputedStyle(document.documentElement).getPropertyValue('--c1').trim();
  document.getElementById('preset-grid').innerHTML=PRESETS.map(p=>`
    <div class="preset-dot${p.c1===c1?' active':''}" style="background:linear-gradient(135deg,${p.c1},${p.c2})" onclick='applyPreset(${JSON.stringify(p)})' title="${p.name}"></div>
  `).join('');
}
function applyBgColor(val){
  const root=document.documentElement;
  root.classList.remove('oled');
  updateOledToggleUI(false);
  const r=parseInt(val.slice(1,3),16),g=parseInt(val.slice(3,5),16),b=parseInt(val.slice(5,7),16);
  const l=(v)=>Math.min(255,v+8).toString(16).padStart(2,'0');
  const bg2='#'+l(r)+l(g)+l(b);
  root.style.setProperty('--bg',val);
  root.style.setProperty('--bg2',bg2);
  document.getElementById('bg-hex').textContent=val;
  document.getElementById('pick-bg').value=val;
  const s=loadSettings();s.bg=val;saveSettings(s);
}
function applyProfitColor(key, val){
  const root=document.documentElement;
  const r=parseInt(val.slice(1,3),16),g=parseInt(val.slice(3,5),16),b=parseInt(val.slice(5,7),16);
  if(key==='pos'){
    root.style.setProperty('--profit-pos', val);
    root.style.setProperty('--glass-pos', `rgba(${r},${g},${b},.13)`);
    root.style.setProperty('--glass-pos-border', `rgba(${r},${g},${b},.30)`);
    document.getElementById('pos-hex').textContent=val;
    document.getElementById('pick-pos').value=val;
    document.querySelector('label:has(#pick-pos)').style.background=val;
  } else {
    root.style.setProperty('--profit-neg', val);
    root.style.setProperty('--glass-neg', `rgba(${r},${g},${b},.13)`);
    root.style.setProperty('--glass-neg-border', `rgba(${r},${g},${b},.30)`);
    document.getElementById('neg-hex').textContent=val;
    document.getElementById('pick-neg').value=val;
    document.querySelector('label:has(#pick-neg)').style.background=val;
  }
  const s=loadSettings();
  s[`profit_${key}`]=val;
  saveSettings(s);
  if(typeof render==='function')render();
}
function toggleOled(){
  const root=document.documentElement;
  const isOled=root.classList.toggle('oled');
  updateOledToggleUI(isOled);
  if(isOled){
    root.style.removeProperty('--bg');
    root.style.removeProperty('--bg2');
    document.getElementById('bg-hex').textContent='#000000';
    document.getElementById('pick-bg').value='#000000';
  } else {
    const s=loadSettings();
    const bg=s.bg||'#0a0a0f';
    applyBgColor(bg);
  }
  const s=loadSettings();s.oled=isOled;saveSettings(s);
}
function updateOledToggleUI(on){
  const tog=document.getElementById('oled-toggle');
  const knob=document.getElementById('oled-knob');
  if(!tog||!knob)return;
  tog.style.background=on?'var(--c1)':'var(--border2)';
  knob.style.transform=on?'translateX(18px)':'translateX(0)';
}
function applySavedColors(){
  const s=loadSettings();
  if(s.c1)applyColor('c1',s.c1);
  if(s.c2)applyColor('c2',s.c2);
  if(s.profit_pos)applyProfitColor('pos',s.profit_pos);
  if(s.profit_neg)applyProfitColor('neg',s.profit_neg);
  if(s.oled){
    document.documentElement.classList.add('oled');
    updateOledToggleUI(true);
  } else if(s.bg){
    applyBgColor(s.bg);
  }
}

// ============================================================
// EXPORT / IMPORT JSON
// ============================================================
function exportCollection(){
  if(!items||items.length===0){toast('Collection vide, rien à exporter','err');return;}
  const blob=new Blob([JSON.stringify({version:2,exported:new Date().toISOString(),items},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`collectjp_export_${new Date().toISOString().slice(0,10)}.json`;
  a.click();URL.revokeObjectURL(url);
  toast('Export téléchargé ✓','ok');
}
function importCollection(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=async(e)=>{
    try{
      const parsed=JSON.parse(e.target.result);
      let imported=[];
      if(Array.isArray(parsed))imported=parsed;
      else if(parsed.items&&Array.isArray(parsed.items))imported=parsed.items;
      else{toast('Fichier JSON invalide','err');return;}
      if(imported.length===0){toast('Fichier vide','err');return;}
      const merge=confirm(`Importer ${imported.length} objet(s) ?\n✅ OK = Fusionner avec la collection actuelle\n❌ Annuler = Annuler`);
      if(!merge){input.value='';return;}
      const existingIds=new Set(items.map(i=>i.id));
      const newItems=imported.filter(i=>!existingIds.has(i.id));
      items=[...newItems,...items];
      await saveItems();render();
      toast(`${newItems.length} objet(s) importé(s) ✓`,'ok');
    }catch(err){toast('Erreur lecture fichier','err');console.error(err);}
    input.value='';
  };
  reader.readAsText(file);
}

// ============================================================
// CLOUD SYNC (GIST)
// ============================================================
async function forceSync() { await syncToGist(true); }

function setSyncPill(state, txt, duration=0){
  const pill=document.getElementById('sync-pill');
  const pillTxt=document.getElementById('sync-pill-txt');
  const dot=pill?.querySelector('.sync-dot');
  if(!pill)return;
  pill.className='show'+(state?' '+state:'');
  pill.style.cssText='';
  if(state==='syncing') dot?.classList.add('pulse');
  else dot?.classList.remove('pulse');
  pillTxt.textContent=txt;
  if(duration>0) setTimeout(()=>{pill.classList.remove('show');},duration);
}

async function syncToGist(manual=false) {
  const conf = loadConfig();
  if(!conf.gh_token || !conf.gist_id) { if(manual) toast('Token ou ID Gist manquant','err'); return; }
  setSyncPill('syncing','Upload en cours…');
  try {
    const enc = await encryptData(items, appPassword);
    const res = await fetch(`https://api.github.com/gists/${conf.gist_id}`, {
      method:'PATCH', headers:{'Authorization':`Bearer ${conf.gh_token}`},
      body:JSON.stringify({files:{'collection.json':{content:enc}}})
    });
    if(res.ok){
      const now=new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
      setSyncPill('ok','Sauvegardé ✓',4000);
      const el=document.getElementById('sync-last');if(el)el.textContent=`Dernier sync : ${now}`;
      if(manual) toast('Cloud Sync ✓','ok');
    } else throw new Error();
  } catch(e) {
    console.error(e);
    setSyncPill('err','Erreur upload',5000);
    if(manual) toast('Erreur Sync GitHub','err');
  }
}

async function softSync(){
  const conf = loadConfig();
  if(!conf.gh_token || !conf.gist_id){ toast('Token ou ID Gist manquant','err'); return; }
  if(!appPassword){ toast('Déverrouillez d\'abord la collection','err'); return; }
  setSyncPill('syncing','Synchronisation…');
  try{
    const res = await fetch(`https://api.github.com/gists/${conf.gist_id}`,{headers:{'Authorization':`Bearer ${conf.gh_token}`}});
    const data = await res.json();
    const content = data.files['collection.json']?.content;
    if(content){
      const cloudItems = await decryptData(content, appPassword);
      const map = new Map(items.map(i=>[i.id,i]));
      cloudItems.forEach(ci=>{
        const local = map.get(ci.id);
        if(!local || new Date(ci.created_at) > new Date(local.created_at)) map.set(ci.id,ci);
      });
      items = [...map.values()].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
      await saveItems(); render();
      toast('Sync bidirectionnel ✓','ok');
      setSyncPill('ok','Sync complet ✓',4000);
    } else {
      await syncToGist(false);
      toast('Collection uploadée ✓','ok');
    }
  }catch(e){
    console.error(e);
    setSyncPill('err','Erreur sync',5000);
    toast('Erreur de synchronisation','err');
  }
}

async function pullFromCloud(){
  const conf = loadConfig();
  if(!conf.gh_token || !conf.gist_id){ toast('Token ou ID Gist manquant','err'); return; }
  if(!appPassword){ toast('Déverrouillez d\'abord la collection','err'); return; }
  if(!confirm('Remplacer la collection locale par la version cloud ?')) return;
  setSyncPill('syncing','Téléchargement…');
  try{
    const res = await fetch(`https://api.github.com/gists/${conf.gist_id}`,{headers:{'Authorization':`Bearer ${conf.gh_token}`}});
    const data = await res.json();
    const content = data.files['collection.json']?.content;
    if(content){
      items = await decryptData(content, appPassword);
      await saveItems(); render();
      setSyncPill('ok','Local mis à jour ✓',4000);
      toast('Collection restaurée depuis le cloud ✓','ok');
    } else { toast('Gist vide, rien à télécharger','err'); setSyncPill('err','Gist vide',4000); }
  }catch(e){
    console.error(e);
    setSyncPill('err','Erreur download',5000);
    toast('Erreur de téléchargement','err');
  }
}

async function fetchFromGist(pwd) {
  const conf = loadConfig();
  if(!conf.gh_token || !conf.gist_id) return false;
  document.getElementById('sync-status').textContent = "Téléchargement cloud...";
  try {
    const res = await fetch(`https://api.github.com/gists/${conf.gist_id}`,{headers:{'Authorization':`Bearer ${conf.gh_token}`}});
    const data = await res.json();
    const content = data.files['collection.json'].content;
    if(content) { items = await decryptData(content, pwd); return true; }
  } catch(e) { console.error(e); }
  return false;
}

// ============================================================
// SAUVEGARDE — IndexedDB (persistant) + Gist en arrière-plan
// ============================================================
async function saveItems() {
  try {
    const enc = await encryptData(items, appPassword);
    await idbSet(KEY_DATA, enc);  // IndexedDB — survit au vidage du cache
    syncToGist();                 // Async sans bloquer
  } catch(e) { console.error(e); toast('Erreur de sauvegarde','err'); }
}

// ============================================================
// DÉVERROUILLAGE
// ============================================================
async function unlockApp() {
  const pwd = document.getElementById('app-pwd').value;
  const errEl = document.getElementById('pwd-error');
  const input = document.getElementById('app-pwd');
  const btn = document.querySelector('#lock-screen .btn-primary');
  if(!pwd){ showPwdError('Entrez votre mot de passe'); return; }

  btn.textContent = 'Déverrouillage…';
  btn.style.opacity = '.7';
  btn.disabled = true;
  errEl.classList.remove('show');
  input.classList.remove('err-shake');

  // Cherche d'abord dans IndexedDB
  let raw = null;
  try { raw = await idbGet(KEY_DATA); } catch(e) {}

  // Fallback localStorage (migration depuis ancienne version)
  if(!raw) {
    try { raw = localStorage.getItem('cj-data-encrypted'); } catch(e) {}
  }

  const conf = loadConfig();

  const unlock = () => {
    appPassword = pwd;
    document.getElementById('lock-screen').style.opacity = '0';
    setTimeout(()=>document.getElementById('lock-screen').style.display='none',300);
    render();
    btn.textContent = 'Déverrouiller';
    btn.style.opacity = '';
    btn.disabled = false;
  };

  const wrongPwd = () => {
    showPwdError('Mot de passe incorrect');
    btn.textContent = 'Déverrouiller';
    btn.style.opacity = '';
    btn.disabled = false;
  };

  if(!raw) {
    if(conf.gh_token && conf.gist_id) {
      const gistOk = await fetchFromGist(pwd);
      if(gistOk){ unlock(); await saveItems(); return; }
    }
    items = [];
    unlock();
    await saveItems();
    return;
  }

  try {
    items = await decryptData(raw, pwd);
    unlock();
    if(conf.gh_token && conf.gist_id) {
      fetchFromGist(pwd).then(res => { if(res){ saveItems(); render(); } });
    }
  } catch(e) {
    wrongPwd();
  }
}

function showPwdError(msg){
  const errEl = document.getElementById('pwd-error');
  const input = document.getElementById('app-pwd');
  errEl.textContent = msg;
  errEl.classList.add('show');
  input.classList.remove('err-shake');
  void input.offsetWidth;
  input.classList.add('err-shake');
  input.addEventListener('animationend', ()=>input.classList.remove('err-shake'), {once:true});
  input.addEventListener('input', ()=>{ errEl.classList.remove('show'); }, {once:true});
}

// ============================================================
// FORMATS & UTILS
// ============================================================
const fEUR=n=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:2}).format(n||0);
const fJPY=n=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY'}).format(n||0);
const jpyToEur=n=>(n||0)/liveRate;
function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8)}

// ============================================================
// NAVIGATION
// ============================================================
function navTo(page){
  ['home','taxes','settings'].forEach(p => {
    document.getElementById(`page-${p}`).classList.toggle('hidden', page !== p);
    document.getElementById(`nav-${p}`).classList.toggle('active', page === p);
  });
  if(page==='settings'){
    renderPresets();
    updateOledToggleUI(document.documentElement.classList.contains('oled'));
    applySavedUiSize();
    initDisplaySettingsUI();
  }
  if(page==='taxes') runSim();
}

// ============================================================
// STATS & CALCULS
// ============================================================
function getCost(item) {
  const baseCost = item.currency === 'JPY' ? jpyToEur(item.buy_price) : Number(item.buy_price || 0);
  return baseCost + Number(item.shipping || 0) + Number(item.taxes || 0);
}
function computeStats(){
  const totalSpent = items.reduce((s,i) => s + getCost(i), 0);
  const totalTaxes = items.reduce((s,i) => s + Number(i.taxes || 0) + Number(i.shipping || 0), 0);
  const totalJpyRaw = items.reduce((s,i) => s + Number(i.sell_jpy || 0), 0);
  const totalEur = items.reduce((s,i) => s + Number(i.sell_eur || 0), 0);
  const totalJpyEur = jpyToEur(totalJpyRaw);
  return {totalSpent, totalJpyRaw, totalEur, totalJpyEur, totalTaxes};
}

function renderStats(){
  const s = computeStats();
  const bestSell = Math.max(s.totalEur, s.totalJpyEur);
  const profit   = bestSell - s.totalSpent;
  const isPos    = profit >= 0;
  const pct      = s.totalSpent > 0 ? ((profit / s.totalSpent)*100).toFixed(1) : 0;

  document.getElementById('stats-grid').innerHTML=`
    <div class="stat-tile"><div class="s-lbl">Dépensé</div><div class="s-val">${fEUR(s.totalSpent)}</div><div class="s-sub">Frais & Douane inclus</div></div>
    <div class="stat-tile"><div class="s-lbl">Objets</div><div class="s-val">${items.length}</div><div class="s-sub">En collection</div></div>
    <div class="stat-tile"><div class="s-lbl">Valeur Japon</div><div class="s-val">${fJPY(s.totalJpyRaw)}</div><div class="s-sub">≈ ${fEUR(s.totalJpyEur)}</div></div>
    <div class="stat-tile"><div class="s-lbl">Valeur Occident</div><div class="s-val">${fEUR(s.totalEur)}</div><div class="s-sub">Marché Européen</div></div>
  `;

  // Bannière rentabilité — fond PLEIN pour lisibilité garantie quelle que soit la couleur
  const banner = document.getElementById('profit-banner');
  const dset = loadDisplaySettings();
  if(s.totalSpent > 0 && dset.showProfit){
    banner.className = 'profit-banner-wrap';
    // On utilise la couleur --profit-pos/neg comme fond solide (pas transparent)
    const bgColor = isPos ? 'var(--profit-pos)' : 'var(--profit-neg)';
    banner.innerHTML = `
      <div style="background:${bgColor};border-radius:16px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 4px 20px rgba(0,0,0,.25)">
        <div>
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.3)">${isPos ? '📈 Collection rentable' : '📉 Déficitaire'}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.9);margin-top:3px;text-shadow:0 1px 2px rgba(0,0,0,.2)">${isPos ? '+' : ''}${pct}% vs investissement</div>
        </div>
        <div style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-.5px;text-shadow:0 1px 4px rgba(0,0,0,.25)">${isPos ? '+' : ''}${fEUR(profit)}</div>
      </div>`;
    banner.classList.remove('hidden');
  } else {
    banner.className = 'hidden';
  }

  document.getElementById('total-taxes-paid').textContent = fEUR(s.totalTaxes);
}

// ============================================================
// ITEM DETAIL MODAL
// ============================================================
function openDetail(id) {
  const item = items.find(i=>i.id===id); if(!item) return;
  const cost = getCost(item);
  const sellEur  = Number(item.sell_eur || 0);
  const sellJpy  = jpyToEur(Number(item.sell_jpy || 0));
  const bestSell = Math.max(sellEur, sellJpy);
  const hasValue = sellEur > 0 || item.sell_jpy > 0;
  const profit   = bestSell - cost;
  const isPos    = profit >= 0;
  const jpySearch   = encodeURIComponent(item.name);
  const ebaySearch  = encodeURIComponent(item.name);
  const d = loadDisplaySettings();

  document.getElementById('detail-title-txt').textContent = item.name;
  document.getElementById('detail-edit-btn').onclick = () => { closeModal('modal-detail'); openEdit(id); };
  document.getElementById('detail-del-btn').onclick = () => { closeModal('modal-detail'); deleteItem(id); };

  document.getElementById('detail-body').innerHTML = `
    ${item.image_url
      ? `<img class="detail-img" src="${esc(item.image_url)}" alt="" loading="lazy">`
      : `<div class="detail-placeholder">📦</div>`}

    <div class="detail-badge-row">
      ${item.category ? `<span class="item-cat">${esc(item.category)}</span>` : ''}
      ${hasValue ? `<span class="profit-chip-glass ${isPos?'pos':'neg'}">${isPos?'▲':'▼'} ${isPos?'+':''}${fEUR(profit)}</span>` : ''}
    </div>

    <div class="detail-grid">
      <div class="detail-tile">
        <div class="dt-lbl">Prix de revient</div>
        <div class="dt-val">${fEUR(cost)}</div>
      </div>
      <div class="detail-tile">
        <div class="dt-lbl">Livraison + Douane</div>
        <div class="dt-val">${fEUR(Number(item.shipping||0)+Number(item.taxes||0))}</div>
      </div>
      ${item.sell_eur ? `<div class="detail-tile"><div class="dt-lbl">Valeur Occident</div><div class="dt-val dt-val-sell">${fEUR(item.sell_eur)}</div></div>` : ''}
      ${item.sell_jpy ? `<div class="detail-tile"><div class="dt-lbl">Valeur Japon</div><div class="dt-val dt-val-sell">${fJPY(item.sell_jpy)}<br><span style="font-size:11px;color:var(--txt3)">≈ ${fEUR(sellJpy)}</span></div></div>` : ''}
    </div>

    ${hasValue ? `
    <div class="detail-profit-bar ${isPos?'pos':'neg'}">
      <div>
        <div class="detail-profit-lbl ${isPos?'pos':'neg'}">${isPos?'📈 Rentable':'📉 Déficitaire'}</div>
        <div style="font-size:11px;color:var(--txt3);margin-top:2px">Marge estimée</div>
      </div>
      <div class="detail-profit-amt ${isPos?'pos':'neg'}">${isPos?'+':''}${fEUR(profit)}</div>
    </div>` : ''}

    ${item.notes ? `<div class="detail-notes-box">📝 ${esc(item.notes)}</div>` : ''}

    ${d.showLinks ? `
    <div class="detail-links-row">
      <a class="link-pill link-ebay" href="https://www.ebay.fr/sch/i.html?_nkw=${ebaySearch}&LH_Complete=1&LH_Sold=1" target="_blank" rel="noopener" style="text-decoration:none">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        eBay vendu
      </a>
      <a class="link-pill link-yahoo" href="https://auctions.yahoo.co.jp/search/search?p=${jpySearch}" target="_blank" rel="noopener" style="text-decoration:none">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Yahoo Enchères JP
      </a>
    </div>` : ''}
  `;
  openModal('modal-detail');
  setTimeout(()=>{ const s=document.querySelector('#modal-detail .modal-scroll'); if(s)s.scrollTop=0; },50);
}

// ============================================================
// RENDER ITEMS — cartes / liste compacte / masqué
// ============================================================
function getFilteredSortedItems() {
  const q = (document.getElementById('search-input')?.value||'').toLowerCase().trim();
  const sort = document.getElementById('sort-sel')?.value || 'recent';
  let list = q ? items.filter(i=>(i.name||'').toLowerCase().includes(q)||(i.category||'').toLowerCase().includes(q)) : [...items];
  if(sort==='name') list.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  else if(sort==='cost_desc') list.sort((a,b)=>getCost(b)-getCost(a));
  else if(sort==='cost_asc') list.sort((a,b)=>getCost(a)-getCost(b));
  else if(sort==='profit_desc') list.sort((a,b)=>{
    const pB=Math.max(Number(b.sell_eur||0),jpyToEur(Number(b.sell_jpy||0)))-getCost(b);
    const pA=Math.max(Number(a.sell_eur||0),jpyToEur(Number(a.sell_jpy||0)))-getCost(a);
    return pB-pA;
  });
  return list;
}

function renderItems(){
  const grid = document.getElementById('items-grid');
  const d = loadDisplaySettings();

  if(currentViewMode === 'hidden'){
    grid.innerHTML = `
      <div class="empty-state" style="padding:30px 32px">
        <div class="empty-icon">🙈</div>
        <h3>Objets masqués</h3>
        <p>Appuyez sur "Cartes" ou "Liste" pour afficher votre collection.</p>
      </div>`;
    const cnt = document.getElementById('items-count'); if(cnt) cnt.textContent='';
    return;
  }

  if(items.length===0){
    grid.innerHTML=`<div class="empty-state"><div class="empty-icon">📦</div><h3>Collection vide</h3><p>Appuyez sur le bouton + pour ajouter votre premier objet.</p></div>`;
    grid.className='item-wrap';
    const cnt = document.getElementById('items-count'); if(cnt) cnt.textContent='';
    return;
  }

  const filtered = getFilteredSortedItems();
  const cnt = document.getElementById('items-count');
  if(cnt) cnt.textContent = filtered.length < items.length ? `${filtered.length}/${items.length}` : `${items.length} objet${items.length>1?'s':''}`;

  if(filtered.length===0){
    grid.innerHTML=`<div class="empty-state"><div class="empty-icon">🔍</div><h3>Aucun résultat</h3><p>Essayez un autre terme de recherche.</p></div>`;
    grid.className='item-wrap';
    return;
  }

  const isList = currentViewMode === 'list';

  if(isList){
    // MODE LISTE ULTRA-COMPACT
    grid.className = 'item-wrap items-list-compact';
    grid.innerHTML = filtered.map((item,idx) => {
      const cost = getCost(item);
      const sellEur  = Number(item.sell_eur || 0);
      const sellJpy  = jpyToEur(Number(item.sell_jpy || 0));
      const bestSell = Math.max(sellEur, sellJpy);
      const hasValue = sellEur > 0 || item.sell_jpy > 0;
      const profit   = bestSell - cost;
      const isPos    = profit >= 0;
      return `<div class="item-card" onclick="openDetail('${item.id}')">
        <div class="compact-row">
          ${item.image_url
            ? `<img class="compact-thumb" src="${esc(item.image_url)}" alt="" loading="lazy">`
            : `<div class="compact-thumb-placeholder">📦</div>`}
          <div class="compact-name">${esc(item.name)}</div>
          <div class="compact-right">
            <span class="compact-cost">${fEUR(cost)}</span>
            ${hasValue ? `<span class="compact-profit ${isPos?'pos':'neg'}">${isPos?'+':''}${fEUR(profit)}</span>` : ''}
          </div>
        </div>
        ${idx < filtered.length-1 ? '<div class="compact-divider"></div>' : ''}
      </div>`;
    }).join('');
    return;
  }

  // MODE CARTES
  grid.className = 'item-wrap';
  grid.innerHTML=filtered.map((item,idx)=>{
    const cost = getCost(item);
    const jpySearch = encodeURIComponent(item.name);
    const ebaySearch = encodeURIComponent(item.name);
    const sellEur  = Number(item.sell_eur || 0);
    const sellJpy  = jpyToEur(Number(item.sell_jpy || 0));
    const bestSell = Math.max(sellEur, sellJpy);
    const hasValue = sellEur > 0 || item.sell_jpy > 0;
    const profit   = bestSell - cost;
    const isPos    = profit >= 0;
    const profitChip = hasValue
      ? `<span class="profit-chip-glass ${isPos?'pos':'neg'}">${isPos?'▲':'▼'} ${isPos?'+':''}${fEUR(profit)}</span>`
      : '';

    return`<div class="item-card clickable" style="animation-delay:${idx*30}ms" onclick="openDetail('${item.id}')">
      <div style="display:flex;gap:12px;padding:14px">
        ${item.image_url
          ? `<img style="width:72px;height:72px;border-radius:10px;object-fit:cover;flex-shrink:0" src="${esc(item.image_url)}" alt="" loading="lazy">`
          : `<div style="width:72px;height:72px;border-radius:10px;background:var(--c1-08);display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0">📦</div>`}
        <div class="item-body">
          <div class="item-name">${esc(item.name)}</div>
          ${item.category?`<span class="item-cat">${esc(item.category)}</span>`:''}
          ${d.showNotes && item.notes?`<div class="item-notes">${esc(item.notes)}</div>`:''}
          <div class="price-row">
            <span class="price-chip">Revient : <b>${fEUR(cost)}</b></span>
            ${item.sell_eur?`<span class="price-chip sell">Occid. <b>${fEUR(item.sell_eur)}</b></span>`:''}
            ${item.sell_jpy?`<span class="price-chip sell">Japon <b>${fJPY(item.sell_jpy)}</b></span>`:''}
          </div>
          ${profitChip}
        </div>
      </div>
      <div class="item-footer" onclick="event.stopPropagation()">
        <div class="item-links">
          ${d.showLinks ? `<a class="link-pill link-ebay" href="https://www.ebay.fr/sch/i.html?_nkw=${ebaySearch}&LH_Complete=1&LH_Sold=1" target="_blank" rel="noopener"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>eBay</a>
          <a class="link-pill link-yahoo" href="https://auctions.yahoo.co.jp/search/search?p=${jpySearch}" target="_blank" rel="noopener"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Yahoo JP</a>` : ''}
        </div>
        <div class="item-actions">
          <button class="act-btn" onclick="openEdit('${item.id}')" title="Modifier"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="act-btn del" onclick="deleteItem('${item.id}')" title="Supprimer"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function render(){renderStats();renderItems();}

// ============================================================
// EXCHANGE RATE API
// ============================================================
async function loadRate(silent=false){
  const btn=document.getElementById('rate-btn');
  if(!silent)btn.querySelector('svg').classList.add('spin');
  try{
    const r=await fetch('https://api.frankfurter.app/latest?from=EUR&to=JPY').then(res=>res.json());
    if(r.rates&&r.rates.JPY){
      liveRate=Math.round(r.rates.JPY*100)/100;
      document.getElementById('rate-display').textContent=`1 € = ${liveRate.toFixed(2)} ¥`;
      document.getElementById('rate-source').textContent=`BCE · Mis à jour ${new Date().toLocaleTimeString('fr-FR')}`;
      btn.querySelector('svg').classList.remove('spin');
      render();runSim();return;
    }
  }catch{}
  try{
    const r2=await fetch('https://open.er-api.com/v6/latest/EUR').then(res=>res.json());
    if(r2.rates&&r2.rates.JPY){
      liveRate=Math.round(r2.rates.JPY*100)/100;
      document.getElementById('rate-display').textContent=`1 € = ${liveRate.toFixed(2)} ¥`;
      document.getElementById('rate-source').textContent=`ExchangeRate-API · ${new Date().toLocaleTimeString('fr-FR')}`;
      btn.querySelector('svg').classList.remove('spin');
      render();runSim();return;
    }
  }catch{}
  document.getElementById('rate-display').textContent=`1 € = ${liveRate.toFixed(2)} ¥`;
  document.getElementById('rate-source').textContent='⚠️ Taux indicatif (hors ligne)';
  btn.querySelector('svg').classList.remove('spin');
  render();runSim();
}
setInterval(()=>loadRate(true),5*60*1000);

// ============================================================
// FORM MODAL
// ============================================================
function toggleCur() {
  const isJPY = document.querySelector('input[name="currency"]:checked').value === 'JPY';
  document.getElementById('f-buy-price').placeholder = isJPY ? "En Yens (¥)" : "En Euros (€)";
  document.getElementById('f-buy-price').step = isJPY ? "1" : "0.01";
}
function clearForm(){
  ['name','cat','img','buy-price','shipping','taxes','sell-eur','sell-jpy','notes'].forEach(k=>{
    const el=document.getElementById('f-'+k);if(el)el.value='';
  });
  document.querySelector('input[name="currency"][value="JPY"]').checked = true;
  toggleCur();
}
function openAdd(){
  editingId=null;
  document.getElementById('form-title').textContent='Ajouter un objet';
  clearForm();
  openModal('modal-form');
  // Scroll le sheet en haut
  setTimeout(()=>{ const s=document.querySelector('.modal-scroll'); if(s)s.scrollTop=0; },50);
}
function openEdit(id){
  const item=items.find(i=>i.id===id);if(!item)return;
  editingId=id;
  document.getElementById('form-title').textContent='Modifier';
  document.getElementById('f-name').value=item.name||'';
  document.getElementById('f-cat').value=item.category||'';
  document.getElementById('f-img').value=item.image_url||'';
  document.querySelector(`input[name="currency"][value="${item.currency||'JPY'}"]`).checked = true;
  toggleCur();
  document.getElementById('f-buy-price').value=item.buy_price||'';
  document.getElementById('f-shipping').value=item.shipping||'';
  document.getElementById('f-taxes').value=item.taxes||'';
  document.getElementById('f-sell-eur').value=item.sell_eur||'';
  document.getElementById('f-sell-jpy').value=item.sell_jpy||'';
  document.getElementById('f-notes').value=item.notes||'';
  openModal('modal-form');
  setTimeout(()=>{ const s=document.querySelector('.modal-scroll'); if(s)s.scrollTop=0; },50);
}
function submitForm(){
  const name=document.getElementById('f-name').value.trim();
  if(!name){toast('Le nom est obligatoire','err');return;}
  const data = {
    name,
    category: document.getElementById('f-cat').value.trim(),
    image_url: document.getElementById('f-img').value.trim(),
    currency: document.querySelector('input[name="currency"]:checked').value,
    buy_price: parseFloat(document.getElementById('f-buy-price').value)||0,
    shipping: parseFloat(document.getElementById('f-shipping').value)||0,
    taxes: parseFloat(document.getElementById('f-taxes').value)||0,
    sell_eur: parseFloat(document.getElementById('f-sell-eur').value)||0,
    sell_jpy: parseFloat(document.getElementById('f-sell-jpy').value)||0,
    notes: document.getElementById('f-notes').value.trim(),
    created_at: new Date().toISOString()
  };
  if(editingId){ const idx=items.findIndex(i=>i.id===editingId); if(idx!==-1)items[idx]={...items[idx],...data}; }
  else items.unshift({id:uid(),...data});
  saveItems(); closeModal('modal-form'); render();
  toast(editingId?'Objet modifié ✓':'Objet ajouté ✓','ok');
}
function deleteItem(id) {
  if(confirm("Supprimer cet objet ? Action irréversible.")) {
    items = items.filter(i=>i.id!==id); saveItems(); render(); toast('Objet supprimé');
  }
}

// ============================================================
// SIMULATEUR TAXES
// ============================================================
function runSim() {
  const jpy     = parseFloat(document.getElementById('sim-jpy').value) || 0;
  const fees    = parseFloat(document.getElementById('sim-fees').value) || 0;
  const customs = parseFloat(document.getElementById('sim-customs').value) || 0;
  const mode    = document.querySelector('input[name="tva-mode"]:checked')?.value || 'import';
  const eurConv = jpyToEur(jpy);

  let base = 0, tva = 0, tvaLbl = 'TVA (20%)';
  if (mode === 'import') {
    base = eurConv + fees; tva = base * 0.20; tvaLbl = 'TVA 20% (valeur + port)';
  } else if (mode === 'simple') {
    base = eurConv; tva = base * 0.20; tvaLbl = 'TVA 20% (valeur seule)';
  } else {
    base = eurConv; tva = 0; tvaLbl = 'TVA (exonéré)';
  }
  const total = eurConv + fees + customs + tva;
  document.getElementById('sim-conv').textContent        = fEUR(eurConv);
  document.getElementById('sim-base').textContent        = fEUR(base);
  document.getElementById('sim-tva-lbl').textContent     = tvaLbl;
  document.getElementById('sim-tva').textContent         = fEUR(tva);
  document.getElementById('sim-customs-disp').textContent= fEUR(customs);
  document.getElementById('sim-total').textContent       = fEUR(total);
}

// ============================================================
// UTILS / MODALS / TOAST
// ============================================================
function openModal(id){document.getElementById(id).classList.add('open')}
function closeModal(id){document.getElementById(id).classList.remove('open')}
function bgClose(e,id){if(e.target===document.getElementById(id))closeModal(id)}
function toast(msg,type=''){
  const t=document.getElementById('toast');
  t.textContent=msg;t.className='show'+(type?' '+type:'');
  clearTimeout(t._t);t._t=setTimeout(()=>t.className='',2800);
}

// ============================================================
// INIT
// ============================================================
(function init(){
  applySavedColors();
  applySavedUiSize();
  applySavedViewMode();
  initConfigUI();
  initDisplaySettingsUI();
  loadRate();
  runSim();
})();