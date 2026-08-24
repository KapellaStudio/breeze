/* Progressive enhancement only. The page remains fully visible and usable if a mobile file preview blocks JavaScript. */
document.querySelectorAll('.swatch').forEach(btn => btn.addEventListener('click', () => {
  document.documentElement.dataset.accent = btn.dataset.accent;
  document.querySelectorAll('.swatch').forEach(x => x.setAttribute('aria-pressed', String(x===btn)));
}));
function go(q) {
  q=String(q||'').trim(); if(!q) return;
  let u=/^[a-z]+:\/\//i.test(q)?q:/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(q)?'https://'+q:'https://search.brave.com/search?q='+encodeURIComponent(q);
  window.open(u,'_blank','noopener');
}
document.getElementById('searchForm')?.addEventListener('submit',e=>{e.preventDefault();go(e.currentTarget.querySelector('input').value)});
document.getElementById('omni')?.addEventListener('keydown',e=>{if(e.key==='Enter')go(e.currentTarget.value)});
