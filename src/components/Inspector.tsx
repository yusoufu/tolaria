import { useMemo, useState, useCallback } from 'react'
import type { VaultEntry, GitCommit } from '../types'
import './Inspector.css'

interface InspectorProps {
  collapsed: boolean
  onToggle: () => void
  entry: VaultEntry | null
  content: string | null
  entries: VaultEntry[]
  allContent: Record<string, string>
  gitHistory: GitCommit[]
  onNavigate: (target: string) => void
  onUpdateFrontmatter?: (path: string, key: string, value: FrontmatterValue) => Promise<void>
  onDeleteProperty?: (path: string, key: string) => Promise<void>
  onAddProperty?: (path: string, key: string, value: FrontmatterValue) => Promise<void>
}

export type FrontmatterValue = string | number | boolean | string[] | null

interface ParsedFrontmatter {
  [key: string]: FrontmatterValue
}

const STATUS_COLORS: Record<string, string> = {
  Active: '#4caf50',
  Done: '#2196f3',
  Paused: '#ff9800',
  Archived: '#9e9e9e',
  Dropped: '#f44336',
  Open: '#4caf50',
  Closed: '#9e9e9e',
  'Not started': '#888',
  Draft: '#ff9800',
  Mixed: '#ff9800',
}

// Keys that are relationships (contain wikilinks)
const RELATIONSHIP_KEYS = new Set([
  'Belongs to',
  'Related to',
  'Events',
  'Has Data',
  'Owner',
  'Advances',
  'Parent',
  'Children',
  'Has',
  'Notes',
])

// Keys to skip showing in Properties (shown elsewhere or internal)
const SKIP_KEYS = new Set([
  'aliases',
  'notion_id',
  'workspace',
])

function formatDate(timestamp: number | null): string {
  if (!timestamp) return '—'
  const d = new Date(timestamp * 1000)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatISODate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}

function countWords(content: string | null): number {
  if (!content) return 0
  // Strip YAML frontmatter
  const stripped = content.replace(/^---[\s\S]*?---\n?/, '')
  const words = stripped.trim().split(/\s+/).filter((w) => w.length > 0)
  return words.length
}

