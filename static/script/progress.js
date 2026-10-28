const ACCURACY_LIMIT_METERS = 50;

const division = document.getElementById('pDivision');
const district = document.getElementById('pDistrict');
const tehsil = document.getElementById('pTehsil');
const pkg = document.getElementById('pPackage');
const site = document.getElementById('pSite');
const plant = document.getElementById('pPlantType');
const pLat = document.getElementById('pLat');
const pLng = document.getElementById('pLng');
const pStatus = document.getElementById('pStatus');
const pStart = document.getElementById('pStart');
const pEnd = document.getElementById('pEnd');
const pRemarks = document.getElementById('pRemarks');
const captureLocationBtn = document.getElementById('captureLocation');
const captureStatus = document.getElementById('captureStatus');
const gpsAccuracy = document.getElementById('gpsAccuracy');
const captureTime = document.getElementById('captureTime');
const spatialStatus = document.getElementById('spatialStatus');
const qaSummary = document.getElementById('qaSummary');
const mapHint = document.getElementById('mapHint');

let progressMap = null;
let gpsMarker = null;
let gpsAccuracyCircle = null;
let divisionBoundaryLayer = null;
let districtBoundaryLayer = null;
let tehsilBoundaryLayer = null;

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));
}


//images max 3 code start
const MAX_PHOTOS = 3;
const MAX_IMAGE_SIZE = 1024 * 1024; // 1 MB

async function compressPhoto(dataUrl) {
    const image = new Image();

    await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("Photo could not be loaded."));
        image.src = dataUrl;
    });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    let width = image.naturalWidth;
    let height = image.naturalHeight;

    const maxDimension = 1600;
    const scale = Math.min(
        1,
        maxDimension / Math.max(width, height)
    );

    width = Math.round(width * scale);
    height = Math.round(height * scale);

    for (let attempt = 0; attempt < 8; attempt++) {
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(image, 0, 0, width, height);

        for (let quality = 0.85; quality >= 0.25; quality -= 0.10) {
            const blob = await new Promise(resolve =>
                canvas.toBlob(resolve, "image/jpeg", quality)
            );

            if (blob && blob.size <= MAX_IMAGE_SIZE) {
                return await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            }
        }

        width = Math.round(width * 0.7);
        height = Math.round(height * 0.7);
    }

    throw new Error("Photo could not be reduced to under 1 MB.");
}
// images max 3 code end

function initProgressMap() {
  const el = document.getElementById('progressMap');
  if (!el || !window.L) return;
  progressMap = L.map(el).setView([31.5204,74.3587], 8);
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:'© OpenStreetMap contributors'
  }).addTo(progressMap);
  divisionBoundaryLayer = L.layerGroup().addTo(progressMap);
  districtBoundaryLayer = L.layerGroup().addTo(progressMap);
  tehsilBoundaryLayer = L.layerGroup().addTo(progressMap);
  L.control.scale({imperial:false, position:'bottomleft'}).addTo(progressMap);
  L.control.layers({'OpenStreetMap':osm},{
    'Division boundary':divisionBoundaryLayer,
    'District boundary':districtBoundaryLayer,
    'Tehsil boundary':tehsilBoundaryLayer
  },{collapsed:true}).addTo(progressMap);
}

/* ---------- Boundary lines (only to show lines on the map; the form values are entered by the user) ---------- */

function clearBoundaryLayer(layer){ if (layer) layer.clearLayers(); }

function boundaryStyle(type){
  const styles = {
    division:{color:'#0b3d62',weight:3,dashArray:'8,5',fillOpacity:0,opacity:.9},
    district:{color:'#d9822b',weight:2.5,dashArray:'4,4',fillOpacity:.04,opacity:.9},
    tehsil:{color:'#1e9e5a',weight:2.5,fillOpacity:.14,opacity:.95}
  };
  return styles[type]||{color:'#666',weight:2,fillOpacity:.08};
}

