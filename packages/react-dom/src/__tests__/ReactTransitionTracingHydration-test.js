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
let ReactDOMServer;
let Scheduler;
let act;
let assertLog;
let container;
let startTransition;
let Suspense;

describe('ReactTransitionTracing Hydration', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    Scheduler = require('scheduler');
    const InternalTestUtils = require('internal-test-utils');
    act = InternalTestUtils.act;
    assertLog = InternalTestUtils.assertLog;
    startTransition = React.startTransition;
    Suspense = React.Suspense;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  // @gate enableTransitionTracing
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('TracingMarker renders as fragment during SSR', async () => {
    // skip: requires Plan 04 (Fizz does not support TracingMarker — crashes
    // with "Element type is invalid" when encountering the symbol type)
    function App() {
      return (
        <div>
          <React.unstable_TracingMarker name="test-marker">
            <span>child one</span>
            <span>child two</span>
          </React.unstable_TracingMarker>
        </div>
      );
    }

    const html = ReactDOMServer.renderToString(<App />);
    expect(html).toBe(
      '<div><span>child one</span><span>child two</span></div>',
    );
  });

  // @gate enableTransitionTracing
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('SSR renderToString with TracingMarker does not crash', async () => {
    // skip: requires Plan 04 (Fizz does not support TracingMarker)
    function App() {
      return (
        <React.unstable_TracingMarker name="marker">
          <div>Hello</div>
        </React.unstable_TracingMarker>
      );
    }

    const html = ReactDOMServer.renderToString(<App />);
    expect(html).toBe('<div>Hello</div>');
  });

  // @gate enableTransitionTracing
  it('hydrateRoot with transition callbacks fires callbacks on post-hydration transitions', async () => {
    function Text({text}) {
      Scheduler.log(text);
      return text;
    }

    let setShowPage;
    function App() {
      const [showPage, _setShowPage] = React.useState(false);
      setShowPage = _setShowPage;
      return (
        <div>
          {showPage ? (
            <React.unstable_TracingMarker name="page-marker">
              <Text text="Page Two" />
            </React.unstable_TracingMarker>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name})`);
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(`onTransitionComplete(${name})`);
      },
      onMarkerComplete: (transitionName, markerName, startTime, endTime) => {
        Scheduler.log(`onMarkerComplete(${transitionName}, ${markerName})`);
      },
    };

    // Server render without TracingMarker to avoid Fizz crash
    // (Fizz doesn't support TracingMarker yet — see Plan 04)
    const serverHtml = '<div>Page One</div>';
    container.innerHTML = serverHtml;

    // Hydrate
    await act(async () => {
      ReactDOMClient.hydrateRoot(container, <App />, {
        unstable_transitionCallbacks: transitionCallbacks,
      });
    });
    assertLog(['Page One']);

    // After hydration, start a named transition that updates state
    await act(async () => {
      startTransition(
        () => {
          setShowPage(true);
        },
        {name: 'nav-transition'},
      );
    });

    assertLog([
      'Page Two',
      'onTransitionStart(nav-transition)',
      'onMarkerComplete(nav-transition, page-marker)',
      'onTransitionComplete(nav-transition)',
    ]);
  });

  // @gate enableTransitionTracing
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('Transition started during selective hydration with TracingMarker', async () => {
    // skip: requires Plan 04 (hydration tracing support)
    function App() {
      return (
        <div>
          <Suspense fallback={<span>Loading...</span>}>
            <React.unstable_TracingMarker name="hydration-marker">
              <div>Content</div>
            </React.unstable_TracingMarker>
          </Suspense>
        </div>
      );
    }

    const transitionCallbacks = {
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name})`);
      },
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(`onTransitionComplete(${name})`);
      },
      onMarkerComplete: (transitionName, markerName, startTime, endTime) => {
        Scheduler.log(`onMarkerComplete(${transitionName}, ${markerName})`);
      },
    };

    const html = ReactDOMServer.renderToString(<App />);
    container.innerHTML = html;

    await act(async () => {
      const root = ReactDOMClient.hydrateRoot(container, <App />, {
        unstable_transitionCallbacks: transitionCallbacks,
      });

      startTransition(
        () => {
          root.render(<App />);
        },
        {name: 'hydration-transition'},
      );
    });

    assertLog([
      'onTransitionStart(hydration-transition)',
      'onMarkerComplete(hydration-transition, hydration-marker)',
      'onTransitionComplete(hydration-transition)',
    ]);
  });

  // @gate enableTransitionTracing
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('renderToPipeableStream with TracingMarker', async () => {
    // skip: requires Plan 04 (Fizz does not support TracingMarker)
    function App() {
      return (
        <html>
          <body>
            <React.unstable_TracingMarker name="stream-marker">
              <div>Streamed Content</div>
            </React.unstable_TracingMarker>
          </body>
        </html>
      );
    }

    let output = '';
    const {Writable} = require('stream');
    const writable = new Writable({
      write(chunk, encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });

    await new Promise((resolve, reject) => {
      const {pipe} = ReactDOMServer.renderToPipeableStream(<App />, {
        onAllReady() {
          pipe(writable);
        },
        onError(err) {
          reject(err);
        },
      });

      writable.on('finish', () => {
        resolve();
      });
    });

    expect(output).toContain('<div>Streamed Content</div>');
    expect(output).not.toContain('TracingMarker');
    expect(output).not.toContain('stream-marker');
  });
});
