(function() {
// map.js — extracted from page
// Handles camera, uploads, polygon drawing and username display

const startCameraBtn = document.getElementById('startCameraBtn');
const captureBtn = document.getElementById('captureBtn');
const stopCameraBtn = document.getElementById('stopCameraBtn');
const cropBtn = document.getElementById('cropBtn'); 
const video = document.getElementById('video');
const cameraStatus = document.getElementById('cameraStatus');
const frameGuide = document.getElementById('frameGuide');

const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const uploadStatus = document.getElementById('uploadStatus');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const polygonList = document.getElementById('polygonList');
// Use the page origin to avoid CORS hostname mismatches
const API_URL = window.location.origin;

let stream = null;
let currentImage = null;
let currentPolygons = [];
let backgroundPolygon = null; // largest polygon (map) saved separately
let backgroundGroup = null; // optional: top-N largest polygons to use as background
let detectionInterval = null;
let isBlackSquareDetected = false;
// Tunable thresholds to reduce noise / false positives
const POLYGON_MIN_AREA = 1500;    // ignore tiny polygons (pixels^2)
const POLYGON_MAX_AREA = 100000; // ignore overly large polygons (pixels^2)
const POLYGON_MIN_DIM = 18;       // min bbox width/height in pixels
const RIGHT_ANGLE_TOL = 0.25;     // radians tolerance to consider ~90deg
const SIDE_EQUAL_TOL = 0.18;      // relative tolerance for side equality

// Tab switching
function switchTab(tab, evt) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(tab + '-tab').classList.add('active');
    if (evt && evt.target) evt.target.classList.add('active');
    if (tab === 'upload' && stream) {
        stopCamera();
    }
}

// Camera functions
startCameraBtn && startCameraBtn.addEventListener('click', startCamera);
stopCameraBtn && stopCameraBtn.addEventListener('click', stopCamera);
captureBtn && captureBtn.addEventListener('click', capturePhoto);

async function startCamera() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        video.srcObject = stream;
        video.play();
        startCameraBtn.disabled = true;
        stopCameraBtn.disabled = false;
        cameraStatus.className = 'status success';
        cameraStatus.textContent = '✓ Camera started';
        updateFrameGuide();
        detectionInterval = setInterval(detectBlackSquare, 100);
    } catch (err) {
        cameraStatus.className = 'status error';
        cameraStatus.textContent = '✗ Camera access denied';
        console.error('Error:', err);
    }
}

function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }
    if (detectionInterval) clearInterval(detectionInterval);
    startCameraBtn.disabled = false;
    stopCameraBtn.disabled = true;
    captureBtn.disabled = true;
    isBlackSquareDetected = false;
    frameGuide.classList.remove('valid');
    cameraStatus.className = 'status';
    cameraStatus.textContent = '';
}

function updateFrameGuide() {
    const container = document.querySelector('.camera-container');
    const guideSize = container.offsetWidth * 0.8; // 80% of frame
    frameGuide.style.width = guideSize + 'px';
    frameGuide.style.height = guideSize + 'px';
}

function detectBlackSquare() {
    if (!video || video.readyState === 0) return;
    const canvas_temp = document.createElement('canvas');
    canvas_temp.width = video.videoWidth;
    canvas_temp.height = video.videoHeight;
    const ctx_temp = canvas_temp.getContext('2d');
    ctx_temp.drawImage(video, 0, 0);
    const imageData = ctx_temp.getImageData(0, 0, canvas_temp.width, canvas_temp.height);
    const data = imageData.data;
    let blackPixels = 0;
    const threshold = 50;
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i]; const g = data[i+1]; const b = data[i+2];
        if (r < threshold && g < threshold && b < threshold) blackPixels++;
    }
    const totalPixels = canvas_temp.width * canvas_temp.height;
    const blackPercentage = (blackPixels / totalPixels) * 100;
    isBlackSquareDetected = blackPercentage > 8;
    if (isBlackSquareDetected) {
        frameGuide.classList.add('valid');
        captureBtn.disabled = false;
        cameraStatus.className = 'status success';
        cameraStatus.textContent = `✓ Ready! Black area: ${Math.round(blackPercentage)}%`;
    } else {
        frameGuide.classList.remove('valid');
        captureBtn.disabled = true;
        cameraStatus.className = 'status warning';
        cameraStatus.textContent = `Black area: ${Math.round(blackPercentage)}% - Show black square.`;
    }
}

