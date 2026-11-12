const KEY = 'ichat:prefs';

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export const prefs = {
  get(k, fallback) {
    const v = read()[k];
    return v === undefined ? fallback : v;
  },
  set(k, v) {
    const o = read();
    o[k] = v;
    try {
      localStorage.setItem(KEY, JSON.stringify(o));
    } catch {
      /* storage unavailable */
    }
  },
};

export function applyTheme(theme) {
  const el = document.documentElement;
  if (theme === 'light' || theme === 'dark') el.dataset.theme = theme;
  else delete el.dataset.theme;
}
