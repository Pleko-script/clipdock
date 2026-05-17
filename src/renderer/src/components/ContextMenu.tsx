import type { JSX } from 'react'

export interface ContextMenuItem {
  id: string
  label: string
  destructive?: boolean
  disabled?: boolean
  onSelect: () => void
}

export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}): JSX.Element {
  return (
    <div className="context-menu-backdrop" onClick={onClose}>
      <div
        className="context-menu"
        style={{ left: x, top: y }}
        onClick={(event) => event.stopPropagation()}
      >
        {items.map((item) => (
          <button
            type="button"
            key={item.id}
            className={item.destructive ? 'destructive' : ''}
            disabled={item.disabled}
            onClick={() => {
              item.onSelect()
              onClose()
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