function boundaryPopup(item){
  return '<b>'+esc((item.type||'').toUpperCase())+' BOUNDARY</b><br>'+
    '<b>Name:</b> '+esc(item.name)+
    (item.division?'<br><b>Division:</b> '+esc(item.division):'')+
    (item.district?'<br><b>District:</b> '+esc(item.district):'')+
    (item.tehsil?'<br><b>Tehsil:</b> '+esc(item.tehsil):'');
}

async function loadBoundaryLayer(layerGroup, type, params){
  clearBoundaryLayer(layerGroup);
  if (!layerGroup) return null;
  try {
    const qs = new URLSearchParams(params);
    qs.set('type', type);
    const r = await fetch('/map_boundaries?'+qs.toString());
    if (!r.ok) throw new Error('Boundary request failed');
    const data = await r.json();
    if (!Array.isArray(data)) return null;
    const added = [];
    data.forEach(item=>{
      if (!item.geometry) return;
      const gLayer = L.geoJSON(
        {type:'Feature',geometry:item.geometry,properties:{}},
        {style:boundaryStyle(type)}
      );
      gLayer.bindPopup(boundaryPopup(item));
      gLayer.addTo(layerGroup);
      added.push(gLayer);
    });
    return added.length ? L.featureGroup(added) : null;
  } catch(e) { console.error('Boundary load error:',e); return null; }
}

function loadDivisionBoundary(divisionName){
  return loadBoundaryLayer(divisionBoundaryLayer,'division',{division:divisionName});
}

function loadDistrictBoundary(divisionName,districtName){
  return loadBoundaryLayer(districtBoundaryLayer,'district',{division:divisionName,district:districtName});
}

async function loadTehsilBoundary(divisionName,districtName,tehsilName){
  const group = await loadBoundaryLayer(tehsilBoundaryLayer,'tehsil',{division:divisionName,district:districtName,tehsil:tehsilName});
  if (group && progressMap) {
    const bounds = group.getBounds();
    if (bounds.isValid()) progressMap.fitBounds(bounds,{padding:[30,30]});
  }
}

division.addEventListener('change', () => {
  const d = division.value.trim();
  clearBoundaryLayer(districtBoundaryLayer);
  clearBoundaryLayer(tehsilBoundaryLayer);
  if (!d) { clearBoundaryLayer(divisionBoundaryLayer); return; }
  loadDivisionBoundary(d);
});

district.addEventListener('change', () => {
  const d = division.value.trim(), di = district.value.trim();
  clearBoundaryLayer(tehsilBoundaryLayer);
  if (!d || !di) { clearBoundaryLayer(districtBoundaryLayer); return; }
  loadDistrictBoundary(d, di);
});

tehsil.addEventListener('change', () => {
  const d = division.value.trim(), di = district.value.trim(), t = tehsil.value.trim();
  if (!d || !di || !t) { clearBoundaryLayer(tehsilBoundaryLayer); return; }
  loadTehsilBoundary(d, di, t);
});

/* ---------- Markers ---------- */

function markerStyle(type) {
  const colors = {gps:'#d43d3d',progress:'#6f42c1'};
  return L.divIcon({
    className:'',
    html:'<div style="width:16px;height:16px;border-radius:50%;background:'+colors[type]+';border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45)"></div>',
    iconSize:[16,16], iconAnchor:[8,8]
  });
}

/* ---------- GPS capture ---------- */