/** Parse YAML frontmatter from content */
function parseFrontmatter(content: string | null): ParsedFrontmatter {
  if (!content) return {}
  
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  
  const yaml = match[1]
  const result: ParsedFrontmatter = {}
  
  let currentKey: string | null = null
  let currentList: string[] = []
  let inList = false
  
  const lines = yaml.split('\n')
  
  for (const line of lines) {
    // Check for list item
    const listMatch = line.match(/^  - (.*)$/)
    if (listMatch && currentKey) {
      inList = true
      currentList.push(listMatch[1].replace(/^["']|["']$/g, ''))
      continue
    }
    
    // If we were in a list and hit a non-list line, save it
    if (inList && currentKey) {
      result[currentKey] = currentList.length === 1 ? currentList[0] : currentList
      currentList = []
      inList = false
    }
    
    // Check for key: value
    const kvMatch = line.match(/^["']?([^"':]+)["']?\s*:\s*(.*)$/)
    if (kvMatch) {
      currentKey = kvMatch[1].trim()
      const value = kvMatch[2].trim()
      
      if (value === '' || value === '|' || value === '>') {
        // Empty value or multiline - wait for list items or next key
        continue
      }
      
      // Handle inline list like [item1, item2]
      if (value.startsWith('[') && value.endsWith(']')) {
        const items = value.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''))
        result[currentKey] = items.length === 1 ? items[0] : items
        continue
      }
      
      // Handle quoted string
      const unquoted = value.replace(/^["']|["']$/g, '')
      
      // Handle boolean
      if (unquoted.toLowerCase() === 'true') {
        result[currentKey] = true
        continue
      }
      if (unquoted.toLowerCase() === 'false') {
        result[currentKey] = false
        continue
      }
      
      result[currentKey] = unquoted
    }
  }
  
  // Don't forget last list if any
  if (inList && currentKey) {
    result[currentKey] = currentList.length === 1 ? currentList[0] : currentList
  }
  
  return result
}

/** Check if a string is a wikilink */
function isWikilink(value: string): boolean {
  return /^\[\[.*\]\]$/.test(value)
}

/** Check if a value contains wikilinks */
function containsWikilinks(value: FrontmatterValue): boolean {
  if (typeof value === 'string') return isWikilink(value)
  if (Array.isArray(value)) return value.some(v => typeof v === 'string' && isWikilink(v))
  return false
}

/** Extract display name from a wikilink like "[[responsibility/grow-newsletter|Grow Newsletter]]" */
function wikilinkDisplay(ref: string): string {
  const inner = ref.replace(/^\[\[|\]\]$/g, '')
  // Check for pipe alias: [[path|Display Name]]
  const pipeIdx = inner.indexOf('|')
  if (pipeIdx !== -1) {
    return inner.slice(pipeIdx + 1)
  }
  // Take last path segment and convert to title case
  const last = inner.split('/').pop() ?? inner
  return last.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Extract the target path for navigation from a wikilink ref */
function wikilinkTarget(ref: string): string {
  const inner = ref.replace(/^\[\[|\]\]$/g, '')
  // Check for pipe alias: [[path|Display Name]] — use path part
  const pipeIdx = inner.indexOf('|')
  const path = pipeIdx !== -1 ? inner.slice(0, pipeIdx) : inner
  // Return the full path for matching (not just last segment)
  return path
}

// Editable value component for inline editing
function EditableValue({ 
  value, 
  onSave, 
  onCancel,
  isEditing,
  onStartEdit 
}: { 
  value: string
  onSave: (newValue: string) => void
  onCancel: () => void
  isEditing: boolean
  onStartEdit: () => void
}) {
  const [editValue, setEditValue] = useState(value)
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onSave(editValue)
    } else if (e.key === 'Escape') {
      setEditValue(value)
      onCancel()
    }
  }
  
  if (isEditing) {
    return (
      <input
        className="inspector__edit-input"
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => onSave(editValue)}
        autoFocus
      />
    )
  }
  
  return (
    <span 
      className="inspector__prop-value inspector__prop-value--editable"
      onClick={onStartEdit}
      title="Click to edit"
    >
      {value || '—'}
    </span>
  )
}

// Editable list component
function EditableList({
  items,
  onSave,
  onDelete,
  label,
}: {
  items: string[]
  onSave: (newItems: string[]) => void
  onDelete?: () => void
  label: string
}) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isAddingNew, setIsAddingNew] = useState(false)
  const [newValue, setNewValue] = useState('')

  const handleStartEdit = (index: number) => {
    setEditingIndex(index)
    setEditValue(items[index])
  }

  const handleSaveEdit = () => {
    if (editingIndex !== null) {
      const newItems = [...items]
      if (editValue.trim()) {
        newItems[editingIndex] = editValue.trim()
      } else {
        // Remove empty items
        newItems.splice(editingIndex, 1)
      }
      onSave(newItems)
      setEditingIndex(null)
    }
  }

  const handleDeleteItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index)
    onSave(newItems)
  }

  const handleAddNew = () => {
    if (newValue.trim()) {
      onSave([...items, newValue.trim()])
      setNewValue('')
      setIsAddingNew(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent, action: 'edit' | 'add') => {
    if (e.key === 'Enter') {
      if (action === 'edit') handleSaveEdit()
      else handleAddNew()
    } else if (e.key === 'Escape') {
      if (action === 'edit') {
        setEditingIndex(null)
        setEditValue('')
      } else {
        setIsAddingNew(false)
        setNewValue('')
      }
    }
  }

  return (
    <div className="inspector__list-editor">
      {items.map((item, idx) => (
        <div key={idx} className="inspector__list-item">
          {editingIndex === idx ? (
            <input
              className="inspector__edit-input"
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, 'edit')}
              onBlur={handleSaveEdit}
              autoFocus
            />
          ) : (
            <>
              <span 
                className="inspector__list-item-text"
                onClick={() => handleStartEdit(idx)}
                title="Click to edit"
              >
                {item}
              </span>
              <button
                className="inspector__list-item-delete"
                onClick={() => handleDeleteItem(idx)}
                title="Remove item"
              >
                ×
              </button>
            </>
          )}
        </div>
      ))}
      {isAddingNew ? (
        <input
          className="inspector__edit-input"
          type="text"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, 'add')}
          onBlur={handleAddNew}
          placeholder={`New ${label.toLowerCase()}...`}
          autoFocus
        />
      ) : (
        <button
          className="inspector__list-add"
          onClick={() => setIsAddingNew(true)}
        >
          + Add item
        </button>
      )}
    </div>
  )
}

