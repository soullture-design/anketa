/* ==========================================================
   Форма заявки — «Лазерная Резка Металла»
   Валидация, маска телефона, загрузка файлов, отправка на send.php
   ========================================================== */
(function () {
  'use strict';

  // ---------- Настройки (должны совпадать с send.php) ----------
    var MAX_FILES = 5;
  var MAX_FILE_BYTES = 10 * 1024 * 1024;   // 10 МБ на файл
  var MAX_TOTAL_BYTES = 10 * 1024 * 1024;  // 10 МБ всего (лимит FormSubmit)
  var ALLOWED_EXT = ['dxf', 'dwg', 'pdf', 'step', 'stp', 'iges', 'igs', 'cdr', 'ai', 'svg',
                     'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx', 'zip', 'rar'];
  var PHONE_FALLBACK = '8 (3519) 45 45 68';

  // ---------- Элементы ----------
  var form = document.getElementById('orderForm');
  var submitBtn = document.getElementById('submitBtn');
  var formError = document.getElementById('formError');
  var success = document.getElementById('success');
  var againBtn = document.getElementById('againBtn');
  var phoneInput = document.getElementById('phone');
  var colorWrap = document.getElementById('colorWrap');
  var colorInput = document.getElementById('color');
  var drop = document.getElementById('drop');
  var fileInput = document.getElementById('fileInput');
  var pickBtn = document.getElementById('pickBtn');
  var fileList = document.getElementById('fileList');
  var progress = document.getElementById('progress');
  var progressBar = document.getElementById('progressBar');
  var progressTxt = document.getElementById('progressTxt');

  var files = [];          // выбранные файлы (File[])
  var sending = false;

  // ---------- Утилиты ----------
  function fieldEl(name) { return form.querySelector('[data-field="' + name + '"]'); }

  function setError(name, msg) {
    var f = fieldEl(name);
    if (!f) return;
    var p = f.querySelector('.err');
    if (msg) { f.classList.add('is-invalid'); if (p) p.textContent = msg; }
    else { f.classList.remove('is-invalid'); if (p) p.textContent = ''; }
  }
  function clearErrors() {
    Array.prototype.forEach.call(form.querySelectorAll('.field'), function (f) {
      f.classList.remove('is-invalid');
      var p = f.querySelector('.err'); if (p) p.textContent = '';
    });
    formError.hidden = true;
  }
  function getRadio(name) {
    var r = form.querySelector('input[name="' + name + '"]:checked');
    return r ? r.value : '';
  }
  function fmtSize(b) {
    if (b < 1024) return b + ' Б';
    if (b < 1048576) return (b / 1024).toFixed(0) + ' КБ';
    return (b / 1048576).toFixed(1).replace('.', ',') + ' МБ';
  }
  function extOf(name) {
    var i = name.lastIndexOf('.');
    return i < 0 ? '' : name.slice(i + 1).toLowerCase();
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- Маска телефона +7 (___) ___-__-__ ----------
  function formatPhone(raw) {
    var d = raw.replace(/\D/g, '');
    if (d[0] === '7' || d[0] === '8') d = d.slice(1);   // убираем код страны
    d = d.slice(0, 10);
    if (!d.length) return '';
    var out = '+7 (' + d.slice(0, 3);
    if (d.length >= 3) out += ')';
    if (d.length > 3) out += ' ' + d.slice(3, 6);
    if (d.length > 6) out += '-' + d.slice(6, 8);
    if (d.length > 8) out += '-' + d.slice(8, 10);
    return out;
  }
  phoneInput.addEventListener('input', function () {
    var atEnd = phoneInput.selectionStart === phoneInput.value.length;
    var isDelete = phoneInput._deleting;
    // при удалении «хвоста» из скобок/дефисов не даём маске вернуть символ
    if (isDelete && /[\s)(-]$/.test(phoneInput.value)) {
      phoneInput.value = phoneInput.value.replace(/\D+$/, '');
    }
    phoneInput.value = formatPhone(phoneInput.value);
    if (atEnd) phoneInput.setSelectionRange(phoneInput.value.length, phoneInput.value.length);
    setError('phone', '');
  });
  phoneInput.addEventListener('keydown', function (e) { phoneInput._deleting = (e.key === 'Backspace' || e.key === 'Delete'); });
  phoneInput.addEventListener('focus', function () { if (!phoneInput.value) phoneInput.value = '+7 ('; });
  phoneInput.addEventListener('blur', function () { if (phoneInput.value === '+7 (') phoneInput.value = ''; });

  // ---------- Покраска: показать/скрыть поле «цвет» ----------
  function syncPaint() {
    var on = getRadio('paint') === 'Да';
    colorWrap.classList.toggle('open', on);
    colorWrap.setAttribute('aria-hidden', on ? 'false' : 'true');
    colorInput.disabled = !on;            // отключённое поле не уходит в FormData
    if (!on) { colorInput.value = ''; setError('color', ''); }
  }
  Array.prototype.forEach.call(form.querySelectorAll('input[name="paint"]'), function (r) {
    r.addEventListener('change', syncPaint);
  });
  syncPaint();

  // ---------- Файлы ----------
  function renderFiles() {
    fileList.innerHTML = '';
    files.forEach(function (f, i) {
      var li = document.createElement('li');
      li.innerHTML =
        '<svg><use href="#i-file"/></svg>' +
        '<span class="f-name" title="' + esc(f.name) + '">' + esc(f.name) + '</span>' +
        '<span class="f-size">' + fmtSize(f.size) + '</span>' +
        '<button type="button" aria-label="Удалить файл ' + esc(f.name) + '" data-i="' + i + '">&times;</button>';
      fileList.appendChild(li);
    });
  }

  function addFiles(list) {
    var errors = [];
    Array.prototype.forEach.call(list, function (f) {
      var ext = extOf(f.name);
      if (ALLOWED_EXT.indexOf(ext) === -1) { errors.push('«' + f.name + '»: формат не поддерживается'); return; }
      if (f.size > MAX_FILE_BYTES) { errors.push('«' + f.name + '»: файл слишком большой (максимум 10 МБ)'); return; }
      if (f.size === 0) { errors.push('«' + f.name + '»: файл пустой'); return; }
      if (files.some(function (x) { return x.name === f.name && x.size === f.size; })) return; // дубликат
      if (files.length >= MAX_FILES) { errors.push('Можно прикрепить не более ' + MAX_FILES + ' файлов'); return; }
      var total = files.reduce(function (s, x) { return s + x.size; }, 0) + f.size;
      if (total > MAX_TOTAL_BYTES) { errors.push('«' + f.name + '»: общий размер файлов больше 10 МБ'); return; }
      files.push(f);
    });
    renderFiles();
    // показываем уникальные ошибки
    var uniq = errors.filter(function (e, i) { return errors.indexOf(e) === i; });
    setError('files', uniq.join('. '));
  }

  pickBtn.addEventListener('click', function (e) { e.stopPropagation(); fileInput.click(); });
  drop.addEventListener('click', function () { fileInput.click(); });
  drop.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', function () {
    setError('files', '');
    addFiles(fileInput.files);
    fileInput.value = '';                 // чтобы можно было выбрать тот же файл снова
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-drag'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-drag'); });
  });
  drop.addEventListener('drop', function (e) {
    setError('files', '');
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });
  fileList.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-i]');
    if (!b) return;
    files.splice(parseInt(b.getAttribute('data-i'), 10), 1);
    renderFiles();
    setError('files', '');
  });

  // ---------- Сброс ошибок при вводе ----------
  form.addEventListener('input', function (e) {
    var f = e.target.closest('.field');
    if (f && f.dataset.field !== 'files') setError(f.dataset.field, '');
  });
  form.addEventListener('change', function (e) {
    var f = e.target.closest('.field');
    if (f && f.dataset.field !== 'files') setError(f.dataset.field, '');
  });

  // ---------- Валидация ----------
  function validate() {
    var ok = true, first = null;
    function bad(name, msg) { setError(name, msg); ok = false; if (!first) first = fieldEl(name); }

    var name = form.elements['name'].value.trim();
    if (name.length < 2) bad('name', 'Укажите имя или название организации');

    if (!getRadio('thickness')) bad('thickness', 'Выберите толщину металла');
    if (!getRadio('metal')) bad('metal', 'Выберите, чей металл');

    var qty = form.qty.value.trim();
    if (!/^\d+$/.test(qty) || parseInt(qty, 10) < 1) bad('qty', 'Укажите количество — целое число от 1');
    else if (parseInt(qty, 10) > 100000) bad('qty', 'Слишком большое количество');

    if (getRadio('paint') === 'Да' && colorInput.value.trim().length < 2) {
      bad('color', 'Укажите цвет покраски (RAL или описание)');
    }

    if (phoneInput.value.replace(/\D/g, '').length !== 11) bad('phone', 'Введите телефон полностью: +7 (XXX) XXX-XX-XX');

    if (!form.consent.checked) bad('consent', 'Необходимо согласие на обработку данных');

    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return ok;
  }

  // ---------- Отправка (через FormSubmit.co, обычная multipart-форма) ----------
  var LABELS = {
    name: 'Имя / организация', thickness: 'Толщина металла', metal: 'Металл',
    qty: 'Количество (шт.)', bend: 'Гибка', weld: 'Сварка', paint: 'Покраска',
    color: 'Цвет покраски', phone: 'Контактный телефон'
  };

  function showFormError(msg) {
    formError.innerHTML = esc(msg) + ' Вы можете позвонить нам: <a href="tel:+73519454568">' + PHONE_FALLBACK + '</a>';
    formError.hidden = false;
    formError.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function addHidden(container, name, value) {
    var i = document.createElement('input');
    i.type = 'hidden'; i.name = name; i.value = value;
    container.appendChild(i);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (sending) return;
    clearErrors();
    if (!validate()) return;
    sending = true;

    // 1. Страница, на которую FormSubmit вернёт клиента после отправки
    document.getElementById('nextUrl').value = location.origin + location.pathname + '?sent=1';

    // 2. Читаемые названия полей для письма
    var payload = document.createElement('div');
    payload.hidden = true;
    var order = ['name', 'thickness', 'metal', 'qty', 'bend', 'weld', 'paint', 'color', 'phone'];
    order.forEach(function (k) {
      var v = (k === 'thickness' || k === 'metal' || k === 'bend' || k === 'weld' || k === 'paint')
        ? getRadio(k) : (form.elements[k] ? form.elements[k].value.trim() : '');
      if (k === 'color' && getRadio('paint') !== 'Да') return;
      if (k === 'phone') v = phoneInput.value;
      addHidden(payload, LABELS[k], v);
    });
    addHidden(payload, 'Дата отправки', new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' }) + ' (Екатеринбург)');
    form.insertBefore(payload, form.firstChild);

    // 3. Исходные поля отключаем, чтобы не дублировались в письме
    Array.prototype.forEach.call(form.querySelectorAll('input[name="name"],input[name="thickness"],input[name="metal"],input[name="qty"],input[name="bend"],input[name="weld"],input[name="paint"],input[name="color"],input[name="phone"],input[name="consent"]'),
      function (el) { el.disabled = true; });

    // 4. Файлы кладём в скрытые file-поля
    var slots = form.querySelectorAll('#attachSlots input[type=file]');
    files.forEach(function (f, i) {
      if (!slots[i]) return;
      var dt = new DataTransfer();
      dt.items.add(f);
      slots[i].files = dt.files;
    });
    Array.prototype.forEach.call(slots, function (sl) { if (!sl.files.length) sl.disabled = true; });

    submitBtn.disabled = true;
    submitBtn.firstElementChild.textContent = 'Отправляем…';
    if (files.length) { progressTxt.textContent = 'Загружаем файлы, не закрывайте страницу…'; progress.hidden = false; progressBar.style.width = '100%'; }

    form.submit();   // программная отправка не вызывает обработчик submit повторно
  });

  // Если страница уже была отправлена и FormSubmit вернул клиента — показываем «Заявка отправлена»
  if (/[?&]sent=1/.test(location.search)) {
    form.hidden = true;
    success.hidden = false;
  }

  // ---------- Новая заявка ----------
  againBtn.addEventListener('click', function () {
    form.reset();
    files = [];
    renderFiles();
    clearErrors();
    syncPaint();
    success.hidden = true;
    form.hidden = false;
    if (history.replaceState) history.replaceState(null, '', location.pathname);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();