function capturePhoto() {
    if (!isBlackSquareDetected) {
        cameraStatus.className = 'status error';
        cameraStatus.textContent = '✗ Black square not properly detected';
        return;
    }
    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = video.videoWidth;
    captureCanvas.height = video.videoHeight;
    const captureCtx = captureCanvas.getContext('2d');
    captureCtx.drawImage(video, 0, 0);
    currentImage = captureCanvas.toDataURL('image/jpeg');
    cameraStatus.className = 'status success';
    cameraStatus.textContent = '✓ Photo captured! Processing...';
    uploadImageToBackend(currentImage);
}

// File upload handling
uploadArea && uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
uploadArea && uploadArea.addEventListener('dragleave', () => { uploadArea.classList.remove('dragover'); });
uploadArea && uploadArea.addEventListener('drop', (e) => { e.preventDefault(); uploadArea.classList.remove('dragover'); const files = e.dataTransfer.files; if (files.length>0) handleFile(files[0]); });
fileInput && fileInput.addEventListener('change', (e) => { if (e.target.files.length>0) handleFile(e.target.files[0]); });
function handleFile(file) { const reader = new FileReader(); reader.onload = (e) => { currentImage = e.target.result; uploadImageToBackend(currentImage); }; reader.readAsDataURL(file); }

async function uploadImageToBackend(base64Image, opts = { skipPreCrop: false }) {
    uploadStatus.className = 'status loading';
    uploadStatus.textContent = '⏳ Processing image...';
    polygonList.innerHTML = '';
    canvas.style.display = 'none';
    try {
        const response = await fetch(`${API_URL}/upload-base64`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64Image })
        });
        const data = await response.json();
        if (data.success) {
            // find and save the largest polygon as the background map
            backgroundPolygon = findLargestPolygon(data.polygons || []);
            const desiredN = 2;
            backgroundGroup = getNLargestPolygons(data.polygons || [], desiredN);

            // If we found a background polygon and we haven't yet pre-cropped,
            // request a server-side OpenCV crop+detect so the document fills the view,
            // then use the returned cropped image and inner polygons.
            if (!opts.skipPreCrop && backgroundPolygon && backgroundPolygon.points.length >= 4) {
                try {
                    uploadStatus.textContent = '⏳ Cropping on server...';
                    const cropResp = await fetch(`${API_URL}/crop-and-detect`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ image: base64Image, polygon: backgroundPolygon.points, normalized: false, detect_inner: true })
                    });
                    const cropData = await cropResp.json();
                    if (cropData && cropData.success && cropData.cropped_image) {
                        // Use the cropped image as the current image and the returned polygons
                        currentImage = cropData.cropped_image;
                        // set background polygon to full-rect of cropped image
                        const tmpImg = new Image();
                        await new Promise((resolve) => { tmpImg.onload = resolve; tmpImg.src = currentImage; });
                        const w = tmpImg.naturalWidth || tmpImg.width; const h = tmpImg.naturalHeight || tmpImg.height;
                        backgroundPolygon = { points: [[0,0],[w,0],[w,h],[0,h]], area: w*h };
                        // Use the cropped image but do not display detected inner objects.
                        // Keep currentPolygons empty so nothing is overlaid.
                        currentPolygons = [];
                        uploadStatus.className = 'status success';
                        uploadStatus.textContent = `✓ Cropped (inner detections hidden)`;
                        cropBtn.disabled = false;
                        drawPolygons();
                        displayPolygonList();
                        return;
                    } else {
                        console.warn('Server crop failed', cropData);
                        // fallthrough to use the original detection results
                    }
                } catch (e) {
                    cropBtn.disabled = true;
                    console.error('Server crop error', e);
                    
                    // fallthrough to continue with original detection
                }
            }
            uploadStatus.className = 'status success';
            uploadStatus.textContent = `✓ ${data.message}`;
            cameraStatus.textContent = `✓ ${data.message}`;
        } else {
            uploadStatus.className = 'status error';
            uploadStatus.textContent = `✗ Error: ${data.error}`;
            cameraStatus.className = 'status error';
            cameraStatus.textContent = `✗ Error: ${data.error}`;
        }
    } catch (error) {
        uploadStatus.className = 'status error';
        uploadStatus.textContent = `✗ Connection error. Is the backend running on port 5000?`;
        cameraStatus.className = 'status error';
        cameraStatus.textContent = `✗ Connection error`;
        console.error('Error:', error);
    }
}




