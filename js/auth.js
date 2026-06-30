'use strict';

let accessToken = null;
let tokenExpiry  = 0;
let tokenClient  = null;
let _onSuccess   = null;

function getAccessToken() {
  if (!accessToken || Date.now() >= tokenExpiry - 30000) {
    const e = new Error('Sessão expirada');
    e.tokenExpired = true;
    throw e;
  }
  return accessToken;
}

// Chamado automaticamente pelo atributo onload do script do Google
function gisLoaded() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: APP_CONFIG.clientId,
    scope:     APP_CONFIG.scope,
    callback:  _handleTokenResponse
  });
}

async function _handleTokenResponse(response) {
  if (response.error) {
    showToast('Erro ao autenticar: ' + response.error, 'error');
    return;
  }

  accessToken = response.access_token;
  tokenExpiry  = Date.now() + response.expires_in * 1000;

  let name = 'Usuário';
  try {
    const res  = await fetch('https://www.googleapis.com/oauth2/v3/userinfo',
      { headers: { Authorization: 'Bearer ' + accessToken } });
    const user = await res.json();
    name = user.name || user.email || name;
  } catch {}

  sessionStorage.setItem('df_gtoken', JSON.stringify({
    token: accessToken, expiry: tokenExpiry, name
  }));

  if (_onSuccess) _onSuccess({ name });
}

// Verifica token em sessionStorage (persiste recarregamentos, não fechar o browser)
async function initAuth(onSuccess) {
  _onSuccess = onSuccess;
  try {
    const stored = JSON.parse(sessionStorage.getItem('df_gtoken') || 'null');
    if (stored && Date.now() < stored.expiry - 30000) {
      accessToken = stored.token;
      tokenExpiry  = stored.expiry;
      return { name: stored.name };
    }
  } catch {}
  return null;
}

function login() {
  if (!tokenClient) {
    showToast('Google ainda carregando — tente em 1 segundo', 'error');
    return;
  }
  // prompt vazio = usa consentimento já dado sem repetir a tela de conta
  tokenClient.requestAccessToken({ prompt: '' });
}

function logout() {
  if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
  accessToken = null;
  tokenExpiry  = 0;
  sessionStorage.removeItem('df_gtoken');
}
