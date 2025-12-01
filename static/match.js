(function(){
// match.js — extracted from match.html
// Word class and image-enabled word list

class Word {
  constructor(word, imgSrc = null) {
    this.word = word;
    this.img = null;
    if (imgSrc) {
      this.img = new Image();
      this.img.src = imgSrc;
    }
  }
}

// Sample data: put your images under /static/images/ and update paths as needed
// Prefer shared `window.WordLists` (plain objects) if provided; otherwise fall back
function makeWordList(arr){
  if (!arr) return [];
  return arr.map(o => new Word(o.word, o.img));
}

const wordListDirection = (window.WordLists && window.WordLists.direction)
  ? makeWordList(window.WordLists.direction)
  : [
      new Word('right', '/static/images/right.png'),
      new Word('left', '/static/images/left.png'),
      new Word('forward', '/static/images/forward.png')
    ];

const wordListNavigation = (window.WordLists && window.WordLists.navigation)
  ? makeWordList(window.WordLists.navigation)
  : [
      new Word('go', '/static/images/go.png'),
      new Word('turn', '/static/images/turn.png')
    ];

const wordListBuilding = (window.WordLists && window.WordLists.building)
  ? makeWordList(window.WordLists.building)
  : [
      new Word('school', '/static/images/school.png'),
      new Word('theater', '/static/images/theater.png'),
      new Word('river', '/static/images/river.png'),
      new Word('park', '/static/images/park.png'),
      new Word('airport', '/static/images/airport.png'),
      new Word('bridge', '/static/images/bridge.png'),
      new Word('post office', '/static/images/post_office.png'),
      new Word('trail', '/static/images/trail.png')
    ];

// rounds configuration: sequence of word lists and labels
const rounds = [
  { id: 'direction', title: 'Direction', list: wordListDirection },
  { id: 'navigation', title: 'Navigation', list: wordListNavigation },
  { id: 'building', title: 'Buildings', list: wordListBuilding }
];

let currentRound = 0;
let starsPerRound = new Array(rounds.length).fill(0); // 0-3 stars per round
// student name is provided on intro.html and stored under 'mapmap_username'
let studentName = localStorage.getItem('mapmap_username') || 'Student';

// UI elements for header/navigation will be created dynamically
function createHeader() {
  const container = document.querySelector('.match-container') || document.body;
  // avoid creating twice
  if (document.getElementById('matchHeader')) return;

  const header = document.createElement('div');
  header.id = 'matchHeader';
  header.className = 'match-header';

  const left = document.createElement('div');
  left.className = 'match-header-left';
  const nameEl = document.createElement('div');
  nameEl.id = 'studentName';
  nameEl.className = 'student-name';
  nameEl.textContent = studentName;
  const starsEl = document.createElement('div');
  starsEl.id = 'roundStars';
  starsEl.className = 'round-stars';
  left.appendChild(nameEl);
  left.appendChild(starsEl);

  const right = document.createElement('div');
  right.className = 'match-header-right';
  const prevBtn = document.createElement('button');
  prevBtn.id = 'prevRound'; prevBtn.className = 'round-btn'; prevBtn.textContent = '◀';
  const roundLabel = document.createElement('span');
  roundLabel.id = 'roundLabel'; roundLabel.className = 'round-label';
  const nextBtn = document.createElement('button');
  nextBtn.id = 'nextRound'; nextBtn.className = 'round-btn'; nextBtn.textContent = '▶';
  right.appendChild(prevBtn); right.appendChild(roundLabel); right.appendChild(nextBtn);

  header.appendChild(left);
  header.appendChild(right);

  container.insertBefore(header, container.firstChild);

  prevBtn.addEventListener('click', ()=>changeRound(currentRound-1));
  nextBtn.addEventListener('click', ()=>changeRound(currentRound+1));
  // allow editing student name on click
  nameEl.addEventListener('click', ()=>{
    const v = prompt('Student name:', studentName);
    if (v!==null) {
      studentName = v.trim()||'Student';
      // persist to the same key used by intro.html
      try { localStorage.setItem('mapmap_username', studentName); } catch(e) {}
      renderHeader();
    }
  });
}

function renderHeader() {
  createHeader();
  const starsEl = document.getElementById('roundStars');
  starsEl.innerHTML = '';
  // show one small star per round (filled according to starsPerRound)
  rounds.forEach((r, idx)=>{
    const starWrap = document.createElement('span');
    starWrap.className = 'round-star-wrap';
    const s = document.createElement('span');
    s.className = 'round-star';
    const filled = starsPerRound[idx];
    // show up to 3 small stars per round as compact indicator
    const totalSmall = 3;
    for (let k=0;k<totalSmall;k++){
      const sub = document.createElement('span');
      sub.className = 'star-sub ' + (k < filled ? 'filled':'');
      sub.textContent = '★';
      starWrap.appendChild(sub);
    }
    // label clickable to jump to round
    const lbl = document.createElement('button');
    lbl.className = 'round-jump'; lbl.textContent = r.title;
    lbl.addEventListener('click', ()=>changeRound(idx));
    starWrap.appendChild(lbl);
    starsEl.appendChild(starWrap);
  });

  const label = document.getElementById('roundLabel');
  if (label) label.textContent = rounds[currentRound].title;
}

function changeRound(idx){
  if (idx < 0 || idx >= rounds.length) return;
  currentRound = idx;
  // reset connections and UI for new round
  clearConnections();
  initMatch(rounds[currentRound].list);
  renderHeader();
}



const leftCol = document.getElementById('leftCol');
const rightCol = document.getElementById('rightCol');
const canvas = document.getElementById('linesCanvas');
const clearBtn = document.getElementById('clearBtn');
const checkBtn = document.getElementById('checkBtn');
const mapBtn = document.getElementById('mapBtn');
const tryOverlay = document.getElementById('tryOverlay');
const scoreText = document.getElementById('scoreText');
const tryOk = document.getElementById('tryOk');

let leftItems = [];
let rightItems = [];
let rightImages = []; // Image objects aligned to rightItems
let rightOrig = []; // original index for each right position
let connections = []; // pairs [leftIndex,rightIndex]
let connCorrect = [];
let selected = -1; // index
let isLeftSelected = false;
let correctAll = false;

// currentWords holds the active word list; initMatch can accept a different list
let currentWords = wordListNavigation;

function initMatch(words = null) {
  // allow caller to pass a word list; otherwise use currentWords (default)
  if (words) currentWords = words;
  const list = currentWords || [];

  leftItems = list.map(w => w.word);
  // shuffle indices for right column
  const idx = list.map((_, i) => i);
  for (let i = idx.length -1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i+1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  rightItems = idx.map(i => list[i].word);
  rightOrig = idx.slice();

  // rightImages aligned with rightItems (may be null)
  rightImages = idx.map(i => list[i].img || null);

  renderItems();
  fitCanvas();
  drawLines();

  // If images are still loading, update layout when they finish loading
  rightImages.forEach(img => {
    if (img && !img.complete) {
      img.addEventListener('load', () => {
        renderItems();
        fitCanvas();
        drawLines();
      });
    }
  });
}

// convenience helper to start a match with a specific list
function startMatch(words) { initMatch(words); }

function renderItems() {
  leftCol.innerHTML = '';
  rightCol.innerHTML = '';
  leftItems.forEach((txt, i) => {
    const d = document.createElement('div');
    d.className = 'item';
    d.dataset.index = i;
    d.textContent = txt;
    d.addEventListener('click', () => onLeftClick(i));
    leftCol.appendChild(d);
  });
  rightItems.forEach((txt, i) => {
    const d = document.createElement('div');
    d.className = 'item';
    d.dataset.index = i;
    // if image available, show it; otherwise show text
    const img = rightImages[i];
    if (img) {
      const imgEl = document.createElement('img');
      imgEl.className = 'thumb';
      imgEl.src = img.src;
      imgEl.alt = txt;
      d.appendChild(imgEl);
    } else {
      d.textContent = txt;
    }
    d.addEventListener('click', () => onRightClick(i));
    rightCol.appendChild(d);
  });
  // after DOM updated, ensure fonts fit
  adjustFontSizes();
}

// Reduce font-size for left column items so the text fits the available width.
function adjustFontSizes() {
  // compute base px value for 1.7rem
  const rootRem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const basePx = 1.7 * rootRem;
  const items = document.querySelectorAll('.col.left .item');
  items.forEach(el => {
    // reset to base size then shrink if needed
    el.style.fontSize = basePx + 'px';
    // allow some padding space
    const available = el.clientWidth - 8;
    // if content overflows, iteratively reduce font size
    let fs = basePx;
    // guard: stop at 10px minimum
    while (el.scrollWidth > el.clientWidth && fs > 10) {
      fs = Math.max(10, Math.floor(fs * 0.92));
      el.style.fontSize = fs + 'px';
    }
  });
}

function onLeftClick(i) {
  if (isLeftSelected && selected === i) { // deselect
    selected = -1; isLeftSelected = false; updateSelection(); return;
  }
  if (!isLeftSelected && selected >= 0) {
    // previously selected right, now connect that right to this left
    connections.push(i, selected);
    selected = -1; isLeftSelected = false;
    connCorrect = []; correctAll = false; updateSelection(); drawLines(); return;
  }
  // select left
  selected = i; isLeftSelected = true; updateSelection();
}
function onRightClick(i) {
  if (!isLeftSelected && selected === i) { selected = -1; isLeftSelected = false; updateSelection(); return; }
  if (isLeftSelected && selected >= 0) {
    // connect selected left to this right
    connections.push(selected, i);
    selected = -1; isLeftSelected = false;
    connCorrect = []; correctAll = false; updateSelection(); drawLines(); return;
  }
  // select right
  selected = i; isLeftSelected = false; updateSelection();
}

function updateSelection() {
  document.querySelectorAll('.col.left .item').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('.col.right .item').forEach(el => el.classList.remove('selected'));
  if (selected >=0) {
    if (isLeftSelected) {
      const el = document.querySelector('.col.left .item[data-index="'+selected+'"]'); if (el) el.classList.add('selected');
    } else {
      const el = document.querySelector('.col.right .item[data-index="'+selected+'"]'); if (el) el.classList.add('selected');
    }
  }
}

function fitCanvas() {
  const area = document.getElementById('matchArea');

  // ensure the container is the positioning context for the canvas
  if (getComputedStyle(area).position === 'static') {
    area.style.position = 'relative';
  }

  // place canvas absolutely inside the area at (0,0)
  canvas.style.position = 'absolute';
  canvas.style.left = '0px';
  canvas.style.top = '0px';

  // use the area's layout size and handle devicePixelRatio for crisp lines
  const rect = area.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;

  // CSS size
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';

  // backing store size (in device pixels)
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);

  // scale drawing operations so coordinates remain in CSS pixels
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
function getItemCenter(col, idx) {
  const colEl = document.querySelector('.col.'+col);
  const item = colEl.querySelector('.item[data-index="'+idx+'"]');
  if (!item) return null;
  const areaRect = document.getElementById('matchArea').getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  // coordinates relative to matchArea
  return {
    x: itemRect.left + itemRect.width/2 - areaRect.left,
    y: itemRect.top + itemRect.height/2 - areaRect.top
  };
}

function drawLines() {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // determine device pixel ratio / canvas scale so we can pick lineWidth in device pixels
  const ratio = window.devicePixelRatio || 1;
  const devicePx = 4; // uniform visible thickness in device pixels for all lines
  let pairIdx = 0;
  for (let i=0; i<connections.length; i+=2) {
    const l = connections[i];
    const r = connections[i+1];
    const p1 = getItemCenter('left', l);
    const p2 = getItemCenter('right', r);
    if (!p1 || !p2) continue;
    // color
    if (connCorrect.length > pairIdx) {
      ctx.strokeStyle = connCorrect[pairIdx] ? '#0F6F3C' : '#C9502D';
    } else {
      ctx.strokeStyle = '#979DD2';
    }
    ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    pairIdx++;
  }
}

function clearConnections() {
  connections = []; connCorrect = []; correctAll = false; drawLines();
  if (mapBtn) mapBtn.style.display = 'none';
}

function checkConnections() {
  connCorrect = []; 
  let lastCorrect = 0;
  for (let i=0; i<connections.length; i+=2) {
    const l = connections[i]; const r = connections[i+1];
    let correct = false;
    if (r >=0 && r < rightOrig.length) {
      correct = (l === rightOrig[r]);
    }
    connCorrect.push(correct);
    if (correct) lastCorrect++;
  }
  drawLines();
  const total = currentWords.length;
  // update stars for this round (scale to 0..3)
  if (total > 0){
    const scaled = Math.round((lastCorrect/total) * 3);
    starsPerRound[currentRound] = Math.max(starsPerRound[currentRound], scaled);
  }

  if (total>0 && lastCorrect < total) {
    // show try again
    scoreText.textContent = lastCorrect + ' / ' + total + ' correct';
    tryOverlay.style.display = 'flex';
  } else {
    // success
    correctAll = true;
    if (mapBtn && currentRound == 2) mapBtn.style.display = 'inline-block';
    alert('All correct! You can go to the map.');
  }
  // update header stars after checking
  renderHeader();
}

window.addEventListener('resize', ()=>{ fitCanvas(); drawLines(); });

clearBtn.addEventListener('click', ()=>{ clearConnections(); });
checkBtn.addEventListener('click', ()=>{ checkConnections(); });
tryOk.addEventListener('click', ()=>{ tryOverlay.style.display='none'; });
mapBtn.addEventListener('click', ()=>{
  if (correctAll) window.location.href = '/map.html'; else checkConnections();
});

// initialize
createHeader();
initMatch(rounds[currentRound].list);
if (mapBtn) mapBtn.style.display = 'none';
// small timeout to ensure layout done
setTimeout(()=>{ fitCanvas(); drawLines(); renderHeader(); }, 50);

})();
