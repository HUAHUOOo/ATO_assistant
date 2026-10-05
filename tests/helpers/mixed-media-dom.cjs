'use strict';

// A deliberately limited DOM/event double. It never fetches URLs, evaluates
// markup, or decodes image bytes. Tests explicitly settle each image attempt.
// Layout, real event capture, browser Range behavior across nodes, clipboard,
// speech synthesis and Android WebView require separate integration coverage.
const escape = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const decode = value => String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
  if (entity[0] === '#') {
    const hex = entity[1].toLowerCase() === 'x';
    return String.fromCodePoint(parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10));
  }
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }[entity.toLowerCase()];
});

class Node {
  constructor(tag, document, text = '') {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = document;
    this.parentNode = null;
    this.childNodes = [];
    this.attrs = {};
    this.listeners = {};
    this._text = text;
    this.style = {};
    this.hidden = false;
    this.complete = false;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set(this.className.split(/\s+/).filter(Boolean).concat(names))].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
      toggle: (name, force) => {
        const on = force === undefined ? !this.classList.contains(name) : force;
        if (on) this.classList.add(name); else this.classList.remove(name);
        return on;
      },
    };
  }
  get nodeType() { return this.tagName === '#TEXT' ? 3 : this.tagName === '#FRAGMENT' ? 11 : 1; }
  get nodeValue() { return this.nodeType === 3 ? this._text : null; }
  set nodeValue(value) { this._text = String(value); }
  get textContent() { return this.nodeType === 3 ? this._text : this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) {
    this.replaceChildren();
    if (this.nodeType === 3) this._text = String(value);
    else if (value !== '') this.append(this.ownerDocument.createTextNode(String(value)));
  }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null; }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentNode?.isConnected); }
  get className() { return this.attrs.class || ''; }
  set className(value) { this.attrs.class = String(value); }
  get id() { return this.attrs.id || ''; }
  set id(value) { this.attrs.id = String(value); }
  get src() { return this.attrs.src || ''; }
  set src(value) {
    this.attrs.src = String(value);
    if (this.tagName === 'IMG') this.ownerDocument.imageRequests.push(this);
  }
  setAttribute(name, value) { this.attrs[name] = String(value); if (name === 'hidden') this.hidden = true; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  hasAttribute(name) { return name in this.attrs; }
  removeAttribute(name) { delete this.attrs[name]; if (name === 'hidden') this.hidden = false; }
  append(...nodes) {
    for (let node of nodes) {
      if (typeof node === 'string') node = this.ownerDocument.createTextNode(node);
      this.appendChild(node);
    }
  }
  appendChild(node) {
    if (node.nodeType === 11) { for (const child of [...node.childNodes]) this.appendChild(child); return node; }
    node.remove(); node.parentNode = this; this.childNodes.push(node); return node;
  }
  insertBefore(node, reference) {
    if (!reference) return this.appendChild(node);
    if (node.nodeType === 11) { for (const child of [...node.childNodes]) this.insertBefore(child, reference); return node; }
    node.remove();
    const index = this.childNodes.indexOf(reference);
    if (index < 0) throw Error('Missing reference node');
    this.childNodes.splice(index, 0, node); node.parentNode = this; return node;
  }
  remove() {
    if (!this.parentNode) return;
    const parent = this.parentNode;
    parent.childNodes.splice(parent.childNodes.indexOf(this), 1); this.parentNode = null;
  }
  replaceChildren(...nodes) { for (const node of this.childNodes) node.parentNode = null; this.childNodes = []; this.append(...nodes); }
  replaceWith(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    for (const node of nodes) parent.insertBefore(node, this);
    this.remove();
  }
  contains(node) { for (; node; node = node.parentNode) if (node === this) return true; return false; }
  matches(selector) {
    return selector.split(',').some(part => {
      const value = part.trim(), tag = value.match(/^[\w-]+/)?.[0];
      if (tag && tag.toUpperCase() !== this.tagName) return false;
      if ([...value.matchAll(/\.([\w-]+)/g)].some(match => !this.classList.contains(match[1]))) return false;
      if ([...value.matchAll(/#([\w-]+)/g)].some(match => this.id !== match[1])) return false;
      return [...value.matchAll(/\[([^=\]]+)(?:=["']?([^"'\]]*)["']?)?\]/g)].every(match =>
        match[2] === undefined ? this.hasAttribute(match[1]) : this.getAttribute(match[1]) === match[2]);
    });
  }
  closest(selector) { for (let node = this; node; node = node.parentNode) if (node.nodeType === 1 && node.matches(selector)) return node; return null; }
  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/), result = [];
    const visit = node => {
      for (const child of node.childNodes) {
        if (child.nodeType === 1 && child.matches(parts.at(-1))) {
          let ancestor = child.parentNode, matches = true;
          for (let index = parts.length - 2; index >= 0; index--) {
            while (ancestor && !ancestor.matches(parts[index])) ancestor = ancestor.parentNode;
            if (!ancestor) { matches = false; break; }
            ancestor = ancestor.parentNode;
          }
          if (matches) result.push(child);
        }
        visit(child);
      }
    };
    visit(this); return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
  removeEventListener(type, callback) { this.listeners[type] = (this.listeners[type] || []).filter(listener => listener !== callback); }
  dispatch(type, event = {}) {
    event.type = type; event.target ??= this;
    event.preventDefault ??= () => { event.defaultPrevented = true; };
    event.stopPropagation ??= () => { event.propagationStopped = true; };
    for (let node = this; node; node = node.parentNode) {
      for (const callback of [...node.listeners[type] || []]) callback.call(node, event);
      if (event.propagationStopped) break;
    }
    return event;
  }
  focus() { this.ownerDocument.activeElement = this; }
  decode() {
    this.ownerDocument.decodeCalls.push(this);
    return new Promise((resolve, reject) => { this.decodeResolve = resolve; this.decodeReject = reject; });
  }
  cloneNode(deep = false) {
    const copy = new Node(this.tagName, this.ownerDocument, this._text);
    copy.attrs = { ...this.attrs }; copy.hidden = this.hidden; copy.style = { ...this.style };
    if (deep) for (const node of this.childNodes) copy.append(node.cloneNode(true));
    return copy;
  }
  get innerHTML() { return this.childNodes.map(node => node.outerHTML).join(''); }
  set innerHTML(value) { this.replaceChildren(); parseHTML(String(value), this); }
  get outerHTML() {
    if (this.nodeType === 3) return escape(this._text);
    if (this.nodeType === 11) return this.innerHTML;
    const tag = this.tagName.toLowerCase();
    const attributes = Object.entries(this.attrs).map(([name, value]) => ` ${name}="${escape(value)}"`).join('');
    return `<${tag}${attributes}>` + (/^(img|br|hr|input|meta|link)$/.test(tag) ? '' : this.innerHTML + `</${tag}>`);
  }
  splitText(offset) {
    if (this.nodeType !== 3) throw Error('Expected text node');
    const tail = this.ownerDocument.createTextNode(this.nodeValue.slice(offset));
    this.nodeValue = this.nodeValue.slice(0, offset);
    if (this.parentNode) this.parentNode.insertBefore(tail, this.nextSibling);
    return tail;
  }
}

function parseHTML(html, parent) {
  const stack = [parent];
  for (const token of html.match(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|[^<]+|</g) || []) {
    if (token.startsWith('<!--')) continue;
    if (token.startsWith('</')) {
      const tag = token.slice(2).match(/^[\w:-]+/)?.[0]?.toUpperCase();
      for (let index = stack.length - 1; index > 0; index--) {
        if (stack[index].tagName === tag) { stack.length = index; break; }
      }
    } else if (/^<[A-Za-z]/.test(token)) {
      const tag = token.slice(1).match(/^[\w:-]+/)[0], node = parent.ownerDocument.createElement(tag);
      for (const match of token.slice(tag.length + 1, -1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        node.setAttribute(match[1], decode(match[2] ?? match[3] ?? match[4] ?? ''));
      }
      stack.at(-1).append(node);
      if (!/^(img|br|hr|input|meta|link)$/i.test(tag) && !token.endsWith('/>')) stack.push(node);
    } else stack.at(-1).append(parent.ownerDocument.createTextNode(decode(token)));
  }
}

class Range {
  constructor(document) { this.document = document; }
  setStart(node, offset) { this.startContainer = node; this.startOffset = offset; }
  setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; }
  selectNodeContents(node) { this.setStart(node, 0); this.setEnd(node, node.nodeType === 3 ? node.nodeValue.length : node.childNodes.length); }
  cloneContents() {
    if (this.startContainer !== this.endContainer) throw Error('DOM double does not model cross-node Range extraction');
    const fragment = this.document.createDocumentFragment(), node = this.startContainer;
    if (node.nodeType === 3) fragment.append(this.document.createTextNode(node.nodeValue.slice(this.startOffset, this.endOffset)));
    else for (const child of node.childNodes.slice(this.startOffset, this.endOffset)) fragment.append(child.cloneNode(true));
    return fragment;
  }
  extractContents() {
    const fragment = this.cloneContents(), node = this.startContainer;
    if (node.nodeType === 3) node.nodeValue = node.nodeValue.slice(0, this.startOffset) + node.nodeValue.slice(this.endOffset);
    else for (const child of node.childNodes.slice(this.startOffset, this.endOffset)) child.remove();
    this.setEnd(node, this.startOffset); return fragment;
  }
  insertNode(node) {
    const start = this.startContainer;
    if (start.nodeType === 3) { const tail = start.splitText(this.startOffset); start.parentNode.insertBefore(node, tail); }
    else start.insertBefore(node, start.childNodes[this.startOffset] || null);
  }
  detach() {}
}

class Document {
  constructor() { this.body = new Node('body', this); this.body.style.overflow = 'auto'; this.imageRequests = []; this.decodeCalls = []; }
  createElement(tag) { return new Node(tag, this); }
  createTextNode(value) { return new Node('#text', this, String(value)); }
  createDocumentFragment() { return new Node('#fragment', this); }
  createRange() { return new Range(this); }
}

function harness() {
  const document = new Document(), container = document.createElement('div');
  document.body.append(container);
  let now = 0, nextId = 0;
  const timers = new Map(), raf = new Map();
  const env = {
    document,
    location: { href: 'https://example.invalid/nested/app/story/index.html' },
    setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => { const id = ++nextId; raf.set(id, callback); return id; },
    cancelAnimationFrame: id => raf.delete(id),
    getSelection: () => env.selection,
  };
  function advance(milliseconds) {
    now += milliseconds;
    for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.callback(); }
  }
  function frames() { for (const [id, callback] of [...raf]) { raf.delete(id); callback(now); } }
  return { document, container, env, timers, raf, advance, frames };
}

module.exports = { harness, escape };
