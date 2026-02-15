import {
  ViewPlugin, Decoration, EditorView, WidgetType,
  type DecorationSet, type ViewUpdate,
} from '@codemirror/view'
import { type Range, type Extension } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'

/**
 * Live preview plugin — Obsidian/Bear-style markdown editing.
 * Hides syntax markers when cursor is NOT on a line, reveals them when it IS.
 * Headers ALWAYS keep their enlarged size, even on the active line.
 */

function isOnCursorLine(view: EditorView, from: number, to: number): boolean {
  for (const range of view.state.selection.ranges) {
    const cursorLine = view.state.doc.lineAt(range.head).number
    const fromLine = view.state.doc.lineAt(from).number
    const toLine = view.state.doc.lineAt(Math.min(to, view.state.doc.length)).number
    if (cursorLine >= fromLine && cursorLine <= toLine) return true
  }
  return false
}

class HrWidget extends WidgetType {
  toDOM() {
    const hr = document.createElement('hr')
    hr.className = 'cm-live-hr'
    return hr
  }
}

class BulletWidget extends WidgetType {
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-live-bullet'
    span.textContent = '•'
    return span
  }
}

class CheckboxWidget extends WidgetType {
  checked: boolean
  pos: number

  constructor(checked: boolean, pos: number) {
    super()
    this.checked = checked
    this.pos = pos
  }

  eq(other: CheckboxWidget) {
    return this.checked === other.checked && this.pos === other.pos
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement('span')
    wrapper.className = 'cm-live-checkbox-wrap'

    const cb = document.createElement('span')
    cb.className = this.checked ? 'cm-live-checkbox cm-live-checkbox-checked' : 'cm-live-checkbox'
    if (this.checked) {
      cb.textContent = '✓'
    }
    cb.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const newText = this.checked ? '- [ ] ' : '- [x] '
      view.dispatch({
        changes: { from: this.pos, to: this.pos + 6, insert: newText },
      })
    })

    wrapper.appendChild(cb)
    return wrapper
  }

  ignoreEvent() { return false }
}