function RelationshipGroup({ label, refs, onNavigate }: { label: string; refs: string[]; onNavigate: (target: string) => void }) {
  if (refs.length === 0) return null
  return (
    <div className="inspector__rel-group">
      <span className="inspector__rel-label">{label}</span>
      <div className="inspector__rel-links">
        {refs.map((ref, idx) => (
          <button
            key={`${ref}-${idx}`}
            className="inspector__rel-link"
            onClick={() => onNavigate(wikilinkTarget(ref))}
          >
            {wikilinkDisplay(ref)}
          </button>
        ))}
      </div>
    </div>
  )
}

function DynamicRelationshipsPanel({ 
  frontmatter, 
  onNavigate 
}: { 
  frontmatter: ParsedFrontmatter
  onNavigate: (target: string) => void 
}) {
  // Find all keys that contain wikilinks
  const relationshipEntries = useMemo(() => {
    return Object.entries(frontmatter)
      .filter(([key, value]) => {
        // Check if this key typically contains relationships or has wikilinks
        if (RELATIONSHIP_KEYS.has(key)) return true
        return containsWikilinks(value)
      })
      .map(([key, value]) => {
        const refs: string[] = []
        if (typeof value === 'string' && isWikilink(value)) {
          refs.push(value)
        } else if (Array.isArray(value)) {
          value.forEach(v => {
            if (typeof v === 'string' && isWikilink(v)) {
              refs.push(v)
            }
          })
        }
        return { key, refs }
      })
      .filter(({ refs }) => refs.length > 0)
  }, [frontmatter])

  if (relationshipEntries.length === 0) {
    return (
      <div className="inspector__section">
        <h4>Relationships</h4>
        <p className="inspector__empty">No relationships</p>
      </div>
    )
  }

  return (
    <div className="inspector__section">
      <h4>Relationships</h4>
      {relationshipEntries.map(({ key, refs }) => (
        <RelationshipGroup key={key} label={key} refs={refs} onNavigate={onNavigate} />
      ))}
    </div>
  )
}

