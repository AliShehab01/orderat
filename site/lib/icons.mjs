// Small inline line-icon set (24x24, stroke=currentColor). No emoji, no logos/trademarks —
// consistent with the brand's "line icons that describe a concrete object or action" rule.
// Usage: icon("chat", "w-6")

const PATHS = {
  chat: '<path d="M4 5h16v10H9l-4 4V5Z"/><path d="M8 9h8M8 12h5"/>',
  receipt: '<path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5V3Z"/><path d="M9 8h6M9 11h6M9 14h4"/>',
  box: '<path d="M3.5 7.5 12 3l8.5 4.5L12 12 3.5 7.5Z"/><path d="M3.5 7.5V16.5L12 21l8.5-4.5V7.5"/><path d="M12 12v9"/>',
  wand: '<path d="M5 19 16 8"/><path d="M14 4l1.2 2.6L18 8l-2.8 1.4L14 12l-1.2-2.6L10 8l2.8-1.4L14 4Z"/><path d="M5 4v3M3.5 5.5h3"/>',
  link: '<path d="M9.5 14.5 14.5 9.5"/><path d="M8 16l-2 2a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5-.5"/><path d="M16 8l2-2a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 .5"/>',
  wallet: '<path d="M3 7.5A2 2 0 0 1 5 5.5h13a1.5 1.5 0 0 1 1.5 1.5v10A2 2 0 0 1 17.5 19H5A2 2 0 0 1 3 17V7.5Z"/><path d="M16.5 12.5h2.5v3h-2.5a1.5 1.5 0 1 1 0-3Z"/><path d="M3 8.5 13 5"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.3"/><path d="M15.5 14a4.8 4.8 0 0 1 5 6"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4V8Z"/><circle cx="12" cy="13.5" r="3.3"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="15" rx="1.5"/><path d="M4 10h16M8 3.5v3M16 3.5v3"/><path d="M8 14h2M11 14h2M14 14h2M8 17h2"/>',
  home: '<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>',
  shop: '<path d="M4 9 5.5 4h13L20 9"/><path d="M4 9h16v11H4V9Z"/><path d="M9 20v-5.5h6V20"/>',
  scissors: '<circle cx="6.5" cy="6.5" r="2.2"/><circle cx="6.5" cy="17.5" r="2.2"/><path d="M8.2 8 19 19M19 5 8.2 16"/>',
  restaurant: '<path d="M6 3v8a2 2 0 1 0 4 0V3M8 3v6M4 3v6"/><path d="M17 3s-2.5 2-2.5 5.5S17 12 17 12v9"/>',
  truck: '<path d="M3 7h10v9H3V7Z"/><path d="M13 10h4l3 3v3h-7v-6Z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
  check: '<path d="M5 12.5 9.5 17 19 6.5"/>',
  arrowBack: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  vat: '<path d="M4 4h16v16H4z" opacity="0"/><path d="M6 4h9l3 3v13H6V4Z"/><path d="M15 4v3h3"/><path d="M8.5 13.5 14.5 17M8.7 13.3a1.4 1.4 0 1 0 2 2 1.4 1.4 0 0 0-2-2ZM12.8 15.3a1.4 1.4 0 1 0 2 2 1.4 1.4 0 0 0-2-2Z"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.4.3.5.8.5 1.3V16h6v-.8c0-.5.1-1 .5-1.3A6 6 0 0 0 12 3Z"/>',
  clock: '<circle cx="12" cy="12.5" r="8.5"/><path d="M12 8v5l3.5 2"/><path d="M9 2h6"/>',
};

export function icon(name, className = "") {
  const d = PATHS[name] || PATHS.check;
  const cls = `icon${className ? " " + className : ""}`;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}
