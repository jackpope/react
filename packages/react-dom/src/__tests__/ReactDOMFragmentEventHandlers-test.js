/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails reactcore
 */

'use strict';

let React;
let ReactDOM;
let ReactDOMClient;
let ReactDOMServer;
let Fragment;
let Scheduler;
let act;
let assertLog;
let waitFor;
let waitForAll;
let assertConsoleErrorDev;
let container;

const setUntrackedInputValue = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'value',
).set;

function click(node) {
  node.dispatchEvent(
    new MouseEvent('click', {bubbles: true, cancelable: true}),
  );
}

function mouseOut(node, relatedTarget) {
  node.dispatchEvent(
    new MouseEvent('mouseout', {
      bubbles: true,
      cancelable: true,
      relatedTarget,
    }),
  );
}

function mouseOver(node, relatedTarget) {
  node.dispatchEvent(
    new MouseEvent('mouseover', {
      bubbles: true,
      cancelable: true,
      relatedTarget,
    }),
  );
}

describe('ReactDOMFragmentEventHandlers', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    Fragment = React.Fragment;
    Scheduler = require('scheduler');
    const InternalTestUtils = require('internal-test-utils');
    act = InternalTestUtils.act;
    assertLog = InternalTestUtils.assertLog;
    waitFor = InternalTestUtils.waitFor;
    waitForAll = InternalTestUtils.waitForAll;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;

    container = document.createElement('div');
    document.body.innerHTML = '';
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // @gate !enableFragmentEventHandlers
  it('ignores and warns about event handler props when the flag is off', async () => {
    const childRef = React.createRef();
    const onClick = jest.fn();
    const root = ReactDOMClient.createRoot(container);
    await act(() =>
      root.render(
        <div>
          <Fragment onClick={onClick}>
            <button ref={childRef} />
          </Fragment>
        </div>,
      ),
    );
    assertConsoleErrorDev([
      'Invalid prop `onClick` supplied to `React.Fragment`. React.Fragment ' +
        'can only have `key`, `ref`, and `children` props.',
    ]);

    click(childRef.current);
    expect(onClick).not.toHaveBeenCalled();
  });

  // @gate enableFragmentEventHandlers
  it('allows event handler props without warning but still warns for other props', async () => {
    const root = ReactDOMClient.createRoot(container);
    await act(() =>
      root.render(
        <div>
          <Fragment onClick={() => {}} onFocusCapture={() => {}}>
            <span />
          </Fragment>
        </div>,
      ),
    );

    await act(() =>
      root.render(
        <div>
          <Fragment onClick={() => {}} foo="bar">
            <span />
          </Fragment>
        </div>,
      ),
    );
    assertConsoleErrorDev([
      'Invalid prop `foo` supplied to `React.Fragment`. React.Fragment ' +
        'can only have `key`, `ref`, `children`, and event handler props.',
    ]);
  });

  // @gate enableFragmentEventHandlers
  it('warns about unknown event handler props like host elements do', async () => {
    function App({onFoo}) {
      return (
        <div>
          <Fragment
            onFoo={onFoo}
            onDblClick={() => {}}
            onClickcapture={() => {}}
            onFocusIn={() => {}}>
            <span />
          </Fragment>
        </div>
      );
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App onFoo={() => {}} />));
    assertConsoleErrorDev([
      'Unknown event handler property `onFoo`. It will be ignored.\n' +
        '    in App (at **)',
      'Invalid event handler property `onDblClick`. Did you mean `onDoubleClick`?\n' +
        '    in App (at **)',
      'Invalid event handler property `onClickcapture`. Did you mean `onClickCapture`?\n' +
        '    in App (at **)',
      'React uses onFocus and onBlur instead of onFocusIn and onFocusOut. ' +
        'All React events are normalized to bubble, so onFocusIn and onFocusOut ' +
        'are not needed/supported by React.\n' +
        '    in App (at **)',
    ]);

    // Like host elements, each name only warns once.
    await act(() => root.render(<App onFoo={() => {}} />));
  });

  // @gate enableFragmentEventHandlers
  it('warns about unknown event handler props the same way for fragments and host elements', async () => {
    const root = ReactDOMClient.createRoot(container);
    await act(() =>
      root.render(
        <div>
          <Fragment onBar={() => {}}>
            <span />
          </Fragment>
          <span onBaz={() => {}} />
        </div>,
      ),
    );
    assertConsoleErrorDev([
      'Unknown event handler property `onBaz`. It will be ignored.\n' +
        '    in span (at **)',
      'Unknown event handler property `onBar`. It will be ignored.',
    ]);
  });

  // @gate enableFragmentEventHandlers
  it('does not remount children when a top-level handler toggles between undefined and a function', async () => {
    const childRef = React.createRef();
    function Child({id}) {
      React.useLayoutEffect(() => {
        Scheduler.log('mount ' + id);
        return () => Scheduler.log('unmount ' + id);
      }, [id]);
      return <button ref={id === 'a' ? childRef : null} />;
    }
    function Component({onClick}) {
      // Unkeyed and returned at the top level, like refs this keeps a Fiber
      // whenever an on* prop is present, even if its value is undefined.
      return (
        <Fragment onClick={onClick}>
          <Child id="a" />
          <Child id="b" />
        </Fragment>
      );
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<Component onClick={undefined} />));
    assertLog(['mount a', 'mount b']);
    const button = childRef.current;

    await act(() =>
      root.render(<Component onClick={() => Scheduler.log('clicked')} />),
    );
    assertLog([]);
    expect(childRef.current).toBe(button);
    click(button);
    assertLog(['clicked']);

    await act(() => root.render(<Component onClick={undefined} />));
    assertLog([]);
    expect(childRef.current).toBe(button);
    click(button);
    assertLog([]);

    await act(() =>
      root.render(<Component onClick={() => Scheduler.log('clicked again')} />),
    );
    assertLog([]);
    click(button);
    assertLog(['clicked again']);
  });

  // @gate enableFragmentEventHandlers
  it('does not remount children of a fragment that is the only child of a host element when its handler toggles', async () => {
    function Child() {
      React.useLayoutEffect(() => {
        Scheduler.log('mount');
        return () => Scheduler.log('unmount');
      }, []);
      return <span />;
    }
    function App({onClick}) {
      return (
        <div>
          <Fragment onClick={onClick}>
            <Child />
          </Fragment>
        </div>
      );
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App onClick={undefined} />));
    assertLog(['mount']);
    await act(() => root.render(<App onClick={() => {}} />));
    await act(() => root.render(<App onClick={undefined} />));
    assertLog([]);
  });

  // @gate enableFragmentEventHandlers
  it('dispatches capture and bubble handlers in tree order', async () => {
    const childRef = React.createRef();
    const log = name => () => Scheduler.log(name);
    const root = ReactDOMClient.createRoot(container);
    await act(() =>
      root.render(
        <div
          onClickCapture={log('parent capture')}
          onClick={log('parent bubble')}>
          <Fragment
            onClickCapture={log('fragment capture')}
            onClick={log('fragment bubble')}>
            <button
              ref={childRef}
              onClickCapture={log('child capture')}
              onClick={log('child bubble')}
            />
          </Fragment>
        </div>,
      ),
    );

    click(childRef.current);
    assertLog([
      'parent capture',
      'fragment capture',
      'child capture',
      'child bubble',
      'fragment bubble',
      'parent bubble',
    ]);
  });

  // @gate enableFragmentEventHandlers
  it('dispatches for events from any host child of the fragment', async () => {
    const aRef = React.createRef();
    const bRef = React.createRef();
    const outsideRef = React.createRef();
    const onClick = jest.fn();
    const root = ReactDOMClient.createRoot(container);
    await act(() =>
      root.render(
        <div>
          <Fragment onClick={onClick}>
            <span ref={aRef}>A</span>
            <div>
              <span ref={bRef}>B</span>
            </div>
          </Fragment>
          <span ref={outsideRef}>Outside</span>
        </div>,
      ),
    );

    click(aRef.current);
    click(bRef.current);
    expect(onClick).toHaveBeenCalledTimes(2);
    expect(onClick.mock.calls[0][0].target).toBe(aRef.current);
    expect(onClick.mock.calls[1][0].target).toBe(bRef.current);

    click(outsideRef.current);
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  // @gate enableFragmentEventHandlers
  it('uses the FragmentInstance as currentTarget and this', async () => {
    const fragmentRef = React.createRef();
    const childRef = React.createRef();
    let currentTarget = null;
    let thisValue = null;
    function onClick(e) {
      currentTarget = e.currentTarget;
      thisValue = this;
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() =>
      root.render(
        <Fragment ref={fragmentRef} onClick={onClick}>
          <button ref={childRef} />
        </Fragment>,
      ),
    );

    click(childRef.current);
    expect(currentTarget).not.toBe(null);
    expect(currentTarget).toBe(fragmentRef.current);
    expect(thisValue).toBe(fragmentRef.current);
    expect(typeof currentTarget.addEventListener).toBe('function');
  });

  // @gate enableFragmentEventHandlers
  it('creates a FragmentInstance for currentTarget when there is no ref', async () => {
    const childRef = React.createRef();
    let currentTarget = null;
    const root = ReactDOMClient.createRoot(container);
    await act(() =>
      root.render(
        <Fragment onClick={e => (currentTarget = e.currentTarget)}>
          <button ref={childRef} />
        </Fragment>,
      ),
    );

    click(childRef.current);
    expect(currentTarget).not.toBe(null);
    expect(currentTarget).not.toBe(childRef.current);
    expect(typeof currentTarget.getClientRects).toBe('function');
    expect(
      currentTarget.compareDocumentPosition(childRef.current) &
        Node.DOCUMENT_POSITION_CONTAINED_BY,
    ).toBeTruthy();
  });

  // @gate enableFragmentEventHandlers
  it('keeps the fiber for unkeyed top-level fragments with event handlers', async () => {
    const childRef = React.createRef();
    const onClick = jest.fn();
    function Component() {
      // An unkeyed Fragment returned at the top level is normally treated as
      // an array of children and doesn't get a Fiber.
      return (
        <Fragment onClick={onClick}>
          <button ref={childRef} />
          <span />
        </Fragment>
      );
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<Component />));

    click(childRef.current);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // @gate enableFragmentEventHandlers
  it('dispatches through nested fragments in order', async () => {
    const childRef = React.createRef();
    const log = name => () => Scheduler.log(name);
    const root = ReactDOMClient.createRoot(container);
    await act(() =>
      root.render(
        <Fragment onClickCapture={log('outer capture')} onClick={log('outer')}>
          <Fragment
            onClickCapture={log('inner capture')}
            onClick={log('inner')}>
            <button ref={childRef} onClick={log('child')} />
          </Fragment>
        </Fragment>,
      ),
    );

    click(childRef.current);
    assertLog(['outer capture', 'inner capture', 'child', 'inner', 'outer']);
  });

  // @gate enableFragmentEventHandlers
  it('stops propagation at a fragment', async () => {
    const childRef = React.createRef();
    const log = name => () => Scheduler.log(name);
    const documentListener = jest.fn();
    document.addEventListener('click', documentListener);
    const root = ReactDOMClient.createRoot(container);
    await act(() =>
      root.render(
        <div onClick={log('parent')}>
          <Fragment
            onClick={e => {
              Scheduler.log('fragment');
              e.stopPropagation();
            }}>
            <button ref={childRef} onClick={log('child')} />
          </Fragment>
        </div>,
      ),
    );

    click(childRef.current);
    assertLog(['child', 'fragment']);
    if (!gate(flags => flags.enableLegacyFBSupport)) {
      // Legacy FB support dispatches clicks from the document itself.
      expect(documentListener).not.toHaveBeenCalled();
    }
    document.removeEventListener('click', documentListener);
  });

  // @gate enableFragmentEventHandlers
  it('stops propagation at a fragment in the capture phase', async () => {
    const childRef = React.createRef();
    const log = name => () => Scheduler.log(name);
    const root = ReactDOMClient.createRoot(container);
    await act(() =>
      root.render(
        <div onClickCapture={log('parent capture')} onClick={log('parent')}>
          <Fragment
            onClickCapture={e => {
              Scheduler.log('fragment capture');
              e.stopPropagation();
            }}>
            <button
              ref={childRef}
              onClickCapture={log('child capture')}
              onClick={log('child')}
            />
          </Fragment>
        </div>,
      ),
    );

    click(childRef.current);
    assertLog(['parent capture', 'fragment capture']);
  });

  // @gate enableFragmentEventHandlers
  it('receives events from portals inside the fragment', async () => {
    const portalContainer = document.createElement('div');
    document.body.appendChild(portalContainer);
    const portalChildRef = React.createRef();
    const log = name => () => Scheduler.log(name);
    const root = ReactDOMClient.createRoot(container);
    await act(() =>
      root.render(
        <div onClick={log('parent')}>
          <Fragment onClick={log('fragment')}>
            {ReactDOM.createPortal(
              <button ref={portalChildRef} onClick={log('portal child')} />,
              portalContainer,
            )}
          </Fragment>
        </div>,
      ),
    );

    click(portalChildRef.current);
    assertLog(['portal child', 'fragment', 'parent']);
  });

  // @gate enableFragmentEventHandlers
  it('reads the latest committed handlers at dispatch time', async () => {
    const childRef = React.createRef();
    let setCount;
    function Child() {
      const [count, _setCount] = React.useState(0);
      setCount = _setCount;
      return <button ref={childRef}>{count}</button>;
    }
    function App({onClick}) {
      return (
        <div>
          <Fragment onClick={onClick}>
            <Child />
          </Fragment>
        </div>
      );
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() =>
      root.render(<App onClick={() => Scheduler.log('first')} />),
    );
    click(childRef.current);
    assertLog(['first']);

    await act(() =>
      root.render(<App onClick={() => Scheduler.log('second')} />),
    );
    click(childRef.current);
    assertLog(['second']);

    // A descendant-only update swaps the Fragment's fibers without the
    // Fragment re-rendering. The committed handler should still be used.
    await act(() => setCount(1));
    expect(childRef.current.textContent).toBe('1');
    click(childRef.current);
    assertLog(['second']);

    await act(() => root.render(<App onClick={undefined} />));
    click(childRef.current);
    assertLog([]);
  });

  // @gate enableFragmentEventHandlers
  it('dispatches when handlers are added to an existing fragment', async () => {
    const childRef = React.createRef();
    function App({onClick}) {
      return (
        <div>
          <Fragment onClick={onClick}>
            <button ref={childRef} />
          </Fragment>
        </div>
      );
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    click(childRef.current);

    await act(() =>
      root.render(<App onClick={() => Scheduler.log('added')} />),
    );
    click(childRef.current);
    assertLog(['added']);

    await act(() =>
      root.render(<App onClick={() => Scheduler.log('updated')} />),
    );
    click(childRef.current);
    assertLog(['updated']);
  });

  // @gate enableFragmentEventHandlers
  it('does not dispatch to handlers from an uncommitted render', async () => {
    const childRef = React.createRef();
    function Text({text}) {
      Scheduler.log(text);
      return text;
    }
    function App({onClick}) {
      return (
        <div>
          <Fragment onClick={onClick}>
            <button ref={childRef}>
              <Text text="A" />
            </button>
            <Text text="B" />
          </Fragment>
        </div>
      );
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App onClick={() => Scheduler.log('old')} />));
    assertLog(['A', 'B']);

    await act(async () => {
      React.startTransition(() => {
        root.render(<App onClick={() => Scheduler.log('new')} />);
      });
      // Yield after the Fragment has begun rendering with the new props.
      await waitFor(['A']);
      click(childRef.current);
      assertLog(['old']);
    });
    assertLog(['B']);

    click(childRef.current);
    assertLog(['new']);
  });

  // @gate enableFragmentEventHandlers
  it('dispatches emulated events such as onChange', async () => {
    const inputRef = React.createRef();
    const log = name => () => Scheduler.log(name);
    const root = ReactDOMClient.createRoot(container);
    await act(() =>
      root.render(
        <Fragment
          onChangeCapture={log('fragment capture')}
          onChange={log('fragment bubble')}>
          <input ref={inputRef} onChange={log('input')} />
        </Fragment>,
      ),
    );

    const input = inputRef.current;
    setUntrackedInputValue.call(input, 'giraffe');
    input.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}));
    assertLog(['fragment capture', 'input', 'fragment bubble']);
  });

  // @gate enableFragmentEventHandlers
  it('follows React bubbling rules for non-bubbling events', async () => {
    const imgRef = React.createRef();
    const scrollRef = React.createRef();
    const log = name => () => Scheduler.log(name);
    const root = ReactDOMClient.createRoot(container);
    await act(() =>
      root.render(
        <Fragment
          onLoad={log('fragment load')}
          onScroll={log('fragment scroll')}
          onScrollCapture={log('fragment scroll capture')}>
          <img ref={imgRef} />
          <div ref={scrollRef} onScroll={log('div scroll')} />
        </Fragment>,
      ),
    );

    // Media and load events bubble through the React tree.
    imgRef.current.dispatchEvent(new Event('load'));
    assertLog(['fragment load']);

    // onScroll does not bubble in React, but capture listeners still run.
    scrollRef.current.dispatchEvent(new Event('scroll'));
    assertLog(['fragment scroll capture', 'div scroll']);
  });

  // @gate enableFragmentEventHandlers
  it('dispatches after a fragment mounted in a hidden Activity is revealed', async () => {
    const Activity = React.Activity;
    const childRef = React.createRef();
    const onClick = jest.fn();
    function App({mode}) {
      return (
        <Activity mode={mode}>
          <Fragment onClick={onClick}>
            <button ref={childRef} />
          </Fragment>
        </Activity>
      );
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App mode="hidden" />));
    await act(() => root.render(<App mode="visible" />));

    click(childRef.current);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // @gate enableFragmentEventHandlers
  it('hydrates fragments with event handlers', async () => {
    const onClick = jest.fn();
    function App() {
      return (
        <div>
          <Fragment onClick={onClick}>
            <button id="button">Click</button>
          </Fragment>
        </div>
      );
    }
    container.innerHTML = ReactDOMServer.renderToString(<App />);
    await act(() => ReactDOMClient.hydrateRoot(container, <App />));

    click(container.querySelector('#button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // @gate enableFragmentEventHandlers
  it('dispatches a discrete event to a fragment in a dehydrated boundary after synchronously hydrating it', async () => {
    const Suspense = React.Suspense;
    function Child({text}) {
      Scheduler.log(text);
      return (
        <Fragment
          onClickCapture={() => Scheduler.log('Fragment capture ' + text)}
          onClick={() => Scheduler.log('Fragment clicked ' + text)}>
          <span onClick={() => Scheduler.log('Clicked ' + text)}>{text}</span>
        </Fragment>
      );
    }
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Suspense fallback="Loading...">
            <Child text="A" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="B" />
          </Suspense>
        </div>
      );
    }

    container.innerHTML = ReactDOMServer.renderToString(<App />);
    assertLog(['App', 'A', 'B']);
    const spanB = container.getElementsByTagName('span')[1];

    ReactDOMClient.hydrateRoot(container, <App />);
    assertLog([]);

    // Clicking the dehydrated content synchronously hydrates the root and
    // the boundary around B, then dispatches to the hydrated handlers.
    click(spanB);
    assertLog([
      'App',
      'B',
      'Fragment capture B',
      'Clicked B',
      'Fragment clicked B',
    ]);

    await waitForAll(['A']);
  });

  // @gate enableFragmentEventHandlers
  it('replays a continuous event to a fragment once its boundary hydrates', async () => {
    const Suspense = React.Suspense;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    function Child({text}) {
      if (suspend && text === 'A') {
        throw promise;
      }
      Scheduler.log(text);
      return (
        <Fragment onMouseEnter={() => Scheduler.log('Fragment enter ' + text)}>
          <span onMouseEnter={() => Scheduler.log('Enter ' + text)}>
            {text}
          </span>
        </Fragment>
      );
    }
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Suspense fallback="Loading...">
            <Child text="A" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="B" />
          </Suspense>
        </div>
      );
    }

    container.innerHTML = ReactDOMServer.renderToString(<App />);
    assertLog(['App', 'A', 'B']);
    const spanA = container.getElementsByTagName('span')[0];

    suspend = true;
    ReactDOMClient.hydrateRoot(container, <App />);
    assertLog([]);

    await act(() => {
      // A can't hydrate yet, so the event is queued for replay.
      mouseOver(spanA, null);
      suspend = false;
      resolve();
    });

    // The hovered boundary hydrates first, then the queued event is replayed.
    assertLog(['App', 'A', 'Fragment enter A', 'Enter A', 'B']);
  });

  describe('enter and leave', () => {
    // @gate enableFragmentEventHandlers
    it('fires at the fragment boundary, not between its own children', async () => {
      const aRef = React.createRef();
      const bRef = React.createRef();
      const outsideRef = React.createRef();
      const label = node => (node === window ? 'window' : node.id);
      const log = name => e =>
        Scheduler.log(
          `${name} target=${label(e.target)} related=${label(e.relatedTarget)}`,
        );
      const root = ReactDOMClient.createRoot(container);
      await act(() =>
        root.render(
          <div id="parent">
            <Fragment
              onMouseEnter={log('fragment enter')}
              onMouseLeave={log('fragment leave')}>
              <div id="a" ref={aRef} onMouseEnter={log('a enter')} />
              <div id="b" ref={bRef} />
            </Fragment>
            <div id="outside" ref={outsideRef} />
          </div>,
        ),
      );

      // Entering from outside the window.
      mouseOver(aRef.current, null);
      assertLog([
        'fragment enter target=a related=window',
        'a enter target=a related=window',
      ]);

      // Moving between the fragment's own host children.
      mouseOut(aRef.current, bRef.current);
      assertLog([]);

      // Leaving to a node outside the fragment.
      mouseOut(bRef.current, outsideRef.current);
      assertLog(['fragment leave target=b related=outside']);

      // Entering from a node outside the fragment.
      mouseOut(outsideRef.current, aRef.current);
      assertLog([
        'fragment enter target=a related=outside',
        'a enter target=a related=outside',
      ]);
    });

    // @gate enableFragmentEventHandlers
    it('treats the parent host node between children as outside the fragment', async () => {
      const parentRef = React.createRef();
      const aRef = React.createRef();
      const bRef = React.createRef();
      const log = name => () => Scheduler.log(name);
      const root = ReactDOMClient.createRoot(container);
      await act(() =>
        root.render(
          <div ref={parentRef}>
            <Fragment
              onMouseEnter={log('fragment enter')}
              onMouseLeave={log('fragment leave')}>
              <div ref={aRef} />
              <div ref={bRef} />
            </Fragment>
          </div>,
        ),
      );

      // The pointer crosses a gap between A and B, which is the parent.
      mouseOut(aRef.current, parentRef.current);
      assertLog(['fragment leave']);
      mouseOut(parentRef.current, bRef.current);
      assertLog(['fragment enter']);
    });

    // @gate enableFragmentEventHandlers
    it('treats portals inside the fragment as part of the fragment', async () => {
      const portalContainer = document.createElement('div');
      document.body.appendChild(portalContainer);
      const aRef = React.createRef();
      const portalChildRef = React.createRef();
      const log = name => () => Scheduler.log(name);
      const root = ReactDOMClient.createRoot(container);
      await act(() =>
        root.render(
          <div>
            <Fragment
              onMouseEnter={log('fragment enter')}
              onMouseLeave={log('fragment leave')}>
              <div ref={aRef} />
              {ReactDOM.createPortal(
                <div ref={portalChildRef} />,
                portalContainer,
              )}
            </Fragment>
          </div>,
        ),
      );

      mouseOver(aRef.current, null);
      assertLog(['fragment enter']);

      // The portal child is outside the fragment in the DOM, but inside it
      // in the React tree.
      mouseOut(aRef.current, portalChildRef.current);
      mouseOver(portalChildRef.current, aRef.current);
      assertLog([]);

      // Leaving the portal child to a node React doesn't manage.
      mouseOut(portalChildRef.current, document.body);
      assertLog(['fragment leave']);
    });

    // @gate enableFragmentEventHandlers
    it('handles nested fragments as separate boundaries', async () => {
      const aRef = React.createRef();
      const bRef = React.createRef();
      const outsideRef = React.createRef();
      const log = name => () => Scheduler.log(name);
      const root = ReactDOMClient.createRoot(container);
      await act(() =>
        root.render(
          <div>
            <Fragment
              onMouseEnter={log('outer enter')}
              onMouseLeave={log('outer leave')}>
              <Fragment
                onMouseEnter={log('inner enter')}
                onMouseLeave={log('inner leave')}>
                <div ref={aRef} />
              </Fragment>
              <div ref={bRef} />
            </Fragment>
            <div ref={outsideRef} />
          </div>,
        ),
      );

      mouseOut(outsideRef.current, aRef.current);
      assertLog(['outer enter', 'inner enter']);

      mouseOut(aRef.current, bRef.current);
      assertLog(['inner leave']);

      mouseOut(bRef.current, aRef.current);
      assertLog(['inner enter']);

      mouseOut(aRef.current, outsideRef.current);
      assertLog(['inner leave', 'outer leave']);
    });
  });
});
