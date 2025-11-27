(function() {
// map.js — extracted from page
// Handles camera, uploads, polygon drawing and username display

const startCameraBtn = document.getElementById('startCameraBtn');
const captureBtn = document.getElementById('captureBtn');
const stopCameraBtn = document.getElementById('stopCameraBtn');
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
        cameraStatus.textContent = `Black area: ${Math.round(blackPercentage)}% - Need ~80%`;
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

async function uploadImageToBackend(base64Image) {
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
            // OPTIONAL: also keep the top-N largest polygons as a group to fill the canvas
            // change `desiredN` to control how many large polygons compose the background
            const desiredN = 2;
            backgroundGroup = getNLargestPolygons(data.polygons || [], desiredN);
            // classify and filter polygons: remove the largest (background map)
            currentPolygons = classifyPolygons(data.polygons || []);
             
            console.log('Detected polygons:', backgroundPolygon, currentPolygons    );

            uploadStatus.className = 'status success';
            uploadStatus.textContent = `✓ ${data.message}`;
            cameraStatus.textContent = `✓ ${data.message}`;
            drawPolygons();
            displayPolygonList();
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

    // ensure area/vertices present
    polygons.forEach(p => {
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
        if (typeof p.vertices !== 'number') p.vertices = (p.points||[]).length;
    });

    // remove largest polygon (assumed background)
    let maxIdx = 0; let maxArea = -1;
    polygons.forEach((p,i)=>{ if (p.area>maxArea){ maxArea = p.area; maxIdx = i; } });
    const filtered = polygons.filter((_,i)=> i !== maxIdx);

    return filtered.map(p => {
        const pts = p.points || [];
        const verts = pts.length;
        // bounding box
        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
        pts.forEach(([x,y])=>{ if (x<minX) minX=x; if (y<minY) minY=y; if (x>maxX) maxX=x; if (y>maxY) maxY=y; });
        const w = isFinite(maxX-minX)?(maxX-minX):0;
        const h = isFinite(maxY-minY)?(maxY-minY):0;

        // compute side lengths and edge vectors
        const sides = [];
        const edges = [];
        for (let i=0;i<verts;i++){
            const a = pts[i];
            const b = pts[(i+1)%verts];
            sides.push(dist(a,b));
            edges.push([b[0]-a[0], b[1]-a[1]]);
        }
        const avgSide = sides.reduce((s,v)=>s+v,0)/Math.max(1,sides.length);

        // compute angles between consecutive edges
        const angles = [];
        for (let i=0;i<edges.length;i++){
            const [ax,ay]=edges[i];
            const [bx,by]=edges[(i+1)%edges.length];
            const dp = dot(ax,ay,bx,by);
            const mag = Math.hypot(ax,ay)*Math.hypot(bx,by) || 1;
            const cos = Math.max(-1, Math.min(1, dp/mag));
            angles.push(Math.acos(cos));
        }

        // centroid for label placement
        const centroid = pts.length ? pts.reduce((acc,p)=>[acc[0]+p[0], acc[1]+p[1]],[0,0]).map(v=>v/pts.length) : [minX + w/2, minY + h/2];

        // classification heuristics
        let kind = 'Unknown';

        if (verts === 3) {
            // triangle: check side equality
            const a = sides[0], b = sides[1], c = sides[2];
            if (approxEqual(a,b,0.15) && approxEqual(b,c,0.15)) kind = 'Equilateral triangle';
            else if (approxEqual(a,b,0.15) || approxEqual(b,c,0.15) || approxEqual(a,c,0.15)) kind = 'Isosceles triangle';
            else kind = 'Scalene triangle';
        } else if (verts === 4) {
            // check for right angles and equal sides
            const rightCount = angles.filter(a=> Math.abs(a - Math.PI/2) < 0.35 ).length;
            const allSidesEqual = sides.every(s=> approxEqual(s, avgSide, 0.18));
            const oppEqual = approxEqual(sides[0], sides[2]) && approxEqual(sides[1], sides[3]);
            if (allSidesEqual && rightCount >= 3) kind = 'Square';
            else if (oppEqual && rightCount >= 3) kind = 'Rectangle';
            else if (allSidesEqual) kind = 'Rhombus';
            else kind = 'Quadrilateral';
        } else if (verts <= 6) {
            // check regularity: side variance small and angle variance small
            const sideStd = Math.sqrt(sides.reduce((s,v)=>s + Math.pow(v-avgSide,2),0)/sides.length);
            const avgAngle = angles.reduce((s,v)=>s+v,0)/angles.length;
            const angleStd = Math.sqrt(angles.reduce((s,v)=>s + Math.pow(v-avgAngle,2),0)/angles.length);
            if (sideStd/avgSide < 0.18 && angleStd < 0.6) kind = `${verts}-sided regular polygon`;
            else kind = `${verts}-sided polygon`;
        } else {
            kind = `Complex ${verts}-sided polygon`;
        }

        // area hint
        if (p.area > 200000) kind = 'Very large area (airport/park)';

        return Object.assign({}, p, { kind, bbox: { x: minX, y: minY, w, h }, centroid });
    });
}

// Return the largest polygon by area (or null)
function findLargestPolygon(polygons) {
    if (!polygons || polygons.length === 0) return null;
    let maxArea = -1, maxPoly = null;
    polygons.forEach(p => {
        let area = (typeof p.area === 'number') ? p.area : null;
        if (area === null) {
            try {
                const pts = p.points || [];
                let a = 0;
                for (let i=0;i<pts.length;i++){
                    const [x1,y1]=pts[i];
                    const [x2,y2]=pts[(i+1)%pts.length];
                    a += x1*y2 - x2*y1;
                }
                area = Math.abs(a)/2;
            } catch (e) { area = 0; }
        }
        if (area > maxArea) { maxArea = area; maxPoly = p; }
    });
    return maxPoly;
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

// Draw a coup of polygons scaled so their union bounding box fills the canvas
function fillCanvasWithPolygonGroup(group, opts = {}) {
    if (!group || group.length === 0) return;
    // compute union bbox
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    group.forEach(p=>{
        (p.points||[]).forEach(([x,y])=>{
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        });
    });
    if (!isFinite(minX)) return;
    const bboxW = Math.max(1, maxX - minX);
    const bboxH = Math.max(1, maxY - minY);

    // choose scale to COVER canvas (fill). preserve aspect by using max scale.
    const sx = canvas.width / bboxW;
    const sy = canvas.height / bboxH;
    const scale = Math.max(sx, sy);

    // center the scaled union in canvas
    const totalW = bboxW * scale;
    const totalH = bboxH * scale;
    const offsetX = (canvas.width - totalW) / 2;
    const offsetY = (canvas.height - totalH) / 2;

    ctx.save();
    group.forEach((p, idx) => {
        const pts = p.points || [];
        if (!pts.length) return;
        const hue = (idx * 360 / group.length) % 360;
        const color = `hsl(${hue}, 60%, 70%)`;
        ctx.fillStyle = opts.bgColor || color;
        ctx.globalAlpha = typeof opts.bgAlpha === 'number' ? opts.bgAlpha : 1.0;

        ctx.beginPath();
        pts.forEach((pt, i)=>{
            const x = (pt[0] - minX) * scale + offsetX;
            const y = (pt[1] - minY) * scale + offsetY;
            if (i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        });
        ctx.closePath();
        ctx.fill();
        if (opts.stroke) {
            ctx.lineWidth = opts.strokeWidth || 2;
            ctx.strokeStyle = opts.strokeColor || 'rgba(0,0,0,0.12)';
            ctx.stroke();
        }
    });
    ctx.globalAlpha = 1;
    ctx.restore();
}

function drawPolygons() {
    if (!currentImage) return;
    const img = new Image();
    img.onload = () => {
        canvas.width = img.width; 
        canvas.height = img.height; 
        ctx.drawImage(img, 0, 0);
        
        // If we have a detected backgroundGroup (top-N), use it to fill the canvas
        if (backgroundGroup && backgroundGroup.length > 0) {
            ctx.clearRect(0,0,canvas.width,canvas.height);
            fillCanvasWithPolygonGroup(backgroundGroup, { bgAlpha: 1.0, stroke: false });
        }
        // else if a single backgroundPolygon exists, expand it to fill the canvas
        else if (backgroundPolygon && backgroundPolygon.points && backgroundPolygon.points.length) {
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
            // fill with a light map color
            ctx.fillStyle = '#e8f3e8';
            ctx.fill();
            ctx.restore();
        } else {
            // Fallback: fill entire canvas with black background when no background polygon
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        
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

window.addEventListener('resize', updateFrameGuide);

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
