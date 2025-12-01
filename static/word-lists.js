// Shared word lists for Match and Sentence Builder
// Each entry is a plain object { word: 'text', img: '/static/images/...' }
// This file exposes `window.WordLists` so other scripts can consume the same data.
(function(){
  if (window.WordLists) return; // don't overwrite if already defined
  window.WordLists = {
    direction: [
      { word: 'right', img: '/static/images/right.png' },
      { word: 'left', img: '/static/images/left.png' },
      { word: 'forward', img: '/static/images/forward.png' }
    ],
    navigation: [
      { word: 'go', img: '/static/images/go.png' },
      { word: 'turn', img: '/static/images/turn.png' }
    ],
    building: [
      { word: 'school', img: '/static/images/school.png' },
      { word: 'theater', img: '/static/images/theater.png' },
      { word: 'river', img: '/static/images/river.png' },
      { word: 'park', img: '/static/images/park.png' },
      { word: 'airport', img: '/static/images/airport.png' },
      { word: 'bridge', img: '/static/images/bridge.png' },
      { word: 'post office', img: '/static/images/post_office.png' },
      { word: 'trail', img: '/static/images/trail.png' }
    ]
  };
})();