function updateSpatialQA(acc) {
  const lat = Number(pLat.value), lng = Number(pLng.value);
  if (acc > ACCURACY_LIMIT_METERS) {
    spatialStatus.className = 'gis-status warn';
    spatialStatus.textContent = '⚠ GPS accuracy is ' + Math.round(acc) + ' m. Please capture again in a location with a better signal.';
    qaSummary.className = 'gis-status warn';
    qaSummary.textContent = 'Spatial QA warning: GPS accuracy is greater than 50 m.';
  } else {
    spatialStatus.className = 'gis-status ok';
    spatialStatus.textContent = '✓ GPS accuracy is good.';
    qaSummary.className = 'gis-status ok';
    qaSummary.textContent = 'Spatial QA passed: GPS accuracy is acceptable.';
  }
  if (progressMap) {
    if (gpsMarker) progressMap.removeLayer(gpsMarker);
    if (gpsAccuracyCircle) progressMap.removeLayer(gpsAccuracyCircle);
    gpsMarker = L.marker([lat,lng],{icon:markerStyle('gps')}).addTo(progressMap)
      .bindPopup('<b>Current Field GPS</b><br>'+lat.toFixed(6)+', '+lng.toFixed(6));
    if (acc > 0) gpsAccuracyCircle = L.circle([lat,lng],{radius:acc,weight:1,fillOpacity:.10}).addTo(progressMap);
    progressMap.setView([lat,lng],16);
    mapHint.textContent = 'Current field GPS is shown on the map.';
  }
}

captureLocationBtn.addEventListener('click', () => {
  if (!site.value.trim()) { alert('Please enter the sitename first.'); return; }
  if (!navigator.geolocation) { captureStatus.textContent = 'Geolocation is not supported in this browser.'; return; }

  // Works without internet / mobile tower signal: the phone's GPS chip is used.
  // A GPS fix can take 30-60 seconds outdoors, so we keep listening and use the best reading.
  const MAX_WAIT_MS = 60000;
  const startedAt = Date.now();
  let best = null, watchId = null, timer = null, ticker = null, finished = false, lastErr = null;

  captureLocationBtn.disabled = true;
  captureStatus.textContent = '🛰️ Searching for GPS satellites... please stay in an open area.';

  function accOf(p) { return p.coords.accuracy ?? Infinity; }

  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    clearInterval(ticker);
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    captureLocationBtn.disabled = false;

    if (!best) {
      const messages = {
        1: 'Location permission was denied. Please allow location access.',
        2: 'Location is unavailable. Please turn ON GPS/Location and go to an open area.',
        3: 'GPS fix not found in time. Please go to an open area and try again.'
      };
      captureStatus.textContent = '✕ ' + ((lastErr && messages[lastErr.code]) || 'Location could not be captured.');
      return;
    }

    const lat = best.coords.latitude, lng = best.coords.longitude;
    const acc = Number.isFinite(accOf(best)) ? accOf(best) : 0;
    pLat.value = lat.toFixed(6);
    pLng.value = lng.toFixed(6);
    gpsAccuracy.textContent = acc ? Math.round(acc) + ' m' : '—';
    captureTime.textContent = new Date().toLocaleString();
    captureStatus.textContent = '✓ GPS captured. Please check the map.';
    updateSpatialQA(acc);
  }

  watchId = navigator.geolocation.watchPosition(pos => {
    if (!best || accOf(pos) < accOf(best)) best = pos;
    if (accOf(best) <= ACCURACY_LIMIT_METERS) finish();   // good enough, stop early
  }, err => {
    lastErr = err;
    if (err.code === 1) finish();                         // permission denied: no point waiting
  }, {enableHighAccuracy: true, timeout: 30000, maximumAge: 0});

  timer = setTimeout(finish, MAX_WAIT_MS);                // after 60s use the best reading we have

  ticker = setInterval(() => {
    if (finished) return;
    const sec = Math.round((Date.now() - startedAt) / 1000);
    captureStatus.textContent = best
      ? '📡 GPS accuracy ' + Math.round(accOf(best)) + ' m, improving... (' + sec + 's)'
      : '🛰️ Waiting for GPS fix... (' + sec + 's)';
  }, 1000);
});

document.getElementById('progressForm').addEventListener('submit', e => {
  e.preventDefault();
});

/* ---------- Offline queue: records are kept on the phone (IndexedDB) until the internet is back ---------- */

const QUEUE_DB = 'spasis_offline';
const QUEUE_STORE = 'pending_records';
let lastSyncNote = '';   // shown in the orange box so we can see why an upload is waiting

function queueDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(QUEUE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(QUEUE_STORE, {keyPath: 'id', autoIncrement: true});
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueTx(mode, fn) {
  const db = await queueDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, mode);
    const request = fn(tx.objectStore(QUEUE_STORE));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

const queueAdd = rec => queueTx('readwrite', s => s.add(rec));
const queuePut = rec => queueTx('readwrite', s => s.put(rec));
const queueDelete = id => queueTx('readwrite', s => s.delete(id));
const queueAll = () => queueTx('readonly', s => s.getAll());

// Returns {ok:true} | {network:true} | {auth:true} | {error:'message'}
async function sendRecord(payload) {
  let r;
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 90000);   // weak signal: never hang forever
  try {
    r = await fetch('/api/progress', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      credentials: 'same-origin',
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (e) {
    lastSyncNote = 'no connection or server not reachable';
    return {network: true};                       // no internet / server unreachable
  } finally {
    clearTimeout(abortTimer);
  }
  // Login session expired: Flask redirects to /login
  if (r.redirected || r.status === 401 || (r.url || '').includes('/login')) return {auth: true};
  if ([408, 429, 502, 503, 504].includes(r.status)) { lastSyncNote = 'server busy (' + r.status + ')'; return {network: true}; }
  if (!r.ok) {
    let msg = String(r.status);
    try { msg = (await r.json()).error || msg; } catch (e) {}
    lastSyncNote = 'server rejected: ' + msg;
    return {error: msg};
  }
  return {ok: true};
}

function pendingBadge() {
  let el = document.getElementById('pendingBadge');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'pendingBadge';
  el.style.cssText = 'display:none;margin-top:10px;padding:10px 12px;border-radius:8px;background:#fff4e0;border:1px solid #d9822b;color:#7a4a0c;font-size:14px';
  document.querySelector('.save-btn').parentNode.appendChild(el);
  return el;
}

async function updatePendingBadge() {
  let items = [];
  try { items = await queueAll(); } catch (e) { console.error(e); }
  const el = pendingBadge();
  if (!items.length) { el.style.display = 'none'; return; }
  const failed = items.filter(x => x.failed);
  el.innerHTML = '📤 <b>' + items.length + '</b> record(s) saved on this phone, waiting to upload.' +
    (failed.length ? '<br>⚠ Server rejected ' + failed.length + ': ' + esc(failed[0].failed) : '') +
    (lastSyncNote ? '<br><small>Last try (' + new Date().toLocaleTimeString() + '): ' + esc(lastSyncNote) + '</small>' : '') +
    ' <button type="button" id="pendingUploadBtn" style="margin-left:8px;padding:4px 10px">Upload now</button>';
  el.style.display = 'block';
  document.getElementById('pendingUploadBtn').onclick = async () => {
    const all = await queueAll();
    for (const it of all) { if (it.failed) { delete it.failed; await queuePut(it); } }
    syncPending();
  };
}

let syncing = false;
async function syncPending() {
  if (syncing) return;
  syncing = true;
  let sent = 0, authProblem = false;
  try {
    const items = (await queueAll()).filter(x => !x.failed);
    for (const item of items) {
      const res = await sendRecord(item.payload);
      if (res.ok) { await queueDelete(item.id); sent++; lastSyncNote = ''; }
      else if (res.network) break;                        // still offline, try again later
      else if (res.auth) { authProblem = true; break; }   // needs login
      else { item.failed = res.error; await queuePut(item); }
    }
  } catch (e) {
    console.error('Sync error:', e);
  } finally {
    syncing = false;
    await updatePendingBadge();
  }
  if (sent) alert('✓ ' + sent + ' pending record(s) uploaded to the database.');
  if (authProblem) {
    const el = pendingBadge();
    el.style.display = 'block';
    el.innerHTML += '<br>⚠ Session expired. Please log in again; pending records will upload automatically.';
  }
}

function resetProgressForm() {
  document.querySelectorAll('#pDivision,#pDistrict,#pTehsil,#pPackage,#pSite,#pPlantType,#pStart,#pEnd,#pRemarks').forEach(x => x.value = '');
  if (window.progressPhotos) window.progressPhotos.length = 0;
  const gallery = document.getElementById('photoGallery');
  if (gallery) gallery.innerHTML = '';
  const photoStatus = document.getElementById('photoStatus');
  if (photoStatus) photoStatus.textContent = 'Capture GPS first, then take photos.';
  pStatus.value = 'In Progress';
  pLat.value = ''; pLng.value = '';
  gpsAccuracy.textContent = '—'; captureTime.textContent = '—';
  captureStatus.textContent = 'Press Capture Current Location to take a new field observation.';
  spatialStatus.className = 'gis-status';
  spatialStatus.textContent = 'Accuracy check will appear here after GPS capture..';
  clearBoundaryLayer(divisionBoundaryLayer);
  clearBoundaryLayer(districtBoundaryLayer);
  clearBoundaryLayer(tehsilBoundaryLayer);
  if (gpsMarker && progressMap) { progressMap.removeLayer(gpsMarker); gpsMarker = null; }
  if (gpsAccuracyCircle && progressMap) { progressMap.removeLayer(gpsAccuracyCircle); gpsAccuracyCircle = null; }
}

document.querySelector('.save-btn').addEventListener('click', async () => {
  if (!division.value.trim() || !district.value.trim() || !tehsil.value.trim() || !pkg.value.trim() || !site.value.trim()) {
    alert('Please enter Division, District, Tehsil, Package and Site Name.'); return;
  }
  if (!pLat.value || !pLng.value) { alert('Capture the current field GPS location first.'); return; }

  const payload = {
    // unique id so the server can ignore a duplicate if an upload is retried
    client_uuid: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(16).slice(2)),
    division: division.value.trim(),
    district: district.value.trim(),
    tehsil: tehsil.value.trim(),
    package_name: pkg.value.trim(),
    site_name: site.value.trim(),
    plant_type: plant.value.trim(),
    lat: pLat.value,
    lng: pLng.value,
    accuracy: gpsAccuracy.textContent,
    status: pStatus.value,
    start_date: pStart.value,
    end_date: pEnd.value,
    remarks: pRemarks.value.trim(),
    captured_at: captureTime.textContent,
    images: (window.progressPhotos || []).map(photo => photo.dataUrl)
  };

  const btn = document.querySelector('.save-btn');
  btn.disabled = true;
  const res = await sendRecord(payload);

  if (res.ok) {
    alert('✓ Geotagged progress record saved to the database.');
  } else if (res.network || res.auth) {
    try {
      await queueAdd({payload, savedAt: new Date().toISOString()});
    } catch (e) {
      console.error(e);
      alert('No internet, and the record could not be stored on this phone. Please do not clear the form; try again.');
      btn.disabled = false;
      return;
    }
    alert(res.auth
      ? '⚠ Your login session expired. The record is saved on this phone. Please log in again and it will upload automatically.'
      : '📴 No internet. The record (with photos) is saved on this phone and will upload automatically when the internet is back.');
  } else {
    alert('Record could not be saved: ' + res.error);
    btn.disabled = false;
    return;
  }

  btn.disabled = false;
  resetProgressForm();
  updatePendingBadge();
});

// Try to upload pending records: when internet returns, every 30 s, and on page load
function syncSoon() {
  syncPending();
  setTimeout(syncPending, 3000);    // right after the network returns, DNS may need a few seconds
  setTimeout(syncPending, 8000);
}
window.addEventListener('online', syncSoon);
window.addEventListener('focus', syncSoon);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncSoon(); });
if (navigator.connection && navigator.connection.addEventListener) navigator.connection.addEventListener('change', syncSoon);
setInterval(() => syncPending(), 10000);
syncPending();

