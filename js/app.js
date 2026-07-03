'use strict';

// ── Estado global ──
let projects       = [];
let currentProject = null;
let currentScene   = null;
let saveTimer      = null;
let saveStatus     = 'saved';
let focusMode      = false;

const $ = id => document.getElementById(id);

// Remove tags HTML do texto armazenado pelo app desktop
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Inicialização ──
async function init() {
  const account = await initAuth((user) => {
    showApp(user);
    loadAllProjects();
  });
  if (account) {
    showApp(account);
    await loadAllProjects();
  } else {
    showLoginScreen();
  }
}

function showLoginScreen() {
  $('login-screen').classList.remove('hidden');
  $('app').classList.add('hidden');
}

function showApp(account) {
  $('login-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  const name = account.name || account.username || '?';
  $('user-initial').textContent = name.charAt(0).toUpperCase();
}

function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : '';
  const btn = $('btn-theme');
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
}

// ── Editor ativo (normal ou dentro do modo foco) ──
function activeEditor() {
  return focusMode ? $('focus-editor') : $('editor-textarea');
}

// ── Modo foco — overlay em tela cheia ──
let focusHintTimer = null;

function syncFocusContent() {
  if (!currentScene) return;
  $('focus-scene-title').textContent = currentScene.title || '';
  $('focus-editor').value = $('editor-textarea').value;
  $('focus-editor').style.fontFamily = $('editor-textarea').style.fontFamily || '';
  $('focus-editor').style.fontSize   = $('editor-textarea').style.fontSize   || '';
  syncZoom($('slider-width').value);
  updateFocusWordCount();
}

function enterFocus() {
  if (!currentScene) return;
  focusMode = true;

  syncFocusContent();
  $('focus-overlay').classList.remove('hidden');
  showFocusHint();
  $('focus-editor').focus();

  $('btn-focus').classList.add('active');
  $('btn-focus').querySelector('.btn-label').textContent = 'Sair foco';
  if (Find.isOpen) Find.reposition();
}

function exitFocus() {
  if (!focusMode) return;
  focusMode = false;

  $('editor-textarea').value = $('focus-editor').value;
  updateWordCount();
  scheduleSave();

  $('focus-overlay').classList.add('hidden');
  $('btn-focus').classList.remove('active');
  $('btn-focus').querySelector('.btn-label').textContent = 'Foco';
  if (Find.isOpen) Find.reposition();
}

function toggleFocusMode() {
  focusMode ? exitFocus() : enterFocus();
}

function updateFocusWordCount() {
  const words = countTextWords($('focus-editor').value);
  $('focus-wordcount').textContent = `${words.toLocaleString('pt-BR')} palavras nesta cena`;
}

function showFocusHint() {
  const hint = $('focus-hint');
  hint.classList.add('show');
  clearTimeout(focusHintTimer);
  focusHintTimer = setTimeout(() => hint.classList.remove('show'), 3000);
}

// ── Fonte e tamanho do editor ──
const EDITOR_FONTS = [
  { label: 'Lora',            css: "'Lora', Georgia, serif" },
  { label: 'Newsreader',      css: "'Newsreader', Georgia, serif" },
  { label: 'Georgia',         css: "Georgia, 'Times New Roman', serif" },
  { label: 'Times New Roman', css: "'Times New Roman', Times, serif" },
  { label: 'Garamond',        css: "'EB Garamond', Garamond, Georgia, serif" },
  { label: 'Instrument Sans', css: "'Instrument Sans', system-ui, sans-serif" },
  { label: 'Arial',           css: "Arial, Helvetica, sans-serif" },
  { label: 'Courier',         css: "'Courier New', Courier, monospace" },
];
const EDITOR_SIZES = [12, 13, 14, 15, 16, 18, 20, 22, 24, 28];

function buildFontControls() {
  const fSel = $('select-font');
  const sSel = $('select-font-size');
  fSel.innerHTML = EDITOR_FONTS.map(f => `<option value="${escHtml(f.css)}">${escHtml(f.label)}</option>`).join('');
  sSel.innerHTML = EDITOR_SIZES.map(s => `<option value="${s}">${s} px</option>`).join('');
  fSel.value = EDITOR_FONTS[0].css;
  sSel.value = '16';
}

function applyEditorFont(css) {
  $('editor-textarea').style.fontFamily = css;
  $('focus-editor').style.fontFamily    = css;
  localStorage.setItem('df_editor_font', css);
}