function DynamicPropertiesPanel({ 
  entry, 
  content,
  frontmatter,
  onUpdateProperty,
  onDeleteProperty,
  onAddProperty,
}: { 
  entry: VaultEntry
  content: string | null
  frontmatter: ParsedFrontmatter
  onUpdateProperty?: (key: string, value: FrontmatterValue) => void
  onDeleteProperty?: (key: string) => void
  onAddProperty?: (key: string, value: FrontmatterValue) => void
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  
  const wordCount = countWords(content)
  
  // Filter out relationship keys and skipped keys
  const propertyEntries = useMemo(() => {
    return Object.entries(frontmatter)
      .filter(([key, value]) => {
        if (SKIP_KEYS.has(key)) return false
        if (RELATIONSHIP_KEYS.has(key)) return false
        if (containsWikilinks(value)) return false
        return true
      })
  }, [frontmatter])

  const handleSaveValue = useCallback((key: string, newValue: string) => {
    setEditingKey(null)
    if (onUpdateProperty) {
      // Try to preserve type
      if (newValue.toLowerCase() === 'true') {
        onUpdateProperty(key, true)
      } else if (newValue.toLowerCase() === 'false') {
        onUpdateProperty(key, false)
      } else if (!isNaN(Number(newValue)) && newValue.trim() !== '') {
        onUpdateProperty(key, Number(newValue))
      } else {
        onUpdateProperty(key, newValue)
      }
    }
  }, [onUpdateProperty])

  const handleSaveList = useCallback((key: string, newItems: string[]) => {
    if (onUpdateProperty) {
      if (newItems.length === 0) {
        onDeleteProperty?.(key)
      } else if (newItems.length === 1) {
        onUpdateProperty(key, newItems[0])
      } else {
        onUpdateProperty(key, newItems)
      }
    }
  }, [onUpdateProperty, onDeleteProperty])

  const handleAddProperty = useCallback(() => {
    if (newKey.trim() && onAddProperty) {
      // Check if it looks like a list
      if (newValue.includes(',')) {
        const items = newValue.split(',').map(s => s.trim()).filter(s => s)
        onAddProperty(newKey.trim(), items.length === 1 ? items[0] : items)
      } else {
        onAddProperty(newKey.trim(), newValue.trim() || '')
      }
      setNewKey('')
      setNewValue('')
      setShowAddDialog(false)
    }
  }, [newKey, newValue, onAddProperty])

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddProperty()
    } else if (e.key === 'Escape') {
      setShowAddDialog(false)
      setNewKey('')
      setNewValue('')
    }
  }

  const renderEditableValue = (key: string, value: FrontmatterValue) => {
    if (value === null || value === undefined) {
      return (
        <EditableValue
          value=""
          isEditing={editingKey === key}
          onStartEdit={() => setEditingKey(key)}
          onSave={(v) => handleSaveValue(key, v)}
          onCancel={() => setEditingKey(null)}
        />
      )
    }
    
    // Status gets special rendering but is still editable
    if (key === 'Status' || key.includes('Status')) {
      const statusStr = String(value)
      const color = STATUS_COLORS[statusStr] ?? '#888'
      if (editingKey === key) {
        return (
          <input
            className="inspector__edit-input"
            type="text"
            defaultValue={statusStr}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveValue(key, (e.target as HTMLInputElement).value)
              if (e.key === 'Escape') setEditingKey(null)
            }}
            onBlur={(e) => handleSaveValue(key, e.target.value)}
            autoFocus
          />
        )
      }
      return (
        <span 
          className="inspector__status-pill inspector__status-pill--editable" 
          style={{ backgroundColor: color }}
          onClick={() => setEditingKey(key)}
          title="Click to edit"
        >
          {statusStr}
        </span>
      )
    }
    
    // Arrays get list editor
    if (Array.isArray(value)) {
      return (
        <EditableList
          items={value.map(String)}
          onSave={(items) => handleSaveList(key, items)}
          label={key}
        />
      )
    }
    
    // Date fields - still editable but formatted
    if (key.includes('Created') || key.includes('Modified') || key.includes('time') || key.includes('Date')) {
      const displayValue = typeof value === 'string' && value.includes('T') 
        ? formatISODate(value) 
        : String(value)
      return (
        <EditableValue
          value={String(value)}
          isEditing={editingKey === key}
          onStartEdit={() => setEditingKey(key)}
          onSave={(v) => handleSaveValue(key, v)}
          onCancel={() => setEditingKey(null)}
        />
      )
    }
    
    // Boolean
    if (typeof value === 'boolean') {
      return (
        <button
          className="inspector__bool-toggle"
          onClick={() => onUpdateProperty?.(key, !value)}
        >
          {value ? '✓ Yes' : '✗ No'}
        </button>
      )
    }
    
    // Default: editable string
    return (
      <EditableValue
        value={String(value)}
        isEditing={editingKey === key}
        onStartEdit={() => setEditingKey(key)}
        onSave={(v) => handleSaveValue(key, v)}
        onCancel={() => setEditingKey(null)}
      />
    )
  }

  return (
    <div className="inspector__section">
      <h4>Properties</h4>
      <div className="inspector__props">
        {/* Always show Type from entry */}
        {entry.isA && (
          <div className="inspector__prop">
            <span className="inspector__prop-label">Type</span>
            <span className="inspector__prop-value">{entry.isA}</span>
          </div>
        )}
        
        {/* Dynamic properties from frontmatter */}
        {propertyEntries.map(([key, value]) => (
          <div key={key} className="inspector__prop">
            <span className="inspector__prop-label">
              {key}
              {onDeleteProperty && (
                <button
                  className="inspector__prop-delete"
                  onClick={() => onDeleteProperty(key)}
                  title="Delete property"
                >
                  ×
                </button>
              )}
            </span>
            {renderEditableValue(key, value)}
          </div>
        ))}
        
        {/* Always show Modified and Words (read-only) */}
        <div className="inspector__prop">
          <span className="inspector__prop-label">Modified</span>
          <span className="inspector__prop-value">{formatDate(entry.modifiedAt)}</span>
        </div>
        <div className="inspector__prop">
          <span className="inspector__prop-label">Words</span>
          <span className="inspector__prop-value">{wordCount}</span>
        </div>
      </div>
      
      {/* Add property UI */}
      {showAddDialog ? (
        <div className="inspector__add-dialog">
          <input
            className="inspector__edit-input"
            type="text"
            placeholder="Property name"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={handleAddKeyDown}
            autoFocus
          />
          <input
            className="inspector__edit-input"
            type="text"
            placeholder="Value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={handleAddKeyDown}
          />
          <div className="inspector__add-dialog-buttons">
            <button onClick={handleAddProperty} disabled={!newKey.trim()}>Add</button>
            <button onClick={() => { setShowAddDialog(false); setNewKey(''); setNewValue('') }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button 
          className="inspector__add-prop" 
          onClick={() => setShowAddDialog(true)}
          disabled={!onAddProperty}
        >
          + Add property
        </button>
      )}
    </div>
  )
}

