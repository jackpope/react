/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment jsdom
 */

let React;
let ReactDOMClient;
let Scheduler;
let act;
let assertLog;
let container;
let startTransition;
let Suspense;
let useState;

describe('ReactTransitionTracing DOM', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    Scheduler = require('scheduler');
    const InternalTestUtils = require('internal-test-utils');
    act = InternalTestUtils.act;
    assertLog = InternalTestUtils.assertLog;
    startTransition = React.startTransition;
    Suspense = React.Suspense;
    useState = React.useState;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  // @gate enableTransitionTracing
  it('basic transition with createRoot callbacks', async () => {
    const onTransitionStart = jest.fn();
    const onTransitionComplete = jest.fn();

    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        onTransitionStart(name, startTime);
        Scheduler.log(`onTransitionStart(${name})`);
      },
      onTransitionComplete: (name, startTime, endTime) => {
        onTransitionComplete(name, startTime, endTime);
        Scheduler.log(`onTransitionComplete(${name})`);
      },
    };

    let navigateToPageTwo;
    function App() {
      const [navigate, setNavigate] = useState(false);
      navigateToPageTwo = () => setNavigate(true);

      return (
        <div>
          {navigate ? <Text text="Page Two" /> : <Text text="Page One" />}
        </div>
      );
    }

    const root = ReactDOMClient.createRoot(container, {
      unstable_transitionCallbacks: transitionCallbacks,
    });

    await act(async () => {
      root.render(<App />);
    });
    assertLog(['Page One']);

    await act(async () => {
      startTransition(() => navigateToPageTwo(), {name: 'nav'});
    });
    assertLog([
      'Page Two',
      'onTransitionStart(nav)',
      'onTransitionComplete(nav)',
    ]);

    expect(onTransitionStart).toHaveBeenCalledTimes(1);
    expect(onTransitionStart).toHaveBeenCalledWith('nav', expect.any(Number));
    expect(onTransitionComplete).toHaveBeenCalledTimes(1);
    expect(onTransitionComplete).toHaveBeenCalledWith(
      'nav',
      expect.any(Number),
      expect.any(Number),
    );
  });

  // @gate enableTransitionTracing
  it('transition with Suspense in DOM', async () => {
    let resolve;
    const promise = new Promise(r => {
      resolve = r;
    });
    let resolved = false;

    function AsyncComponent() {
      if (!resolved) {
        Scheduler.log('Suspend');
        throw promise;
      }
      Scheduler.log('Loaded');
      return 'Loaded';
    }

    const onTransitionStart = jest.fn();
    const onTransitionProgress = jest.fn();
    const onTransitionComplete = jest.fn();

    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        onTransitionStart(name, startTime);
        Scheduler.log(`onTransitionStart(${name})`);
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        onTransitionProgress(name, startTime, endTime, pending);
        Scheduler.log(`onTransitionProgress(${name}, [${suspenseNames}])`);
      },
      onTransitionComplete: (name, startTime, endTime) => {
        onTransitionComplete(name, startTime, endTime);
        Scheduler.log(`onTransitionComplete(${name})`);
      },
    };

    let showAsync;
    function App() {
      const [show, setShow] = useState(false);
      showAsync = () => setShow(true);

      return (
        <div>
          {show ? (
            <Suspense fallback={<Text text="Loading..." />}>
              <AsyncComponent />
            </Suspense>
          ) : (
            <Text text="Initial" />
          )}
        </div>
      );
    }

    const root = ReactDOMClient.createRoot(container, {
      unstable_transitionCallbacks: transitionCallbacks,
    });

    await act(async () => {
      root.render(<App />);
    });
    assertLog(['Initial']);

    await act(async () => {
      startTransition(() => showAsync(), {name: 'show-async'});
    });
    // The Suspend may fire twice due to Suspense pre-warming in some channels
    const logs = Scheduler.unstable_clearLog();
    expect(logs).toContain('Suspend');
    expect(logs).toContain('Loading...');
    expect(logs).toContain('onTransitionStart(show-async)');
    expect(logs).toContain('onTransitionProgress(show-async, [<null>])');

    expect(onTransitionStart).toHaveBeenCalledTimes(1);
    expect(onTransitionProgress).toHaveBeenCalledTimes(1);

    // Resolve the suspended component
    await act(async () => {
      resolved = true;
      resolve();
    });
    assertLog([
      'Loaded',
      'onTransitionProgress(show-async, [])',
      'onTransitionComplete(show-async)',
    ]);

    expect(onTransitionComplete).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe('Loaded');
  });

  // @gate enableTransitionTracing
  it('timestamps are positive numbers', async () => {
    const startTimes = [];
    const endTimes = [];

    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        startTimes.push(startTime);
        Scheduler.log(`onTransitionStart(${name})`);
      },
      onTransitionComplete: (name, startTime, endTime) => {
        startTimes.push(startTime);
        endTimes.push(endTime);
        Scheduler.log(`onTransitionComplete(${name})`);
      },
    };

    let navigate;
    function App() {
      const [page, setPage] = useState('one');
      navigate = () => setPage('two');

      return <Text text={`Page ${page}`} />;
    }

    const root = ReactDOMClient.createRoot(container, {
      unstable_transitionCallbacks: transitionCallbacks,
    });

    await act(async () => {
      root.render(<App />);
    });
    assertLog(['Page one']);

    await act(async () => {
      startTransition(() => navigate(), {name: 'timestamp-test'});
    });
    assertLog([
      'Page two',
      'onTransitionStart(timestamp-test)',
      'onTransitionComplete(timestamp-test)',
    ]);

    // Verify all timestamps are non-negative numbers (not -1)
    startTimes.forEach(t => {
      expect(typeof t).toBe('number');
      expect(t).toBeGreaterThanOrEqual(0);
    });
    endTimes.forEach(t => {
      expect(typeof t).toBe('number');
      expect(t).toBeGreaterThanOrEqual(0);
    });

    // endTime should be >= startTime
    expect(endTimes[0]).toBeGreaterThanOrEqual(startTimes[0]);
  });

  // @gate enableTransitionTracing
  it('multiple DOM roots with independent tracking', async () => {
    const callbacksA = [];
    const callbacksB = [];

    const transitionCallbacksA = {
      onTransitionStart: (name, startTime) => {
        callbacksA.push({type: 'start', name});
        Scheduler.log(`A:onTransitionStart(${name})`);
      },
      onTransitionComplete: (name, startTime, endTime) => {
        callbacksA.push({type: 'complete', name});
        Scheduler.log(`A:onTransitionComplete(${name})`);
      },
    };

    const transitionCallbacksB = {
      onTransitionStart: (name, startTime) => {
        callbacksB.push({type: 'start', name});
        Scheduler.log(`B:onTransitionStart(${name})`);
      },
      onTransitionComplete: (name, startTime, endTime) => {
        callbacksB.push({type: 'complete', name});
        Scheduler.log(`B:onTransitionComplete(${name})`);
      },
    };

    let navigateA;
    function AppA() {
      const [page, setPage] = useState('one');
      navigateA = () => setPage('two');
      return <Text text={`A:${page}`} />;
    }

    let navigateB;
    function AppB() {
      const [page, setPage] = useState('one');
      navigateB = () => setPage('two');
      return <Text text={`B:${page}`} />;
    }

    const containerA = document.createElement('div');
    const containerB = document.createElement('div');
    document.body.appendChild(containerA);
    document.body.appendChild(containerB);

    const rootA = ReactDOMClient.createRoot(containerA, {
      unstable_transitionCallbacks: transitionCallbacksA,
    });
    const rootB = ReactDOMClient.createRoot(containerB, {
      unstable_transitionCallbacks: transitionCallbacksB,
    });

    await act(async () => {
      rootA.render(<AppA />);
      rootB.render(<AppB />);
    });
    assertLog(['A:one', 'B:one']);

    // Transition in root A only
    await act(async () => {
      startTransition(() => navigateA(), {name: 'nav-a'});
    });
    assertLog([
      'A:two',
      'A:onTransitionStart(nav-a)',
      'A:onTransitionComplete(nav-a)',
    ]);

    // Root B should not have received any callbacks
    expect(callbacksB).toEqual([]);
    expect(callbacksA).toEqual([
      {type: 'start', name: 'nav-a'},
      {type: 'complete', name: 'nav-a'},
    ]);

    // Transition in root B only
    await act(async () => {
      startTransition(() => navigateB(), {name: 'nav-b'});
    });
    assertLog([
      'B:two',
      'B:onTransitionStart(nav-b)',
      'B:onTransitionComplete(nav-b)',
    ]);

    expect(callbacksB).toEqual([
      {type: 'start', name: 'nav-b'},
      {type: 'complete', name: 'nav-b'},
    ]);

    // Verify A callbacks didn't grow
    expect(callbacksA).toEqual([
      {type: 'start', name: 'nav-a'},
      {type: 'complete', name: 'nav-a'},
    ]);

    document.body.removeChild(containerA);
    document.body.removeChild(containerB);
  });

  // @gate enableTransitionTracing
  // @gate enableCPUSuspense
  it('should not fire onTransitionIncomplete when navigating away from a resolved CPU Suspense page', async () => {
    // Reproduces Bug 3: After navigating to a page with CPU Suspense (defer)
    // and async Suspense wrapped in TracingMarkers, waiting for everything to
    // resolve, and then navigating back to home, a bogus onTransitionIncomplete
    // fires for the navigate-to-home transition with deletions referencing the
    // old page's Suspense boundary.

    let resolveAsyncData;
    const asyncDataPromise = new Promise(r => {
      resolveAsyncData = r;
    });
    let asyncDataResolved = false;

    function AsyncContent() {
      if (!asyncDataResolved) {
        Scheduler.log('Suspend [AsyncContent]');
        throw asyncDataPromise;
      }
      Scheduler.log('AsyncContent');
      return 'Async Data Loaded';
    }

    function DeferredContent() {
      Scheduler.log('DeferredContent');
      return 'Deferred Content';
    }

    const TracingMarker = React.unstable_TracingMarker;

    const onTransitionStart = jest.fn();
    const onTransitionComplete = jest.fn();
    const onTransitionIncomplete = jest.fn();
    const onTransitionProgress = jest.fn();

    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        onTransitionStart(name, startTime);
        Scheduler.log(`onTransitionStart(${name})`);
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        onTransitionProgress(name, startTime, endTime, pending);
        Scheduler.log(`onTransitionProgress(${name}, [${suspenseNames}])`);
      },
      onTransitionComplete: (name, startTime, endTime) => {
        onTransitionComplete(name, startTime, endTime);
        Scheduler.log(`onTransitionComplete(${name})`);
      },
      onTransitionIncomplete: (name, startTime, deletions) => {
        onTransitionIncomplete(name, startTime, deletions);
        Scheduler.log(`onTransitionIncomplete(${name})`);
      },
    };

    let setPage;
    function App() {
      const [page, _setPage] = useState('home');
      setPage = _setPage;

      if (page === 'home') {
        return <Text text="Home" />;
      }

      return (
        <TracingMarker name="cpu-suspense">
          <TracingMarker name="cpu:deferred-section">
            <Suspense
              defer
              name="cpu:deferred"
              fallback={<Text text="Deferring..." />}>
              <DeferredContent />
            </Suspense>
          </TracingMarker>
          <TracingMarker name="cpu:async-section">
            <Suspense
              name="cpu:async-data"
              fallback={<Text text="Loading async..." />}>
              <AsyncContent />
            </Suspense>
          </TracingMarker>
        </TracingMarker>
      );
    }

    const root = ReactDOMClient.createRoot(container, {
      unstable_transitionCallbacks: transitionCallbacks,
    });

    // Step 1: Render Home
    await act(async () => {
      root.render(<App />);
    });
    assertLog(['Home']);

    // Step 2: Navigate to CPU Suspense page
    await act(async () => {
      startTransition(() => setPage('cpu'), {name: 'navigate-to-cpu'});
    });
    // Clear logs — the exact sequence of renders/callbacks during navigation
    // varies by channel (pre-warming, deferred retry, etc.)
    Scheduler.unstable_clearLog();

    // Step 3: Resolve async data so everything is visible
    await act(async () => {
      asyncDataResolved = true;
      resolveAsyncData();
    });
    Scheduler.unstable_clearLog();

    // At this point, both Suspense boundaries have resolved and the CPU page
    // is fully rendered. The navigate-to-cpu transition should be complete.
    expect(container.textContent).toContain('Deferred Content');
    expect(container.textContent).toContain('Async Data Loaded');

    // Step 4: Navigate back to Home
    await act(async () => {
      startTransition(() => setPage('home'), {name: 'navigate-to-home'});
    });

    expect(container.textContent).toBe('Home');

    // The navigate-to-home transition should complete normally.
    // Bug 3: a bogus onTransitionIncomplete fires for navigate-to-home
    // with deletions referencing the old page's Suspense boundary.
    expect(onTransitionIncomplete).not.toHaveBeenCalled();
  });
});
