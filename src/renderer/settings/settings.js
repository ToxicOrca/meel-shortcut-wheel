// Settings renderer. Loads config from main, renders editors for slices,
// trigger, and appearance, and saves back. contextIsolation is on, so all
// privileged calls go through the `window.meel` bridge from the preload.

'use strict';

let config = null;

// Maps uiohook mouse button numbers to friendly names.
const MOUSE_NAMES = { 1: 'Left click', 2: 'Right click', 3: 'Middle click', 4: 'Mouse button 4 (back)', 5: 'Mouse button 5 (forward)' };

// Which params each action type needs. Drives the dynamic param editor.
const ACTION_PARAMS = {
  LaunchProgram: [
    { key: 'path', label: 'Program', type: 'file' },
    { key: 'args', label: 'Arguments', type: 'list' },
    { key: 'cwd', label: 'Working dir', type: 'folder' }
  ],
  Screenshot: [
    { key: 'mode', label: 'Mode', type: 'select', options: ['full', 'region'] },
    { key: 'saveDir', label: 'Save folder', type: 'folder' },
    { key: 'toClipboard', label: 'Also copy to clipboard', type: 'checkbox' }
  ],
  OpenURL: [{ key: 'url', label: 'URL', type: 'text' }],
  OpenFolder: [{ key: 'path', label: 'Folder', type: 'folder' }],
  RunCommand: [
    { key: 'command', label: 'Command', type: 'text' },
    { key: 'cwd', label: 'Working dir', type: 'folder' }
  ],
  SendHotkey: [{ key: 'combo', label: 'Hotkey (e.g. Ctrl+Shift+S)', type: 'text' }],
  MediaKey: [{ key: 'key', label: 'Media key', type: 'select', options: ['play_pause', 'next', 'prev', 'stop', 'volume_up', 'volume_down', 'volume_mute'] }],
  SubWheel: [{ key: 'slices', label: 'Sub-slices', type: 'subwheel' }]
};

const THEME_KEYS = [
  ['background', 'Wheel background'],
  ['slice', 'Slice fill'],
  ['sliceHover', 'Selected slice'],
  ['border', 'Slice border'],
  ['text', 'Text'],
  ['textDim', 'Dim text'],
  ['centerDot', 'Center dot']
];

const THEME_PRESETS = {
  'Default Dark': { background: '#14161c', slice: '#1e222c', sliceHover: '#2b64f5', border: '#2a2f3a', text: '#e6e9f0', textDim: '#8b93a7', centerDot: '#2b64f5' },
  'Midnight Blue': { background: '#0d1117', slice: '#161b22', sliceHover: '#1f6feb', border: '#21262d', text: '#c9d1d9', textDim: '#6e7681', centerDot: '#1f6feb' },
  'Deep Purple': { background: '#1a1025', slice: '#241734', sliceHover: '#7c3aed', border: '#2e1f44', text: '#e2ddf5', textDim: '#8b7faa', centerDot: '#7c3aed' },
  'Nord': { background: '#2e3440', slice: '#3b4252', sliceHover: '#5e81ac', border: '#434c5e', text: '#eceff4', textDim: '#a0a8b8', centerDot: '#88c0d0' },
  'Ember': { background: '#1a1210', slice: '#261c18', sliceHover: '#e5484d', border: '#3a2a24', text: '#f0e6e0', textDim: '#a08878', centerDot: '#e5484d' },
  'Forest': { background: '#0f1a12', slice: '#162118', sliceHover: '#2ea043', border: '#243028', text: '#d8f0dc', textDim: '#7ca085', centerDot: '#2ea043' },
  'Slate': { background: '#1e2024', slice: '#27292e', sliceHover: '#6b7280', border: '#35383e', text: '#e5e7eb', textDim: '#9ca3af', centerDot: '#6b7280' },
  'Dracula': { background: '#282a36', slice: '#343746', sliceHover: '#bd93f9', border: '#44475a', text: '#f8f8f2', textDim: '#6272a4', centerDot: '#ff79c6' },
  'Monokai': { background: '#272822', slice: '#32332d', sliceHover: '#a6e22e', border: '#3e3f38', text: '#f8f8f2', textDim: '#888880', centerDot: '#f92672' },
  'Ocean': { background: '#0b1929', slice: '#132337', sliceHover: '#0ea5e9', border: '#1c3150', text: '#dce8f5', textDim: '#6889a8', centerDot: '#0ea5e9' }
};