/** Find all entries whose content contains a wikilink to the current note */
function useBacklinks(
  entry: VaultEntry | null,
  entries: VaultEntry[],
  allContent: Record<string, string>
): VaultEntry[] {
  return useMemo(() => {
    if (!entry) return []
    // Build patterns to match: [[title]], [[filename-without-ext]], [[path-segment/filename-without-ext]]
    const title = entry.title
    const stem = entry.filename.replace(/\.md$/, '')
    // Also match by aliases
    const targets = [title, ...entry.aliases]
    // Also match path-based links like [[project/26q1-laputa-app]]
    const pathStem = entry.path.replace(/^.*\/Laputa\//, '').replace(/\.md$/, '')

    return entries.filter((e) => {
      if (e.path === entry.path) return false
      const content = allContent[e.path]
      if (!content) return false
      // Check for any [[target]] pattern in the content
      for (const t of targets) {
        if (content.includes(`[[${t}]]`)) return true
      }
      if (content.includes(`[[${stem}]]`)) return true
      if (content.includes(`[[${pathStem}]]`)) return true
      // Also check with pipe aliases
      if (content.includes(`[[${pathStem}|`)) return true
      return false
    })
  }, [entry, entries, allContent])
}

function BacklinksPanel({ backlinks, onNavigate }: { backlinks: VaultEntry[]; onNavigate: (target: string) => void }) {
  return (
    <div className="inspector__section">
      <h4>Backlinks {backlinks.length > 0 && <span className="inspector__count">{backlinks.length}</span>}</h4>
      {backlinks.length === 0 ? (
        <p className="inspector__empty">No backlinks</p>
      ) : (
        <div className="inspector__backlinks">
          {backlinks.map((e) => (
            <button
              key={e.path}
              className="inspector__backlink"
              onClick={() => onNavigate(e.title)}
            >
              <span className="inspector__backlink-title">{e.title}</span>
              {e.isA && <span className="inspector__backlink-type">{e.isA}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function formatRelativeDate(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - timestamp
  if (diff < 86400) return 'today'
  const days = Math.floor(diff / 86400)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months === 1) return '1mo ago'
  return `${months}mo ago`
}

function GitHistoryPanel({ commits }: { commits: GitCommit[] }) {
  return (
    <div className="inspector__section">
      <h4>History</h4>
      {commits.length === 0 ? (
        <p className="inspector__empty">No revision history</p>
      ) : (
        <>
          <div className="inspector__commits">
            {commits.map((c) => (
              <div key={c.hash} className="inspector__commit">
                <div className="inspector__commit-top">
                  <span className="inspector__commit-hash">{c.hash}</span>
                  <span className="inspector__commit-date">{formatRelativeDate(c.date)}</span>
                </div>
                <div className="inspector__commit-msg">{c.message}</div>
              </div>
            ))}
          </div>
          <button className="inspector__view-all" disabled>
            View all revisions
          </button>
        </>
      )}
    </div>
  )
}

export function Inspector({ 
  collapsed, 
  onToggle, 
  entry, 
  content, 
  entries, 
  allContent, 
  gitHistory, 
  onNavigate,
  onUpdateFrontmatter,
  onDeleteProperty,
  onAddProperty,
}: InspectorProps) {
  const backlinks = useBacklinks(entry, entries, allContent)
  const frontmatter = useMemo(() => parseFrontmatter(content), [content])

  const handleUpdateProperty = useCallback((key: string, value: FrontmatterValue) => {
    if (entry && onUpdateFrontmatter) {
      onUpdateFrontmatter(entry.path, key, value)
    }
  }, [entry, onUpdateFrontmatter])

  const handleDeleteProperty = useCallback((key: string) => {
    if (entry && onDeleteProperty) {
      onDeleteProperty(entry.path, key)
    }
  }, [entry, onDeleteProperty])

  const handleAddProperty = useCallback((key: string, value: FrontmatterValue) => {
    if (entry && onAddProperty) {
      onAddProperty(entry.path, key, value)
    }
  }, [entry, onAddProperty])

  return (
    <aside className={`inspector ${collapsed ? 'inspector--collapsed' : ''}`}>
      <div className="inspector__header" data-tauri-drag-region>
        <button className="inspector__toggle" onClick={onToggle}>
          {collapsed ? '\u25C0' : '\u25B6'}
        </button>
        {!collapsed && <h3>Inspector</h3>}
      </div>
      {!collapsed && (
        <div className="inspector__content">
          {entry ? (
            <>
              <DynamicPropertiesPanel 
                entry={entry} 
                content={content} 
                frontmatter={frontmatter}
                onUpdateProperty={onUpdateFrontmatter ? handleUpdateProperty : undefined}
                onDeleteProperty={onDeleteProperty ? handleDeleteProperty : undefined}
                onAddProperty={onAddProperty ? handleAddProperty : undefined}
              />
              <DynamicRelationshipsPanel frontmatter={frontmatter} onNavigate={onNavigate} />
              <BacklinksPanel backlinks={backlinks} onNavigate={onNavigate} />
              <GitHistoryPanel commits={gitHistory} />
            </>
          ) : (
            <>
              <div className="inspector__section">
                <h4>Properties</h4>
                <p className="inspector__empty">No note selected</p>
              </div>
              <div className="inspector__section">
                <h4>Relationships</h4>
                <p className="inspector__empty">No relationships</p>
              </div>
              <div className="inspector__section">
                <h4>Backlinks</h4>
                <p className="inspector__empty">No backlinks</p>
              </div>
              <div className="inspector__section">
                <h4>History</h4>
                <p className="inspector__empty">No revision history</p>
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  )
}
