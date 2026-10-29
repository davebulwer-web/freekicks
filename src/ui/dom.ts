/** Tiny DOM helper: el('div.cls#id', {attrs}, children) */
export function el<K extends keyof HTMLElementTagNameMap>(
  spec: K | `${K}.${string}` | `${K}#${string}`,
  attrs: Record<string, string | number | boolean | ((e: Event) => void)> = {},
  children: (Node | string | null | undefined | false)[] = [],
): HTMLElementTagNameMap[K] {
  const m = /^([a-z0-9]+)((?:[.#][\w-]+)*)$/i.exec(spec)!;
  const node = document.createElement(m[1] as K);
  for (const part of m[2].match(/[.#][\w-]+/g) ?? []) {
    if (part[0] === '.') node.classList.add(part.slice(1));
    else node.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') node.addEventListener(k.replace(/^on/, ''), v);
    else if (typeof v === 'boolean') {
      if (v) node.setAttribute(k, '');
    } else if (k === 'text') node.textContent = String(v);
    else if (k === 'html') node.innerHTML = String(v);
    else node.setAttribute(k, String(v));
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

/** Stop pointer events on UI controls from reaching the game's tap/drag handler. */
export function shield(node: HTMLElement): HTMLElement {
  for (const ev of ['pointerdown', 'pointerup', 'pointermove']) node.addEventListener(ev, (e) => e.stopPropagation());
  return node;
}