const SIZE_PRESETS = {
  'Compact': { wheelRadius: 100, innerRadius: 35, sliceGapDeg: 2, animationMs: 80 },
  'Default': { wheelRadius: 150, innerRadius: 55, sliceGapDeg: 3, animationMs: 120 },
  'Large': { wheelRadius: 200, innerRadius: 70, sliceGapDeg: 3, animationMs: 140 },
  'Extra Large': { wheelRadius: 260, innerRadius: 90, sliceGapDeg: 4, animationMs: 160 },
  'Tight': { wheelRadius: 140, innerRadius: 60, sliceGapDeg: 1, animationMs: 100 },
  'Spacious': { wheelRadius: 180, innerRadius: 50, sliceGapDeg: 6, animationMs: 120 }
};

// ---- Emoji data (compact set, grouped by category) -------------------------

const EMOJI_CATEGORIES = [
  { name: '😀', label: 'Smileys', emojis: '😀😃😄😁😆😅🤣😂🙂😊😇🥰😍🤩😘😗😚😙🥲😋😛😜🤪😝🤑🤗🤭🤫🤔🫡🤐🫠😐😑😶🫥😏😒🙄😬🤥😌😔😪🤤😴😷🤒🤕🤢🤮🤧🥵🥶🥴😵🤯🤠🥳🥸😎🤓🧐😕🫤😟🙁😮😯😲😳🥺🥹😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬' },
  { name: '👋', label: 'People', emojis: '👋🤚🖐️✋🖖👌🤌🤏✌️🤞🫰🤟🤘🤙🫵🫱🫲🫳🫴👈👉👆🖕👇☝️👍👎✊👊🤛🤜👏🙌🫶👐🤲🤝🙏💪🦾🦿🦵🦶👂🦻👃🧠🫁🦷🦴👀👁️👅👄' },
  { name: '🐱', label: 'Animals', emojis: '🐶🐱🐭🐹🐰🦊🐻🐼🐻‍❄️🐨🐯🦁🐮🐷🐸🐵🙈🙉🙊🐒🐔🐧🐦🐤🐣🐥🦆🦅🦉🦇🐺🐗🐴🦄🐝🪱🐛🦋🐌🐞🐜🪳🪲🐢🐍🦎🦖🦕🐙🦑🦐🦞🦀🐡🐠🐟🐬🐳🐋🦈🦭🐊🐅🐆🦓🦍🦧🦣🐘🦛🦏🐪🐫🦒🦘🦬🐃🐂🐄🐎🐖🐏🐑🦙🐐🦌🐕🐩🦮🐈🐓🦃🦤🦚🦜🦢🦩🐇🦝🦨🦡🦫🦦🦥🐁🐀🐿️🦔🐾🐉🐲' },
  { name: '🍎', label: 'Food', emojis: '🍏🍎🍐🍊🍋🍌🍉🍇🍓🫐🍈🍒🍑🥭🍍🥥🥝🍅🍆🥑🥦🥬🥒🌶️🫑🌽🥕🫒🧄🧅🥔🍠🥐🥯🍞🥖🥨🧀🥚🍳🧈🥞🧇🥓🥩🍗🍖🦴🌭🍔🍟🍕🫓🥪🥙🧆🌮🌯🫔🥗🥘🫕🥫🍝🍜🍲🍛🍣🍱🥟🦪🍤🍙🍚🍘🍥🥠🥮🍢🍡🍧🍨🍦🥧🧁🍰🎂🍮🍭🍬🍫🍿🍩🍪🌰🥜🍯🥛🍼🫖☕🍵🧃🥤🧋🍶🍺🍻🥂🍷🥃🍸🍹🧉🍾🧊' },
  { name: '⚽', label: 'Activities', emojis: '⚽🏀🏈⚾🥎🎾🏐🏉🥏🎱🪀🏓🏸🏒🏑🥍🏏🪃🥅⛳🪁🏹🎣🤿🥊🥋🎽🛹🛼🛷⛸️🥌🎿⛷️🏂🪂🏋️🤸🤺⛹️🏇🧘🏄🏊🤽🚣🧗🚵🚴🏆🥇🥈🥉🏅🎖️🏵️🎗️🎪🤹🎭🩰🎨🎬🎤🎧🎼🎹🥁🪘🎷🎺🎸🪕🎻🎲♟️🎯🎳🎮🎰🧩' },
  { name: '🚗', label: 'Travel', emojis: '🚗🚕🚙🚌🚎🏎️🚓🚑🚒🚐🛻🚚🚛🚜🏍️🛵🦽🦼🛺🚲🛴🛹🛼🚏🛣️🛤️🛞⛽🛞🚨🚥🚦🛑🚧⚓🛟⛵🛶🚤🛳️⛴️🛥️🚢✈️🛩️🛫🛬🪂💺🚁🚟🚠🚡🛰️🚀🛸🌍🌎🌏🗺️🧭🏔️⛰️🌋🗻🏕️🏖️🏜️🏝️🏞️' },
  { name: '💡', label: 'Objects', emojis: '⌚📱📲💻⌨️🖥️🖨️🖱️🖲️🕹️🗜️💽💾💿📀📼📷📸📹🎥📽️🎞️📞☎️📟📠📺📻🎙️🎚️🎛️🧭⏱️⏲️⏰🕰️⌛⏳📡🔋🪫🔌💡🔦🕯️🪔🧯🛢️💸💵💴💶💷🪙💰💳💎⚖️🪜🧰🪛🔧🔨⚒️🛠️⛏️🪚🔩⚙️🪤🧲🔫💣🧨🪓🔪🗡️⚔️🛡️🚬⚰️🪦⚱️🏺🔮📿🧿🪬💈⚗️🔭🔬🕳️🩹🩺🩻💊💉🩸🧬🦠🧫🧪🌡️🧹🪠🧺🧻🚰🚿🛁🛀🪥🪒🧴🪮🧽🪣🧯🛒🚬🪑🪞🪟🛏️🛋️🪑🚪🧳' },
  { name: '🔣', label: 'Symbols', emojis: '❤️🧡💛💚💙💜🖤🤍🤎💔❤️‍🔥❤️‍🩹❣️💕💞💓💗💖💘💝💟☮️✝️☪️🕉️☸️🪯✡️🔯🕎☯️☦️🛐⛎♈♉♊♋♌♍♎♏♐♑♒♓🆔⚛️🉑☢️☣️📴📳🈶🈚🈸🈺🈷️✴️🆚💮🉐㊗️㊙️🈴🈵🈹🈲🅰️🅱️🆎🆑🅾️🆘❌⭕🛑⛔📛🚫💯💢♨️🚷🚯🚳🚱🔞📵🚭❗❕❓❔‼️⁉️🔅🔆〽️⚠️🚸🔱⚜️🔰♻️✅🈯💹❇️✳️❎🌐💠Ⓜ️🌀💤🏧🚾♿🅿️🛗🈳🈂️🛂🛃🛄🛅🚹🚺🚼⚧🚻🚮🎦📶🈁🔣ℹ️🔤🔡🔠🆖🆗🆙🆒🆕🆓0️⃣1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣🔟🔢#️⃣*️⃣⏏️▶️⏸️⏯️⏹️⏺️⏭️⏮️⏩⏪⏫⏬◀️🔼🔽➡️⬅️⬆️⬇️↗️↘️↙️↖️↕️↔️↩️↪️⤴️⤵️🔀🔁🔂🔄🔃🎵🎶➕➖➗✖️🟰♾️💲💱™️©️®️〰️➰➿🔚🔙🔛🔝🔜✔️☑️🔘🔴🟠🟡🟢🔵🟣⚫⚪🟤🔺🔻🔸🔹🔶🔷🔳🔲▪️▫️◾◽◼️◻️🟥🟧🟨🟩🟦🟪⬛⬜🟫🔈🔇🔉🔊🔔🔕📣📢' }
];

