import { useRef, type JSX, type KeyboardEvent, type PointerEvent } from 'react'
import {
  clampEditorPanelWidth,
  EDITOR_PANEL_MAX_WIDTH,
  EDITOR_PANEL_MIN_WIDTH,
  type EditorPanelSide
} from '../editorPanelLayout'

export function PanelResizeHandle({
  side,
  width,
  label,
  hidden,
  onResize
}: {
  side: EditorPanelSide
  width: number
  label: string
  hidden: boolean
  onResize: (width: number) => void
}): JSX.Element {
  const drag = useRef<{ clientX: number; width: number } | null>(null)

  const resizeFromPointer = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!drag.current) return
    const pointerDelta = event.clientX - drag.current.clientX
    const widthDelta = side === 'organize' ? pointerDelta : -pointerDelta
    onResize(clampEditorPanelWidth(drag.current.width + widthDelta))
  }

  const releasePointer = (event: PointerEvent<HTMLButtonElement>): void => {
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const handleKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      onResize(event.key === 'Home' ? EDITOR_PANEL_MIN_WIDTH : EDITOR_PANEL_MAX_WIDTH)
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const physicalDelta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 24 : 8)
    const widthDelta = side === 'organize' ? physicalDelta : -physicalDelta
    onResize(clampEditorPanelWidth(width + widthDelta))
  }

  return (
    <button
      type="button"
      className={`panel-resize-handle ${side}`}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={EDITOR_PANEL_MIN_WIDTH}
      aria-valuemax={EDITOR_PANEL_MAX_WIDTH}
      aria-valuenow={width}
      aria-valuetext={`${width} px`}
      hidden={hidden}
      onKeyDown={handleKey}
      onPointerDown={(event) => {
        drag.current = { clientX: event.clientX, width }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeFromPointer(event)
      }}
      onPointerUp={releasePointer}
      onPointerCancel={releasePointer}
    />
  )
}