// Classify polygons and remove the largest one (assumed background map)
function classifyPolygons(polygons) {
        if (!polygons || polygons.length === 0) return [];

        // helpers
        const dist = (a,b) => Math.hypot(a[0]-b[0], a[1]-b[1]);
        const approxEqual = (a,b,tol=0.12) => {
                if (b === 0) return Math.abs(a) < 1e-6;
                return Math.abs(a-b)/Math.max(Math.abs(b),1) <= tol;
        };
        const dot = (ax,ay,bx,by) => ax*bx + ay*by;

        // compute basic measurements for all polygons
        polygons.forEach(p => {
                // area
                if (typeof p.area !== 'number') {
                        try {
                                const pts = p.points || [];
                                let area = 0;
                                for (let i=0;i<pts.length;i++){
                                        const [x1,y1]=pts[i];
                                        const [x2,y2]=pts[(i+1)%pts.length];
                                        area += x1*y2 - x2*y1;
                                }
                                p.area = Math.abs(area)/2;
                        } catch(e){ p.area = 0; }
                }
                // vertices
                p.vertices = (p.points||[]).length;
                // bounding box
                const pts = p.points || [];
                let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
                pts.forEach(([x,y])=>{ if (x<minX) minX=x; if (y<minY) minY=y; if (x>maxX) maxX=x; if (y>maxY) maxY=y; });
                p.bbox = { x: minX, y: minY, w: isFinite(maxX-minX)?(maxX-minX):0, h: isFinite(maxY-minY)?(maxY-minY):0 };
                // centroid (simple average)
                p.centroid = pts.length ? pts.reduce((acc,pt)=>[acc[0]+pt[0], acc[1]+pt[1]],[0,0]).map(v=>v/pts.length) : [p.bbox.x + p.bbox.w/2, p.bbox.y + p.bbox.h/2];
        });

        // pre-filter noisy/small polygons
        const candidates = polygons.filter(p => {
            if (typeof p.area !== 'number') return false;
            if (p.area < POLYGON_MIN_AREA) return false;
            if (p.area > POLYGON_MAX_AREA) return false;    
            if (p.bbox.w < POLYGON_MIN_DIM || p.bbox.h < POLYGON_MIN_DIM) return false;
            return true;
        });

        // choose background polygon from candidates (prefer largest quad), fallback to overall largest
        let maxIdx = -1, maxArea = -1, quadIdx = -1, quadArea = -1;
        (candidates.length ? candidates : polygons).forEach((p,i)=>{
            const area = typeof p.area === 'number' ? p.area : 0;
            if (area > maxArea) { maxArea = area; maxIdx = i; }
            if (p.vertices === 4 && area > quadArea) { quadArea = area; quadIdx = i; }
        });
        const bgSource = candidates.length ? candidates : polygons;
        const bgIdxRel = quadIdx >= 0 ? quadIdx : maxIdx;
        const background = bgIdxRel >= 0 ? (bgSource[bgIdxRel] || null) : null;
        if (background) backgroundPolygon = background;

        // determine background area for filtering returned list
        const bgArea = background && typeof background.area === 'number' ? background.area : Infinity;

        // final filtered list: remove background and any polygon larger than background, and apply size filter again
        const filtered = (polygons || []).filter(p => {
            if (background && p === background) return false;
            if (typeof p.area === 'number' && p.area > bgArea) return false;
            if (typeof p.area !== 'number' || p.area < POLYGON_MIN_AREA) return false;
            if (p.bbox.w < POLYGON_MIN_DIM || p.bbox.h < POLYGON_MIN_DIM) return false;
            return true;
        });

        // compute shape features and classify only for the filtered set
        return filtered.map(p => {
            const pts = p.points || [];
            const verts = pts.length;
            // sides/edges
            const sides = []; const edges = [];
            for (let i=0;i<verts;i++){
                const a = pts[i], b = pts[(i+1)%verts];
                sides.push(dist(a,b));
                edges.push([b[0]-a[0], b[1]-a[1]]);
            }
            const avgSide = sides.reduce((s,v)=>s+v,0)/Math.max(1,sides.length);
            const angles = [];
            for (let i=0;i<edges.length;i++){
                const [ax,ay]=edges[i]; const [bx,by]=edges[(i+1)%edges.length];
                const dp = dot(ax,ay,bx,by); const mag = Math.hypot(ax,ay)*Math.hypot(bx,by) || 1;
                const cos = Math.max(-1, Math.min(1, dp/mag)); angles.push(Math.acos(cos));
            }
            const centroid = p.centroid || [p.bbox.x + p.bbox.w/2, p.bbox.y + p.bbox.h/2];
            // classify
            let kind = 'Unknown';
            if (verts === 3) {
                const [a,b,c] = sides;
                if (approxEqual(a,b,0.15) && approxEqual(b,c,0.15)) kind = 'Equilateral triangle';
                else if (approxEqual(a,b,0.15) || approxEqual(b,c,0.15) || approxEqual(a,c,0.15)) kind = 'Isosceles triangle';
                else kind = 'Scalene triangle';
            } else if (verts === 4) {
                const rightCount = angles.filter(a=> Math.abs(a - Math.PI/2) < RIGHT_ANGLE_TOL ).length;
                const allSidesEqual = sides.every(s=> approxEqual(s, avgSide, SIDE_EQUAL_TOL));
                const oppEqual = approxEqual(sides[0], sides[2], SIDE_EQUAL_TOL) && approxEqual(sides[1], sides[3], SIDE_EQUAL_TOL);
                if (allSidesEqual && rightCount >= 3) kind = 'Square';
                else if (oppEqual && rightCount >= 3) kind = 'Rectangle';
                else if (allSidesEqual) kind = 'Rhombus';
                else kind = 'Quadrilateral';
            } else if (verts <= 6) {
                const sideStd = Math.sqrt(sides.reduce((s,v)=>s + Math.pow(v-avgSide,2),0)/sides.length || 0);
                const avgAngle = angles.reduce((s,v)=>s+v,0)/angles.length || 0;
                const angleStd = Math.sqrt(angles.reduce((s,v)=>s + Math.pow(v-avgAngle,2),0)/angles.length || 0);
                if (sideStd/avgSide < 0.18 && angleStd < 0.6) kind = `${verts}-sided regular polygon`;
                else kind = `${verts}-sided polygon`;
            } else {
                kind = `Complex ${verts}-sided polygon`;
            }
            if (p.area > 200000) kind = 'Very large area (airport/park)';
            return Object.assign({}, p, { kind, bbox: p.bbox, centroid });
        });
}