// Currently open emoji picker element (only one at a time).
let openEmojiPicker = null;

function closeEmojiPicker() {
  if (openEmojiPicker) { openEmojiPicker.remove(); openEmojiPicker = null; }
  document.removeEventListener('mousedown', onDocClickClosePicker);
}

function onDocClickClosePicker(e) {
  if (!openEmojiPicker) return;
  // Don't close if the click is inside the picker or on the button that opened it
  if (openEmojiPicker.contains(e.target)) return;
  if (e.target.closest && e.target.closest('.slice-emoji-btn')) return;
  closeEmojiPicker();
}

function showEmojiPicker(anchor, onPick) {
  closeEmojiPicker();
  const picker = document.createElement('div');
  picker.className = 'emoji-picker';

  // Category tabs
  const tabs = document.createElement('div');
  tabs.className = 'emoji-picker-tabs';
  EMOJI_CATEGORIES.forEach((cat, ci) => {
    const btn = document.createElement('button');
    btn.textContent = cat.name;
    btn.title = cat.label;
    if (ci === 0) btn.classList.add('active');
    btn.addEventListener('click', () => {
      tabs.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderGrid(cat.emojis);
      searchInput.value = '';
    });
    tabs.appendChild(btn);
  });
  picker.appendChild(tabs);

  // Search
  const searchInput = document.createElement('input');
  searchInput.className = 'emoji-picker-search';
  searchInput.placeholder = 'Type to filter…';
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    if (!q) {
      const activeIdx = [...tabs.querySelectorAll('button')].findIndex((b) => b.classList.contains('active'));
      renderGrid(EMOJI_CATEGORIES[Math.max(0, activeIdx)].emojis);
    } else {
      // Show all emojis that include the search term (basic text match)
      const all = EMOJI_CATEGORIES.map((c) => c.emojis).join('');
      renderGrid(all);
    }
  });
  picker.appendChild(searchInput);

  // Grid
  const grid = document.createElement('div');
  grid.className = 'emoji-picker-grid';
  picker.appendChild(grid);

  function renderGrid(emojiStr) {
    grid.innerHTML = '';
    const emojis = splitEmojis(emojiStr);
    emojis.forEach((em) => {
      const btn = document.createElement('button');
      btn.textContent = em;
      btn.addEventListener('click', () => { onPick(em); closeEmojiPicker(); });
      grid.appendChild(btn);
    });
  }

  renderGrid(EMOJI_CATEGORIES[0].emojis);

  anchor.appendChild(picker);
  openEmojiPicker = picker;
  setTimeout(() => document.addEventListener('mousedown', onDocClickClosePicker), 0);
}