function buildDecorations(view: EditorView): DecorationSet {
  const decs: Range<Decoration>[] = []
  const tree = syntaxTree(view.state)
  const doc = view.state.doc

  tree.iterate({
    enter: (node) => {
      const { from, to, name } = node
      const onCursor = isOnCursorLine(view, from, to)

      // ATX Headings: ALWAYS apply size styling, even on cursor line
      // On cursor line: show "#" markers in subtle color
      // Off cursor line: hide "#" markers entirely
      if (/^ATXHeading[1-6]$/.test(name)) {
        const level = parseInt(name.charAt(name.length - 1))
        let markerEnd = from
        const cursor = node.node.cursor()
        if (cursor.firstChild()) {
          do {
            if (cursor.name === 'HeaderMark') {
              markerEnd = cursor.to
            }
          } while (cursor.nextSibling())
        }
        if (markerEnd > from) {
          const afterMarker = doc.sliceString(markerEnd, Math.min(markerEnd + 1, to))
          const contentStart = afterMarker === ' ' ? markerEnd + 1 : markerEnd

          if (onCursor) {
            // Active line: show markers in subtle color, keep heading size on whole line
            decs.push(Decoration.mark({ class: `cm-live-heading-marker cm-live-heading-marker-${level}` }).range(from, markerEnd))
            if (contentStart < to) {
              decs.push(Decoration.mark({ class: `cm-live-heading cm-live-heading-${level}` }).range(contentStart, to))
            }
          } else {
            // Inactive line: hide markers, style content
            decs.push(Decoration.replace({}).range(from, contentStart))
            decs.push(Decoration.mark({ class: `cm-live-heading cm-live-heading-${level}` }).range(contentStart, to))
          }
        }
        return false
      }

      // Skip remaining nodes on cursor line — reveal raw syntax there
      if (onCursor) return

      // Bold: **text** or __text__
      if (name === 'StrongEmphasis') {
        const text = doc.sliceString(from, to)
        const marker = text.startsWith('**') ? '**' : text.startsWith('__') ? '__' : null
        if (marker && text.endsWith(marker) && to - from > marker.length * 2) {
          decs.push(Decoration.replace({}).range(from, from + marker.length))
          decs.push(Decoration.mark({ class: 'cm-live-strong' }).range(from + marker.length, to - marker.length))
          decs.push(Decoration.replace({}).range(to - marker.length, to))
        }
        return false
      }

      // Italic: *text* or _text_
      if (name === 'Emphasis') {
        const text = doc.sliceString(from, to)
        if ((text.startsWith('*') && text.endsWith('*')) || (text.startsWith('_') && text.endsWith('_'))) {
          if (to - from > 2) {
            decs.push(Decoration.replace({}).range(from, from + 1))
            decs.push(Decoration.mark({ class: 'cm-live-em' }).range(from + 1, to - 1))
            decs.push(Decoration.replace({}).range(to - 1, to))
          }
        }
        return false
      }

      // Links: [text](url)
      if (name === 'Link') {
        const cursor = node.node.cursor()
        let textStart = -1
        let textEnd = -1
        let urlPartStart = -1

        if (cursor.firstChild()) {
          do {
            if (cursor.name === 'LinkMark') {
              if (textStart === -1) {
                textStart = cursor.to
              } else if (urlPartStart === -1) {
                textEnd = cursor.from
                urlPartStart = cursor.from
              }
            }
          } while (cursor.nextSibling())
        }

        if (textStart !== -1 && textEnd !== -1 && urlPartStart !== -1) {
          decs.push(Decoration.replace({}).range(from, textStart))
          decs.push(Decoration.mark({ class: 'cm-live-link' }).range(textStart, textEnd))
          decs.push(Decoration.replace({}).range(urlPartStart, to))
        }
        return false
      }

      // Inline code: `code`
      if (name === 'InlineCode') {
        const text = doc.sliceString(from, to)
        if (text.startsWith('`') && text.endsWith('`') && to - from > 2) {
          decs.push(Decoration.replace({}).range(from, from + 1))
          decs.push(Decoration.mark({ class: 'cm-live-code' }).range(from + 1, to - 1))
          decs.push(Decoration.replace({}).range(to - 1, to))
        }
        return false
      }

      // Horizontal rules: ---, ***, ___
      if (name === 'HorizontalRule') {
        decs.push(Decoration.replace({ widget: new HrWidget() }).range(from, to))
        return false
      }
    },
  })

  // Second pass: line-based decorations for lists and checkboxes
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const text = line.text
    const stripped = text.replace(/^\s*/, '')
    const indent = text.length - stripped.length
    const lineOnCursor = isOnCursorLine(view, line.from, line.to)

    // Checkbox: "- [ ] " or "- [x] " (with optional leading whitespace)
    const checkboxMatch = text.match(/^(\s*)- \[([ x])\] /)
    if (checkboxMatch && !lineOnCursor) {
      const checked = checkboxMatch[2] === 'x'
      const markerStart = line.from + checkboxMatch[1].length
      const markerEnd = markerStart + 6 // "- [x] " is 6 chars
      decs.push(
        Decoration.replace({
          widget: new CheckboxWidget(checked, markerStart),
        }).range(markerStart, markerEnd)
      )
      // Add nested guide line decoration
      if (indent > 0) {
        decs.push(Decoration.line({ class: 'cm-live-list-nested' }).range(line.from))
      }
      continue
    }

    // Unordered list bullet: "- " (with optional leading whitespace)
    const bulletMatch = text.match(/^(\s*)- /)
    if (bulletMatch && !lineOnCursor) {
      const markerStart = line.from + bulletMatch[1].length
      const markerEnd = markerStart + 2 // "- " is 2 chars
      decs.push(
        Decoration.replace({
          widget: new BulletWidget(),
        }).range(markerStart, markerEnd)
      )
    }

    // Add nested guide line for any indented list item (bullet or checkbox)
    if (indent > 0 && /^\s+(- |\* |\d+\. )/.test(text)) {
      decs.push(Decoration.line({ class: 'cm-live-list-nested' }).range(line.from))
    }
  }

  return Decoration.set(decs, true)
}

