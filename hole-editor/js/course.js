// hole-editor/js/course.js - WHICH COURSE THIS EDITOR IS EDITING (2026-09-22).
//
// The editor was built for Red Mesa alone: it imported Red Mesa's recipes, saved under a Red Mesa
// key and exported redmesa.js. `?course=new` opens the SAME tool on a blank course instead
// (starter.js), with its own storage key, its own export and a course name/theme the designer sets.
// No DOM here; model.js reads the active profile through setCourse().

import { SPECS as RM_SPECS, RM_DEFAULTS } from '../../golf/courses/redmesa.js';
import { STARTER_SPECS, THEME_DEFAULTS } from './starter.js';

export const PROFILES = {
  redmesa: {
    id: 'redmesa', custom: false, title: 'Red Mesa Hole Editor', name: 'Red Mesa', theme: 'desert',
    specs: RM_SPECS, defaults: RM_DEFAULTS, storageKey: 'golf.holeEditor.redmesa.v1', idPrefix: 'rm',
    exportFile: 'redmesa.js',
  },
  custom: {
    id: 'custom', custom: true, title: 'Course Creator', name: 'My Course', theme: 'parkland',
    specs: STARTER_SPECS, defaults: THEME_DEFAULTS.parkland, storageKey: 'golf.holeEditor.custom.v1', idPrefix: 'h',
    exportFile: null,   // named after the course, see export.js
  },
};

export function defaultsFor(theme) {
  return THEME_DEFAULTS[theme] || THEME_DEFAULTS.parkland;
}

/** The profile the page URL asks for: `?course=new` (or `custom`) is the blank course; anything
 *  else, including no parameter at all, is Red Mesa - so every existing link still opens what it
 *  always did. */
export function resolveProfile(search) {
  let q = '';
  try { q = new URLSearchParams(search != null ? search : (typeof location !== 'undefined' ? location.search : '')).get('course') || ''; } catch { q = ''; }
  return (q === 'new' || q === 'custom') ? PROFILES.custom : PROFILES.redmesa;
}

/** A file-safe course id from its name: "King's Landing" -> "kingslanding". Falls back to
 *  'mycourse' so an empty name still exports something loadable. */
export function slugOf(name) {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return s || 'mycourse';
}
