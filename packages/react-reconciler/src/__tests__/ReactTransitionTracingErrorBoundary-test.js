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

let useState;
let Suspense;
let startTransition;

let ErrorBoundary;

describe('ReactTransitionTracingErrorBoundary', () => {
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');

    const InternalTestUtils = require('internal-test-utils');
    act = InternalTestUtils.act;
    waitForAll = InternalTestUtils.waitForAll;

    useState = React.useState;
    startTransition = React.startTransition;
    Suspense = React.Suspense;

    ErrorBoundary = class extends React.Component {
      state = {error: null};
      static getDerivedStateFromError(error) {
        return {error};
      }
      render() {
        if (this.state.error) {
          return this.props.fallback || null;
        }
        return this.props.children;
      }
    };
  });

  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

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
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('error inside TracingMarker triggers onMarkerIncomplete', async () => {
    // skip: requires Plan 09 (error abort reason in TransitionAbort)
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
      onMarkerIncomplete: (
        transitionName,
        markerName,
        startTime,
        deletions,
      ) => {
        Scheduler.log(
          `onMarkerIncomplete(${transitionName}, ${markerName}, ${startTime})`,
        );
      },
    };

    function BadComponent() {
      throw new Error('Component error');
    }

    function App({navigate}) {
      return (
        <div>
          {navigate ? (
            <React.unstable_TracingMarker name="marker">
              <ErrorBoundary fallback={<Text text="Error fallback" />}>
                <BadComponent />
              </ErrorBoundary>
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
      root.render(<App navigate={false} />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll(['Page One']);

      await act(async () => {
        startTransition(() => root.render(<App navigate={true} />), {
          name: 'transition',
        });
        ReactNoop.expire(1000);
        await advanceTimers(1000);

        await waitForAll([
          'Error fallback',
          'onTransitionStart(transition, 1000)',
          'onMarkerIncomplete(transition, marker, 1000)',
        ]);
      });
    });
  });

  // @gate enableTransitionTracing
  it('error boundary catches error during traced transition - transition still completes', async () => {
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

    function BadComponent() {
      throw new Error('Component error');
    }

    let navigateToPageTwo;
    function App() {
      const [navigate, setNavigate] = useState(false);
      navigateToPageTwo = () => {
        setNavigate(true);
      };

      return (
        <div>
          {navigate ? (
            <ErrorBoundary fallback={<Text text="Error fallback" />}>
              <BadComponent />
            </ErrorBoundary>
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

      startTransition(() => navigateToPageTwo(), {
        name: 'error transition',
      });

      ReactNoop.expire(1000);
      await advanceTimers(1000);
    });

    const allLogs = Scheduler.unstable_clearLog();
    expect(allLogs).toContain('Error fallback');
    expect(allLogs.filter(l => l.startsWith('on'))).toEqual([
      'onTransitionStart(error transition, 1000)',
      'onTransitionComplete(error transition, 1000, 2000)',
    ]);
  });

  // @gate enableTransitionTracing
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('error inside Suspense within TracingMarker', async () => {
    // skip: requires Plan 09 (error abort reason in TransitionAbort)
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
      onMarkerIncomplete: (
        transitionName,
        markerName,
        startTime,
        deletions,
      ) => {
        Scheduler.log(
          `onMarkerIncomplete(${transitionName}, ${markerName}, ${startTime})`,
        );
      },
    };

    function BadComponent() {
      throw new Error('Component error');
    }

    function App({navigate}) {
      return (
        <div>
          {navigate ? (
            <React.unstable_TracingMarker name="marker">
              <Suspense fallback={<Text text="Loading..." />}>
                <ErrorBoundary fallback={<Text text="Error fallback" />}>
                  <BadComponent />
                </ErrorBoundary>
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
      root.render(<App navigate={false} />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll(['Page One']);

      await act(async () => {
        startTransition(() => root.render(<App navigate={true} />), {
          name: 'transition',
        });
        ReactNoop.expire(1000);
        await advanceTimers(1000);

        await waitForAll([
          'Error fallback',
          'onTransitionStart(transition, 1000)',
          'onMarkerIncomplete(transition, marker, 1000)',
        ]);
      });
    });
  });

  // @gate enableTransitionTracing
  it('error recovery allows transition completion', async () => {
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

    function BadComponent() {
      throw new Error('Component error');
    }

    let setShowBad;
    let setRecovered;
    function App() {
      const [showBad, _setShowBad] = useState(false);
      const [recovered, _setRecovered] = useState(false);
      setShowBad = _setShowBad;
      setRecovered = _setRecovered;

      if (recovered) {
        return (
          <div>
            <Text text="Recovered Page" />
          </div>
        );
      }

      return (
        <div>
          {showBad ? (
            <ErrorBoundary fallback={<Text text="Error fallback" />}>
              <BadComponent />
            </ErrorBoundary>
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

    // First transition: triggers error, caught by ErrorBoundary
    await act(async () => {
      startTransition(() => setShowBad(true), {
        name: 'error transition',
      });

      ReactNoop.expire(1000);
      await advanceTimers(1000);
    });

    {
      const allLogs = Scheduler.unstable_clearLog();
      expect(allLogs).toContain('Error fallback');
      expect(allLogs.filter(l => l.startsWith('on'))).toEqual([
        'onTransitionStart(error transition, 1000)',
        'onTransitionComplete(error transition, 1000, 2000)',
      ]);
    }

    // Second transition: recovery with a working component
    await act(async () => {
      startTransition(() => setRecovered(true), {
        name: 'recovery transition',
      });

      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Recovered Page',
        'onTransitionStart(recovery transition, 2000)',
        'onTransitionComplete(recovery transition, 2000, 3000)',
      ]);
    });
  });

  // @gate enableTransitionTracing
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('nested TracingMarker error propagation', async () => {
    // skip: requires Plan 09 (error abort reason in TransitionAbort)
    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
      onMarkerIncomplete: (
        transitionName,
        markerName,
        startTime,
        deletions,
      ) => {
        Scheduler.log(
          `onMarkerIncomplete(${transitionName}, ${markerName}, ${startTime})`,
        );
      },
    };

    function BadComponent() {
      throw new Error('Component error');
    }

    function App({navigate}) {
      return (
        <div>
          {navigate ? (
            <React.unstable_TracingMarker name="outer marker">
              <React.unstable_TracingMarker name="inner marker">
                <ErrorBoundary fallback={<Text text="Error fallback" />}>
                  <BadComponent />
                </ErrorBoundary>
              </React.unstable_TracingMarker>
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
      root.render(<App navigate={false} />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll(['Page One']);

      await act(async () => {
        startTransition(() => root.render(<App navigate={true} />), {
          name: 'transition',
        });
        ReactNoop.expire(1000);
        await advanceTimers(1000);

        await waitForAll([
          'Error fallback',
          'onTransitionStart(transition, 1000)',
          'onMarkerIncomplete(transition, inner marker, 1000)',
          'onMarkerIncomplete(transition, outer marker, 1000)',
        ]);
      });
    });
  });
});
