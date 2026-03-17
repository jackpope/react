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
  it('TracingMarker renders as fragment during SSR', async () => {
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
  it('SSR renderToString with TracingMarker does not crash', async () => {
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

    // Use Fizz to server render (TracingMarker is now supported)
    const serverHtml = ReactDOMServer.renderToString(
      <div>
        <Text text="Page One" />
      </div>,
    );
    assertLog(['Page One']);
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
  it('nested TracingMarkers in SSR render as fragments', async () => {
    function App() {
      return (
        <div>
          <React.unstable_TracingMarker name="outer">
            <span>one</span>
            <React.unstable_TracingMarker name="inner">
              <span>two</span>
            </React.unstable_TracingMarker>
          </React.unstable_TracingMarker>
        </div>
      );
    }

    const html = ReactDOMServer.renderToString(<App />);
    expect(html).toBe('<div><span>one</span><span>two</span></div>');
  });

  // @gate enableTransitionTracing
  it('TracingMarker with Suspense boundary in SSR', async () => {
    function App() {
      return (
        <div>
          <React.unstable_TracingMarker name="page">
            <Suspense fallback={<span>Loading...</span>}>
              <span>Content</span>
            </Suspense>
          </React.unstable_TracingMarker>
        </div>
      );
    }

    const html = ReactDOMServer.renderToString(<App />);
    expect(html).toContain('<span>Content</span>');
    expect(html).not.toContain('TracingMarker');
    expect(html).not.toContain('page');
  });

  // @gate enableTransitionTracing
  it('SSR with TracingMarker followed by hydration with post-hydration transition', async () => {
    function Text({text}) {
      Scheduler.log(text);
      return text;
    }

    let setPage;
    function App() {
      const [page, _setPage] = React.useState('home');
      setPage = _setPage;
      return (
        <div>
          <React.unstable_TracingMarker name="app">
            {page === 'home' ? (
              <Text text="Home" />
            ) : (
              <React.unstable_TracingMarker name="profile">
                <Text text="Profile" />
              </React.unstable_TracingMarker>
            )}
          </React.unstable_TracingMarker>
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

    // Server render the initial page with TracingMarker in the tree
    const serverHtml = ReactDOMServer.renderToString(<App />);
    assertLog(['Home']);
    container.innerHTML = serverHtml;

    // Hydrate
    await act(async () => {
      ReactDOMClient.hydrateRoot(container, <App />, {
        unstable_transitionCallbacks: transitionCallbacks,
      });
    });
    assertLog(['Home']);

    // Navigate via transition — TracingMarker callbacks should fire normally
    await act(async () => {
      startTransition(
        () => {
          setPage('profile');
        },
        {name: 'navigate'},
      );
    });

    assertLog([
      'Profile',
      'onTransitionStart(navigate)',
      'onMarkerComplete(navigate, profile)',
      'onTransitionComplete(navigate)',
    ]);
  });
});
