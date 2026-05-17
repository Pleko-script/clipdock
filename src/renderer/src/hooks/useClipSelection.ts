import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent,
  type MutableRefObject,
  type SetStateAction
} from 'react'
import type { LibraryClipRecordSummary } from '../../../shared/clipdock'

export function useClipSelection(clips: LibraryClipRecordSummary[]): {
  activeClip: LibraryClipRecordSummary | null
  activeClipId: string | null
  selectedClipIds: Set<string>
  selectedClipIdsRef: MutableRefObject<Set<string>>
  setActiveClipId: (clipId: string | null) => void
  setSelectedClipIds: Dispatch<SetStateAction<Set<string>>>
  selectClip: (clip: LibraryClipRecordSummary, event: MouseEvent) => void
  openClip: (clip: LibraryClipRecordSummary) => void
} {
  const [activeClipId, setActiveClipId] = useState<string | null>(null)
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set())
  const activeClip = clips.find((clip) => clip.id === activeClipId) ?? clips[0] ?? null
  const visibleSelectedClipIds = useMemo(
    () =>
      new Set([...selectedClipIds].filter((clipId) => clips.some((clip) => clip.id === clipId))),
    [clips, selectedClipIds]
  )
  const selectedClipIdsRef = useRef(visibleSelectedClipIds)

  useEffect(() => {
    selectedClipIdsRef.current = visibleSelectedClipIds
  }, [visibleSelectedClipIds])

  const selectClip = useCallback((clip: LibraryClipRecordSummary, event: MouseEvent): void => {
    setActiveClipId(clip.id)
    setSelectedClipIds((current) => {
      const multi = event.metaKey || event.ctrlKey
      const next = new Set(multi ? current : [])

      if (multi && next.has(clip.id)) {
        next.delete(clip.id)
      } else {
        next.add(clip.id)
      }

      return next
    })
  }, [])

  const openClip = useCallback((clip: LibraryClipRecordSummary): void => {
    setActiveClipId(clip.id)
    setSelectedClipIds(new Set([clip.id]))
  }, [])

  return {
    activeClip,
    activeClipId: activeClip?.id ?? null,
    selectedClipIds: visibleSelectedClipIds,
    selectedClipIdsRef,
    setActiveClipId,
    setSelectedClipIds,
    selectClip,
    openClip
  }
}
