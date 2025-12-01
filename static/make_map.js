(function(){
  const canvas = document.getElementById('mapCanvas');
  const ctx = canvas.getContext('2d');
  const markerList = document.getElementById('markerList');
  const backBtn = document.getElementById('backBtn');
  const exportBtn = document.getElementById('exportBtn');
  const clearBtn = document.getElementById('clearBtn');
  const analyzeBtn = document.getElementById('analyzeBtn');
const API_URL = window.location.origin;

  let baseImage = null; // Image object
  let dpr = window.devicePixelRatio || 1;
  const markers = [];

  analyzeBtn.addEventListener('click', analyzePhoto);

  async function analyzePhoto() {
    if (!baseImage) return;
    try {

      console.log(baseImage.src);
      const response = await fetch(API_URL + '/analyze', {
        method: 'POST',
        body: JSON.stringify({ image: baseImage.src }),
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await response.json();
      if (result.success) {
        alert('Analysis complete: ' + result.message);
      } else {
        alert('Analysis failed: ' + result.error);
      }
    } catch (e) {
      alert('Analysis error: ' + e.message);
    }

  }


  function loadCropped() {
    const data = localStorage.getItem('mapmap_last_cropped');
    if (!data) {
      document.body.innerHTML = '<div style="padding:20px; width: 50%">No cropped image found. <a href="/map.html">Go back</a></div>';
      return;
    }
    baseImage = new Image();
    baseImage.onload = () => {
      // set up canvas size to be 50% of the window width (CSS pixels)
      updateCanvasSize();
      draw();
      // ensure canvas updates on window resize
      window.addEventListener('resize', () => { updateCanvasSize(); draw(); });
    };
    baseImage.src = data;
  }

  function updateCanvasSize() {
    if (!baseImage) return;
    dpr = window.devicePixelRatio || 1;
    // target display width = 50% of window width, but don't upscale beyond natural width
    const targetDisplayWidth = Math.round(window.innerWidth * 0.5);
    const displayWidth = 600;
    const displayHeight = 400;

    // set CSS size
    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';

    // set backing pixel size for sharp rendering on hi-dpi displays
    canvas.width = Math.round(displayWidth * dpr);
    canvas.height = Math.round(displayHeight * dpr);

    // make drawing commands use CSS pixels
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    if (!baseImage) return;
    // drawing in CSS pixel coordinates (context is scaled by dpr)
    const dispW = canvas.width / (window.devicePixelRatio || 1);
    const dispH = canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0,0,dispW,dispH);
    ctx.drawImage(baseImage, 0, 0, dispW, dispH);
    // draw markers
    markers.forEach((m, i) => {
      const x = m.x * (dispW / baseImage.naturalWidth);
      const y = m.y * (dispH / baseImage.naturalHeight);
      ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI*2); ctx.fillStyle = 'rgba(242,159,61,0.95)'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '1.3rem sans-serif'; ctx.fillText(String(i+1), x-6, y+6);
    });
    renderMarkerList();
  }

  function renderMarkerList() {
    markerList.innerHTML = '';
    markers.forEach((m,i)=>{
      const div = document.createElement('div');
      div.className = 'marker-item';

      const info = document.createElement('span');
      info.className = 'marker-info';
      info.textContent = `${i+1}. x:${Math.round(m.x)}, y:${Math.round(m.y)}`;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'remove-btn';
      btn.setAttribute('aria-label', `Remove marker ${i+1}`);
      btn.textContent = 'Remove';
      btn.addEventListener('click', () => { markers.splice(i,1); draw(); });

      div.appendChild(info);
      div.appendChild(btn);
      markerList.appendChild(div);
    });
  }

  canvas.addEventListener('click', (ev) => {
    if (!baseImage) return;
    const rect = canvas.getBoundingClientRect();
    const cssX = (ev.clientX - rect.left);
    const cssY = (ev.clientY - rect.top);
    const dispW = canvas.width / (window.devicePixelRatio || 1);
    const dispH = canvas.height / (window.devicePixelRatio || 1);
    const cx = cssX * (baseImage.naturalWidth / dispW);
    const cy = cssY * (baseImage.naturalHeight / dispH);
    markers.push({ x: Math.round(cx), y: Math.round(cy) });
    draw();
  });

  exportBtn.addEventListener('click', () => {
    if (!baseImage) return;
    // create full-size canvas and draw markers at original resolution
    const out = document.createElement('canvas');
    out.width = baseImage.naturalWidth; out.height = baseImage.naturalHeight;
    const octx = out.getContext('2d');
    octx.drawImage(baseImage, 0, 0, out.width, out.height);
    markers.forEach((m,i)=>{
      octx.beginPath(); octx.arc(m.x, m.y, 12, 0, Math.PI*2); octx.fillStyle = 'rgba(220,38,38,0.95)'; octx.fill();
      octx.strokeStyle = '#fff'; octx.lineWidth = 4; octx.stroke();
      octx.fillStyle = '#fff'; octx.font = '28px sans-serif'; octx.fillText(String(i+1), m.x-8, m.y+10);
    });
    const a = document.createElement('a'); a.href = out.toDataURL('image/png'); a.download = 'map_with_markers.png'; a.click();
  });

  backBtn.addEventListener('click', ()=>{ window.location.href = '/map.html'; });
  clearBtn.addEventListener('click', ()=>{ markers.length = 0; draw(); });

  // start
  loadCropped();

})();
