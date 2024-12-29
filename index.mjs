/**
 * @typedef {{ type: string; movedTo?: string }} Change
 */

/**
 * @typedef {{ children: { [key: string]: Hierarchy }; changes?: Change[] }} Hierarchy
 */

/**
 * @typedef {{ includeRenamed: boolean; includeModified: boolean; includeAdditions: boolean; includeDeletions; boolean; includeAddDel: boolean }} ParseOptions
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

    /** @type Change */
    const change = { type: m[1] }
    let path = m[2]

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

async function getTreeFromZfs(/** @type string */ fileData) {
  /** @type Hierarchy */
  const hierarchy = {
    children: {},
  }

  for (const [change, path] of zfsLines(fileData)) {
    if (!path.startsWith("/")) {
      throw new Error(`Didn't start with /: ${path}`)
    }

    const segments = path.split("/")

    addSegments(hierarchy, segments, change, path)
  }

  return hierarchy
}

function pruneTree(/** @type Hierarchy */ tree, /** @type ParseOptions */ options) {
  const isAddDel =
    tree.changes?.find((change) => change.type === "-") != null &&
    tree.changes?.find((change) => change.type === "+") != null

  const changes = tree.changes?.filter((change) => {
    if (change.type === "R" && !options.includeRenamed) {
      return false
    }

    if (change.type === "M" && !options.includeModified) {
      return false
    }

    if (isAddDel) {
      if (!options.includeAddDel) {
        return false
      }
    } else {
      if (change.type === "+" && !options.includeAdditions) {
        return false
      }

      if (change.type === "-" && !options.includeDeletions) {
        return false
      }
    }

    return true
  })

  /** @type Hierarchy */
  const updated = {
    children: Object.fromEntries(
      Object.entries(tree.children).flatMap(([key, value]) => {
        const result = pruneTree(value, options)
        return result ? [[key, result]] : []
      })
    ),
    changes,
  }

  if (!updated.changes?.length && Object.keys(updated.children).length === 0) {
    return undefined
  }

  return updated
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
      <input type="checkbox" name="includeAddDel" checked />
      Show add+del
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
  /** @type Hierarchy */
  tree

  connectedCallback() {
    this.render()
  }

  render() {
    this.replaceChildren(uploadTemplate.content.cloneNode(true))

    this.querySelector("input[type=file]").addEventListener("change", async (ev) => {
      const file = ev.currentTarget.files[0]
      const text = await file.text()
      this.tree = await getTreeFromZfs(text)
      console.log("tree", this.tree)
      this.showResult()
    })

    this.querySelectorAll("input[type=checkbox]").forEach((input) => {
      input.addEventListener("change", () => {
        this.showResult()
      })
    })
  }

  async showResult() {
    if (!this.tree) return

    let prunedTree = pruneTree(this.tree, {
      includeRenamed: this.querySelector("input[name=includeRenamed]").checked,
      includeModified: this.querySelector("input[name=includeModified]").checked,
      includeAdditions: this.querySelector("input[name=includeAdditions]").checked,
      includeDeletions: this.querySelector("input[name=includeDeletions]").checked,
      includeAddDel: this.querySelector("input[name=includeAddDel]").checked,
    })

    if (!prunedTree) {
      prunedTree = {
        children: {},
        changes: [],
      }
    }

    console.log("pruned", prunedTree)

    document.body.querySelector("result-item")?.remove()
    const resultItem = document.createElement("result-item")
    resultItem.tree = prunedTree
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