// Split a string into grapheme clusters (handles multi-codepoint emoji).
function splitEmojis(str) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(str)].map((s) => s.segment);
  }
  return Array.from(str);
}

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  });
  kids.forEach((c) => n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return n;
};

// ---- Init -------------------------------------------------------------------

async function init() {
  config = await window.meel.getConfig();
  const state = await window.meel.getState();
  $('#enabledToggle').checked = !!state.enabled;
  $('#enabledLabel').textContent = state.enabled ? 'Enabled' : 'Disabled';

  wireTabs();
  wireGlobalControls();
  await wireAdvanced();
  renderAll();

  window.meel.onConfigChanged((cfg) => { config = cfg; renderAll(); });
  window.meel.onTriggerCaptured((input) => applyCapturedTrigger(input));
}

// Advanced panel: config path (read-only) + start-on-login toggle.
async function wireAdvanced() {
  try {
    const p = await window.meel.getConfigPath();
    $('#configPath').textContent = p || '—';
  } catch { /* non-fatal */ }

  const loginToggle = $('#startOnLogin');
  if (loginToggle) {
    try {
      const { openAtLogin } = await window.meel.getLoginItem();
      loginToggle.checked = !!openAtLogin;
    } catch { /* non-fatal */ }
    loginToggle.addEventListener('change', async (e) => {
      const result = await window.meel.setLoginItem(e.target.checked);
      loginToggle.checked = !!result;
      status(result ? 'Will start on login' : 'Won\'t start on login');
    });
  }
}

function renderAll() {
  renderSlices();
  renderTrigger();
  renderAppearance();
  renderProfiles();
}

// ---- Tabs -------------------------------------------------------------------

function wireTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      $('#tab-' + tab.dataset.tab).classList.add('active');
    });
  });
}

// ---- Slices -----------------------------------------------------------------

function activeProfile() {
  return config.profiles[config.activeProfile];
}

function renderSlices() {
  const list = $('#sliceList');
  list.innerHTML = '';
  const slices = activeProfile().slices;
  slices.forEach((slice, idx) => list.appendChild(sliceCard(slice, idx, activeProfile().slices, renderSlices)));
  renderPreview();
}

