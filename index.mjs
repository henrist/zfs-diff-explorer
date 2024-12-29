/**
 * @typedef {{ type: string; movedTo?: string }} Change
 */

/**
 * @typedef {{ children: { [key: string]: Hierarchy }; changes?: Change[] }} Hierarchy
 */

/**
 * @typedef {{ includeRenamed: boolean }} ParseOptions
 */

function count(/** @type Hierarchy */ hierarchy) {
  let c = 0

  for (const child of Object.values(hierarchy.children)) {
    if (child.changes != null && child.changes.length > 0) c++

    c += count(child)
  }

  return c
}

function* zfsLines(/** @type string */ data, /** @type ParseOptions */ options) {
  const lines = data.split("\n")
  for (const line of lines) {
    if (line === "") continue

    const m = line.match(/^(.)\t(.+)$/)
    if (!m) {
      continue
    }

    /** @type Change */
    const change = { type: m[1] }
    let path = m[2]

    if (change.type === "R" && !options.includeRenamed) {
      continue
    }

    if (change.type === "M" && !options.includeModified) {
      continue
    }

    if (change.type === "+" && !options.includeAdditions) {
      continue
    }

    if (change.type === "-" && !options.includeDeletions) {
      continue
    }

    if (change.type === "R") {
      const m2 = path.match(/(.+) -> (.+)$/)
      if (!m2) {
        throw new Error("Couldn't find new value for rename")
      }
      path = m2[1]
      change.movedTo = m2[2]
    }

    /** @type {[Change, string]} */
    const res = [change, path]

    yield res
  }
}

function getChild(/** @type Hierarchy */ hierarchy, /** @type string */ value) {
  // hasOwn to support values such as "constructor"
  const found = Object.hasOwn(hierarchy.children, value)
    ? hierarchy.children[value]
    : null
  if (found) return found

  /** @type Hierarchy */
  const created = {
    children: {},
  }
  hierarchy.children[value] = created
  return created
}

function addSegments(
  /** @type Hierarchy */ hierarchy,
  /** @type {string[]} */ segments,
  /** @type Change */ change,
  /** @type string */ path,
) {
  if (segments.length === 0) {
    hierarchy.changes ??= []
    hierarchy.changes.push(change)
    return
  }

  const first = segments[0]
  if (segments.length === 1 && first === "") {
    hierarchy.changes ??= []
    hierarchy.changes.push(change)
    return
  }

  const child = getChild(hierarchy, first)
  addSegments(child, segments.slice(1), change, path)
}

export async function getTreeFromZfs(/** @type string */ fileData, /** @type ParseOptions */ options) {
  /** @type Hierarchy */
  const hierarchy = {
    children: {},
  }

  for (const [change, path] of zfsLines(fileData, options)) {
    if (!path.startsWith("/")) {
      throw new Error(`Didn't start with /: ${path}`)
    }

    const segments = path.split("/")

    addSegments(hierarchy, segments, change, path)
  }

  return hierarchy
}

class ChildItem extends HTMLElement {
  /** @type boolean? */
  isDefaultOpen

  #isOpen = false

  /** @type Hierarchy */
  child

  /** @type string */
  childKey

  /** @type number */
  depth

  connectedCallback() {
    this.#isOpen = this.isDefaultOpen ?? false
    this.render()
  }

