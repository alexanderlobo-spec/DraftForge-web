'use strict';

// Google Drive API v3
const DRIVE  = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';

// Cache de IDs para evitar chamadas repetidas à API
const _ids = {};

// Rastreia a versão remota esperada de cada projeto (modifiedTime do Drive)
const _remoteVersions = {};

async function dfetch(url, opts = {}) {
  const token = getAccessToken(); // lança se expirado
  const res   = await fetch(url, {
    ...opts,
    headers: { Authorization: 'Bearer ' + token, ...opts.headers }
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error?.message || msg; } catch {}
    const e = new Error(msg); e.status = res.status; throw e;
  }
  return res;
}

// Encontra pasta por nome dentro de um pai (sem criar)
async function _findFolder(name, parentId) {
  const key = `f:${parentId}/${name}`;
  if (_ids[key]) return _ids[key];
  const q   = `name='${name}' and '${parentId}' in parents and mimeType='${FOLDER}' and trashed=false`;
  const res = await dfetch(`${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`);
  const d   = await res.json();
  if (d.files?.length) { _ids[key] = d.files[0].id; return d.files[0].id; }
  return null;
}

// Encontra ou cria pasta
async function _findOrCreateFolder(name, parentId) {
  const existing = await _findFolder(name, parentId);
  if (existing) return existing;
  const res = await dfetch(`${DRIVE}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] })
  });
  const f = await res.json();
  _ids[`f:${parentId}/${name}`] = f.id;
  return f.id;
}

// Retorna o ID da pasta DraftForgeAI/projects (cria se não existir)
async function _projectsFolderId() {
  if (_ids['projects']) return _ids['projects'];
  const [root, sub] = APP_CONFIG.projectsPath;
  const rootId = await _findOrCreateFolder(root, 'root');
  const projId = await _findOrCreateFolder(sub, rootId);
  _ids['projects'] = projId;
  return projId;
}

// Lista pastas de projeto (cada pasta = um projeto)
async function listProjects() {
  const parentId = await _projectsFolderId();
  const q   = `'${parentId}' in parents and mimeType='${FOLDER}' and trashed=false`;
  const res = await dfetch(
    `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)&orderBy=name&pageSize=200`
  );
  const d = await res.json();
  // Cacheia IDs das pastas de projeto
  (d.files || []).forEach(f => { _ids[`pf:${f.name}`] = f.id; });
  return (d.files || []).filter(f => f.name !== '_trash' && !f.name.startsWith('.'));
}

// Retorna o ID da pasta de um projeto específico
async function _projectFolderId(slug) {
  if (_ids[`pf:${slug}`]) return _ids[`pf:${slug}`];
  const parentId = await _projectsFolderId();
  const id = await _findFolder(slug, parentId);
  if (id) _ids[`pf:${slug}`] = id;
  return id;
}

// Retorna o ID do arquivo project.json de um projeto
async function _projectFileId(slug) {
  if (_ids[`file:${slug}`]) return _ids[`file:${slug}`];
  const folderId = await _projectFolderId(slug);
  if (!folderId) return null;
  const q   = `name='project.json' and '${folderId}' in parents and trashed=false`;
  const res = await dfetch(`${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`);
  const d   = await res.json();
  if (d.files?.length) { _ids[`file:${slug}`] = d.files[0].id; return d.files[0].id; }
  return null;
}

async function _getRemoteModifiedTime(slug) {
  const fileId = await _projectFileId(slug);
  if (!fileId) return null;
  const res = await dfetch(`${DRIVE}/files/${fileId}?fields=modifiedTime`);
  const d = await res.json();
  return d.modifiedTime || null;
}

async function loadProjectJson(slug) {
  const fileId = await _projectFileId(slug);
  if (!fileId) throw new Error('project.json não encontrado: ' + slug);
  const res = await dfetch(`${DRIVE}/files/${fileId}?alt=media`);
  const data = await res.json();
  // Cacheia a versão remota esperada
  const modTime = await _getRemoteModifiedTime(slug);
  _remoteVersions[slug] = modTime;
  return data;
}

async function saveProjectJson(slug, data) {
  data.meta.lastSaved = new Date().toISOString();
  const body   = JSON.stringify(data, null, 2);
  const fileId = await _projectFileId(slug);

  if (fileId) {
    // Checa conflito: o arquivo mudou remotamente desde que o carregamos?
    const currentRemoteTime = await _getRemoteModifiedTime(slug);
    const expectedRemoteTime = _remoteVersions[slug];

    if (expectedRemoteTime && currentRemoteTime && currentRemoteTime !== expectedRemoteTime) {
      // Conflito! Salva para arquivo de conflito em vez de sobrescrever
      await _saveConflictFile(slug, data);
      const e = new Error('Conflito de escrita: o arquivo foi modificado remotamente');
      e.name = 'SaveConflictError';
      throw e;
    }

    // Atualiza arquivo existente
    const res = await dfetch(`${UPLOAD}/files/${fileId}?uploadType=media&fields=modifiedTime`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    const updated = await res.json();
    _remoteVersions[slug] = updated.modifiedTime;
  } else {
    // Cria pasta do projeto (se necessário) e o arquivo project.json
    let folderId = await _projectFolderId(slug);
    if (!folderId) {
      const parentId = await _projectsFolderId();
      folderId = await _findOrCreateFolder(slug, parentId);
      _ids[`pf:${slug}`] = folderId;
    }

    const boundary = 'df' + Math.random().toString(36).slice(2);
    const meta     = JSON.stringify({ name: 'project.json', parents: [folderId] });
    const multipart = [
      `--${boundary}`, 'Content-Type: application/json', '', meta,
      `--${boundary}`, 'Content-Type: application/json', '', body,
      `--${boundary}--`
    ].join('\r\n');

    const res = await dfetch(`${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`, {
      method:  'POST',
      headers: { 'Content-Type': `multipart/related; boundary="${boundary}"` },
      body:    multipart
    });
    const newFile = await res.json();
    _ids[`file:${slug}`] = newFile.id;
    _remoteVersions[slug] = newFile.modifiedTime;
  }
}

async function _saveConflictFile(slug, data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const conflictFileName = `conflito_${timestamp}.json`;
  const folderId = await _projectFolderId(slug);
  if (!folderId) return;

  const conflictFolder = await _findOrCreateFolder('conflitos', folderId);
  const body = JSON.stringify(data, null, 2);
  const boundary = 'df' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: conflictFileName, parents: [conflictFolder] });
  const multipart = [
    `--${boundary}`, 'Content-Type: application/json', '', meta,
    `--${boundary}`, 'Content-Type: application/json', '', body,
    `--${boundary}--`
  ].join('\r\n');

  await dfetch(`${UPLOAD}/files?uploadType=multipart`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary="${boundary}"` },
    body: multipart
  });
}

// ── Utilitários (idênticos à versão OneDrive) ──
function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function countTextWords(text) {
  return (text || '').split(/\s+/).filter(Boolean).length;
}

function projectTotalWords(project) {
  return (project.scenes || []).reduce((acc, s) => acc + countTextWords(s.text), 0);
}