// sliceCard is reusable for top-level and nested sub-slices.
// slicesArray: the array this slice belongs to (for reorder/remove).
// onChanged: callback to re-render the slice list after mutations.
function sliceCard(slice, idx, slicesArray, onChanged) {
  const tpl = $('#sliceTemplate').content.cloneNode(true);
  const card = tpl.querySelector('.slice-card');
  card.dataset.id = slice.id;

  const iconInput = card.querySelector('.slice-icon');
  const iconImg = card.querySelector('.slice-icon-img');
  const emojiBtn = card.querySelector('.slice-emoji-btn');
  const importBtn = card.querySelector('.slice-import-icon-btn');
  const clearBtn = card.querySelector('.slice-clear-icon-btn');

  // Show imported icon image if present
  function refreshIconDisplay() {
    if (slice.iconImage) {
      iconImg.src = slice.iconImage;
      iconImg.style.display = '';
      iconInput.style.display = 'none';
      clearBtn.style.display = '';
    } else {
      iconImg.style.display = 'none';
      iconInput.style.display = '';
      clearBtn.style.display = 'none';
    }
  }

  iconInput.value = slice.icon || '';
  iconInput.addEventListener('input', (e) => { slice.icon = e.target.value; renderPreview(); });
  refreshIconDisplay();

  // Emoji picker
  emojiBtn.addEventListener('click', () => {
    showEmojiPicker(card.querySelector('.slice-icon-wrap'), (emoji) => {
      slice.icon = emoji;
      slice.iconImage = null;
      iconInput.value = emoji;
      refreshIconDisplay();
      renderPreview();
    });
  });

  // Import program icon — shown for LaunchProgram when a path is set,
  // but also available via right-click or when the auto-extract fails by
  // falling back to a file picker (useful for .lnk shortcuts, Electron/PWA
  // web apps, etc.).
  function updateImportBtnVisibility() {
    importBtn.style.display = (slice.action.type === 'LaunchProgram') ? '' : 'none';
  }
  updateImportBtnVisibility();

  importBtn.addEventListener('click', async () => {
    let dataUri = null;
    status('Extracting icon…');
    try {
      // Try the configured program path first
      if (slice.action.path) {
        dataUri = await window.meel.extractIcon(slice.action.path);
      }
      // If that didn't work (or no path), let the user browse for a file
      if (!dataUri) {
        if (slice.action.path) status('Auto-extract failed — pick a file…');
        const picked = await window.meel.pickIconSource();
        if (!picked) return;
        dataUri = await window.meel.extractIcon(picked);
      }
    } catch (err) {
      status('Error: ' + err.message);
      return;
    }
    if (dataUri) {
      slice.iconImage = dataUri;
      slice.icon = '';
      iconInput.value = '';
      refreshIconDisplay();
      renderPreview();
      status('Icon imported (' + dataUri.length + ' bytes)');
    } else {
      status('Could not extract icon');
    }
  });

  // Clear imported icon
  clearBtn.addEventListener('click', () => {
    slice.iconImage = null;
    refreshIconDisplay();
    renderPreview();
  });

  card.querySelector('.slice-label-in').value = slice.label || '';
  card.querySelector('.slice-label-in').addEventListener('input', (e) => { slice.label = e.target.value; renderPreview(); });

  card.querySelector('.slice-color').value = slice.color || '#1e222c';
  card.querySelector('.slice-color').addEventListener('input', (e) => { slice.color = e.target.value; renderPreview(); });

  // Reorder within the slices array (top → clockwise on the wheel).
  card.querySelector('.slice-up').addEventListener('click', () => {
    const i = slicesArray.findIndex((s) => s.id === slice.id);
    if (i > 0) { [slicesArray[i], slicesArray[i - 1]] = [slicesArray[i - 1], slicesArray[i]]; onChanged(); }
  });
  card.querySelector('.slice-down').addEventListener('click', () => {
    const i = slicesArray.findIndex((s) => s.id === slice.id);
    if (i >= 0 && i < slicesArray.length - 1) { [slicesArray[i], slicesArray[i + 1]] = [slicesArray[i + 1], slicesArray[i]]; onChanged(); }
  });

  // Action type dropdown
  const typeSel = card.querySelector('.slice-action-type');
  window.meel.actionTypes.forEach((t) => typeSel.appendChild(el('option', { value: t }, t)));
  typeSel.value = slice.action.type;
  typeSel.addEventListener('change', (e) => {
    const newType = e.target.value;
    slice.action = newType === 'SubWheel' ? { type: 'SubWheel', slices: [] } : { type: newType };
    renderActionParams(card, slice, updateImportBtnVisibility, slicesArray, onChanged);
    updateImportBtnVisibility();
    updateNestBtnVisibility();
    renderPreview();
  });

  // Nest button: convert this slice to a SubWheel (or hide if already one)
  const nestBtn = card.querySelector('.slice-nest-btn');
  function updateNestBtnVisibility() {
    nestBtn.style.display = (slice.action.type === 'SubWheel') ? 'none' : '';
  }
  updateNestBtnVisibility();
  nestBtn.addEventListener('click', () => {
    // Wrap the current action as the first sub-slice, then convert to SubWheel
    const oldAction = Object.assign({}, slice.action);
    const oldLabel = slice.label || 'Action';
    slice.action = {
      type: 'SubWheel',
      slices: [
        { id: 'sub-' + Date.now(), label: oldLabel, icon: slice.icon || '⭐', color: null, action: oldAction }
      ]
    };
    typeSel.value = 'SubWheel';
    renderActionParams(card, slice, updateImportBtnVisibility, slicesArray, onChanged);
    updateImportBtnVisibility();
    updateNestBtnVisibility();
    renderPreview();
  });

  card.querySelector('.slice-remove').addEventListener('click', () => {
    const i = slicesArray.findIndex((s) => s.id === slice.id);
    if (i >= 0) slicesArray.splice(i, 1);
    onChanged();
  });

  renderActionParams(card, slice, updateImportBtnVisibility, slicesArray, onChanged);
  return card;
}

// ---- Live preview -----------------------------------------------------------
// A scaled-down copy of the real overlay wheel so edits (labels, colors, count,
// theme, gap) are visible before saving. Mirrors overlay.js geometry.

const SVG_NS = 'http://www.w3.org/2000/svg';

