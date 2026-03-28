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
  return turn;
}

export function mountTranscriptFixture(
  doc: Document,
  options: FixtureOptions,
): TranscriptFixture {
  doc.body.innerHTML = '';

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
  const fixture = mountTranscriptFixture(doc, { turnCount: 0, streaming: options.streaming });
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