const livePreviewPlugin = ViewPlugin.fromClass(
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

const livePreviewTheme = EditorView.theme({
  // Headings — content text
  '.cm-live-heading': {
    fontWeight: '700',
    color: '#e0e0e0',
  },
  '.cm-live-heading-1': { fontSize: '1.8em', lineHeight: '1.4' },
  '.cm-live-heading-2': { fontSize: '1.4em', lineHeight: '1.4' },
  '.cm-live-heading-3': { fontSize: '1.2em', lineHeight: '1.35' },
  '.cm-live-heading-4': { fontSize: '1.05em', lineHeight: '1.35' },
  '.cm-live-heading-5': { fontSize: '1em', lineHeight: '1.3' },
  '.cm-live-heading-6': { fontSize: '0.9em', lineHeight: '1.3', opacity: '0.8' },

  // Heading markers (#) — visible on active line, subtle color
  '.cm-live-heading-marker': {
    color: '#555',
    fontWeight: '300',
  },
  '.cm-live-heading-marker-1': { fontSize: '1.8em', lineHeight: '1.4' },
  '.cm-live-heading-marker-2': { fontSize: '1.4em', lineHeight: '1.4' },
  '.cm-live-heading-marker-3': { fontSize: '1.2em', lineHeight: '1.35' },
  '.cm-live-heading-marker-4': { fontSize: '1.05em', lineHeight: '1.35' },
  '.cm-live-heading-marker-5': { fontSize: '1em', lineHeight: '1.3' },
  '.cm-live-heading-marker-6': { fontSize: '0.9em', lineHeight: '1.3' },

  // Inline formatting
  '.cm-live-strong': { fontWeight: '700' },
  '.cm-live-em': { fontStyle: 'italic' },
  '.cm-live-link': {
    color: '#4a9eff',
    textDecoration: 'underline',
    cursor: 'pointer',
  },
  '.cm-live-code': {
    fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
    fontSize: '0.9em',
    background: '#1e1e3a',
    padding: '1px 4px',
    borderRadius: '3px',
  },

  // Horizontal rule
  '.cm-live-hr': {
    border: 'none',
    borderTop: '1px solid #3a3a5a',
    margin: '8px 0',
  },

  // Bullet widget
  '.cm-live-bullet': {
    color: '#888',
    fontSize: '0.85em',
    marginRight: '4px',
  },

  // Checkbox widget
  '.cm-live-checkbox-wrap': {
    display: 'inline-flex',
    alignItems: 'center',
    marginRight: '4px',
    verticalAlign: 'middle',
  },
  '.cm-live-checkbox': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '16px',
    height: '16px',
    border: '1.5px solid #555',
    borderRadius: '3px',
    background: 'transparent',
    cursor: 'pointer',
    verticalAlign: 'middle',
    fontSize: '11px',
    lineHeight: '1',
    color: 'transparent',
    userSelect: 'none',
  },
  '.cm-live-checkbox:hover': {
    borderColor: '#4a9eff',
  },
  '.cm-live-checkbox-checked': {
    background: '#4a9eff',
    borderColor: '#4a9eff',
    color: '#fff',
  },

  // Nested list guide line
  '.cm-live-list-nested': {
    borderLeft: '1.5px solid #2a2a4a',
    marginLeft: '8px',
  },
})

export function livePreview(): Extension {
  return [livePreviewPlugin, livePreviewTheme]
}
