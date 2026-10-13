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

/* ---------- Boundary lines (sirf map par line dikhane ke liye; form ki values user khud likhta hai) ---------- */

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
    spatialStatus.textContent = '⚠ GPS accuracy ' + Math.round(acc) + ' m hai. Behtar signal wali jagah par dobara capture karein.';
    qaSummary.className = 'gis-status warn';
    qaSummary.textContent = 'Spatial QA warning: GPS accuracy 50 m se zyada hai.';
  } else {
    spatialStatus.className = 'gis-status ok';
    spatialStatus.textContent = '✓ GPS accuracy theek hai.';
    qaSummary.className = 'gis-status ok';
    qaSummary.textContent = 'Spatial QA passed: GPS accuracy qabil-e-qabool hai.';
  }
  if (progressMap) {
    if (gpsMarker) progressMap.removeLayer(gpsMarker);
    if (gpsAccuracyCircle) progressMap.removeLayer(gpsAccuracyCircle);
    gpsMarker = L.marker([lat,lng],{icon:markerStyle('gps')}).addTo(progressMap)
      .bindPopup('<b>Current Field GPS</b><br>'+lat.toFixed(6)+', '+lng.toFixed(6));
    if (acc > 0) gpsAccuracyCircle = L.circle([lat,lng],{radius:acc,weight:1,fillOpacity:.10}).addTo(progressMap);
    progressMap.setView([lat,lng],16);
    mapHint.textContent = 'Current field GPS map par dikhaya ja raha hai.';
  }
}

captureLocationBtn.addEventListener('click', () => {
  if (!site.value.trim()) { alert('Pehle Site Name likhein.'); return; }
  if (!navigator.geolocation) { captureStatus.textContent = 'Is browser me geolocation support nahi hai.'; return; }
  captureStatus.textContent = '📍 High-accuracy GPS capture ho raha hai...';
  captureLocationBtn.disabled = true;
  navigator.geolocation.getCurrentPosition(pos => {
    const lat = pos.coords.latitude, lng = pos.coords.longitude, acc = pos.coords.accuracy || 0;
    pLat.value = lat.toFixed(6);
    pLng.value = lng.toFixed(6);
    gpsAccuracy.textContent = acc ? Math.round(acc) + ' m' : '—';
    captureTime.textContent = new Date().toLocaleString();
    captureStatus.textContent = '✓ GPS capture ho gaya. Map par check karein.';
    captureLocationBtn.disabled = false;
    updateSpatialQA(acc);
  }, err => {
    const messages = {
      1:'Location permission deny ho gayi. Location access allow karein.',
      2:'Location available nahi. GPS/location services check karein.',
      3:'Location request time out ho gayi. Dobara try karein.'
    };
    captureStatus.textContent = '✕ ' + (messages[err.code] || 'Location capture nahi ho saki.');
    captureLocationBtn.disabled = false;
  }, {enableHighAccuracy:true, timeout:20000, maximumAge:0});
});

document.getElementById('progressForm').addEventListener('submit', e => {
  e.preventDefault();
});

document.querySelector('.save-btn').addEventListener('click', async () => {
  if (!division.value.trim() || !district.value.trim() || !tehsil.value.trim() || !pkg.value.trim() || !site.value.trim()) {
    alert('Division, District, Tehsil, Package aur Site Name likhein.'); return;
  }
  if (!pLat.value || !pLng.value) { alert('Capture the current field GPS location first.'); return; }

  const payload = {
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
    captured_at: captureTime.textContent
  };

  const btn = document.querySelector('.save-btn');
  btn.disabled = true;
  try {
    const r = await fetch('/api/progress', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      let msg = r.status;
      try { msg = (await r.json()).error || msg; } catch (e) {}
      alert('Record save nahi hua: ' + msg);
      btn.disabled = false;
      return;
    }
  } catch (e) {
    console.error(e);
    alert('Server se connection nahi ho saka.');
    btn.disabled = false;
    return;
  }
  btn.disabled = false;

  alert('✓ Geotagged progress record saved to the database.');
  document.querySelectorAll('#pDivision,#pDistrict,#pTehsil,#pPackage,#pSite,#pPlantType,#pStart,#pEnd,#pRemarks').forEach(x => x.value = '');
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
});

initProgressMap();