function findLargestPolygon(polygons) {
    if (!polygons || polygons.length === 0) return null;
    let maxIdx = -1; let maxArea = -1;
    polygons.forEach((p,i)=>{
        let area = typeof p.area === 'number' ? p.area : null;
        if (area === null) {
            try {
                const pts = p.points || [];
                let a = 0;
                for (let j=0;j<pts.length;j++){ const [x1,y1]=pts[j]; const [x2,y2]=pts[(j+1)%pts.length]; a += x1*y2 - x2*y1; }
                area = Math.abs(a)/2;
            } catch(e){ area = 0; }
        }
        if (area > maxArea) { maxArea = area; maxIdx = i; }
    });
    return maxIdx >= 0 ? (polygons[maxIdx] || null) : null;
}

// Return top-N largest polygons (largest first)
function getNLargestPolygons(polygons, n = 1) {
    if (!polygons || polygons.length === 0) return [];
    // ensure area exists
    const copy = polygons.map(p => {
        if (typeof p.area !== 'number') {
            try {
                const pts = p.points || [];
                let a = 0;
                for (let i=0;i<pts.length;i++){
                    const [x1,y1]=pts[i];
                    const [x2,y2]=pts[(i+1)%pts.length];
                    a += x1*y2 - x2*y1;
                }
                p.area = Math.abs(a)/2;
            } catch (e) { p.area = 0; }
        }
        return p;
    });
    copy.sort((a,b) => (b.area||0) - (a.area||0));
    return copy.slice(0, Math.max(0, n));
}


