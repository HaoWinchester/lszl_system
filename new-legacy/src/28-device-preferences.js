'use strict'

;(function (global) {
  const EXACT_KEYS = Object.freeze([
    'kg_default_entry_mode_v1',
    'kg_question_language_mode_v1',
    'kg_global_shortcuts_layout_v1',
    'kg_global_shortcuts_position_v1',
    'kg_graph_user_preferences_v1',
    'kg_canvas_view_preferences_v1',
    'kg_graph_recent_colors_v1',
    'kg_home_interaction_mode_v1',
    'kg_home_professional_flow_v1',
    'kg_graph_closed_tabs_v1',
    'kg_file_manager_details_open_v1',
    'kg_file_manager_folder_section_collapsed_v1',
    'kg_file_manager_layout_v1',
    'kg_file_manager_recent_folders_v1',
    'kg_file_manager_sidebar_collapsed_v1',
    'kg_file_manager_sort_v1',
    'kg_file_manager_theme_v1',
    'kg_deep_recall_theme_v1',
    'kg_multi_question_analysis_sections_v1',
    'kg_multi_question_font_scale_v1',
    'kg_multi_question_highlight_color_v1',
    'kg_multi_question_paper_selection_v1',
    'kg_multi_question_release_selection_v1',
    'kg_paper_workspace_layout_v1',
    'kg_question_classification_collapsed_v1',
    'kg_question_library_workspace_layout_v1',
    'kg_question_training_filters_collapsed_v1',
    'kg_question_training_workspace_layout_v1',
    'kg_teacher_workbench_subject_v1',
    'kg_training_workspace_layout_v1',
    'pmp_question_font_size_v1',
    'pmp_question_font_size_v2',
  ])
  const SCOPED_UI_BASE_KEYS = Object.freeze([
    'kg_multi_question_highlight_color_v1',
    'kg_multi_question_analysis_sections_v1',
    'kg_multi_question_paper_selection_v1',
    'kg_multi_question_release_selection_v1',
    'kg_canvas_workspace_catalog_v2',
  ])
  const PREFIXES = Object.freeze([
    'kg_resizable_',
    'kg_ui_resizable_region_',
    'kg_workspace_layout_',
    'kg_recent_selection_',
    'kg_font_',
    'kg_language_',
    'kg_theme_',
  ])

  function isApprovedScope(scope) {
    if (!scope) return false
    try { return encodeURIComponent(decodeURIComponent(scope)) === scope } catch (_) { return false }
  }

  function isAllowedScopedUiKey(key) {
    return SCOPED_UI_BASE_KEYS.some(base => {
      const marker = `${base}__`
      return key.startsWith(marker) && isApprovedScope(key.slice(marker.length))
    })
  }

  function assertAllowed(key) {
    const normalized = String(key)
    if (EXACT_KEYS.includes(normalized) || PREFIXES.some(prefix => normalized.startsWith(prefix)) || isAllowedScopedUiKey(normalized)) return normalized
    const error = new Error(`Device preference key is forbidden: ${normalized}`)
    error.code = 'DEVICE_PREFERENCE_KEY_FORBIDDEN'
    throw error
  }

  function getJSON(key, fallback = null) {
    const raw = global.localStorage?.getItem(assertAllowed(key))
    if (raw == null) return fallback
    try { return JSON.parse(raw) } catch (_) { return fallback }
  }

  function setJSON(key, value) {
    global.localStorage?.setItem(assertAllowed(key), JSON.stringify(value))
    return value
  }

  function getString(key, fallback = '') {
    const value = global.localStorage?.getItem(assertAllowed(key))
    return value == null ? fallback : value
  }

  function setString(key, value) {
    const normalized = String(value)
    global.localStorage?.setItem(assertAllowed(key), normalized)
    return normalized
  }

  function remove(key) {
    global.localStorage?.removeItem(assertAllowed(key))
  }

  global.KGDevicePreferences = Object.freeze({
    EXACT_KEYS,
    SCOPED_UI_BASE_KEYS,
    PREFIXES,
    getJSON,
    setJSON,
    getString,
    setString,
    remove,
  })
})(window)