function renderPreview() {
  const svg = $('#wheelPreview');
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const a = config.appearance;
  const t = a.theme || {};
  const slices = activeProfile().slices;
  const n = slices.length;
  const cx = 150, cy = 150;
  // Shrink the main ring to leave room for sub-rings outside
  const outer = 85, inner = Math.max(20, Math.min(60, (a.innerRadius / a.wheelRadius) * outer));
  const gap = ((a.sliceGapDeg || 0) * Math.PI) / 180;

  // Background disc — covers full preview area
  const bg = document.createElementNS(SVG_NS, 'circle');
  bg.setAttribute('cx', cx); bg.setAttribute('cy', cy); bg.setAttribute('r', 148);
  bg.setAttribute('fill', t.background || '#14161c');
  svg.appendChild(bg);

  const startOffset = -Math.PI / 2;
  const seg = n ? (2 * Math.PI) / n : 0;

  renderPreviewRing(svg, slices, cx, cy, inner, outer, startOffset - seg / 2, startOffset + (2 * Math.PI) - seg / 2, gap, a, t, 0, outer - inner);

  // Center dot
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('r', 4);
  dot.setAttribute('fill', t.centerDot || '#2b64f5');
  svg.appendChild(dot);
}

function renderPreviewRing(svg, slices, cx, cy, innerR, outerR, startAngle, endAngle, gap, a, t, depth, parentWidth) {
  const n = slices.length;
  if (!n) return;
  const totalAngle = endAngle - startAngle;
  const seg = totalAngle / n;
  const fontScale = Math.max(0.45, 1 - depth * 0.35);
  const subGap = 3;

  slices.forEach((slice, i) => {
    const mid = startAngle + (i + 0.5) * seg;
    const sStart = startAngle + i * seg + gap / 2;
    const sEnd = startAngle + (i + 1) * seg - gap / 2;

    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', wedge(cx, cy, innerR, outerR, sStart, sEnd));
    p.setAttribute('fill', slice.color || t.slice || '#1e222c');
    p.setAttribute('stroke', t.border || '#2a2f3a');
    svg.appendChild(p);

    // Label/icon
    const lr = (innerR + outerR) / 2;
    const lx = cx + Math.cos(mid) * lr;
    const ly = cy + Math.sin(mid) * lr;
    const arcLen = (sEnd - sStart) * lr;

    if (arcLen > 10) {
      if (slice.iconImage) {
        const imgSize = Math.round(16 * fontScale);
        const img = document.createElementNS(SVG_NS, 'image');
        img.setAttribute('href', slice.iconImage);
        img.setAttribute('x', lx - imgSize / 2);
        img.setAttribute('y', ly - imgSize / 2);
        img.setAttribute('width', imgSize);
        img.setAttribute('height', imgSize);
        svg.appendChild(img);
      } else {
        const showIcon = slice.icon;
        const showLabel = a.showLabels !== false && slice.label;
        if (showIcon || showLabel) {
          const txt = document.createElementNS(SVG_NS, 'text');
          txt.setAttribute('x', lx); txt.setAttribute('y', ly);
          txt.setAttribute('fill', t.text || '#e6e9f0');
          txt.setAttribute('font-size', Math.round((showIcon ? 13 : 9) * fontScale));
          txt.setAttribute('text-anchor', 'middle');
          txt.setAttribute('dominant-baseline', 'middle');
          txt.textContent = showIcon ? slice.icon : slice.label;
          svg.appendChild(txt);
        }
      }
    }

    // Recurse into SubWheel children — rendered as outer ring at actual position
    if (slice.action && slice.action.type === 'SubWheel' && Array.isArray(slice.action.slices) && slice.action.slices.length > 0) {
      const subInner = outerR + subGap;
      const subWidth = Math.max(18, parentWidth * 0.55);
      const subOuter = subInner + subWidth;
      renderPreviewRing(svg, slice.action.slices, cx, cy, subInner, subOuter, sStart, sEnd, gap * 0.7, a, t, depth + 1, subWidth);
    }
  });
}

function wedge(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  const [x0o, y0o] = p(r1, a0);
  const [x1o, y1o] = p(r1, a1);
  const [x1i, y1i] = p(r0, a1);
  const [x0i, y0i] = p(r0, a0);
  const large = (a1 - a0) > Math.PI ? 1 : 0;
  return `M ${x0o} ${y0o} A ${r1} ${r1} 0 ${large} 1 ${x1o} ${y1o} L ${x1i} ${y1i} A ${r0} ${r0} 0 ${large} 0 ${x0i} ${y0i} Z`;
}

function renderActionParams(card, slice, onPathChange, slicesArray, onChanged) {
  const wrap = card.querySelector('.slice-action-params');
  wrap.innerHTML = '';
  const params = ACTION_PARAMS[slice.action.type] || [];
  params.forEach((param) => wrap.appendChild(paramRow(slice, param, onPathChange, slicesArray, onChanged)));
}