function drawPolygons() {
    if (!currentImage) return;
    const img = new Image();
    img.onload = () => {
        canvas.width = img.width; 
        canvas.height = img.height; 
        ctx.drawImage(img, 0, 0);
        
    
        console.log('Filling canvas with background polygon');
        const ptsBg = backgroundPolygon.points;
        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
        ptsBg.forEach(([x,y])=>{ if (x<minX) minX=x; if (y<minY) minY=y; if (x>maxX) maxX=x; if (y>maxY) maxY=y; });
        const bw = isFinite(maxX-minX)?(maxX-minX):1;
        const bh = isFinite(maxY-minY)?(maxY-minY):1;
        const sx = canvas.width / bw;
        const sy = canvas.height / bh;

        ctx.save();
        ctx.beginPath();
        ptsBg.forEach((p,i)=>{
            const x = (p[0] - minX) * sx;
            const y = (p[1] - minY) * sy;
            if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        });
        ctx.closePath();
        ctx.restore();
     
        
        currentPolygons.forEach((polygon, index) => {
            const hue = (index * 360 / currentPolygons.length) % 360; 
            const color = `hsl(${hue}, 100%, 50%)`;
            ctx.strokeStyle = color; 
            ctx.fillStyle = color; 
            ctx.lineWidth = 3; 
            ctx.globalAlpha = 0.28;
            ctx.beginPath(); 
            polygon.points.forEach((point, i) => { 
                if (i===0) ctx.moveTo(point[0], point[1]); 
                else ctx.lineTo(point[0], point[1]); 
            }); 
            ctx.closePath(); 
            ctx.fill();
            ctx.globalAlpha = 1; 
            ctx.stroke();

            // draw kind label near centroid
            if (polygon.centroid) {
                const [cx, cy] = polygon.centroid;
                ctx.fillStyle = '#111';
                ctx.font = '16px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                // draw a subtle white halo for readability
                ctx.lineWidth = 4; 
                ctx.strokeStyle = 'rgba(255,255,255,0.85)';
                ctx.strokeText(polygon.kind, cx, cy - 10);
                ctx.fillText(polygon.kind, cx, cy - 10);
            }
            
            if (polygon.area > 50000) {
            }
        });
        canvas.style.display = 'block';
    };
    img.src = currentImage;
}
function displayPolygonList() {
    polygonList.innerHTML = '';
    currentPolygons.forEach((polygon, index) => {
        const div = document.createElement('div'); div.className = 'polygon-item';
        div.innerHTML = `<strong>Polygon ${index+1}</strong> <em>${polygon.kind || ''}</em><small>Vertices: ${polygon.vertices} | Area: ${Math.round(polygon.area||0)} px²</small>`;
        polygonList.appendChild(div);
    });
}

// -------------------------
// Component registry & recognition
// -------------------------
const COMPONENT_REGISTRY_KEY = 'mapmap_component_registry';

function loadComponentRegistry() {
    try { return JSON.parse(localStorage.getItem(COMPONENT_REGISTRY_KEY) || '[]'); } catch (e) { return []; }
}
function saveComponentRegistry(reg) { try { localStorage.setItem(COMPONENT_REGISTRY_KEY, JSON.stringify(reg)); } catch (e) {} }
let componentRegistry = loadComponentRegistry();

function polygonFeatures(p) {
    const pts = p.points || [];
    const verts = pts.length || 0;
    const area = typeof p.area === 'number' ? p.area : 0;
    const bbox = p.bbox || { w:0, h:0 };
    const aspect = bbox.w && bbox.h ? bbox.w / bbox.h : 1;
    const sides = [];
    for (let i=0;i<verts;i++){ const a=pts[i], b=pts[(i+1)%verts]; sides.push(Math.hypot(a[0]-b[0], a[1]-b[1])); }
    const avgSide = sides.length ? sides.reduce((s,v)=>s+v,0)/sides.length : 0;
    const sideStd = sides.length ? Math.sqrt(sides.reduce((s,v)=>s+Math.pow(v-avgSide,2),0)/sides.length) : 0;
    return { area, aspect, verts, avgSide, sideStd, bboxW: bbox.w||0, bboxH: bbox.h||0 };
}

function normalizeFeatures(f) {
    return [ Math.log10(Math.max(1,f.area))/6.0, Math.max(0,Math.min(5,f.aspect))/5.0, Math.min(12,f.verts)/12.0, Math.log10(Math.max(1,f.avgSide))/4.0, Math.min(1, f.sideStd/Math.max(1,f.avgSide)) ];
}

function featureDistance(aNorm, bNorm) { let s=0; for (let i=0;i<aNorm.length;i++){ const d=(aNorm[i]||0)-(bNorm[i]||0); s+=d*d; } return Math.sqrt(s); }

function registerComponentExample(label, polygon) {
    const f = polygonFeatures(polygon); const fnorm = normalizeFeatures(f);
    let entry = componentRegistry.find(r => r.label === label);
    if (!entry) { entry = { label, examples: [fnorm], proto: f, count: 1 }; componentRegistry.push(entry); }
    else { entry.examples.push(fnorm); entry.count = (entry.count||0)+1; }
    saveComponentRegistry(componentRegistry);
}

