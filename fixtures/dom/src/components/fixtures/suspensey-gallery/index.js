import FixtureSet from '../../FixtureSet';
import TestCase from '../../TestCase';

const React = window.React;
const {
  Suspense,
  startTransition,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} = React;
const SuspenseList = React.unstable_SuspenseList;
const ViewTransition = React.ViewTransition || React.unstable_ViewTransition;

// How long the service worker waits before responding with each image. They
// intentionally arrive out of order.
const DELAYS = [650, 200, 450, 750, 300, 550, 120, 700];
const HUES = [10, 50, 95, 150, 200, 245, 290, 330];

const styles = `
.sg-controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 16px; }
.sg-controls label { display: flex; gap: 6px; align-items: center; }
.sg-grid { display: grid; grid-template-columns: repeat(4, 164px); gap: 12px; min-height: 280px; }
.sg-card { margin: 0; width: 164px; height: 134px; border-radius: 8px; overflow: hidden; background: #e6e8ec; position: relative; }
.sg-card img { display: block; width: 164px; height: 123px; object-fit: cover; background: #d0d4da; }
.sg-card figcaption { font: 11px/11px monospace; padding: 0 4px; color: #333; }
.sg-placeholder { display: flex; align-items: center; justify-content: center; color: #889; font: 600 18px sans-serif; animation: sg-pulse 1s ease-in-out infinite alternate; }
@keyframes sg-pulse { from { opacity: 0.55; } to { opacity: 1; } }
.sg-status { font: 13px monospace; color: #555; margin-bottom: 8px; }
`;

function useImageServiceWorker() {
  const [ready, setReady] = useState(
    () =>
      typeof navigator !== 'undefined' &&
      navigator.serviceWorker != null &&
      navigator.serviceWorker.controller != null
  );
  useEffect(() => {
    if (ready || navigator.serviceWorker == null) {
      return;
    }
    const onChange = () => setReady(true);
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    navigator.serviceWorker.register('/suspensey-gallery-sw.js').then(() => {
      if (navigator.serviceWorker.controller != null) {
        setReady(true);
      }
    });
    return () =>
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
  }, [ready]);
  return ready;
}

function RevealTime({startTime}) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    ref.current.textContent =
      'shown +' + Math.round(performance.now() - startTime) + 'ms';
  }, [startTime]);
  return <span ref={ref} />;
}

function Card({image, startTime, useViewTransition}) {
  const card = (
    <Suspense
      fallback={
        <div className="sg-card sg-placeholder">
          <span>{image.label}</span>
        </div>
      }>
      <figure className="sg-card">
        <img src={image.src} width={164} height={123} alt="" />
        <figcaption>
          #{image.label} {image.delay}ms · <RevealTime startTime={startTime} />
        </figcaption>
      </figure>
    </Suspense>
  );
  // In experimental builds, suspensey images are only enabled inside a
  // <ViewTransition> (unless enableSuspenseyImages is on).
  return useViewTransition ? <ViewTransition>{card}</ViewTransition> : card;
}

function Gallery({run, revealOrder, tail, slow, broken, useViewTransition}) {
  const images = DELAYS.map((delay, i) => {
    const actualDelay = slow ? delay * 3 : delay;
    return {
      label: String(i + 1),
      delay: actualDelay,
      src:
        `/suspensey-gallery-image/${i + 1}.svg?run=${run.id}` +
        `&delay=${actualDelay}&hue=${HUES[i]}` +
        (broken && i === 3 ? '&fail=1' : ''),
    };
  });
  const cards = images.map(image => (
    <Card
      key={image.label}
      image={image}
      startTime={run.startTime}
      useViewTransition={useViewTransition}
    />
  ));
  return (
    <div className="sg-grid">
      {revealOrder === 'none' ? (
        cards
      ) : (
        <SuspenseList
          revealOrder={revealOrder}
          tail={
            revealOrder === 'forwards' || revealOrder === 'backwards'
              ? tail
              : undefined
          }>
          {cards}
        </SuspenseList>
      )}
    </div>
  );
}

function GalleryCase() {
  const ready = useImageServiceWorker();
  const [revealOrder, setRevealOrder] = useState('forwards');
  const [tail, setTail] = useState('visible');
  const [slow, setSlow] = useState(false);
  const [broken, setBroken] = useState(false);
  const [useViewTransition, setUseViewTransition] = useState(true);
  const [run, setRun] = useState(null);

  function load() {
    const nextRun = {
      id: Math.random().toString(36).slice(2),
      startTime: performance.now(),
    };
    startTransition(() => {
      setRun(nextRun);
    });
  }

  return (
    <TestCase
      title="Suspensey image gallery"
      description={
        'Each image is in its own Suspense boundary inside a SuspenseList. ' +
        'With enableSuspenseListImages, rows reveal in order as their images ' +
        'load instead of all at once. Images arrive out of order (the delay ' +
        'is shown on each card). The image timeout is ~800ms, so "slow" ' +
        'shows what happens when React stops waiting.'
      }>
      <TestCase.Steps>
        <li>Pick a reveal order and tail mode</li>
        <li>Click "Load gallery"</li>
      </TestCase.Steps>
      <TestCase.ExpectedResult>
        With "forwards", cards appear in order 1 → 8 as soon as each card and
        all cards before it have loaded. With "together", they appear at once.
        Turning off ViewTransition disables suspensey images entirely, so cards
        appear before their images have loaded.
      </TestCase.ExpectedResult>
      <style>{styles}</style>
      <div className="sg-controls">
        <label>
          revealOrder
          <select
            value={revealOrder}
            onChange={e => setRevealOrder(e.target.value)}>
            <option value="forwards">forwards</option>
            <option value="backwards">backwards</option>
            <option value="together">together</option>
            <option value="independent">independent</option>
            <option value="none">(no SuspenseList)</option>
          </select>
        </label>
        <label>
          tail
          <select value={tail} onChange={e => setTail(e.target.value)}>
            <option value="visible">visible</option>
            <option value="collapsed">collapsed</option>
            <option value="hidden">hidden</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={slow}
            onChange={e => setSlow(e.target.checked)}
          />
          slow (×3)
        </label>
        <label>
          <input
            type="checkbox"
            checked={broken}
            onChange={e => setBroken(e.target.checked)}
          />
          #4 broken
        </label>
        <label>
          <input
            type="checkbox"
            checked={useViewTransition}
            onChange={e => setUseViewTransition(e.target.checked)}
          />
          ViewTransition
        </label>
        <button onClick={load} disabled={!ready}>
          {ready ? 'Load gallery' : 'Starting image server…'}
        </button>
      </div>
      <div className="sg-status">
        {run === null
          ? 'Not loaded yet'
          : `revealOrder=${revealOrder} tail=${tail}${slow ? ' slow' : ''}`}
      </div>
      {run !== null && (
        <Gallery
          key={run.id}
          run={run}
          revealOrder={revealOrder}
          tail={tail}
          slow={slow}
          broken={broken}
          useViewTransition={useViewTransition}
        />
      )}
    </TestCase>
  );
}

export default function SuspenseyGalleryPage() {
  return (
    <FixtureSet title="Suspensey Image Gallery">
      <GalleryCase />
    </FixtureSet>
  );
}
