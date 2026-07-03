'use strict';

// ── Estado global ──
let projects       = [];
let currentProject = null;
let currentScene   = null;
let saveTimer      = null;
let saveStatus     = 'saved';
let focusMode      = false;
let searchOpen     = false;

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

// ── Modo foco ──
function toggleFocusMode() {
  focusMode = !focusMode;
  $('app').classList.toggle('focus-mode', focusMode);
  $('btn-focus').textContent = focusMode ? 'Sair foco' : 'Foco';
}

// ── Fonte do editor ──
function applyEditorFont(font) {
  $('editor-textarea').style.fontFamily = font;
  localStorage.setItem('df_editor_font', font);
}

// ── Largura do editor ──
function applyEditorWidth(w) {
  document.documentElement.style.setProperty('--editor-max-w', w + 'px');
  localStorage.setItem('df_editor_width', String(w));
}

// ── Busca ──
function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runSearch(q) {
  const query   = q.trim().toLowerCase();
  const results = $('search-results');

  if (!query || !currentProject) {
    results.classList.add('hidden');
    $('scene-list').classList.remove('hidden');
    return;
  }

  $('scene-list').classList.add('hidden');
  results.classList.remove('hidden');

  const scenes  = currentProject.scenes || [];
  const matches = scenes.filter(s =>
    s.title.toLowerCase().includes(query) ||
    stripHtml(s.text || '').toLowerCase().includes(query) ||
    (s.nota || '').toLowerCase().includes(query)
  );

  if (matches.length === 0) {
    results.innerHTML = '<div class="list-placeholder">Nenhum resultado encontrado.</div>';
    return;
  }

  results.innerHTML = matches.map(s => {
    const text    = stripHtml(s.text || '');
    const textIdx = text.toLowerCase().indexOf(query);
    let snippet   = '';

    if (textIdx >= 0) {
      const start  = Math.max(0, textIdx - 30);
      const end    = Math.min(text.length, textIdx + query.length + 60);
      const before = escHtml(text.slice(start, textIdx));
      const match  = escHtml(text.slice(textIdx, textIdx + query.length));
      const after  = escHtml(text.slice(textIdx + query.length, end));
      snippet = (start > 0 ? '…' : '') + before + `<mark>${match}</mark>` + after + (end < text.length ? '…' : '');
    }

    const titleIdx = s.title.toLowerCase().indexOf(query);
    let titleHtml;
    if (titleIdx >= 0) {
      titleHtml =
        escHtml(s.title.slice(0, titleIdx)) +
        `<mark>${escHtml(s.title.slice(titleIdx, titleIdx + query.length))}</mark>` +
        escHtml(s.title.slice(titleIdx + query.length));
    } else {
      titleHtml = escHtml(s.title);
    }

    return `<div class="search-result-item" data-id="${s.id}">
      <div class="search-result-title">${titleHtml}</div>
      ${snippet ? `<div class="search-result-snippet">${snippet}</div>` : ''}
    </div>`;
  }).join('');

  results.querySelectorAll('.search-result-item').forEach(el => {
    el.addEventListener('click', () => {
      const id    = parseInt(el.dataset.id);
      const scene = currentProject.scenes.find(s => s.id === id);
      if (scene) { closeSearch(); openScene(scene); }
    });
  });
}

function openSearch() {
  searchOpen = true;
  $('sidebar-search-box').classList.remove('hidden');
  $('btn-search-toggle').textContent = '✕';
  $('btn-search-toggle').title = 'Fechar busca';
  setTimeout(() => $('search-input').focus(), 40);
}

function closeSearch() {
  searchOpen = false;
  $('sidebar-search-box').classList.add('hidden');
  $('search-input').value = '';
  $('search-results').classList.add('hidden');
  $('scene-list').classList.remove('hidden');
  $('btn-search-toggle').textContent = '🔍';
  $('btn-search-toggle').title = 'Buscar nas cenas';
}

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
}

async function closeCurrentProject() {
  if (focusMode) toggleFocusMode();
  if (searchOpen) closeSearch();

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
  $('editor-textarea').focus();
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

  $('btn-login').addEventListener('click', login);
  $('btn-logout').addEventListener('click', () => {
    if (focusMode) toggleFocusMode();
    if (searchOpen) closeSearch();
    logout();
    currentProject = null;
    currentScene   = null;
    projects       = [];
    $('btn-save-now').classList.add('hidden');
    $('btn-close-project').classList.add('hidden');
    $('btn-focus').classList.add('hidden');
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

  // Fonte do editor
  $('select-font').addEventListener('change', () => applyEditorFont($('select-font').value));

  // Largura do editor
  $('slider-width').addEventListener('input', () => applyEditorWidth($('slider-width').value));

  // Busca
  $('btn-search-toggle').addEventListener('click', () => searchOpen ? closeSearch() : openSearch());
  $('search-input').addEventListener('input',   () => runSearch($('search-input').value));
  $('search-input').addEventListener('keydown', e => { if (e.key === 'Escape') closeSearch(); });

  // Inicializar fonte e largura do localStorage
  const savedFont  = localStorage.getItem('df_editor_font');
  const savedWidth = localStorage.getItem('df_editor_width') || '700';
  if (savedFont) {
    applyEditorFont(savedFont);
    $('select-font').value = savedFont;
  }
  applyEditorWidth(savedWidth);
  $('slider-width').value = savedWidth;

  // Atalhos de teclado
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && currentScene) {
      e.preventDefault();
      doSave(false);
    }
    if (e.key === 'Escape' && focusMode) toggleFocusMode();
    if (e.key === 'F11' && currentScene) {
      e.preventDefault();
      toggleFocusMode();
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