function recognizeComponent(polygon, maxDist = 0.6) {
    if (!componentRegistry || componentRegistry.length === 0) return null;
    const f = polygonFeatures(polygon); const fnorm = normalizeFeatures(f);
    let best = null;
    for (const entry of componentRegistry) {
        let minD = Infinity;
        for (const ex of entry.examples) { const d = featureDistance(fnorm, ex); if (d < minD) minD = d; }
        if (best === null || minD < best.dist) best = { label: entry.label, dist: minD };
    }
    if (best && best.dist <= maxDist) return best; return null;
}

function enableRegistrationUI() {
    // wire polygon list items for quick registration by clicking
    polygonList.querySelectorAll('.polygon-item').forEach((div, idx) => {
        div.style.cursor = 'pointer';
        div.onclick = () => {
            const polygon = currentPolygons[idx]; if (!polygon) return;
            const existing = recognizeComponent(polygon);
            const suggested = existing ? `${existing.label} (match ${existing.dist.toFixed(2)})` : '';
            const label = prompt(`Register component name for polygon #${idx+1}:`, suggested) || null;
            if (!label) return;
            registerComponentExample(label, polygon);
            polygon.kind = label;
            displayPolygonList(); drawPolygons();
        };
    });
}

function annotateRecognizedComponents() {
    currentPolygons.forEach(p => { const match = recognizeComponent(p); if (match) p.kind = `${match.label}`; });
}

// override displayPolygonList to annotate and enable registration UI after rendering
const orig_displayPolygonList = displayPolygonList;
displayPolygonList = function() {
    orig_displayPolygonList();
    annotateRecognizedComponents();
    // update labels in the list
    polygonList.querySelectorAll('.polygon-item').forEach((div, idx) => {
        const p = currentPolygons[idx]; if (p && p.kind) { const em = div.querySelector('em'); if (em) em.textContent = p.kind; }
    });
    enableRegistrationUI();
};

// point-in-polygon (ray-casting)
function pointInPoly(px, py, pts) {
    let inside = false;
    for (let i=0, j=pts.length-1; i<pts.length; j=i++){
        const xi = pts[i][0], yi = pts[i][1]; const xj = pts[j][0], yj = pts[j][1];
        const intersect = ((yi>py) !== (yj>py)) && (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// click canvas to label polygon
canvas.addEventListener('click', (ev) => {
    if (!currentPolygons || !currentPolygons.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const y = (ev.clientY - rect.top) * (canvas.height / rect.height);
    for (let i=0;i<currentPolygons.length;i++){
        const p = currentPolygons[i]; if (p.points && pointInPoly(x,y,p.points)) {
            const label = prompt(`Label polygon #${i+1} (leave empty to cancel):`, p.kind || ''); if (!label) return; registerComponentExample(label, p); p.kind = label; displayPolygonList(); drawPolygons(); return;
        }
    }
});

window.dumpComponentRegistry = function() { console.log(componentRegistry); };

// ensure registration UI is enabled on initial load
enableRegistrationUI();

window.addEventListener('resize', updateFrameGuide);
// expose certain helpers used by inline handlers in the HTML
window.switchTab = switchTab;


if (cropBtn) {
    cropBtn.addEventListener('click', () => {
        if (currentImage) {
            try { localStorage.setItem('mapmap_last_cropped', currentImage); } catch (e) {}
            window.location.href = '/make_map.html';
        } else {
            // no image available
            alert('No cropped image available. Please crop an image first.');
        }
    });
}

// Intro overlay handling
const introOverlay = document.getElementById('introOverlay');
const usernameInput = document.getElementById('usernameInput');
const startBtn = document.getElementById('startBtn');

function closeIntro(username) {
    if (username) {
        window.APP_USERNAME = username;
        try { localStorage.setItem('mapmap_username', username); } catch (e) {}
    }
    // show username in greeting area
    try { const name = username || localStorage.getItem('mapmap_username'); if (name && userGreeting) userGreeting.textContent = `Welcome, ${name}`; } catch (e) {}
    introOverlay.style.display = 'none';
}

// Pre-fill from localStorage if available
try {
    const saved = localStorage.getItem('mapmap_username');
    if (saved) usernameInput.value = saved;
    if (saved && userGreeting) userGreeting.textContent = `Welcome, ${saved}`;
} catch (e) {}

startBtn && startBtn.addEventListener('click', () => {
    const name = usernameInput.value && usernameInput.value.trim();
    if (!name) { usernameInput.focus(); return; }
    closeIntro(name);
});

usernameInput && usernameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startBtn.click(); });
})();
