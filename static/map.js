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
    isBlackSquareDetected = blackPercentage > 55 && blackPercentage < 85;
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
            currentPolygons = data.polygons;
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

function drawPolygons() {
    if (!currentImage) return;
    const img = new Image();
    img.onload = () => {
        canvas.width = img.width; canvas.height = img.height; ctx.drawImage(img, 0, 0);
        currentPolygons.forEach((polygon, index) => {
            const hue = (index * 360 / currentPolygons.length) % 360; const color = `hsl(${hue}, 100%, 50%)`;
            ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 3; ctx.globalAlpha = 0.3;
            ctx.beginPath(); polygon.points.forEach((point, i) => { if (i===0) ctx.moveTo(point[0], point[1]); else ctx.lineTo(point[0], point[1]); }); ctx.closePath(); ctx.fill();
            ctx.globalAlpha = 1; ctx.stroke();
        });
        canvas.style.display = 'block';
    };
    img.src = currentImage;
}

function displayPolygonList() {
    polygonList.innerHTML = '';
    currentPolygons.forEach((polygon, index) => {
        const div = document.createElement('div'); div.className = 'polygon-item';
        div.innerHTML = `<strong>Polygon ${index+1}</strong><small>Vertices: ${polygon.vertices} | Area: ${Math.round(polygon.area)} px²</small>`;
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
