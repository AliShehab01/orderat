// Orderat web app settings: the Edge Functions base and the sign-in client ids. The Apple return address
// is this page's own /app/ (registered for orderatweb.com, www.orderatweb.com and orderat-app.pages.dev).
// It is always /app/, so Apple sign-in does not work from the Next dev path /orderat/ (Apple only returns
// to a registered address); use the built site (npm run site:build, served at /app/) to try it locally.
window.ORDERAT_CONFIG = {
  apiBase: 'https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1',
  googleClientId: '799835600648-rj4qq9ia615jfob5eg6k4lgop3aq3i6l.apps.googleusercontent.com',
  appleServicesId: 'com.ams.orderat.web',
  appleRedirectUri: location.origin + '/app/',
  // Store pages. null shows "Coming soon" instead of a download button.
  storeLinks: { ios: 'https://apps.apple.com/app/id6816299089', android: null },
};