function paramRow(slice, param, onPathChange, slicesArray, onChanged) {
  const val = slice.action[param.key];
  const row = el('div', { class: 'row' }, el('label', {}, param.label));

  if (param.type === 'checkbox') {
    const input = el('input', { type: 'checkbox' });
    input.checked = !!val;
    input.addEventListener('change', (e) => { slice.action[param.key] = e.target.checked; });
    row.appendChild(input);
  } else if (param.type === 'select') {
    const sel = el('select', {});
    param.options.forEach((o) => sel.appendChild(el('option', { value: o }, o)));
    sel.value = val || param.options[0];
    sel.addEventListener('change', (e) => { slice.action[param.key] = e.target.value; renderPreview(); });
    row.appendChild(sel);
  } else if (param.type === 'file' || param.type === 'folder') {
    const input = el('input', { type: 'text', value: val || '' });
    input.addEventListener('input', (e) => {
      slice.action[param.key] = e.target.value;
      if (param.key === 'path' && onPathChange) onPathChange();
    });
    const btn = el('button', { class: 'btn tiny' }, 'Browse…');
    btn.addEventListener('click', async () => {
      const picked = param.type === 'file' ? await window.meel.pickFile() : await window.meel.pickFolder();
      if (picked) {
        slice.action[param.key] = picked;
        input.value = picked;
        if (param.key === 'path' && onPathChange) onPathChange();
      }
    });
    row.appendChild(input);
    row.appendChild(btn);
  } else if (param.type === 'list') {
    const input = el('input', { type: 'text', value: Array.isArray(val) ? val.join(' ') : (val || '') });
    input.addEventListener('input', (e) => {
      slice.action[param.key] = e.target.value.trim() ? e.target.value.trim().split(/\s+/) : [];
    });
    row.appendChild(input);
  } else if (param.type === 'subwheel') {
    // Inline sub-slice editor for SubWheel action type
    row.innerHTML = '';
    const container = el('div', { class: 'subwheel-editor' });
    const subSlices = slice.action.slices || [];
    slice.action.slices = subSlices; // ensure reference is set

    function renderSubSlices() {
      container.innerHTML = '';
      const heading = el('div', { class: 'subwheel-header' },
        el('label', {}, `Sub-slices (${subSlices.length})`));
      container.appendChild(heading);

      subSlices.forEach((sub, si) => {
        container.appendChild(sliceCard(sub, si, subSlices, () => { renderSubSlices(); renderPreview(); }));
      });

      const addBtn = el('button', { class: 'btn tiny primary' }, '+ Add sub-slice');
      addBtn.addEventListener('click', () => {
        subSlices.push({
          id: 'sub-' + Date.now(),
          label: 'New',
          icon: '⭐',
          color: null,
          action: { type: 'LaunchProgram', path: '', args: [] }
        });
        renderSubSlices();
        renderPreview();
      });
      container.appendChild(addBtn);
    }

    renderSubSlices();
    row.appendChild(container);
  } else {
    const input = el('input', { type: 'text', value: val || '' });
    input.addEventListener('input', (e) => { slice.action[param.key] = e.target.value; });
    row.appendChild(input);
  }
  return row;
}

// ---- Trigger ----------------------------------------------------------------

function renderTrigger() {
  $('#triggerDisplay').textContent = describeTrigger(config.trigger);
  $('#triggerMode').value = config.trigger.mode || 'hold';
  $('#triggerMode').onchange = (e) => { config.trigger.mode = e.target.value; };
}

function describeTrigger(t) {
  if (!t) return '—';
  if (t.type === 'mouse') return MOUSE_NAMES[t.button] || ('Mouse button ' + t.button);
  if (t.type === 'keyboard') return 'Key code ' + t.keycode;
  return '—';
}

function applyCapturedTrigger(input) {
  config.trigger.type = input.type;
  if (input.type === 'mouse') { config.trigger.button = input.button; config.trigger.keycode = null; }
  else { config.trigger.keycode = input.keycode; }
  $('#captureHint').style.display = 'none';
  renderTrigger();
  status('Trigger set to ' + describeTrigger(config.trigger));
}

// ---- Appearance -------------------------------------------------------------

