import { useState } from 'react'
import type { VaultEntry, SidebarSelection } from '../types'
import './Sidebar.css'

interface SidebarProps {
  entries: VaultEntry[]
  selection: SidebarSelection
  onSelect: (selection: SidebarSelection) => void
  onSelectNote?: (entry: VaultEntry) => void
}

const FILTERS = [
  { label: 'All Notes', filter: 'all' as const },
  { label: 'People', filter: 'people' as const },
  { label: 'Events', filter: 'events' as const },
  { label: 'Favorites', filter: 'favorites' as const },
  { label: 'Trash', filter: 'trash' as const },
]

const SECTION_GROUPS = [
  { label: 'PROJECTS', type: 'Project' },
  { label: 'EXPERIMENTS', type: 'Experiment' },
  { label: 'RESPONSIBILITIES', type: 'Responsibility' },
  { label: 'PROCEDURES', type: 'Procedure' },
] as const

export function Sidebar({ entries, selection, onSelect, onSelectNote }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const toggleSection = (type: string) => {
    setCollapsed((prev) => ({ ...prev, [type]: !prev[type] }))
  }

  const isActive = (sel: SidebarSelection): boolean => {
    if (selection.kind !== sel.kind) return false
    if (sel.kind === 'filter' && selection.kind === 'filter') return sel.filter === selection.filter
    if (sel.kind === 'sectionGroup' && selection.kind === 'sectionGroup') return sel.type === selection.type
    if (sel.kind === 'entity' && selection.kind === 'entity') return sel.entry.path === selection.entry.path
    if (sel.kind === 'topic' && selection.kind === 'topic') return sel.entry.path === selection.entry.path
    return false
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__header" data-tauri-drag-region>
        <h2>Laputa</h2>
      </div>

      <nav className="sidebar__nav">
        <div className="sidebar__filters">
          {FILTERS.map(({ label, filter }) => (
            <div
              key={filter}
              className={`sidebar__filter-item${
                isActive({ kind: 'filter', filter }) ? ' sidebar__filter-item--active' : ''
              }`}
              onClick={() => onSelect({ kind: 'filter', filter })}
            >
              {label}
            </div>
          ))}
        </div>

        {SECTION_GROUPS.map(({ label, type }) => {
          const items = entries.filter((e) => e.isA === type)
          const isCollapsed = collapsed[type] ?? false

          return (
            <div key={type} className="sidebar__section">
              <div
                className={`sidebar__section-header${
                  isActive({ kind: 'sectionGroup', type }) ? ' sidebar__section-header--active' : ''
                }`}
                onClick={() => onSelect({ kind: 'sectionGroup', type })}
              >
                <button
                  className="sidebar__collapse-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleSection(type)
                  }}
                  aria-label={isCollapsed ? `Expand ${label}` : `Collapse ${label}`}
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
                <span className="sidebar__section-label">{label}</span>
                <span className="sidebar__section-count">{items.length}</span>
                <button
                  className="sidebar__add-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    // TODO: Wire up create new entity
                  }}
                  aria-label={`Add ${type}`}
                >
                  +
                </button>
              </div>
              {!isCollapsed && (
                <div className="sidebar__section-items">
                  {items.map((entry) => (
                    <div
                      key={entry.path}
                      className={`sidebar__item${
                        isActive({ kind: 'entity', entry }) ? ' sidebar__item--active' : ''
                      }`}
                      onClick={() => {
                        onSelect({ kind: 'entity', entry })
                        onSelectNote?.(entry)
                      }}
                    >
                      {entry.title}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {(() => {
          const topics = entries.filter((e) => e.isA === 'Topic')
          if (topics.length === 0) return null
          return (
            <div className="sidebar__topics">
              <div className="sidebar__topics-header">TOPICS</div>
              {topics.map((entry) => (
                <div
                  key={entry.path}
                  className={`sidebar__topic-item${
                    isActive({ kind: 'topic', entry }) ? ' sidebar__topic-item--active' : ''
                  }`}
                  onClick={() => {
                    onSelect({ kind: 'topic', entry })
                    onSelectNote?.(entry)
                  }}
                >
                  {entry.title}
                </div>
              ))}
            </div>
          )
        })()}
      </nav>
    </aside>
  )
}
