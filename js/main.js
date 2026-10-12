(function(){
  'use strict';
  var d = document;
  // Мобильное меню
  var b = d.querySelector('.burger'), nav = d.getElementById('nav');
  if (b && nav) {
    b.addEventListener('click', function(){
      var o = nav.classList.toggle('open');
      b.setAttribute('aria-expanded', o); b.setAttribute('aria-label', o ? 'Закрыть меню' : 'Открыть меню');
    });
    nav.addEventListener('click', function(e){ if (e.target.tagName === 'A') { nav.classList.remove('open'); b.setAttribute('aria-expanded','false'); } });
    d.addEventListener('keydown', function(e){ if (e.key === 'Escape' && nav.classList.contains('open')) { nav.classList.remove('open'); b.setAttribute('aria-expanded','false'); b.focus(); } });
  }
  // Фильтр каталога
  var chips = d.querySelectorAll('.chip'), cards = d.querySelectorAll('.card');
  chips.forEach(function(c){
    c.addEventListener('click', function(){
      var f = c.dataset.f;
      chips.forEach(function(x){ var on = x === c; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', on); });
      cards.forEach(function(k){ k.hidden = !(f === 'all' || k.dataset.g === f); k.classList.add('in'); });
    });
  });
  // Окно с подробностями (<dialog>)
  var dlg = d.getElementById('dlg'), body = d.getElementById('dlg-body'), last = null;
  d.addEventListener('click', function(e){
    var t = e.target.closest('[data-dialog]');
    if (t && dlg && typeof dlg.showModal === 'function') {
      var tpl = d.getElementById(t.dataset.dialog); if (!tpl) return;
      body.innerHTML = ''; body.appendChild(tpl.content.cloneNode(true));
      var h = body.querySelector('h3'); if (h) h.id = 'dlg-title';
      last = t; dlg.showModal();
    } else if (e.target === dlg) { dlg.close(); }
  });
  if (dlg) dlg.addEventListener('close', function(){ if (last) last.focus(); });
  // Просмотр фото в галерее
  var lb = d.getElementById('lb');
  if (lb) {
    var shots = [].slice.call(d.querySelectorAll('[data-lb]')), cur = 0, lbImg = lb.querySelector('img'), cnt = lb.querySelector('.lb__n');
    var show = function(i){ cur = (i + shots.length) % shots.length; lbImg.src = shots[cur].dataset.lb; lbImg.alt = shots[cur].dataset.alt || ''; cnt.textContent = (cur+1) + ' / ' + shots.length; };
    shots.forEach(function(b,i){ b.addEventListener('click', function(){ show(i); lb.showModal(); }); });
    lb.querySelector('.lb__prev').addEventListener('click', function(){ show(cur-1); });
    lb.querySelector('.lb__next').addEventListener('click', function(){ show(cur+1); });
    lb.querySelector('.lb__x').addEventListener('click', function(){ lb.close(); });
    lb.addEventListener('click', function(e){ if (e.target === lb) lb.close(); });
    d.addEventListener('keydown', function(e){ if (!lb.open) return; if (e.key === 'ArrowLeft') show(cur-1); if (e.key === 'ArrowRight') show(cur+1); });
  }
  // Плавное появление блоков
  var els = d.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function(es){ es.forEach(function(x){ if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }); }, {rootMargin:'0px 0px -8% 0px'});
    els.forEach(function(el){ io.observe(el); });
  } else { els.forEach(function(el){ el.classList.add('in'); }); }
})();
