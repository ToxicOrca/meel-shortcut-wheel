// Config load/save. The active config lives in Electron's userData directory
// (e.g. %APPDATA%/Meel/meel-config.json on Windows). On first run we copy the
// shipped default from config/default-config.json.

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CONFIG_FILENAME = 'meel-config.json';

function userConfigPath() {
  return path.join(app.getPath('userData'), CONFIG_FILENAME);
}

function defaultConfigPath() {
  // Packaged: config/ is bundled next to the app root.
  return path.join(app.getAppPath(), 'config', 'default-config.json');
}

function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

// ---- Validation / migration ------------------------------------------------
// A user-editable JSON file can be malformed, partial, or from an older
// version. validateConfig() takes whatever we loaded and returns a guaranteed-
// well-formed config by deep-merging over the shipped defaults and coercing
// obviously-wrong types. It never throws: the app must always end up with a
// usable config.

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Recursively fill missing keys in `target` from `defaults` (does not overwrite
// values that already exist and are the right shape).
function mergeDefaults(target, defaults) {
  if (!isObject(target)) return JSON.parse(JSON.stringify(defaults));
  for (const key of Object.keys(defaults)) {
    if (isObject(defaults[key])) {
      target[key] = mergeDefaults(isObject(target[key]) ? target[key] : {}, defaults[key]);
    } else if (target[key] === undefined) {
      target[key] = JSON.parse(JSON.stringify(defaults[key]));
    }
  }
  return target;
}

function validateConfig(cfg, defaults) {
  const out = mergeDefaults(isObject(cfg) ? cfg : {}, defaults);

  // Top-level sanity.
  if (typeof out.enabled !== 'boolean') out.enabled = true;
  out.version = defaults.version;

  // Trigger.
  const t = out.trigger;
  if (t.type !== 'mouse' && t.type !== 'keyboard') t.type = 'mouse';
  if (t.mode !== 'hold' && t.mode !== 'toggle') t.mode = 'hold';
  if (t.type === 'mouse') {
    t.button = Number.isInteger(t.button) ? t.button : 4;
  } else {
    t.keycode = Number.isInteger(t.keycode) ? t.keycode : null;
  }

  // Appearance numbers must be finite and sane.
  const a = out.appearance;
  const num = (v, def, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  };
  a.wheelRadius = num(a.wheelRadius, 150, 60, 500);
  a.innerRadius = num(a.innerRadius, 55, 10, a.wheelRadius - 10);
  a.sliceGapDeg = num(a.sliceGapDeg, 3, 0, 30);
  a.animationMs = num(a.animationMs, 120, 0, 1000);
  if (typeof a.showLabels !== 'boolean') a.showLabels = true;
  a.subWheelGap = num(a.subWheelGap, 4, 0, 20);
  a.subWheelCollapsedWidth = num(a.subWheelCollapsedWidth, 8, 4, 30);

  // Profiles must exist and the active one must be present.
  if (!isObject(out.profiles) || Object.keys(out.profiles).length === 0) {
    out.profiles = JSON.parse(JSON.stringify(defaults.profiles));
  }
  if (!out.profiles[out.activeProfile]) {
    out.activeProfile = Object.keys(out.profiles)[0];
  }

  // Every profile needs a slices array; every slice needs id + action.type.
  // SubWheel slices are validated recursively.
  function validateSlices(slices, prefix) {
    return slices.filter(isObject).map((s, i) => {
      if (!s.id) s.id = `${prefix}-${i}`;
      if (!isObject(s.action) || !s.action.type) s.action = { type: 'LaunchProgram', path: '', args: [] };
      if (s.label === undefined) s.label = '';
      if (s.icon === undefined) s.icon = '';
      if (s.color === undefined) s.color = null;
      // Recurse into SubWheel children
      if (s.action.type === 'SubWheel') {
        if (!Array.isArray(s.action.slices)) s.action.slices = [];
        s.action.slices = validateSlices(s.action.slices, s.id);
        // Validate primaryAction if present
        if (s.action.primaryAction && (!isObject(s.action.primaryAction) || !s.action.primaryAction.type)) {
          delete s.action.primaryAction;
        }
      }
      return s;
    });
  }

  for (const [pid, profile] of Object.entries(out.profiles)) {
    if (!isObject(profile)) { delete out.profiles[pid]; continue; }
    if (!Array.isArray(profile.slices)) profile.slices = [];
    profile.slices = validateSlices(profile.slices, `slice-${pid}`);
  }

  return out;
}

// Load the user config, creating it from the default if it does not exist.
// Never throws to the caller: on any parse error it falls back to defaults so
// the app still launches (with a console warning).
function loadConfig() {
  const target = userConfigPath();
  const defaults = readJson(defaultConfigPath());
  try {
    if (!fs.existsSync(target)) {
      // First run: seed from defaults.
      const def = validateConfig(defaults, defaults);
      applyRuntimeDefaults(def);
      saveConfig(def);
      return def;
    }
    // Existing run: load, then validate/merge against current defaults so a
    // partial or older file is repaired rather than crashing the app.
    const loaded = validateConfig(readJson(target), defaults);
    applyRuntimeDefaults(loaded);
    return loaded;
  } catch (err) {
    console.error('[config] failed to load, using defaults:', err);
    const def = validateConfig(defaults, defaults);
    applyRuntimeDefaults(def);
    return def;
  }
}

// Fill in values that depend on the runtime environment (paths that don't
// exist at author time).
function applyRuntimeDefaults(cfg) {
  const shots = path.join(app.getPath('pictures'), 'Meel Screenshots');
  const profile = cfg.profiles && cfg.profiles[cfg.activeProfile];
  if (!profile) return;
  for (const slice of profile.slices) {
    if (slice.action && slice.action.type === 'Screenshot' && !slice.action.saveDir) {
      slice.action.saveDir = shots;
    }
  }
}

// Validate an arbitrary config object against the *shipped* defaults. Used when
// the settings UI hands us a config to save.
function validate(cfg) {
  const defaults = readJson(defaultConfigPath());
  return validateConfig(cfg, defaults);
}

function saveConfig(cfg) {
  const target = userConfigPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(cfg, null, 2), 'utf8');
  return target;
}

function resetConfig() {
  const defaults = readJson(defaultConfigPath());
  const def = validateConfig(defaults, defaults);
  applyRuntimeDefaults(def);
  saveConfig(def);
  return def;
}

// Return the slices for the currently active profile.
function activeSlices(cfg) {
  const profile = cfg.profiles && cfg.profiles[cfg.activeProfile];
  return profile ? profile.slices : [];
}

module.exports = {
  loadConfig,
  saveConfig,
  resetConfig,
  validateConfig,
  validate,
  activeSlices,
  userConfigPath,
  defaultConfigPath
};
