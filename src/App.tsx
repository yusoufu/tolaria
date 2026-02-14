import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Sidebar } from './components/Sidebar'
import { NoteList } from './components/NoteList'
import { Editor } from './components/Editor'
import { Inspector } from './components/Inspector'
import { ResizeHandle } from './components/ResizeHandle'
import { isTauri, mockInvoke } from './mock-tauri'
import type { VaultEntry, SidebarSelection } from './types'
import './App.css'

// TODO: Make vault path configurable via settings
const TEST_VAULT_PATH = '~/Laputa'

const DEFAULT_SELECTION: SidebarSelection = { kind: 'filter', filter: 'all' }

function App() {
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const [selection, setSelection] = useState<SidebarSelection>(DEFAULT_SELECTION)
  const [tabs, setTabs] = useState<{ entry: VaultEntry; content: string }[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(250)
  const [noteListWidth, setNoteListWidth] = useState(300)
  const [inspectorWidth, setInspectorWidth] = useState(280)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)

  useEffect(() => {
    const loadVault = async () => {
      try {
        let result: VaultEntry[]
        if (isTauri()) {
          const path = TEST_VAULT_PATH.replace('~', '/Users/luca')
          result = await invoke<VaultEntry[]>('list_vault', { path })
        } else {
          // Running in browser (not Tauri) — use mock data for visual testing
          console.info('[mock] Using mock Tauri data for browser testing')
          result = await mockInvoke<VaultEntry[]>('list_vault', {})
        }
        console.log(`Vault scan complete: ${result.length} entries found`)
        setEntries(result)
      } catch (err) {
        console.warn('Vault scan failed:', err)
      }
    }
    loadVault()
  }, [])

  const handleSelectNote = useCallback(async (entry: VaultEntry) => {
    // If tab already open, just switch to it
    setTabs((prev) => {
      if (prev.some((t) => t.entry.path === entry.path)) {
        setActiveTabPath(entry.path)
        return prev
      }
      return prev
    })

    // Check if we already have this tab (use functional check to avoid stale closure)
    let alreadyOpen = false
    setTabs((prev) => {
      alreadyOpen = prev.some((t) => t.entry.path === entry.path)
      return prev
    })
    if (alreadyOpen) return

    // Load content for new tab, then add and activate
    try {
      let content: string
      if (isTauri()) {
        content = await invoke<string>('get_note_content', { path: entry.path })
      } else {
        content = await mockInvoke<string>('get_note_content', { path: entry.path })
      }
      setTabs((prev) => {
        if (prev.some((t) => t.entry.path === entry.path)) return prev
        return [...prev, { entry, content }]
      })
      setActiveTabPath(entry.path)
    } catch (err) {
      console.warn('Failed to load note content:', err)
      setTabs((prev) => {
        if (prev.some((t) => t.entry.path === entry.path)) return prev
        return [...prev, { entry, content: '' }]
      })
      setActiveTabPath(entry.path)
    }
  }, [])

  const handleCloseTab = useCallback((path: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.entry.path !== path)
      // If closing active tab, switch to adjacent tab
      if (path === activeTabPath && next.length > 0) {
        const closedIdx = prev.findIndex((t) => t.entry.path === path)
        const newIdx = Math.min(closedIdx, next.length - 1)
        setActiveTabPath(next[newIdx].entry.path)
      } else if (next.length === 0) {
        setActiveTabPath(null)
      }
      return next
    })
  }, [activeTabPath])

  const handleSwitchTab = useCallback((path: string) => {
    setActiveTabPath(path)
  }, [])

  const handleNavigateWikilink = useCallback((target: string) => {
    // Find entry by title (case-insensitive) or alias
    const found = entries.find(
      (e) =>
        e.title.toLowerCase() === target.toLowerCase() ||
        e.aliases.some((a) => a.toLowerCase() === target.toLowerCase())
    )
    if (found) {
      handleSelectNote(found)
    }
  }, [entries, handleSelectNote])

  const handleSidebarResize = useCallback((delta: number) => {
    setSidebarWidth((w) => Math.max(150, Math.min(400, w + delta)))
  }, [])

  const handleNoteListResize = useCallback((delta: number) => {
    setNoteListWidth((w) => Math.max(200, Math.min(500, w + delta)))
  }, [])

  const handleInspectorResize = useCallback((delta: number) => {
    // Inspector resize is inverted: dragging left makes it wider
    setInspectorWidth((w) => Math.max(200, Math.min(500, w - delta)))
  }, [])

  const activeTab = tabs.find((t) => t.entry.path === activeTabPath) ?? null

  return (
    <div className="app">
      <div className="app__sidebar" style={{ width: sidebarWidth }}>
        <Sidebar entries={entries} selection={selection} onSelect={setSelection} />
      </div>
      <ResizeHandle onResize={handleSidebarResize} />
      <div className="app__note-list" style={{ width: noteListWidth }}>
        <NoteList entries={entries} selection={selection} selectedNote={activeTab?.entry ?? null} onSelectNote={handleSelectNote} />
      </div>
      <ResizeHandle onResize={handleNoteListResize} />
      <div className="app__editor">
        <Editor
          tabs={tabs}
          activeTabPath={activeTabPath}
          onSwitchTab={handleSwitchTab}
          onCloseTab={handleCloseTab}
          onNavigateWikilink={handleNavigateWikilink}
        />
      </div>
      {!inspectorCollapsed && <ResizeHandle onResize={handleInspectorResize} />}
      <div
        className="app__inspector"
        style={{ width: inspectorCollapsed ? 40 : inspectorWidth }}
      >
        <Inspector
          collapsed={inspectorCollapsed}
          onToggle={() => setInspectorCollapsed((c) => !c)}
        />
      </div>
    </div>
  )
}

export default App