function renderAppearance() {
  const a = config.appearance;

  // ---- Size preset ----
  const sizeSel = $('#sizePreset');
  sizeSel.innerHTML = '<option value="">Custom</option>';
  Object.keys(SIZE_PRESETS).forEach((name) => {
    sizeSel.appendChild(el('option', { value: name }, name));
  });
  // Detect if current values match a preset
  const matchSize = Object.entries(SIZE_PRESETS).find(([, p]) =>
    p.wheelRadius === a.wheelRadius && p.innerRadius === a.innerRadius &&
    p.sliceGapDeg === a.sliceGapDeg && p.animationMs === a.animationMs
  );
  sizeSel.value = matchSize ? matchSize[0] : '';
  sizeSel.onchange = (e) => {
    const p = SIZE_PRESETS[e.target.value];
    if (!p) return;
    Object.assign(a, p);
    $('#wheelRadius').value = a.wheelRadius;
    $('#innerRadius').value = a.innerRadius;
    $('#sliceGapDeg').value = a.sliceGapDeg;
    $('#animationMs').value = a.animationMs;
    renderPreview();
  };

  $('#wheelRadius').value = a.wheelRadius;
  $('#innerRadius').value = a.innerRadius;
  $('#sliceGapDeg').value = a.sliceGapDeg;
  $('#animationMs').value = a.animationMs;
  $('#showLabels').checked = a.showLabels !== false;

  const markSizeCustom = () => { sizeSel.value = ''; };
  $('#wheelRadius').oninput = (e) => { a.wheelRadius = +e.target.value; markSizeCustom(); renderPreview(); };
  $('#innerRadius').oninput = (e) => { a.innerRadius = +e.target.value; markSizeCustom(); renderPreview(); };
  $('#sliceGapDeg').oninput = (e) => { a.sliceGapDeg = +e.target.value; markSizeCustom(); renderPreview(); };
  $('#animationMs').oninput = (e) => { a.animationMs = +e.target.value; markSizeCustom(); };
  $('#showLabels').onchange = (e) => { a.showLabels = e.target.checked; renderPreview(); };

  // ---- Theme preset ----
  const themeSel = $('#themePreset');
  themeSel.innerHTML = '<option value="">Custom</option>';
  Object.keys(THEME_PRESETS).forEach((name) => {
    themeSel.appendChild(el('option', { value: name }, name));
  });
  const matchTheme = Object.entries(THEME_PRESETS).find(([, p]) =>
    THEME_KEYS.every(([key]) => (a.theme[key] || '') === (p[key] || ''))
  );
  themeSel.value = matchTheme ? matchTheme[0] : '';
  themeSel.onchange = (e) => {
    const p = THEME_PRESETS[e.target.value];
    if (!p) return;
    Object.assign(a.theme, p);
    renderAppearance(); // re-render color pickers with new values
    renderPreview();
  };

  // ---- Theme color pickers ----
  const wrap = $('#themeColors');
  wrap.innerHTML = '';
  THEME_KEYS.forEach(([key, label]) => {
    const field = el('div', { class: 'field' }, el('label', {}, label));
    const input = el('input', { type: 'color', value: a.theme[key] || '#1e222c' });
    input.addEventListener('input', (e) => { a.theme[key] = e.target.value; themeSel.value = ''; renderPreview(); });
    field.appendChild(input);
    wrap.appendChild(field);
  });
}

// ---- Profiles ---------------------------------------------------------------

function renderProfiles() {
  const sel = $('#activeProfile');
  sel.innerHTML = '';
  Object.entries(config.profiles).forEach(([id, p]) => {
    sel.appendChild(el('option', { value: id }, p.name || id));
  });
  sel.value = config.activeProfile;
  sel.onchange = (e) => { config.activeProfile = e.target.value; renderSlices(); };
}

// ---- Global controls --------------------------------------------------------

function wireGlobalControls() {
  $('#addSlice').addEventListener('click', () => {
    activeProfile().slices.push({
      id: 'slice-' + Date.now(),
      label: 'New',
      icon: '⭐',
      color: null,
      action: { type: 'LaunchProgram', path: '', args: [] }
    });
    renderSlices();
  });

  $('#captureTrigger').addEventListener('click', async () => {
    $('#captureHint').style.display = 'block';
    await window.meel.listenForTrigger();
  });

  $('#saveConfig').addEventListener('click', async () => {
    await window.meel.saveConfig(config);
    status('Saved ✓', true);
  });

  $('#resetConfig').addEventListener('click', async () => {
    config = await window.meel.resetConfig();
    renderAll();
    status('Reset to defaults');
  });

  $('#enabledToggle').addEventListener('change', async (e) => {
    const enabled = await window.meel.setEnabled(e.target.checked);
    $('#enabledLabel').textContent = enabled ? 'Enabled' : 'Disabled';
  });
}

function status(msg, ok) {
  const s = $('#statusMsg');
  s.textContent = msg;
  s.className = 'status' + (ok ? ' ok' : '');
  setTimeout(() => { s.textContent = ''; s.className = 'status'; }, 2500);
}

init();
