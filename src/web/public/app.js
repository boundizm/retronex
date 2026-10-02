'use strict';

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.includes('-') || k === 'role') node.setAttribute(k, v);
    else node[k] = v;
  }
  for (const c of children.flat()) node.append(c);
  return node;
};

let state = { groups: [], samples: {}, current: null, query: '' };

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'retronex-panel' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login') { showLogin(); throw new Error('Oturum süresi doldu.'); }
  if (!res.ok) throw new Error(data.error || `Hata (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show${bad ? ' bad' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3500);
}

// ---- Discord benzeri önizleme (önce HTML'den kaçır, sonra biçimlendir) ----
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function renderPreview(text, samples) {
  const filled = text.replace(/\{(\w+)\}/g, (m, k) => (k in samples ? samples[k] : m));
  return escapeHtml(filled)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\|\|([^|]+)\|\|/g, '<span class="spoiler">$1</span>')
    .replace(/&lt;@&amp;(\d+)&gt;/g, '<span class="mention">@rol</span>')
    .replace(/&lt;@(\d+)&gt;/g, '<span class="mention">@kullanıcı</span>')
    .replace(/&lt;#(\d+)&gt;/g, '<span class="mention">#kanal</span>');
}

// ---- Giriş ----
function showLogin() { $('#app').hidden = true; $('#login').hidden = false; $('#password').focus(); }
function showApp() { $('#login').hidden = true; $('#app').hidden = false; }

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    await api('POST', '/api/login', { password: $('#password').value });
    $('#password').value = '';
    await load();
  } catch (err) { $('#login-error').textContent = err.message; }
});

$('#logout').addEventListener('click', async () => { await api('POST', '/api/logout').catch(() => {}); showLogin(); });

$('#refresh-panel').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const r = await api('POST', '/api/actions/ticket-panel');
    toast(r.result === 'sent' ? 'Bilet paneli Discord\'a gönderildi.' : 'Bilet paneli Discord\'da güncellendi.');
  } catch (err) { toast(err.message, true); }
  e.target.disabled = false;
});

$('#search').addEventListener('input', (e) => { state.query = e.target.value.trim().toLowerCase(); render(); });

// ---- Veri ----
async function load() {
  const data = await api('GET', '/api/texts');
  state.groups = data.groups;
  state.samples = data.samples;
  if (!state.groups.some((g) => g.name === state.current)) state.current = state.groups[0]?.name;
  showApp();
  render();
}

function renderNav() {
  const nav = $('#groups');
  nav.replaceChildren(...state.groups.map((g) => {
    const custom = g.items.filter((i) => i.custom).length;
    return el('button', {
      type: 'button',
      onclick: () => { state.current = g.name; state.query = ''; $('#search').value = ''; render(); },
    }, el('span', { textContent: g.name }), el('span', { className: 'count', textContent: custom ? `${custom} ✎` : '' }));
  }));
  nav.querySelectorAll('button').forEach((b, idx) => {
    if (state.groups[idx].name === state.current && !state.query) b.setAttribute('aria-current', 'true');
  });
}

function render() {
  renderNav();
  const content = $('#content');
  let items;
  let title;
  if (state.query) {
    items = state.groups.flatMap((g) => g.items).filter((i) =>
      [i.key, i.label, i.value, i.default].some((s) => s.toLowerCase().includes(state.query)));
    title = `Arama: “${state.query}” (${items.length})`;
  } else {
    items = state.groups.find((g) => g.name === state.current)?.items ?? [];
    title = state.current;
  }
  content.replaceChildren(
    el('h2', { className: 'group-title', textContent: title }),
    ...(items.length ? items.map(card) : [el('p', { className: 'empty', textContent: 'Sonuç yok.' })]),
  );
}

function findItem(key) { return state.groups.flatMap((g) => g.items).find((i) => i.key === key); }

function card(item) {
  const isColor = item.kind === 'color';
  const multiline = !isColor && (item.kind === 'text' || item.value.includes('\n'));
  const input = isColor
    ? el('input', { type: 'text', value: item.value, maxLength: 7, spellcheck: false, 'aria-label': item.label })
    : el(multiline ? 'textarea' : 'input', { value: item.value, rows: Math.min(10, Math.max(2, item.value.split('\n').length + 1)), 'aria-label': item.label });
  if (!multiline && !isColor) input.type = 'text';

  const counter = el('span');
  const hint = el('span', { textContent: isColor ? '#RRGGBB' : `Discord sınırı: ${item.max} karakter` });
  const err = el('p', { className: 'error', role: 'alert' });
  const preview = el('div', { className: 'preview' });
  const save = el('button', { className: 'btn primary', type: 'button', textContent: 'Kaydet', disabled: true });
  const reset = el('button', { className: 'btn', type: 'button', textContent: 'Varsayılana sıfırla', hidden: !item.custom });
  const badge = el('span', { className: 'badge', textContent: 'özelleştirildi', hidden: !item.custom });
  const root = el('section', { className: 'card' });
  let colorPicker;

  const update = () => {
    const v = input.value;
    const dirty = v !== item.value;
    root.classList.toggle('dirty', dirty);
    save.disabled = !dirty;
    counter.textContent = `${v.length}/${item.max}`;
    counter.className = v.length > item.max ? 'over' : '';
    if (isColor) {
      if (colorPicker && /^#[0-9a-f]{6}$/i.test(v)) colorPicker.value = v.toLowerCase();
      preview.replaceChildren(el('span', { className: 'swatch', style: `background:${/^#[0-9a-f]{6}$/i.test(v) ? v : 'transparent'}` }));
      preview.style.background = 'transparent';
    } else {
      preview.innerHTML = `<span class="label">Önizleme (örnek değerlerle)</span>${renderPreview(v, state.samples)}`;
    }
  };
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !save.disabled) save.click(); });

  if (isColor) {
    colorPicker = el('input', { type: 'color', value: item.value.toLowerCase(), 'aria-label': `${item.label} (renk seçici)` });
    colorPicker.addEventListener('input', () => { input.value = colorPicker.value.toUpperCase(); update(); });
  }

  const vars = item.vars.length
    ? el('div', { className: 'vars' }, el('span', { className: 'muted', textContent: 'Değişkenler (tıkla → ekle):' }),
      item.vars.map((v) => el('button', {
        type: 'button', textContent: `{${v}}`, title: `Örnek: ${state.samples[v] ?? ''}`,
        onclick: () => {
          const s = input.selectionStart ?? input.value.length;
          const e = input.selectionEnd ?? s;
          input.setRangeText(`{${v}}`, s, e, 'end');
          input.focus();
          update();
        },
      })))
    : null;

  save.addEventListener('click', async () => {
    err.textContent = '';
    save.disabled = true;
    try {
      const r = await api('PUT', '/api/texts', { key: item.key, value: input.value });
      item.value = input.value;
      item.custom = item.value !== item.default;
      reset.hidden = badge.hidden = !item.custom;
      toast(r.panelRefreshed ? `Kaydedildi — bilet paneli ${r.panelRefreshed === 'sent' ? 'gönderildi' : r.panelRefreshed === 'updated' ? 'güncellendi' : r.panelRefreshed}.` : 'Kaydedildi.');
      renderNav();
    } catch (e) { err.textContent = e.message; }
    update();
  });

  reset.addEventListener('click', async () => {
    err.textContent = '';
    try {
      const r = await api('POST', '/api/texts/reset', { key: item.key });
      item.value = input.value = r.value;
      item.custom = false;
      reset.hidden = badge.hidden = true;
      if (colorPicker) colorPicker.value = r.value.toLowerCase();
      toast('Varsayılana sıfırlandı.');
      renderNav();
    } catch (e) { err.textContent = e.message; }
    update();
  });

  root.append(
    el('div', { className: 'card-head' }, el('span', {}, el('strong', { textContent: item.label }), badge), el('code', { textContent: item.key })),
    isColor ? el('div', { className: 'color-row' }, colorPicker, input) : input,
    vars ?? '',
    el('div', { className: 'meta' }, hint, counter),
    preview,
    el('div', { className: 'actions' }, save, reset),
    err,
  );
  update();
  return root;
}

// ---- Başlangıç ----
api('GET', '/api/session').then((s) => (s.authenticated ? load() : showLogin())).catch(() => showLogin());
