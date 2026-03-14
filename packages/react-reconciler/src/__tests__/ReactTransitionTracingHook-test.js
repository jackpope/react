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
let getCacheForType;
let useState;
let useTransition;
let Suspense;

let caches;
let seededCache;

describe('ReactTransitionTracingHook', () => {
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');

    const InternalTestUtils = require('internal-test-utils');
    act = InternalTestUtils.act;
    waitForAll = InternalTestUtils.waitForAll;
    useState = React.useState;
    useTransition = React.useTransition;
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
  it('useTransition with name option fires transition callbacks', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    let navigate;
    function App() {
      const [, startTransition] = useTransition();
      const [page, setPage] = useState('one');
      navigate = () => {
        startTransition(
          () => {
            setPage('two');
          },
          {name: 'nav'},
        );
      };

      return (
        <div>
          <Text text={`Page ${page}`} />
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

      await waitForAll(['Page one']);
    });

    await act(async () => {
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      navigate();
      await null;
      Scheduler.unstable_clearLog();

      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await null;
      Scheduler.unstable_clearLog();

      await waitForAll([
        'Page two',
        'onTransitionStart(nav, 2000)',
        'onTransitionComplete(nav, 2000, 3000)',
      ]);
    });
  });

  // @gate enableTransitionTracing
  it('useTransition with Suspense and TracingMarker', async () => {
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
      onMarkerProgress: (
        transitioName,
        markerName,
        startTime,
        currentTime,
        pending,
      ) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onMarkerProgress(${transitioName}, ${markerName}, ${startTime}, ${currentTime}, [${suspenseNames}])`,
        );
      },
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.log(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };

    let navigate;
    function App() {
      const [, startTransition] = useTransition();
      const [show, setShow] = useState(false);
      navigate = () => {
        startTransition(
          () => {
            setShow(true);
          },
          {name: 'nav'},
        );
      };

      return (
        <div>
          {show ? (
            <React.unstable_TracingMarker name="nav marker">
              <Suspense
                fallback={<Text text="Loading..." />}
                name="nav suspense">
                <AsyncText text="Page Two" />
              </Suspense>
            </React.unstable_TracingMarker>
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
      navigate();
      await null;
      Scheduler.unstable_clearLog();

      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Suspend [Page Two]',
        'Loading...',
        // pre-warming
        'Suspend [Page Two]',
        // end pre-warming
        'onTransitionStart(nav, 1000)',
        'onMarkerProgress(nav, nav marker, 1000, 2000, [nav suspense])',
        'onTransitionProgress(nav, 1000, 2000, [nav suspense])',
      ]);

      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await resolveText('Page Two');

      await waitForAll([
        'Page Two',
        'onMarkerProgress(nav, nav marker, 1000, 3000, [])',
        'onMarkerComplete(nav, nav marker, 1000, 3000)',
        'onTransitionProgress(nav, 1000, 3000, [])',
        'onTransitionComplete(nav, 1000, 3000)',
      ]);
    });
  });

  // This test verifies behavior when no name is provided, so it works
  // regardless of whether enableTransitionTracing is on or off.
  it('useTransition without name does not fire transition callbacks', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    let navigate;
    function App() {
      const [, startTransition] = useTransition();
      const [page, setPage] = useState('one');
      navigate = () => {
        startTransition(() => {
          setPage('two');
        });
      };

      return (
        <div>
          <Text text={`Page ${page}`} />
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

      await waitForAll(['Page one']);
    });

    await act(async () => {
      navigate();
      await null;
      Scheduler.unstable_clearLog();

      ReactNoop.expire(1000);
      await advanceTimers(1000);

      // No transition callbacks should fire
      await waitForAll(['Page two']);
    });
  });

  // @gate enableTransitionTracing
  it('multiple useTransition hooks with independent tracking', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    let navigateA;
    let navigateB;

    function ComponentA() {
      const [, startTransition] = useTransition();
      const [page, setPage] = useState('A1');
      navigateA = () => {
        startTransition(
          () => {
            setPage('A2');
          },
          {name: 'transition A'},
        );
      };
      return <Text text={`Component ${page}`} />;
    }

    function ComponentB() {
      const [, startTransition] = useTransition();
      const [page, setPage] = useState('B1');
      navigateB = () => {
        startTransition(
          () => {
            setPage('B2');
          },
          {name: 'transition B'},
        );
      };
      return <Text text={`Component ${page}`} />;
    }

    function App() {
      return (
        <div>
          <ComponentA />
          <ComponentB />
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

      await waitForAll(['Component A1', 'Component B1']);
    });

    await act(async () => {
      navigateA();
      await null;
      Scheduler.unstable_clearLog();

      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Component A2',
        'Component B1',
        'onTransitionStart(transition A, 1000)',
        'onTransitionComplete(transition A, 1000, 2000)',
      ]);
    });

    await act(async () => {
      navigateB();
      await null;
      Scheduler.unstable_clearLog();

      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Component A2',
        'Component B2',
        'onTransitionStart(transition B, 2000)',
        'onTransitionComplete(transition B, 2000, 3000)',
      ]);
    });
  });

  // @gate enableTransitionTracing
  it('useTransition startTime uses now()', async () => {
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    let navigate;
    function App() {
      const [, startTransition] = useTransition();
      const [page, setPage] = useState('one');
      navigate = () => {
        startTransition(
          () => {
            setPage('two');
          },
          {name: 'timed nav'},
        );
      };

      return (
        <div>
          <Text text={`Page ${page}`} />
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

      await waitForAll(['Page one']);
    });

    await act(async () => {
      // Advance time before calling startTransition so startTime reflects
      // the scheduler time at call time, not 0 or -1.
      ReactNoop.expire(4000);
      await advanceTimers(4000);
      navigate();
      await null;
      Scheduler.unstable_clearLog();

      ReactNoop.expire(1000);
      await advanceTimers(1000);

      // startTime should be 5000 (1000 + 4000), not -1
      await waitForAll([
        'Page two',
        'onTransitionStart(timed nav, 5000)',
        'onTransitionComplete(timed nav, 5000, 6000)',
      ]);
    });
  });

  // @gate enableTransitionTracing
  it('isPending during traced transition with Suspense', async () => {
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

    let navigate;
    function App() {
      const [isPending, startTransition] = useTransition();
      const [show, setShow] = useState(false);
      navigate = () => {
        startTransition(
          () => {
            setShow(true);
          },
          {name: 'suspense nav'},
        );
      };

      return (
        <div>
          <Text text={`Pending: ${isPending}`} />
          {show ? (
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

      await waitForAll(['Pending: false', 'Page One']);
    });

    await act(async () => {
      navigate();
      await null;
      Scheduler.unstable_clearLog();

      ReactNoop.expire(1000);
      await advanceTimers(1000);

      // isPending should be true during the transition
      await waitForAll([
        'Pending: true',
        'Page One',
        'Pending: false',
        'Suspend [Page Two]',
        'Loading...',
        // pre-warming
        'Suspend [Page Two]',
        // end pre-warming
        'onTransitionStart(suspense nav, 1000)',
        'onTransitionProgress(suspense nav, 1000, 2000, [suspense page])',
      ]);

      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await resolveText('Page Two');

      await waitForAll([
        'Pending: false',
        'Page Two',
        'onTransitionProgress(suspense nav, 1000, 3000, [])',
        'onTransitionComplete(suspense nav, 1000, 3000)',
      ]);
    });
  });
});
