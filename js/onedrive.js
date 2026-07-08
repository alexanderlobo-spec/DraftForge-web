'use strict';

const GRAPH = 'https://graph.microsoft.com/v1.0';

// Rastreia a versão remota esperada de cada projeto (lastModifiedDateTime do OneDrive)
const _remoteVersions = {};

// Encode cada segmento do caminho separadamente
function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

async function gFetch(path, opts = {}) {
  const token = await getToken();
  const res = await fetch(GRAPH + path, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + token,
      ...opts.headers
    }
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error?.message || msg; } catch {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res;
}

async function listProjects() {
  const folder = APP_CONFIG.projectsFolder;
  try {
    const res = await gFetch(
      `/me/drive/root:/${encodePath(folder)}:/children` +
      `?$select=name,id,folder,lastModifiedDateTime&$top=200`
    );
    const data = await res.json();
    return (data.value || []).filter(
      i => i.folder && i.name !== '_trash' && !i.name.startsWith('.')
    );
  } catch (e) {
    if (e.status === 404) return null; // pasta ainda não existe
    throw e;
  }
}

async function _getRemoteModifiedTime(slug) {
  try {
    const path = `${APP_CONFIG.projectsFolder}/${slug}/project.json`;
    const res = await gFetch(`/me/drive/root:/${encodePath(path)}?$select=lastModifiedDateTime`);
    const d = await res.json();
    return d.lastModifiedDateTime || null;
  } catch {
    return null;
  }
}

async function loadProjectJson(slug) {
  const path = `${APP_CONFIG.projectsFolder}/${slug}/project.json`;
  const res = await gFetch(`/me/drive/root:/${encodePath(path)}:/content`);
  const data = await res.json();
  // Cacheia a versão remota esperada
  const modTime = await _getRemoteModifiedTime(slug);
  _remoteVersions[slug] = modTime;
  return data;
}

async function saveProjectJson(slug, data) {
  data.meta.lastSaved = new Date().toISOString();
  const path = `${APP_CONFIG.projectsFolder}/${slug}/project.json`;

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

  await gFetch(`/me/drive/root:/${encodePath(path)}:/content`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: JSON.stringify(data, null, 2)
  });
  // Atualiza a versão remota esperada
  const modTime = await _getRemoteModifiedTime(slug);
  _remoteVersions[slug] = modTime;
}

async function _saveConflictFile(slug, data) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const conflictFileName = `conflito_${timestamp}.json`;
    const conflictPath = `${APP_CONFIG.projectsFolder}/${slug}/conflitos/${conflictFileName}`;
    const body = JSON.stringify(data, null, 2);

    await gFetch(`/me/drive/root:/${encodePath(conflictPath)}:/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body
    });
  } catch (e) {
    console.error('Erro ao salvar arquivo de conflito:', e);
  }
}

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
  return stripHtml(text || '').split(/\s+/).filter(Boolean).length;
}

function projectTotalWords(project) {
  return (project.scenes || []).reduce((acc, s) => acc + countTextWords(s.text), 0);
}
