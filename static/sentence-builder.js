/**
 * DOM-based Sentence Builder
 * Renders a palette of words and a row of slots. Drag a palette item into a slot to place it.
 * Uses `window.wordsToUse` if present; otherwise falls back to sample words.
 */
(function(){
  const container = document.getElementById('sentence-container');
  if (!container) return;

  // Sentence Builder styles moved to `static/makemap.css`.
  // Ensure `make_map.html` includes that stylesheet so these classes are available.

  // helper to get words
  function getWordsToUse(){
    try{ if (window.wordsToUse && Array.isArray(window.wordsToUse) && window.wordsToUse.length>0) return window.wordsToUse.slice(); }catch(e){}
    // prefer canonical shared WordLists if present
    try{
      if (window.WordLists && typeof window.WordLists === 'object'){
        const parts = [];
        // iterate lists in insertion order (direction, navigation, building expected)
        Object.keys(window.WordLists).forEach(k => {
          const list = window.WordLists[k];
          if (!Array.isArray(list)) return;
          list.forEach(item => {
            if (!item) return;
            if (typeof item === 'string') parts.push(item);
            else if (typeof item === 'object' && 'word' in item) parts.push(String(item.word));
          });
        });
        // dedupe while preserving order
        const seen = new Set();
        const out = [];
        for (const w of parts){
          const t = (w||'').trim();
          if (!t) continue;
          if (!seen.has(t)) { seen.add(t); out.push(t); }
        }
        seen.add('at', 'in', 'the', 'a');
        out.push('at','in','the','a');
        if (out.length) return out;
      }
    }catch(e){}
    return null;
  }

  // build UI
  container.innerHTML = '';
  const title = document.createElement('div'); title.className='sb-title'; title.textContent='Explain the route. How can we get there?'; container.appendChild(title);
  const instr = document.createElement('div'); instr.className='sb-instructions'; instr.textContent='Drag words into the blanks to create sentences.'; container.appendChild(instr);

  const paletteWrap = document.createElement('div'); paletteWrap.className='sb-palette'; container.appendChild(paletteWrap);
  const sentenceLabel = document.createElement('div'); sentenceLabel.className='sb-subtitle'; container.appendChild(sentenceLabel);
  const sentenceWrap = document.createElement('div'); sentenceWrap.className='sb-sentence'; container.appendChild(sentenceWrap);
  const controls = document.createElement('div'); controls.className='sb-controls'; container.appendChild(controls);
  const resetBtn = document.createElement('button'); resetBtn.className='sb-reset'; resetBtn.textContent='Reset'; controls.appendChild(resetBtn);

  let words = getWordsToUse();
  if (!words) words = ['doing','am','are','now','you'];
  const ROWS = 7;
  const COLS = 5;

  // state: 2D slots array [row][col] (null or text)
  const slots = Array.from({length: ROWS}, ()=> Array.from({length: COLS}, ()=> null));

  // render palette (palette items are static copies)
  function renderPalette(){
    paletteWrap.innerHTML = '';
    words.forEach(w => {
      const el = document.createElement('div');
      el.className = 'sb-word';
      el.textContent = w;
      el.draggable = false;
      el.addEventListener('pointerdown', (ev)=> startDrag(ev, {text:w, from:'palette'}));
      paletteWrap.appendChild(el);
    });
  }

  function renderSlots(){
    sentenceWrap.innerHTML = '';
    for (let r=0;r<ROWS;r++){
      const rowEl = document.createElement('div');
      rowEl.className = 'sb-row';
      for (let c=0;c<COLS;c++){
        const slotEl = document.createElement('div');
        slotEl.className = 'sb-slot';
        slotEl.dataset.row = r;
        slotEl.dataset.col = c;
        if (slots[r][c] !== null){
          slotEl.classList.add('filled');
          slotEl.textContent = slots[r][c];
          // size the slot to fit the word
          adjustSlotSize(slotEl, slots[r][c]);
          // allow dragging from filled slot
          slotEl.addEventListener('pointerdown', (ev)=> startDrag(ev, {text: slots[r][c], from:'slot', row:r, col:c}));
        } else {
          slotEl.textContent = '';
          slotEl.style.width = '80px';
        }
        rowEl.appendChild(slotEl);
      }
      // append period at end of row
      const p = document.createElement('div'); p.style.fontSize='1.2rem'; p.textContent='.';
      rowEl.appendChild(p);
      sentenceWrap.appendChild(rowEl);
    }
  }

  // drag logic
  let dragEl = null;
  let dragData = null;

  function startDrag(ev, data){
    ev.preventDefault();
    dragData = data; // {text, from, slotIndex?}
    dragEl = document.createElement('div');
    dragEl.className = 'sb-word dragging';
    dragEl.style.position = 'absolute';
    dragEl.style.pointerEvents = 'none';
    dragEl.textContent = data.text;
    document.body.appendChild(dragEl);
    moveDragEl(ev.clientX, ev.clientY);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  // adjust slot width to fit the word text (measured in same font)
  function adjustSlotSize(slotEl, text){
    try{
      const span = document.createElement('span');
      span.style.position = 'absolute';
      span.style.visibility = 'hidden';
      span.style.whiteSpace = 'nowrap';
      // inherit font styles from slot
      const s = getComputedStyle(slotEl);
      span.style.font = s.font;
      span.textContent = text;
      document.body.appendChild(span);
      const measured = span.getBoundingClientRect().width;
      document.body.removeChild(span);
      const padding = 20; // left+right padding approx
      const minW = 40;
      const maxW = 500;
      const w = Math.min(maxW, Math.max(minW, Math.ceil(measured + padding)));
      slotEl.style.width = w + 'px';
    }catch(e){ /* ignore measurement errors */ }
  }

  function moveDragEl(cx, cy){
    dragEl.style.left = (cx + 8) + 'px';
    dragEl.style.top = (cy + 8) + 'px';
  }

  function onPointerMove(ev){ if (dragEl) moveDragEl(ev.clientX, ev.clientY); }

  function onPointerUp(ev){
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    if (!dragData) { cleanupDrag(); return; }

    // find slot under pointer (use row/col data attributes)
    const rects = Array.from(sentenceWrap.querySelectorAll('.sb-slot')).map(el=>({el, rect:el.getBoundingClientRect()}));
    let placed = false;
    for (const r of rects){
      if (ev.clientX > r.rect.left && ev.clientX < r.rect.right && ev.clientY > r.rect.top && ev.clientY < r.rect.bottom){
        const row = parseInt(r.el.dataset.row,10);
        const col = parseInt(r.el.dataset.col,10);
        if (!Number.isNaN(row) && !Number.isNaN(col)){
          slots[row][col] = dragData.text;
          placed = true;
          break;
        }
      }
    }

    // if not placed and drag originated from a slot, restore original slot
    if (!placed && dragData.from === 'slot'){
      if (typeof dragData.row === 'number' && typeof dragData.col === 'number') slots[dragData.row][dragData.col] = dragData.text;
    }

    renderSlots();
    cleanupDrag();
  }

  function cleanupDrag(){ if (dragEl && dragEl.parentNode) dragEl.parentNode.removeChild(dragEl); dragEl = null; dragData = null; }

  resetBtn.addEventListener('click', ()=>{
    // reset slots and re-render
    for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) slots[r][c]=null;
    renderSlots();
  });

  // initial render
  renderPalette();
  renderSlots();

  // expose some helpers for debugging
  window.SentenceBuilder = { renderSlots, renderPalette };

})();
