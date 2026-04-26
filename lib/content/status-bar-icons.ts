import type { ArchiveEntryAction } from './message-actions';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const ENTRY_ACTION_TEST_IDS: Record<ArchiveEntryAction, string> = {
  copy: 'copy-turn-action-button',
  like: 'good-response-turn-action-button',
  dislike: 'bad-response-turn-action-button',
  share: 'share-turn-action-button',
  more: 'more-turn-action-button',
};

export function createSvgIcon(doc: Document, action: ArchiveEntryAction): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const commonStroke = {
    fill: 'none',
    stroke: 'currentColor',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'stroke-width': '1.6',
  } as const;

  switch (action) {
    case 'copy': {
      const back = doc.createElementNS(SVG_NS, 'rect');
      back.setAttribute('x', '7');
      back.setAttribute('y', '5');
      back.setAttribute('width', '8');
      back.setAttribute('height', '8');
      back.setAttribute('rx', '1.6');
      Object.entries(commonStroke).forEach(([name, value]) => back.setAttribute(name, value));

      const front = doc.createElementNS(SVG_NS, 'rect');
      front.setAttribute('x', '4');
      front.setAttribute('y', '8');
      front.setAttribute('width', '8');
      front.setAttribute('height', '8');
      front.setAttribute('rx', '1.6');
      Object.entries(commonStroke).forEach(([name, value]) => front.setAttribute(name, value));

      svg.append(back, front);
      return svg;
    }
    case 'like':
    case 'dislike': {
      const thumb = doc.createElementNS(SVG_NS, 'path');
      thumb.setAttribute(
        'd',
        'M5.5 9.8h2.2V17H5.5V9.8Zm3.1-1.3 1.4-4.7h2.2l-.6 4.7H16l-1 6H8.2c-.6 0-1.1-.5-1.1-1.1V8.5Z',
      );
      Object.entries(commonStroke).forEach(([name, value]) => thumb.setAttribute(name, value));
      if (action === 'dislike') {
        thumb.setAttribute('transform', 'translate(20 20) scale(-1 -1)');
      }
      svg.append(thumb);
      return svg;
    }
    case 'share': {
      const arrow = doc.createElementNS(SVG_NS, 'path');
      arrow.setAttribute('d', 'M10 4.5v8.2M6.6 7.9 10 4.5l3.4 3.4M4.5 11.8V15a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3.2');
      Object.entries(commonStroke).forEach(([name, value]) => arrow.setAttribute(name, value));
      svg.append(arrow);
      return svg;
    }
    case 'more': {
      for (const cx of [6, 10, 14]) {
        const dot = doc.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('cx', String(cx));
        dot.setAttribute('cy', '10');
        dot.setAttribute('r', '1.1');
        dot.setAttribute('fill', 'currentColor');
        svg.append(dot);
      }
      return svg;
    }
  }
}

export function createCheckIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.style.width = '16px';
  svg.style.height = '16px';
  svg.style.display = 'block';

  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M4.5 10.5 8.2 14 15.5 6');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-width', '1.8');
  svg.append(path);

  return svg;
}
