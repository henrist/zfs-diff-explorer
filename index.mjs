/**
 * @typedef {{ change: string }} Change
 */

/**
 * @typedef {{ children: { [key: string]: Hierarchy }; changes?: Change[] }} Hierarchy
 */

function count(/** @type Hierarchy */ hierarchy) {
  let c = 0

  for (const child of Object.values(hierarchy.children)) {
    if (child.changes != null && child.changes.length > 0) c++

    c += count(child)
  }

  return c
}

function* zfsLines(/** @type string */ data) {
  const lines = data.split("\n")
  for (const line of lines) {
    if (line === "") continue

    const m = line.match(/^(.)\t(.+)$/)
    if (!m) {
      continue
    }

    /** @type {[string, string]} */
    const res = [m[1], m[2]]

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
  /** @type string */ type,
  /** @type string */ path,
) {
  if (segments.length === 0) {
    hierarchy.changes ??= []
    hierarchy.changes.push({ change: type })
    return
  }

  const first = segments[0]
  if (segments.length === 1 && first === "") {
    hierarchy.changes ??= []
    hierarchy.changes.push({ change: type })
    return
  }

  const child = getChild(hierarchy, first)
  addSegments(child, segments.slice(1), type, path)
}

export async function getTreeFromZfs(/** @type string */ fileData) {
  /** @type Hierarchy */
  const hierarchy = {
    children: {},
  }

  for (const [type, path] of zfsLines(fileData)) {
    if (!path.startsWith("/")) {
      throw new Error(`Didn't start with /: ${path}`)
    }

    const segments = path.split("/")

    addSegments(hierarchy, segments, type, path)
  }

  return hierarchy
}

class ChildItem extends HTMLElement {
  #isOpen = false

  /** @type Hierarchy */
  child

  /** @type string */
  childKey

  /** @type number */
  depth

  connectedCallback() {
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
        change.change === "-"
          ? "text-red-600"
          : change.change === "+"
          ? "text-green-600"
          : ""
      span.appendChild(document.createTextNode(` ${change.change}`))
      li.appendChild(span)
    }

    if (this.#isOpen) {
      const hierarchyItem = document.createElement("hierarchy-item")
      hierarchyItem.hierarchy = this.child
      hierarchyItem.depth = this.depth + 1
      li.appendChild(hierarchyItem)
    }

    this.replaceChildren(li)
  }
}

class HierarchyItem extends HTMLElement {
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
      childItem.child = child
      childItem.childKey = key
      childItem.depth = this.depth
      ol.appendChild(childItem)
    }

    this.replaceChildren(ol)
  }
}

class UploadArea extends HTMLElement {
  connectedCallback() {
    this.render()
  }

  render() {
    const div = document.createElement("div")

    const input = document.createElement("input")
    input.type = "file"
    input.addEventListener("change", async () => {
      const file = input.files[0]
      const text = await file.text()

      const tree = await getTreeFromZfs(text)
      console.log("tree", tree)

      const resultItem = document.createElement("result-item")
      resultItem.tree = tree
      document.body.appendChild(resultItem)
    })
    div.appendChild(input)

    this.replaceChildren(div)
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
