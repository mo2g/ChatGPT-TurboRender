export interface TranscriptFixture {
  main: HTMLElement;
  scroller: HTMLElement;
  transcript: HTMLElement;
  stopButton: HTMLButtonElement;
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

  return { main, scroller, transcript, stopButton };
}
