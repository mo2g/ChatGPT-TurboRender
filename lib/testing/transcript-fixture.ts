export interface TranscriptFixture {
  main: HTMLElement;
  headerActions: HTMLElement;
  shareButton: HTMLButtonElement;
  scroller: HTMLElement;
  transcript: HTMLElement;
  stopButton: HTMLButtonElement;
}

export interface GroupedTranscriptFixture extends Omit<TranscriptFixture, 'transcript'> {
  transcript: HTMLElement;
  dayGroups: HTMLElement[];
}

export interface FixtureOptions {
  turnCount: number;
  streaming?: boolean;
}

type HostActionName = 'copy' | 'like' | 'dislike' | 'share' | 'more';

const HOST_ACTION_LABELS: Record<HostActionName, string> = {
  copy: 'Copy',
  like: 'Like',
  dislike: 'Dislike',
  share: 'Share',
  more: 'More',
};

const HOST_ACTION_TEST_IDS: Record<HostActionName, string> = {
  copy: 'copy-turn-action-button',
  like: 'good-response-turn-action-button',
  dislike: 'bad-response-turn-action-button',
  share: 'share-turn-action-button',
  more: 'more-turn-action-button',
};

const HOST_ICON_NS = 'http://www.w3.org/2000/svg';

function createHostActionIcon(doc: Document, action: HostActionName): SVGSVGElement {
  const svg = doc.createElementNS(HOST_ICON_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.style.width = '16px';
  svg.style.height = '16px';
  svg.style.display = 'block';

  const commonStroke = {
    fill: 'none',
    stroke: 'currentColor',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'stroke-width': '1.6',
  } as const;

  switch (action) {
    case 'copy': {
      const back = doc.createElementNS(HOST_ICON_NS, 'rect');
      back.setAttribute('x', '7');
      back.setAttribute('y', '5');
      back.setAttribute('width', '8');
      back.setAttribute('height', '8');
      back.setAttribute('rx', '1.6');
      Object.entries(commonStroke).forEach(([name, value]) => back.setAttribute(name, value));

      const front = doc.createElementNS(HOST_ICON_NS, 'rect');
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
      const thumb = doc.createElementNS(HOST_ICON_NS, 'path');
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
      const arrow = doc.createElementNS(HOST_ICON_NS, 'path');
      arrow.setAttribute('d', 'M10 4.5v8.2M6.6 7.9 10 4.5l3.4 3.4M4.5 11.8V15a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3.2');
      Object.entries(commonStroke).forEach(([name, value]) => arrow.setAttribute(name, value));
      svg.append(arrow);
      return svg;
    }
    case 'more': {
      for (const cx of [6, 10, 14]) {
        const dot = doc.createElementNS(HOST_ICON_NS, 'circle');
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

function hostActionCounterKey(action: HostActionName): string {
  return `hostAction${action[0]?.toUpperCase() ?? ''}${action.slice(1)}Count`;
}

function incrementHostActionCounter(doc: Document, action: HostActionName): void {
  const key = hostActionCounterKey(action);
  const current = Number(doc.body.dataset[key] ?? '0');
  doc.body.dataset[key] = String(current + 1);
}

function createHostActionButton(doc: Document, action: HostActionName): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', HOST_ACTION_LABELS[action]);
  button.setAttribute('title', HOST_ACTION_LABELS[action]);
  button.setAttribute('data-testid', HOST_ACTION_TEST_IDS[action]);
  button.dataset.hostAction = action;
  button.style.display = 'inline-flex';
  button.style.alignItems = 'center';
  button.style.justifyContent = 'center';
  button.style.width = '24px';
  button.style.height = '24px';
  button.style.padding = '0';
  button.style.border = '0';
  button.style.borderRadius = '999px';
  button.style.background = 'transparent';
  button.style.color = '#6b7280';
  button.style.cursor = 'pointer';
  button.style.lineHeight = '0';
  button.append(createHostActionIcon(doc, action));
  button.addEventListener('click', () => {
    if (action === 'like' || action === 'dislike') {
      const nextPressed = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(nextPressed));
      if (nextPressed) {
        incrementHostActionCounter(doc, action);
      }
      return;
    }

    incrementHostActionCounter(doc, action);
  });
  return button;
}

function createTurn(doc: Document, index: number): HTMLElement {
  const turn = doc.createElement('article');
  const role = index % 2 === 0 ? 'user' : 'assistant';
  turn.className = 'conversation-turn';
  turn.dataset.testid = `conversation-turn-${index}`;
  turn.setAttribute('data-testid', `conversation-turn-${index}`);
  turn.setAttribute('data-message-author-role', role);
  turn.innerHTML = `
    <header>${role === 'user' ? 'You' : 'ChatGPT'}</header>
    <div class="turn-body">
      <p>Turn ${index + 1} primary content.</p>
      <p>Turn ${index + 1} secondary content to simulate nested DOM.</p>
      <article class="turn-nested-card">
        <p>Nested card inside turn ${index + 1}.</p>
      </article>
      <pre><code>const sample${index} = ${index};</code></pre>
    </div>
  `;

  const hostActionBar = doc.createElement('div');
  hostActionBar.className = 'turn-host-actions';
  hostActionBar.style.display = 'flex';
  hostActionBar.style.flexWrap = 'wrap';
  hostActionBar.style.gap = '8px';
  hostActionBar.style.alignItems = 'center';
  hostActionBar.style.marginTop = '8px';
  hostActionBar.append(
    createHostActionButton(doc, 'copy'),
    createHostActionButton(doc, 'like'),
    createHostActionButton(doc, 'dislike'),
    createHostActionButton(doc, 'share'),
    createHostActionButton(doc, 'more'),
  );
  turn.append(hostActionBar);
  return turn;
}

export function mountTranscriptFixture(
  doc: Document,
  options: FixtureOptions,
): TranscriptFixture {
  doc.body.innerHTML = '';
  doc.body.dataset.hostActionCopyCount = '0';
  doc.body.dataset.hostActionLikeCount = '0';
  doc.body.dataset.hostActionDislikeCount = '0';
  doc.body.dataset.hostActionShareCount = '0';
  doc.body.dataset.hostActionMoreCount = '0';
  doc.body.dataset.hostActionBranchCount = '0';
  doc.body.dataset.hostActionReadAloudCount = '0';
  doc.body.dataset.hostActionStopReadAloudCount = '0';

  const main = doc.createElement('main');
  const headerActions = doc.createElement('div');
  headerActions.dataset.testid = 'conversation-actions';
  headerActions.setAttribute('data-testid', 'conversation-actions');
  headerActions.style.display = 'flex';
  headerActions.style.justifyContent = 'flex-end';
  headerActions.style.gap = '8px';
  headerActions.style.padding = '12px 24px';

  const otherButton = doc.createElement('button');
  otherButton.type = 'button';
  otherButton.textContent = 'Other';
  headerActions.append(otherButton);

  const shareButton = doc.createElement('button');
  shareButton.type = 'button';
  shareButton.textContent = 'Share';
  shareButton.setAttribute('aria-label', 'Share');
  headerActions.append(shareButton);

  const scroller = doc.createElement('div');
  scroller.dataset.testid = 'conversation-scroller';
  scroller.setAttribute('data-testid', 'conversation-scroller');
  scroller.style.height = '640px';
  scroller.style.overflowY = 'auto';
  scroller.style.padding = '24px';

  const transcript = doc.createElement('section');
  transcript.dataset.testid = 'conversation-transcript';
  transcript.setAttribute('data-testid', 'conversation-transcript');
  transcript.style.display = 'grid';
  transcript.style.gap = '18px';

  for (let index = 0; index < options.turnCount; index += 1) {
    transcript.append(createTurn(doc, index));
  }

  main.append(headerActions);
  scroller.append(transcript);
  main.append(scroller);
  doc.body.append(main);

  const stopButton = doc.createElement('button');
  stopButton.type = 'button';
  stopButton.textContent = 'Stop generating';
  stopButton.dataset.testid = 'stop-button';
  stopButton.setAttribute('data-testid', 'stop-button');
  stopButton.hidden = !options.streaming;
  doc.body.append(stopButton);

  if (options.streaming && transcript.lastElementChild instanceof HTMLElement) {
    transcript.lastElementChild.setAttribute('aria-busy', 'true');
  }

  return { main, headerActions, shareButton, scroller, transcript, stopButton };
}

export function mountGroupedTranscriptFixture(
  doc: Document,
  options: FixtureOptions & { daySizes?: number[] },
): GroupedTranscriptFixture {
  const fixture = mountTranscriptFixture(doc, { turnCount: 0, streaming: options.streaming ?? false });
  fixture.transcript.remove();

  const daySizes = options.daySizes ?? [Math.max(1, Math.floor(options.turnCount / 2)), Math.ceil(options.turnCount / 2)];
  const dayGroups: HTMLElement[] = [];
  let turnIndex = 0;

  for (const [dayIndex, size] of daySizes.entries()) {
    const dayGroup = doc.createElement('section');
    dayGroup.dataset.testid = `conversation-day-${dayIndex + 1}`;
    dayGroup.setAttribute('data-testid', `conversation-day-${dayIndex + 1}`);
    dayGroup.style.display = 'grid';
    dayGroup.style.gap = '18px';

    const dayLabel = doc.createElement('div');
    dayLabel.textContent = `Day ${dayIndex + 1}`;
    dayLabel.className = 'conversation-day-label';
    dayGroup.append(dayLabel);

    for (let count = 0; count < size; count += 1) {
      dayGroup.append(createTurn(doc, turnIndex));
      turnIndex += 1;
      if (turnIndex >= options.turnCount) {
        break;
      }
    }

    fixture.scroller.append(dayGroup);
    dayGroups.push(dayGroup);

    if (turnIndex >= options.turnCount) {
      break;
    }
  }

  return {
    ...fixture,
    transcript: fixture.scroller,
    dayGroups,
  };
}
