/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

let React;
let ReactNoop;
let Scheduler;
let act;
let waitForAll;
let assertLog;

let getCacheForType;
let useState;
let Suspense;
let startTransition;

let caches;
let seededCache;

describe('ReactTransitionTracingInterruption', () => {
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');

    const InternalTestUtils = require('internal-test-utils');
    act = InternalTestUtils.act;
    waitForAll = InternalTestUtils.waitForAll;
    assertLog = InternalTestUtils.assertLog;

    useState = React.useState;
    startTransition = React.startTransition;
    Suspense = React.Suspense;

    getCacheForType = React.unstable_getCacheForType;

    caches = [];
    seededCache = null;
  });

  function createTextCache() {
    if (seededCache !== null) {
      const cache = seededCache;
      seededCache = null;
      return cache;
    }

    const data = new Map();
    const cache = {
      data,
      resolve(text) {
        const record = data.get(text);

        if (record === undefined) {
          const newRecord = {
            status: 'resolved',
            value: text,
          };
          data.set(text, newRecord);
        } else if (record.status === 'pending') {
          const thenable = record.value;
          record.status = 'resolved';
          record.value = text;
          thenable.pings.forEach(t => t());
        }
      },
      reject(text, error) {
        const record = data.get(text);
        if (record === undefined) {
          const newRecord = {
            status: 'rejected',
            value: error,
          };
          data.set(text, newRecord);
        } else if (record.status === 'pending') {
          const thenable = record.value;
          record.status = 'rejected';
          record.value = error;
          thenable.pings.forEach(t => t());
        }
      },
    };
    caches.push(cache);
    return cache;
  }

  function readText(text) {
    const textCache = getCacheForType(createTextCache);
    const record = textCache.data.get(text);
    if (record !== undefined) {
      switch (record.status) {
        case 'pending':
          Scheduler.log(`Suspend [${text}]`);
          throw record.value;
        case 'rejected':
          Scheduler.log(`Error [${text}]`);
          throw record.value;
        case 'resolved':
          return record.value;
      }
    } else {
      Scheduler.log(`Suspend [${text}]`);

      const thenable = {
        pings: [],
        then(resolve) {
          if (newRecord.status === 'pending') {
            thenable.pings.push(resolve);
          } else {
            Promise.resolve().then(() => resolve(newRecord.value));
          }
        },
      };

      const newRecord = {
        status: 'pending',
        value: thenable,
      };
      textCache.data.set(text, newRecord);

      throw thenable;
    }
  }

  function AsyncText({text}) {
    const fullText = readText(text);
    Scheduler.log(fullText);
    return fullText;
  }

  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  function resolveMostRecentTextCache(text) {
    if (caches.length === 0) {
      throw Error('Cache does not exist');
    } else {
      // Resolve the most recently created cache. An older cache can by
      // resolved with `caches[index].resolve(text)`.
      caches[caches.length - 1].resolve(text);
    }
  }

  const resolveText = resolveMostRecentTextCache;

  function advanceTimers(ms) {
    // Note: This advances Jest's virtual time but not React's. Use
    // ReactNoop.expire for that.
    if (typeof ms !== 'number') {
      throw new Error('Must specify ms');
    }
    jest.advanceTimersByTime(ms);
    // Wait until the end of the current tick
    // We cannot use a timer since we're faking them
    return Promise.resolve().then(() => {});
  }

  // @gate enableTransitionTracing
  it('discrete event interrupts traced transition', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    let navigateToPageTwo;
    let setDiscreteCount;
    function App() {
      const [navigate, setNavigate] = useState(false);
      const [discreteCount, _setDiscreteCount] = useState(0);
      navigateToPageTwo = () => setNavigate(true);
      setDiscreteCount = _setDiscreteCount;

      return (
        <div data-count={discreteCount}>
          {navigate ? (
            <Suspense
              fallback={<Text text="Loading..." />}
              name="suspense page">
              <AsyncText text="Page Two" />
            </Suspense>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll(['Page One']);
    });

    await act(async () => {
      // Start a named transition that suspends
      startTransition(() => navigateToPageTwo(), {name: 'page transition'});
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Suspend [Page Two]',
        'Loading...',
        // pre-warming
        'Suspend [Page Two]',
        // end pre-warming
        'onTransitionStart(page transition, 1000)',
        'onTransitionProgress(page transition, 1000, 2000, [suspense page])',
      ]);

      // While the transition is suspended, trigger a discrete (high-priority) update
      ReactNoop.flushSync(() => {
        setDiscreteCount(1);
      });
      assertLog(['Suspend [Page Two]', 'Loading...']);

      // Resolve the suspended data
      await resolveText('Page Two');
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Page Two',
        'onTransitionProgress(page transition, 1000, 3000, [])',
        'onTransitionComplete(page transition, 1000, 3000)',
      ]);
    });
  });

  // @gate enableTransitionTracing
  it('two traced transitions where second interrupts first', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    let showA;
    let showB;
    function App() {
      const [a, setA] = useState(false);
      const [b, setB] = useState(false);
      showA = () => setA(true);
      showB = () => setB(true);

      return (
        <div>
          {a ? (
            <Suspense fallback={<Text text="Loading A..." />} name="suspense A">
              <AsyncText text="Content A" />
            </Suspense>
          ) : (
            <Text text="Initial A" />
          )}
          {b ? (
            <Suspense fallback={<Text text="Loading B..." />} name="suspense B">
              <AsyncText text="Content B" />
            </Suspense>
          ) : (
            <Text text="Initial B" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll(['Initial A', 'Initial B']);
    });

    // Start transition A that suspends
    await act(async () => {
      startTransition(() => showA(), {name: 'transition A'});
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Suspend [Content A]',
        'Loading A...',
        'Initial B',
        // pre-warming
        'Suspend [Content A]',
        // end pre-warming
        'onTransitionStart(transition A, 1000)',
        'onTransitionProgress(transition A, 1000, 2000, [suspense A])',
      ]);
    });

    // Start transition B that also suspends (interrupting A's pending work)
    await act(async () => {
      startTransition(() => showB(), {name: 'transition B'});
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Suspend [Content A]',
        'Loading A...',
        'Suspend [Content B]',
        'Loading B...',
        // pre-warming
        'Suspend [Content A]',
        'Suspend [Content B]',
        // end pre-warming
        'onTransitionStart(transition B, 2000)',
        'onTransitionProgress(transition B, 2000, 3000, [suspense B])',
      ]);
    });

    // Resolve B first
    await act(async () => {
      await resolveText('Content B');
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Content B',
        'onTransitionProgress(transition B, 2000, 4000, [])',
        'onTransitionComplete(transition B, 2000, 4000)',
      ]);
    });

    // Resolve A
    await act(async () => {
      await resolveText('Content A');
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Content A',
        'onTransitionProgress(transition A, 1000, 5000, [])',
        'onTransitionComplete(transition A, 1000, 5000)',
      ]);
    });
  });

  // @gate enableTransitionTracing
  it('traced transition interrupted by flushSync', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    let navigateToPageTwo;
    let setCounter;
    function App() {
      const [navigate, setNavigate] = useState(false);
      const [counter, _setCounter] = useState(0);
      navigateToPageTwo = () => setNavigate(true);
      setCounter = _setCounter;

      return (
        <div data-counter={counter}>
          {navigate ? (
            <Suspense
              fallback={<Text text="Loading..." />}
              name="suspense page">
              <AsyncText text="Page Two" />
            </Suspense>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll(['Page One']);
    });

    await act(async () => {
      // Start a transition that suspends
      startTransition(() => navigateToPageTwo(), {name: 'nav transition'});
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Suspend [Page Two]',
        'Loading...',
        // pre-warming
        'Suspend [Page Two]',
        // end pre-warming
        'onTransitionStart(nav transition, 1000)',
        'onTransitionProgress(nav transition, 1000, 2000, [suspense page])',
      ]);

      // Interrupt with a synchronous update
      ReactNoop.flushSync(() => {
        setCounter(n => n + 1);
      });
      assertLog(['Suspend [Page Two]', 'Loading...']);

      // Resolve the suspended content
      await resolveText('Page Two');
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Page Two',
        'onTransitionProgress(nav transition, 1000, 3000, [])',
        'onTransitionComplete(nav transition, 1000, 3000)',
      ]);
    });
  });

  // @gate enableTransitionTracing
  it('concurrent transitions with shared Suspense boundary', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    let setNavigate;
    let setShowExtra;
    function App() {
      const [navigate, _setNavigate] = useState(false);
      const [showExtra, _setShowExtra] = useState(false);
      setNavigate = () => _setNavigate(true);
      setShowExtra = () => _setShowExtra(true);

      return (
        <div>
          {navigate ? (
            <Suspense
              fallback={<Text text="Loading..." />}
              name="shared suspense">
              <AsyncText text="Async Content" />
              {showExtra ? 'Extra Content' : null}
            </Suspense>
          ) : (
            <Text text="Home" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll(['Home']);
    });

    // Start both transitions at the same time so they both
    // cause the same Suspense boundary to suspend
    await act(async () => {
      startTransition(() => setNavigate(), {name: 'navigate'});
      startTransition(() => setShowExtra(), {name: 'show extra'});
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Suspend [Async Content]',
        'Loading...',
        // pre-warming
        'Suspend [Async Content]',
        // end pre-warming
        'onTransitionStart(navigate, 1000)',
        'onTransitionStart(show extra, 1000)',
        'onTransitionProgress(navigate, 1000, 2000, [shared suspense])',
        'onTransitionProgress(show extra, 1000, 2000, [shared suspense])',
      ]);
    });

    // Resolve the shared async content
    await act(async () => {
      await resolveText('Async Content');
      ReactNoop.expire(1000);
      await advanceTimers(1000);
    });

    // Callback ordering between transitions may vary by channel.
    const completionLogs = Scheduler.unstable_clearLog();
    expect(completionLogs).toContain('Async Content');
    expect(completionLogs).toContain(
      'onTransitionProgress(navigate, 1000, 3000, [])',
    );
    expect(completionLogs).toContain(
      'onTransitionComplete(navigate, 1000, 3000)',
    );
    expect(completionLogs).toContain(
      'onTransitionProgress(show extra, 1000, 3000, [])',
    );
    expect(completionLogs).toContain(
      'onTransitionComplete(show extra, 1000, 3000)',
    );
  });
});
