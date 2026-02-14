import {
  ViewPlugin, Decoration, EditorView, WidgetType,
  type DecorationSet, type ViewUpdate,
} from '@codemirror/view'
import { type Range, type Extension } from '@codemirror/state'

/**
 * Wikilink extension — renders [[links]] as styled clickable elements.
 * Hides [[ and ]] when cursor is not on that line, reveals on cursor line.
 * Clicking a wikilink triggers a callback to navigate to the linked note.
 */

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g

function isOnCursorLine(view: EditorView, from: number, to: number): boolean {
  for (const range of view.state.selection.ranges) {
    const cursorLine = view.state.doc.lineAt(range.head).number
    const fromLine = view.state.doc.lineAt(from).number
    const toLine = view.state.doc.lineAt(Math.min(to, view.state.doc.length)).number
    if (cursorLine >= fromLine && cursorLine <= toLine) return true
  }
  return false
}

class WikilinkWidget extends WidgetType {
  title: string
  constructor(title: string) {
    super()
    this.title = title
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-wikilink'
    span.textContent = this.title
    span.dataset.wikilinkTarget = this.title
    return span
  }

  eq(other: WikilinkWidget) {
    return this.title === other.title
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const decs: Range<Decoration>[] = []
  const doc = view.state.doc.toString()

  let match
  WIKILINK_RE.lastIndex = 0
  while ((match = WIKILINK_RE.exec(doc)) !== null) {
    const from = match.index
    const to = from + match[0].length
    const title = match[1]

    if (isOnCursorLine(view, from, to)) continue

    // Replace [[title]] with styled widget
    decs.push(
      Decoration.replace({ widget: new WikilinkWidget(title) }).range(from, to)
    )
  }

  return Decoration.set(decs, true)
}

const wikilinkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
)

const wikilinkTheme = EditorView.theme({
  '.cm-wikilink': {
    color: '#4a9eff',
    cursor: 'pointer',
    borderBottom: '1px dotted #4a9eff50',
    padding: '0 1px',
  },
  '.cm-wikilink:hover': {
    borderBottomColor: '#4a9eff',
    background: '#4a9eff15',
  },
})

/**
 * Create the wikilinks extension.
 * @param onNavigate Callback when a wikilink is clicked (receives the link title)
 */
export function wikilinks(onNavigate: (target: string) => void): Extension {
  // Use mousedown (not click) to catch the event before CM6 moves the cursor,
  // which would remove the widget decoration and lose the click target.
  const clickHandler = EditorView.domEventHandlers({
    mousedown(event, _view) {
      const el = event.target as HTMLElement
      console.log('[wikilink] mousedown on:', el.className, el.textContent?.substring(0, 30))
      if (el.classList.contains('cm-wikilink') && el.dataset.wikilinkTarget) {
        event.preventDefault()
        console.log('[wikilink] navigating to:', el.dataset.wikilinkTarget)
        onNavigate(el.dataset.wikilinkTarget)
        return true
      }
      return false
    },
  })

  return [wikilinkPlugin, wikilinkTheme, clickHandler]
}
