'use strict';

const GRAPH = 'https://graph.microsoft.com/v1.0';

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

async function loadProjectJson(slug) {
  const path = `${APP_CONFIG.projectsFolder}/${slug}/project.json`;
  const res = await gFetch(`/me/drive/root:/${encodePath(path)}:/content`);
  return await res.json();
}

async function saveProjectJson(slug, data) {
  data.meta.lastSaved = new Date().toISOString();
  const path = `${APP_CONFIG.projectsFolder}/${slug}/project.json`;
  await gFetch(`/me/drive/root:/${encodePath(path)}:/content`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: JSON.stringify(data, null, 2)
  });
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
  return (text || '').split(/\s+/).filter(Boolean).length;
}

function projectTotalWords(project) {
  return (project.scenes || []).reduce((acc, s) => acc + countTextWords(s.text), 0);
}
