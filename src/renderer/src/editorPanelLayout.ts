export type EditorPanelSide = 'organize' | 'details'

export interface EditorPanelLayout {
  organizeWidth: number
  detailsWidth: number
  organizeCollapsed: boolean
  detailsCollapsed: boolean
}

export const EDITOR_PANEL_STORAGE_KEY = 'clipdock.editorPanels'
export const EDITOR_PANEL_MIN_WIDTH = 140
export const EDITOR_PANEL_MAX_WIDTH = 320
export const EDITOR_PANEL_DEFAULT_WIDTH = 220
export const EDITOR_PANEL_COLLAPSED_WIDTH = 36
export const EDITOR_PANEL_SINGLE_BREAKPOINT = 900
export const EDITOR_PANEL_COMPACT_BREAKPOINT = 720

export function clampEditorPanelWidth(value: number): number {
  const finite = Number.isFinite(value) ? Math.round(value) : EDITOR_PANEL_DEFAULT_WIDTH
  return Math.min(EDITOR_PANEL_MAX_WIDTH, Math.max(EDITOR_PANEL_MIN_WIDTH, finite))
}

export function defaultEditorPanelLayout(): EditorPanelLayout {
  return {
    organizeWidth: EDITOR_PANEL_DEFAULT_WIDTH,
    detailsWidth: EDITOR_PANEL_DEFAULT_WIDTH,
    organizeCollapsed: false,
    detailsCollapsed: false
  }
}

export function parseEditorPanelLayout(value: string | null): EditorPanelLayout {
  if (!value) return defaultEditorPanelLayout()
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return defaultEditorPanelLayout()
    const record = parsed as Record<string, unknown>
    return {
      organizeWidth: clampEditorPanelWidth(Number(record.organizeWidth)),
      detailsWidth: clampEditorPanelWidth(Number(record.detailsWidth)),
      organizeCollapsed: record.organizeCollapsed === true,
      detailsCollapsed: record.detailsCollapsed === true
    }
  } catch {
    return defaultEditorPanelLayout()
  }
}

export function responsivePanelCollapse(width: number): {
  organize: boolean
  details: boolean
} {
  if (width < EDITOR_PANEL_COMPACT_BREAKPOINT) return { organize: true, details: true }
  if (width < EDITOR_PANEL_SINGLE_BREAKPOINT) return { organize: false, details: true }
  return { organize: false, details: false }
}
