// Turn a live, on-screen chart <svg> into a downloadable image. A detached SVG
// loses the page stylesheet, so every var()-driven fill/stroke/font would fall
// back to black; we walk the tree and inline the *computed* presentation styles
// before serializing. Capture must come from a visible element — a hidden
// ResponsiveContainer measures 0.

const STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
];

function inlineStyles(source, clone) {
  const sources = [source, ...source.querySelectorAll('*')];
  const clones = [clone, ...clone.querySelectorAll('*')];
  for (let i = 0; i < sources.length; i += 1) {
    const target = clones[i];
    if (!target || target.nodeType !== 1) continue;
    const computed = window.getComputedStyle(sources[i]);
    let css = '';
    for (const prop of STYLE_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (value) css += `${prop}:${value};`;
    }
    target.setAttribute('style', css);
  }
}

function sizeOf(svgEl) {
  const rect = svgEl.getBoundingClientRect();
  const width = rect.width || Number(svgEl.getAttribute('width')) || 0;
  const height = rect.height || Number(svgEl.getAttribute('height')) || 0;
  return { width, height };
}

export function svgToString(svgEl) {
  const clone = svgEl.cloneNode(true);
  inlineStyles(svgEl, clone);
  const { width, height } = sizeOf(svgEl);
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);
  if (!clone.getAttribute('viewBox') && width && height) {
    clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  const serialized = new XMLSerializer().serializeToString(clone);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
}

// PNG rendering needs canvas.toBlob; jsdom and very old browsers lack it, so
// callers can fall back to SVG when this is false.
export function canExportPng() {
  return (
    typeof document !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.toBlob === 'function'
  );
}

export function svgToPng(svgEl, { scale = 2, background = null } = {}) {
  const svgString = svgToString(svgEl);
  const { width, height } = sizeOf(svgEl);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext('2d');
        if (background) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((out) => (out ? resolve(out) : reject(new Error('PNG encoding failed'))), 'image/png');
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not rasterize the chart SVG'));
    };
    img.src = url;
  });
}