function applyEditorFontSize(px) {
  $('editor-textarea').style.fontSize = px + 'px';
  $('focus-editor').style.fontSize    = px + 'px';
  localStorage.setItem('df_editor_font_size', String(px));
}

// ── Zoom da área de escrita (a página tem largura fixa; o slider só amplia/reduz visualmente, sem mover onde o texto quebra) ──
const EDITOR_BASE_W = 700;

function syncZoom(value) {
  const ratio = (value / EDITOR_BASE_W).toFixed(3);
  $('editor-textarea').style.zoom = ratio;
  $('focus-editor').style.zoom    = ratio;
  localStorage.setItem('df_editor_width', String(value));
}

// ── Busca — todo o livro (todas as cenas do projeto), barra flutuante ──
// Nota: o editor aqui é um <textarea> (texto puro), não contenteditable como no
// desktop, então não dá para usar a CSS Custom Highlight API para marcar todas
// as ocorrências ao mesmo tempo dentro do texto. Em vez disso, o resultado atual
// é marcado via seleção nativa do navegador (setSelectionRange) e a view rola
// até ele — mesmo efeito prático de "ir até a ocorrência e vê-la destacada".
const Find = {
  isOpen: false,
  q: '',
  matches: [],
  current: -1,
  chaptersWithHits: 0,
  _debounce: null,

  toggle() { this.isOpen ? this.close() : this.open(); },

  open() {
    if (!currentProject) { showToast('Abra um projeto para buscar', 'info'); return; }
    this.isOpen = true;
    $('find-bar').classList.remove('hidden');
    this.reposition();
    $('btn-find').classList.add('active');

    const input = $('find-input');
    input.focus();
    input.select();
    if (input.value.trim()) this.search(input.value);
  },

  close() {
    this.isOpen = false;
    $('find-bar').classList.add('hidden');
    $('btn-find').classList.remove('active');
    activeEditor()?.focus();
  },

  reposition() {
    $('find-bar').classList.toggle('in-focus', focusMode);
  },

  search(q) {
    q = (q || '').trim();
    this.q = q;
    if (!currentProject || !q) {
      this.matches = []; this.current = -1; this.chaptersWithHits = 0;
      this._renderInfo(); this._renderResults();
      return;
    }

    const needle = q.toLowerCase();
    const list = [];
    let chaptersWithHits = 0;

    (currentProject.scenes || []).forEach(scene => {
      const text = stripHtml(scene.text || '');
      const hay  = text.toLowerCase();
      let from = 0, idxInScene = 0, hadHit = false;
      while (true) {
        const at = hay.indexOf(needle, from);
        if (at < 0) break;
        hadHit = true;
        list.push({
          sceneId: scene.id,
          idxInScene,
          title:   scene.title || 'Sem título',
          act:     scene.act,
          offset:  at,
          length:  q.length,
          snippet: this._snippet(text, at, q.length)
        });
        idxInScene++;
        from = at + needle.length;
      }
      if (hadHit) chaptersWithHits++;
    });

    this.matches = list;
    this.chaptersWithHits = chaptersWithHits;
    if (!list.length) this.current = -1;
    else if (this.current >= list.length) this.current = -1;

    this._renderInfo();
    this._renderResults();
  },

  _snippet(text, at, len) {
    const PRE = 28, POST = 34;
    const before = text.slice(Math.max(0, at - PRE), at);
    const hit    = text.slice(at, at + len);
    const after  = text.slice(at + len, at + len + POST);
    return {
      before: (at > PRE ? '…' : '') + before,
      hit,
      after: after + (at + len + POST < text.length ? '…' : '')
    };
  },

  next() { if (this.matches.length) { this.current = (this.current + 1) % this.matches.length; this._goTo(); } },
  prev() { if (this.matches.length) { this.current = (this.current - 1 + this.matches.length) % this.matches.length; this._goTo(); } },

  goToResult(i) {
    this.current = i;
    this._goTo();
    $('find-input').focus();
  },

  async _goTo() {
    const m = this.matches[this.current];
    if (!m) return;

    if (!currentScene || currentScene.id !== m.sceneId) {
      const scene = currentProject.scenes.find(s => s.id === m.sceneId);
      if (!scene) return;
      await openScene(scene);
      if (focusMode) syncFocusContent();
    }

    const ed = activeEditor();
    ed.focus();
    ed.setSelectionRange(m.offset, m.offset + m.length);
    this._scrollToOffset(ed, m.offset);

    this._renderInfo();
    this._renderResults();
  },

  _scrollToOffset(ta, offset) {
    const before = ta.value.slice(0, offset);
    const line = before.split('\n').length - 1;
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 24;
    ta.scrollTop = Math.max(0, line * lineHeight - ta.clientHeight / 2);
  },

  _renderInfo() {
    const info = $('find-count');
    if (!this.q) { info.textContent = ''; return; }
    const total = this.matches.length;
    if (!total) { info.textContent = 'Nenhum resultado'; return; }
    const pos = this.current >= 0 ? `${this.current + 1}/` : '';
    const caps = this.chaptersWithHits === 1 ? '1 cena' : `${this.chaptersWithHits} cenas`;
    info.textContent = `${pos}${total} · ${caps}`;
  },

  _renderResults() {
    const box = $('find-results');
    box.innerHTML = '';
    if (!this.q || !this.matches.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');

    const MAX = 200;
    this.matches.slice(0, MAX).forEach((m, i) => {
      const row = document.createElement('button');
      row.className = 'find-result' + (i === this.current ? ' active' : '');
      row.innerHTML = `
        <span class="find-result-cap act-${m.act}">${m.sceneId}</span>
        <span class="find-result-body">
          <span class="find-result-title">${escHtml(m.title)}</span>
          <span class="find-result-snip">${escHtml(m.snippet.before)}<mark>${escHtml(m.snippet.hit)}</mark>${escHtml(m.snippet.after)}</span>
        </span>`;
      row.addEventListener('click', () => this.goToResult(i));
      box.appendChild(row);
    });

    if (this.matches.length > MAX) {
      const more = document.createElement('div');
      more.className = 'find-result-more';
      more.textContent = `+ ${this.matches.length - MAX} resultados não listados`;
      box.appendChild(more);
    }

    box.querySelector('.find-result.active')?.scrollIntoView({ block: 'nearest' });
  }
};

// ── Projetos ──
async function loadAllProjects() {
  $('project-list').innerHTML = '<div class="list-placeholder">Carregando…</div>';
  showSidebarState('projects');

  try {
    const items = await listProjects();

    if (items === null || items.length === 0) {
      renderProjectList();
      return;
    }

    projects = [];
    for (const item of items) {
      try {
        const data = await loadProjectJson(item.name);
        projects.push(data);
      } catch (e) {
        console.warn('Projeto sem project.json ignorado:', item.name, e.message);
      }
    }
    renderProjectList();

  } catch (e) {
    $('project-list').innerHTML = `<div class="list-placeholder error">Erro: ${e.message}</div>`;
  }
}

function renderProjectList() {
  const list = $('project-list');
  if (projects.length === 0) {
    list.innerHTML = '<div class="list-placeholder">Nenhum projeto ainda.<br>Crie o primeiro!</div>';
    return;
  }

  list.innerHTML = projects.map(p => {
    const total = projectTotalWords(p).toLocaleString('pt-BR');
    const cenas = (p.scenes || []).length;
    return `
      <div class="project-item" data-slug="${p.meta.slug}">
        <div class="project-item-name">${p.meta.title}</div>
        <div class="project-item-meta">${p.meta.publisher || ''} · ${cenas}c · ${total}p</div>
      </div>`;
  }).join('');

  list.querySelectorAll('.project-item').forEach(el =>
    el.addEventListener('click', () => openProject(el.dataset.slug))
  );
}

async function openProject(slug) {
  const project = projects.find(p => p.meta.slug === slug);
  if (!project) return;

  currentProject = project;
  currentScene   = null;

  $('sidebar-project-title').textContent = project.meta.title;
  $('header-project-name').textContent   = project.meta.title;
  $('header-words').textContent          = projectTotalWords(project).toLocaleString('pt-BR') + ' palavras';

  renderSceneList();
  showSidebarState('scenes');
  showEditorState('empty');
  $('btn-save-now').classList.remove('hidden');
  $('btn-close-project').classList.remove('hidden');
  $('btn-focus').classList.remove('hidden');
  $('btn-find').classList.remove('hidden');
}

async function closeCurrentProject() {
  exitFocus();
  Find.close();

  if (currentScene) {
    clearTimeout(saveTimer);
    await doSave(true);
  }
  currentProject = null;
  currentScene   = null;
  $('header-project-name').textContent = '';
  $('header-words').textContent = '';
  setSaveStatus('saved');
  $('btn-save-now').classList.add('hidden');
  $('btn-close-project').classList.add('hidden');
  $('btn-focus').classList.add('hidden');
  $('btn-find').classList.add('hidden');
  showSidebarState('projects');
  showEditorState('empty');
}

// ── Cenas ──
function renderSceneList() {
  const list = $('scene-list');
  const scenes = currentProject.scenes || [];

  if (scenes.length === 0) {
    list.innerHTML = '<div class="list-placeholder">Nenhuma cena ainda.</div>';
    return;
  }

  const actNames = { 1: 'ATO 1 — CONSTRUÇÃO', 2: 'ATO 2 — CONFRONTO', 3: 'ATO 3 — RESOLUÇÃO' };
  const byAct = { 1: [], 2: [], 3: [] };
  scenes.forEach(s => { (byAct[s.act] || byAct[1]).push(s); });

  let html = '';
  [1, 2, 3].forEach(act => {
    if (!byAct[act].length) return;
    html += `<div class="act-label act-${act}-color">${actNames[act]}</div>`;
    byAct[act].forEach(s => {
      const statusLabel = { done: '✓ Escrita', notes: 'Notas', todo: 'Rascunho' }[s.status] || 'Rascunho';
      const wc = countTextWords(s.text);
      const isActive = currentScene?.id === s.id ? ' active' : '';
      html += `
        <div class="scene-item act-${act}-border${isActive}" data-id="${s.id}">
          <div class="scene-item-title">${s.title}</div>
          <div class="scene-item-meta">${statusLabel} · ${wc.toLocaleString('pt-BR')}p</div>
        </div>`;
    });
  });

  list.innerHTML = html;
  list.querySelectorAll('.scene-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = parseInt(el.dataset.id);
      const scene = currentProject.scenes.find(s => s.id === id);
      if (scene) openScene(scene);
    });
  });
}