  render() {
    const childCount = count(this.child)

    const canOpen = Object.keys(this.child.children).length > 0

    const label = document.createTextNode(
      `${this.childKey}${canOpen ? "/" : ""}${
        childCount > 0 ? ` ${childCount}` : ""
      }`,
    )

    const li = document.createElement("li")

    if (canOpen) {
      const span = document.createElement("span")
      span.tabIndex = 0
      span.className = "font-bold"
      span.addEventListener("click", () => {
        this.#isOpen = !this.#isOpen
        this.render()
      })
      span.appendChild(label)
      li.appendChild(span)
    } else {
      li.appendChild(label)
    }

    for (const change of this.child.changes ?? []) {
      const span = document.createElement("span")
      span.className =
        change.type === "-"
          ? "text-red-600"
          : change.type === "+"
          ? "text-green-600"
          : ""
      span.appendChild(document.createTextNode(` ${change.type}`))

      if (change.movedTo) {
        const movedToSpan = document.createElement("span")
        movedToSpan.style.color = "#BBB"
        movedToSpan.appendChild(document.createTextNode(` -> ${change.movedTo}`))
        span.appendChild(movedToSpan)
      }

      li.appendChild(span)
    }

    if (this.#isOpen) {
      const hierarchyItem = document.createElement("hierarchy-item")
      hierarchyItem.isDefaultOpen = this.isDefaultOpen && Object.keys(this.child.children).length === 1
      hierarchyItem.hierarchy = this.child
      hierarchyItem.depth = this.depth + 1
      li.appendChild(hierarchyItem)
    }

    this.replaceChildren(li)
  }
}

class HierarchyItem extends HTMLElement {
  /** @type boolean? */
  isDefaultOpen

  /** @type Hierarchy */
  hierarchy

  /** @type number */
  depth

  connectedCallback() {
    this.render()
  }

  render() {
    const ol = document.createElement("ol")

    for (const [key, child] of Object.entries(this.hierarchy.children).sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      const childItem = document.createElement("child-item")
      childItem.isDefaultOpen = this.isDefaultOpen
      childItem.child = child
      childItem.childKey = key
      childItem.depth = this.depth
      ol.appendChild(childItem)
    }

    this.replaceChildren(ol)
  }
}

const uploadTemplate = document.createElement("template")
uploadTemplate.innerHTML = `
  <div>
    <input type="file" />
    <label>
      <input type="checkbox" name="includeRenamed" checked />
      Show renamed
    </label>
    <label>
      <input type="checkbox" name="includeModified" checked />
      Show modified
    </label>
    <label>
      <input type="checkbox" name="includeAdditions" checked />
      Show additions
    </label>
    <label>
      <input type="checkbox" name="includeDeletions" checked />
      Show deletions
    </label>
  </div>
`

class UploadArea extends HTMLElement {
  /** @type string */
  text

  connectedCallback() {
    this.render()
  }

  render() {
    this.replaceChildren(uploadTemplate.content.cloneNode(true))

    this.querySelector("input[type=file]").addEventListener("change", async (ev) => {
      const file = ev.currentTarget.files[0]
      this.text = await file.text()
      this.showResult()
    })

    this.querySelectorAll("input[type=checkbox]").forEach((input) => {
      input.addEventListener("change", () => {
        this.showResult()
      })
    })
  }

  async showResult() {
    if (!this.text) return

    const tree = await getTreeFromZfs(this.text, {
      includeRenamed: this.querySelector("input[name=includeRenamed]").checked,
      includeModified: this.querySelector("input[name=includeModified]").checked,
      includeAdditions: this.querySelector("input[name=includeAdditions]").checked,
      includeDeletions: this.querySelector("input[name=includeDeletions]").checked,
    })

    console.log("tree", tree)

    document.body.querySelector("result-item")?.remove()
    const resultItem = document.createElement("result-item")
    resultItem.tree = tree
    document.body.appendChild(resultItem)
  }
}

class ResultItem extends HTMLElement {
  /** @type Hierarchy */
  tree

  connectedCallback() {
    this.render()
  }

  render() {
    const div = document.createElement("div")

    const hierarchyItem = document.createElement("hierarchy-item")
    hierarchyItem.isDefaultOpen = true
    hierarchyItem.hierarchy = this.tree
    hierarchyItem.depth = 0

    div.appendChild(hierarchyItem)

    this.replaceChildren(div)
  }
}

window.customElements.define("child-item", ChildItem)
window.customElements.define("hierarchy-item", HierarchyItem)
window.customElements.define("upload-area", UploadArea)
window.customElements.define("result-item", ResultItem)