initProgressMap();


// image code start
(function () {
    const $ = id => document.getElementById(id);

    const video = $('camVideo');
    const box = $('cameraBox');
    const status = $('photoStatus');

    let stream = null;
    const photos = [];
    window.progressPhotos = photos;

    async function openCamera() {
        if (!$('pLat').value || !$('pLng').value) {
            status.textContent =
                '⚠️ Please press Capture Current Location first.';
            return;
        }

        if (!navigator.mediaDevices?.getUserMedia) {
            status.textContent =
                'HTTPS or a supported browser is required for camera access.';
            return;
        }

        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1920 }
                },
                audio: false
            });

            video.srcObject = stream;
            box.style.display = 'block';
            status.textContent = 'Back camera is ON.';
        } catch (e) {
            status.textContent =
                '❌ Could not open camera: ' + e.message;
        }
    }

    function closeCamera() {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }

        stream = null;

        if (video) video.srcObject = null;
        if (box) box.style.display = 'none';
    }

    async function snap() {
        if (photos.length >= MAX_PHOTOS) {
            status.textContent = 'You can capture a maximum of 3 photos.';
            return;
        }

        if (!video.videoWidth) {
            status.textContent = 'Camera is not ready yet.';
            return;
        }

        const lat = $('pLat').value;
        const lng = $('pLng').value;
        const acc = $('gpsAccuracy').textContent;
        const time = new Date().toLocaleString();

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);

        // Stamp GPS, accuracy, date/time and site details on the photo
        const lines = [
            `Lat: ${lat}  Lng: ${lng}`,
            `Acc: ${acc}  ${time}`,
            `${$('pSite').value || ''} ${$('pPackage').value || ''}`.trim()
        ];

        const fontSize = Math.max(16, Math.round(canvas.width / 45));
        const lineHeight = fontSize + 6;
        const boxHeight = lines.length * lineHeight + 12;

        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(
            0,
            canvas.height - boxHeight,
            canvas.width,
            boxHeight
        );

        ctx.fillStyle = '#fff';
        lines.forEach((line, i) => {
            ctx.fillText(
                line,
                10,
                canvas.height - boxHeight + (i + 1) * lineHeight
            );
        });

        const snapButton = $('snapPhoto');
        snapButton.disabled = true;
        status.textContent = 'Compressing photo...';

        try {
            // The existing compressPhoto() helper will be used
            const dataUrl = await compressPhoto(canvas.toDataURL('image/jpeg', 0.85));

            // Check the size of the final compressed image
            const base64 = dataUrl.split(',')[1];
            const estimatedSize = Math.floor(base64.length * 3 / 4);

            if (estimatedSize > MAX_IMAGE_SIZE) {
                throw new Error('Photo is still larger than 1 MB.');
            }

            photos.push({
                dataUrl: dataUrl,
                lat: parseFloat(lat),
                lng: parseFloat(lng),
                accuracy: acc,
                capturedAt: new Date().toISOString()
            });

            renderGallery();

            status.textContent =
                `✅ ${photos.length}/3 photos captured. Each photo is 1 MB or less.`;
        } catch (e) {
            status.textContent = '❌ ' + e.message;
        } finally {
            snapButton.disabled = false;
        }
    }

    function renderGallery() {
        const gallery = $('photoGallery');
        gallery.innerHTML = '';

        photos.forEach((photo, index) => {
            const item = document.createElement('div');
            item.className = 'photo-item';

            const img = document.createElement('img');
            img.src = photo.dataUrl;
            img.alt = `Site photo ${index + 1}`;

            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.textContent = '×';
            removeButton.setAttribute('aria-label', 'Remove photo');

            removeButton.addEventListener('click', () => {
                photos.splice(index, 1);
                renderGallery();
                status.textContent =
                    `${photos.length}/3 photos captured.`;
            });

            item.appendChild(img);
            item.appendChild(removeButton);
            gallery.appendChild(item);
        });
    }

    $('openCamera').addEventListener('click', openCamera);
    $('snapPhoto').addEventListener('click', snap);
    $('closeCamera').addEventListener('click', closeCamera);

    window.addEventListener('pagehide', closeCamera);
})();
// image code end