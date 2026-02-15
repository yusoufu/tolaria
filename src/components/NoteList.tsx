import { useState } from 'react'
import type { VaultEntry, SidebarSelection } from '../types'
import './NoteList.css'

interface NoteListProps {
  entries: VaultEntry[]
  selection: SidebarSelection
  selectedNote: VaultEntry | null
  allContent: Record<string, string>
  onSelectNote: (entry: VaultEntry) => void
  onCreateNote: () => void
}

/** Extract first ~80 chars of content after the title heading */
function getSnippet(content: string | undefined): string {
  if (!content) return ''
  // Remove frontmatter
  const withoutFm = content.replace(/^---[\s\S]*?---\s*/, '')
  // Remove the first heading
  const withoutH1 = withoutFm.replace(/^#\s+.*\n+/, '')
  // Clean markdown syntax and collapse whitespace
  const clean = withoutH1
    .replace(/[#*_`\[\]]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
  return clean.slice(0, 80) + (clean.length > 80 ? '...' : '')
}

/** Format a relative date string */
function relativeDate(ts: number | null): string {
  if (!ts) return ''
  const now = Math.floor(Date.now() / 1000)
  const diff = now - ts
  if (diff < 0) {
    // Future date - just show the date
    const date = new Date(ts * 1000)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  const date = new Date(ts * 1000)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Get the best date to display for an entry (prefer modifiedAt, fallback to createdAt) */
function getDisplayDate(entry: VaultEntry): number | null {
  // Prefer modifiedAt (most recent activity), but fall back to createdAt
  return entry.modifiedAt ?? entry.createdAt
}

/** Check if a wikilink array (e.g. belongsTo) references a given entry by path stem */
function refsMatch(refs: string[], entry: VaultEntry): boolean {
  // Extract the path stem: /Users/luca/Laputa/project/26q1-laputa-app.md → project/26q1-laputa-app
  const stem = entry.path.replace(/^.*\/Laputa\//, '').replace(/\.md$/, '')
  return refs.some((ref) => {
    const inner = ref.replace(/^\[\[/, '').replace(/\]\]$/, '')
    return inner === stem
  })
}

function filterEntries(entries: VaultEntry[], selection: SidebarSelection): VaultEntry[] {
  switch (selection.kind) {
    case 'filter':
      switch (selection.filter) {
        case 'all':
          return entries
        case 'people':
          return entries.filter((e) => e.isA === 'Person')
        case 'events':
          return entries.filter((e) => e.isA === 'Event')
        case 'favorites':
          // TODO: Implement favorites (needs a "favorite" field in frontmatter)
          return []
        case 'trash':
          // TODO: Implement trash (needs deleted/archived status)
          return []
      }
      break
    case 'sectionGroup':
      return entries.filter((e) => e.isA === selection.type)
    case 'entity': {
      const pinned = selection.entry
      const children = entries.filter(
        (e) => e.path !== pinned.path && refsMatch(e.belongsTo, pinned)
      )
      return [pinned, ...children]
    }
    case 'topic': {
      const topic = selection.entry
      return entries.filter((e) => refsMatch(e.relatedTo, topic))
    }
  }
}

function sortByModified(a: VaultEntry, b: VaultEntry): number {
  return (getDisplayDate(b) ?? 0) - (getDisplayDate(a) ?? 0)
}

const TYPE_PILLS = [
  { label: 'All', type: null },
  { label: 'Projects', type: 'Project' },
  { label: 'Notes', type: 'Note' },
  { label: 'Events', type: 'Event' },
  { label: 'People', type: 'Person' },
  { label: 'Experiments', type: 'Experiment' },
  { label: 'Procedures', type: 'Procedure' },
  { label: 'Responsibilities', type: 'Responsibility' },
] as const

export function NoteList({ entries, selection, selectedNote, allContent, onSelectNote, onCreateNote }: NoteListProps) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)

  const filtered = filterEntries(entries, selection)

  // Sort: for entity view, keep pinned first, sort children; otherwise sort all
  let sorted: VaultEntry[]
  if (selection.kind === 'entity' && filtered.length > 0) {
    const [pinned, ...children] = filtered
    sorted = [pinned, ...children.sort(sortByModified)]
  } else {
    sorted = [...filtered].sort(sortByModified)
  }

  // Search filter (title substring, case-insensitive)
  const query = search.trim().toLowerCase()
  const searched = query
    ? sorted.filter((e) => e.title.toLowerCase().includes(query))
    : sorted

  // Type filter pills
  const displayed = typeFilter
    ? searched.filter((e) => e.isA === typeFilter)
    : searched

  return (
    <div className="note-list">
      <div className="note-list__header" data-tauri-drag-region>
        <h3>Notes</h3>
        <div className="note-list__header-right">
          <span className="note-list__count">{displayed.length}</span>
          <button className="note-list__add-btn" onClick={onCreateNote} title="Create new note">
            +
          </button>
        </div>
      </div>
      <div className="note-list__search">
        <input
          type="text"
          className="note-list__search-input"
          placeholder="Search notes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="note-list__pills">
        {TYPE_PILLS.map(({ label, type }) => (
          <button
            key={label}
            className={`note-list__pill${typeFilter === type ? ' note-list__pill--active' : ''}`}
            onClick={() => setTypeFilter(type)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="note-list__items">
        {displayed.length === 0 ? (
          <div className="note-list__empty">No notes found</div>
        ) : (
          displayed.map((entry, i) => (
            <div
              key={entry.path}
              className={`note-list__item${
                selection.kind === 'entity' && i === 0 ? ' note-list__item--pinned' : ''
              }${selectedNote?.path === entry.path ? ' note-list__item--selected' : ''}`}
              onClick={() => onSelectNote(entry)}
            >
              <div className="note-list__item-top">
                <div className="note-list__title">{entry.title}</div>
                <span className="note-list__date">{relativeDate(getDisplayDate(entry))}</span>
              </div>
              <div className="note-list__snippet">{getSnippet(allContent[entry.path])}</div>
              <div className="note-list__meta">
                {entry.isA && <span className={`note-list__type note-list__type--${entry.isA.toLowerCase()}`}>{entry.isA}</span>}
                {entry.status && <span className="note-list__status">{entry.status}</span>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
