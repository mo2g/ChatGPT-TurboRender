import { DEFAULT_SETTINGS } from '../../lib/shared/constants';
import { TurboRenderController } from '../../lib/content/turbo-render-controller';
import { mountTranscriptFixture } from '../../lib/testing/transcript-fixture';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');

if (app == null) {
  throw new Error('Harness root missing');
}

app.innerHTML = `
  <section class="harness-toolbar">
    <h1>TurboRender Harness</h1>
    <p id="harness-status">Booting…</p>
    <div class="harness-actions">
      <button id="seed-small">Seed 40 turns</button>
      <button id="seed-large">Seed 180 turns</button>
      <button id="toggle-streaming">Toggle streaming</button>
      <button id="refresh-status">Refresh status</button>
    </div>
  </section>
  <section class="harness-stage"></section>
`;

const stage = document.querySelector<HTMLElement>('.harness-stage');
const statusEl = document.querySelector<HTMLElement>('#harness-status');

if (stage == null || statusEl == null) {
  throw new Error('Harness UI missing');
}

const harnessRoute = new URL(window.location.href).searchParams.get('route');
history.replaceState({}, '', harnessRoute === 'share' ? '/share/share-123' : '/chat/harness');

let streaming = true;
let controller: TurboRenderController | null = null;

function boot(turnCount: number): void {
  controller?.stop();
  mountTranscriptFixture(document, { turnCount, streaming });
  document.body.insertBefore(app, document.body.firstChild);
  controller = new TurboRenderController({
    settings: {
      ...DEFAULT_SETTINGS,
      minFinalizedBlocks: 10,
      minDescendants: 100,
      keepRecentTurns: 6,
      viewportBufferTurns: 2,
      groupSize: 5,
    },
    paused: false,
    onPauseToggle: (paused) => controller?.setPaused(paused),
  });
  controller.start();
  refreshStatus();
}

function refreshStatus(): void {
  if (controller == null) {
    statusEl.textContent = 'Controller offline.';
    return;
  }
  const status = controller.getStatus();
  statusEl.dataset.refreshCount = String(status.refreshCount);
  statusEl.dataset.routeKind = status.routeKind;
  statusEl.dataset.collapsedBatchCount = String(status.collapsedBatchCount);
  statusEl.dataset.expandedBatchCount = String(status.expandedBatchCount);
  statusEl.dataset.parkedTurns = String(status.parkedTurns);
  statusEl.textContent = `${status.active ? 'Active' : 'Monitoring'} • ${status.parkedTurns}/${status.totalTurns} parked • ${status.liveDescendantCount} live descendants`;
}

boot(40);
window.setInterval(refreshStatus, 500);

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  if (target.id === 'seed-small') {
    boot(40);
    return;
  }
  if (target.id === 'seed-large') {
    boot(180);
    return;
  }
  if (target.id === 'toggle-streaming') {
    streaming = !streaming;
    boot(controller?.getStatus().totalTurns ?? 180);
    return;
  }
  if (target.id === 'refresh-status') {
    refreshStatus();
  }
});