async function openScene(scene) {
  if (currentScene) {
    clearTimeout(saveTimer);
    await doSave(true);
  }

  currentScene = scene;

  document.querySelectorAll('.scene-item').forEach(el =>
    el.classList.toggle('active', parseInt(el.dataset.id) === scene.id)
  );

  const actNames = { 1: 'ATO 1', 2: 'ATO 2', 3: 'ATO 3' };
  $('scene-act-label').textContent = actNames[scene.act] || 'ATO 1';
  $('scene-act-label').className   = `scene-act-label act-${scene.act}-color`;
  $('scene-title').textContent     = scene.title;
  $('scene-subtitle').textContent  = scene.subtitle || '';

  $('editor-textarea').value = stripHtml(scene.text || '');
  updateWordCount();

  $('notes-status').value   = scene.status   || 'todo';
  $('notes-nota').value     = scene.nota     || '';
  $('notes-loc').value      = scene.loc      || '';
  $('notes-pov').value      = scene.pov      || '';
  $('notes-tom').value      = scene.tom      || '';
  $('notes-objetivo').value = scene.objetivo || '';
  $('notes-gancho').value   = scene.gancho   || '';

  showEditorState('scene');
  if (!focusMode) $('editor-textarea').focus();
}

// ── Auto-save ──
function updateWordCount() {
  const text  = $('editor-textarea').value;
  const words = countTextWords(text);
  $('scene-word-count').textContent = `${words.toLocaleString('pt-BR')} palavras nesta cena`;

  if (currentProject) {
    const total = (currentProject.scenes || []).reduce((acc, s) => {
      const t = s.id === currentScene?.id ? text : (s.text || '');
      return acc + countTextWords(t);
    }, 0);
    $('header-words').textContent = `${total.toLocaleString('pt-BR')} palavras`;
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  setSaveStatus('pending');
  saveTimer = setTimeout(() => doSave(false), 3000);
}

async function doSave(silent = false) {
  if (!currentProject || !currentScene) return;
  if (!silent) setSaveStatus('saving');

  currentScene.text     = $('editor-textarea').value;
  currentScene.status   = $('notes-status').value;
  currentScene.nota     = $('notes-nota').value;
  currentScene.loc      = $('notes-loc').value;
  currentScene.pov      = $('notes-pov').value;
  currentScene.tom      = $('notes-tom').value;
  currentScene.objetivo = $('notes-objetivo').value;
  currentScene.gancho   = $('notes-gancho').value;

  try {
    await saveProjectJson(currentProject.meta.slug, currentProject);
    if (!silent) setSaveStatus('saved');
    renderSceneList();
  } catch (e) {
    if (!silent) setSaveStatus('error');
    if (e.tokenExpired) showToast('Sessão expirada — clique em Sair e entre novamente', 'error');
    console.error('Erro ao salvar:', e);
  }
}

function setSaveStatus(status) {
  saveStatus = status;
  const el = $('save-indicator');
  const map = {
    pending: ['',                   ''],
    saving:  ['● Salvando…',       'saving'],
    saved:   ['✓ Salvo',           'saved'],
    error:   ['⚠ Erro ao salvar',  'error']
  };
  const [text, cls] = map[status] || ['', ''];
  el.textContent = text;
  el.className   = 'save-indicator' + (cls ? ' ' + cls : '');
}

// ── Criar projeto ──
async function createProject() {
  const title = $('new-project-title').value.trim();
  if (!title) { $('new-project-title').focus(); return; }

  const slug      = slugify(title);
  const author    = $('new-project-author').value.trim()    || 'Alexander';
  const publisher = $('new-project-publisher').value.trim() || 'Lobo Publishers';
  const desc      = $('new-project-desc').value.trim();

  const data = {
    meta: { title, slug, author, publisher, description: desc,
            created: new Date().toISOString(), lastSaved: new Date().toISOString() },
    scenes: []
  };

  try {
    await saveProjectJson(slug, data);
    projects.push(data);
    closeModal('modal-new-project');
    renderProjectList();
    openProject(slug);
  } catch (e) {
    showToast('Erro ao criar projeto: ' + e.message, 'error');
  }
}

// ── Criar cena ──
async function createScene() {
  if (!currentProject) return;
  const title = $('new-scene-title').value.trim();
  if (!title) { $('new-scene-title').focus(); return; }

  const act   = parseInt($('new-scene-act').value);
  const maxId = Math.max(0, ...(currentProject.scenes || []).map(s => s.id));

  const scene = {
    id: maxId + 1, act, title, subtitle: '', status: 'todo',
    loc: '', pov: '', tom: '', objetivo: '', gancho: '',
    beats: [], nota: '', personal: '',
    arcPosition: { x: 0.5, y: 0.5 },
    text: ''
  };

  currentProject.scenes = currentProject.scenes || [];
  currentProject.scenes.push(scene);

  try {
    await saveProjectJson(currentProject.meta.slug, currentProject);
    closeModal('modal-new-scene');
    renderSceneList();
    openScene(scene);
  } catch (e) {
    showToast('Erro ao criar cena: ' + e.message, 'error');
  }
}

// ── Helpers de UI ──
function showSidebarState(state) {
  $('sidebar-projects').classList.toggle('hidden', state !== 'projects');
  $('sidebar-scenes').classList.toggle('hidden',   state !== 'scenes');
}

function showEditorState(state) {
  $('empty-state').classList.toggle('hidden',   state !== 'empty');
  $('scene-editor').classList.toggle('hidden',  state !== 'scene');
  $('notes-empty').classList.toggle('hidden',   state !== 'empty');
  $('notes-content').classList.toggle('hidden', state !== 'scene');
}

function openModal(id)  { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// ── Event listeners ──
document.addEventListener('DOMContentLoaded', () => {

  buildFontControls();

  $('btn-login').addEventListener('click', login);
  $('btn-logout').addEventListener('click', () => {
    exitFocus();
    Find.close();
    logout();
    currentProject = null;
    currentScene   = null;
    projects       = [];
    $('btn-save-now').classList.add('hidden');
    $('btn-close-project').classList.add('hidden');
    $('btn-focus').classList.add('hidden');
    $('btn-find').classList.add('hidden');
    showLoginScreen();
  });

  $('btn-back-projects').addEventListener('click', closeCurrentProject);

  // Modais — novo projeto
  $('btn-new-project').addEventListener('click', () => {
    $('new-project-title').value = '';
    openModal('modal-new-project');
    setTimeout(() => $('new-project-title').focus(), 60);
  });
  $('btn-create-project').addEventListener('click', createProject);

  // Modais — nova cena
  $('btn-new-scene').addEventListener('click', () => {
    $('new-scene-title').value = '';
    openModal('modal-new-scene');
    setTimeout(() => $('new-scene-title').focus(), 60);
  });
  $('btn-create-scene').addEventListener('click', createScene);

  // Fechar modais
  document.querySelectorAll('.modal-close, [data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.closeModal || btn.closest('.modal')?.id;
      if (id) closeModal(id);
    });
  });
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(modal.id); });
  });

  // Editor
  $('editor-textarea').addEventListener('input', () => {
    updateWordCount();
    scheduleSave();
  });
  $('editor-textarea').addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = $('editor-textarea');
      const s  = ta.selectionStart;
      ta.value = ta.value.slice(0, s) + '\t' + ta.value.slice(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = s + 1;
      scheduleSave();
    }
  });

  // Notas
  ['notes-status','notes-nota','notes-loc','notes-pov','notes-tom','notes-objetivo','notes-gancho']
    .forEach(id => {
      $(id)?.addEventListener('input',  scheduleSave);
      $(id)?.addEventListener('change', scheduleSave);
    });

  // Tema claro/escuro
  applyTheme(localStorage.getItem('df_theme') === 'dark');
  $('btn-theme').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme !== 'dark';
    localStorage.setItem('df_theme', dark ? 'dark' : 'light');
    applyTheme(dark);
  });

  // Salvar / Fechar projeto
  $('btn-save-now').addEventListener('click', () => doSave(false));
  $('btn-close-project').addEventListener('click', closeCurrentProject);

  // Modo foco
  $('btn-focus').addEventListener('click', toggleFocusMode);
  $('btn-exit-focus').addEventListener('click', exitFocus);
  $('focus-editor').addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); exitFocus(); }
  });
  $('focus-editor').addEventListener('input', () => {
    updateFocusWordCount();
    $('editor-textarea').value = $('focus-editor').value;
    updateWordCount();
    scheduleSave();
  });
  $('focus-overlay').addEventListener('mousemove', showFocusHint);
  $('btn-focus-find').addEventListener('click', () => Find.open());

  // Fonte e tamanho do editor
  $('select-font').addEventListener('change', () => applyEditorFont($('select-font').value));
  $('select-font-size').addEventListener('change', () => applyEditorFontSize($('select-font-size').value));

  // Zoom da área de escrita
  $('slider-width').addEventListener('input', () => syncZoom($('slider-width').value));

  // Busca
  $('btn-find').addEventListener('click', () => Find.toggle());
  $('find-close').addEventListener('click', () => Find.close());
  $('find-next').addEventListener('click',  () => Find.next());
  $('find-prev').addEventListener('click',  () => Find.prev());
  $('find-input').addEventListener('input', () => {
    clearTimeout(Find._debounce);
    Find._debounce = setTimeout(() => Find.search($('find-input').value), 150);
  });
  $('find-input').addEventListener('keydown', e => {
    if (e.key === 'Enter')       { e.preventDefault(); e.shiftKey ? Find.prev() : Find.next(); }
    else if (e.key === 'Escape') { e.preventDefault(); Find.close(); }
  });

  // Inicializar fonte, tamanho e zoom do localStorage
  const savedFont = localStorage.getItem('df_editor_font');
  const savedSize = localStorage.getItem('df_editor_font_size') || '16';
  const savedZoom = localStorage.getItem('df_editor_width')     || '700';
  if (savedFont) { applyEditorFont(savedFont); $('select-font').value = savedFont; }
  applyEditorFontSize(savedSize);
  $('select-font-size').value = savedSize;
  $('slider-width').value = savedZoom;
  syncZoom(savedZoom);

  // Atalhos de teclado
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && currentScene) {
      e.preventDefault();
      doSave(false);
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f') && currentScene) {
      e.preventDefault();
      toggleFocusMode();
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'f' || e.key === 'F') && currentProject) {
      e.preventDefault();
      Find.toggle();
    }
  });

  // Salva ao fechar aba/janela
  window.addEventListener('beforeunload', e => {
    if (saveStatus === 'pending' || saveStatus === 'saving') {
      doSave(true);
      e.returnValue = 'Há alterações não salvas.';
    }
  });

  $('new-project-title').addEventListener('keydown', e => { if (e.key === 'Enter') createProject(); });
  $('new-scene-title').addEventListener('keydown',   e => { if (e.key === 'Enter') createScene(); });

  init();
});
