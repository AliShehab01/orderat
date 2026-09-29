// Orderat web app settings: the Edge Functions base and the sign-in client ids. The Apple return address
// is this page's own /app/ (registered for orderatweb.com, www.orderatweb.com and orderat-app.pages.dev).
window.ORDERAT_CONFIG = {
  apiBase: 'https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1',
  googleClientId: '799835600648-rj4qq9ia615jfob5eg6k4lgop3aq3i6l.apps.googleusercontent.com',
  appleServicesId: 'com.ams.orderat.web',
  appleRedirectUri: location.origin + '/app/',
};
