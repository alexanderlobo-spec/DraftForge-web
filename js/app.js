'use strict';

// ── Estado global ──
let projects       = [];
let currentProject = null;
let currentScene   = null;
let saveTimer      = null;
let saveStatus     = 'saved';

const $ = id => document.getElementById(id);

// ── Inicialização ──
async function init() {
  // Passa callback para quando o login via popup do Google terminar
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

// ── Projetos ──
async function loadAllProjects() {
  $('project-list').innerHTML = '<div class="list-placeholder">Carregando…</div>';
  showSidebarState('projects');

  try {
    const items = await listProjects();

    // Sem projetos ainda
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
  // Salva cena anterior antes de trocar
  if (currentScene) {
    clearTimeout(saveTimer);
    await doSave(true);
  }

  currentScene = scene;

  // Atualiza sidebar
  document.querySelectorAll('.scene-item').forEach(el =>
    el.classList.toggle('active', parseInt(el.dataset.id) === scene.id)
  );

  // Header da cena
  const actNames = { 1: 'ATO 1', 2: 'ATO 2', 3: 'ATO 3' };
  $('scene-act-label').textContent = actNames[scene.act] || 'ATO 1';
  $('scene-act-label').className   = `scene-act-label act-${scene.act}-color`;
  $('scene-title').textContent     = scene.title;
  $('scene-subtitle').textContent  = scene.subtitle || '';

  // Editor
  $('editor-textarea').value = scene.text || '';
  updateWordCount();

  // Painel de notas
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

  // Atualiza total no header com o texto atual do editor (não salvo ainda)
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

  // Coleta valores do editor e das notas
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
    pending: ['',              ''],
    saving:  ['● Salvando…',  'saving'],
    saved:   ['✓ Salvo',      'saved'],
    error:   ['⚠ Erro ao salvar', 'error']
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

function openModal(id) {
  $(id).classList.remove('hidden');
}

function closeModal(id) {
  $(id).classList.add('hidden');
}

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
    logout();
    currentProject = null;
    currentScene   = null;
    projects       = [];
    showLoginScreen();
  });

  // Volta para lista de projetos
  $('btn-back-projects').addEventListener('click', async () => {
    if (currentScene) {
      clearTimeout(saveTimer);
      await doSave(true);
    }
    currentProject = null;
    currentScene   = null;
    $('header-project-name').textContent = '';
    $('header-words').textContent = '';
    setSaveStatus('saved');
    showSidebarState('projects');
    showEditorState('empty');
  });

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

  // Fechar modais (botão × e backdrop)
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

  // Salva ao fechar aba/janela
  window.addEventListener('beforeunload', e => {
    if (saveStatus === 'pending' || saveStatus === 'saving') {
      doSave(true);
      e.returnValue = 'Há alterações não salvas.';
    }
  });

  // Enter nos modais
  $('new-project-title').addEventListener('keydown', e => { if (e.key === 'Enter') createProject(); });
  $('new-scene-title').addEventListener('keydown',   e => { if (e.key === 'Enter') createScene(); });

  init();
});
