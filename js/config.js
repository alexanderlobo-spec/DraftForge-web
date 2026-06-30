const APP_CONFIG = {
  // Cole aqui o Client ID gerado no Google Cloud Console
  // (parece com: 000000000000-xxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com)
  clientId: '723397227200-vt84t8916n4scvhsl1sdf1l5o1d1hfbk.apps.googleusercontent.com',

  scope: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/userinfo.profile'
  ].join(' '),

  // Estrutura de pastas no Google Drive:
  // Meu Drive → DraftForgeAI → projects → {slug} → project.json
  projectsPath: ['DraftForgeAI', 'projects']
};
