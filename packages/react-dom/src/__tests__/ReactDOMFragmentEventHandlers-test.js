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

    describe('gaps between children', () => {
      // jsdom has no layout. Children are laid out in a row:
      //   A: x 0-100, gap: x 100-120, B: x 120-220, outside: x 300-400,
      // all at y 0-50. The parent's own area is everywhere else.
      const GAP = [110, 25];
      const PAST_B = [250, 25];
      const BELOW = [110, 80];
      const ON_A = [50, 25];
      const ON_B = [170, 25];
      const ON_OUTSIDE = [350, 25];

      function setRect(node, left, right) {
        node.getClientRects = () => [
          {left, right, top: 0, bottom: 50, width: right - left, height: 50},
        ];
      }

      function dispatchAt(node, type, [clientX, clientY], init) {
        const event = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          ...init,
        });
        if (init && init.pointerId !== undefined) {
          Object.defineProperty(event, 'pointerId', {value: init.pointerId});
        }
        node.dispatchEvent(event);
      }
      const outAt = (node, relatedTarget, point, init) =>
        dispatchAt(node, 'mouseout', point, {relatedTarget, ...init});
      const moveAt = (node, point) => dispatchAt(node, 'mousemove', point);

      function createRefs() {
        return {
          grandparent: React.createRef(),
          parent: React.createRef(),
          a: React.createRef(),
          b: React.createRef(),
          outside: React.createRef(),
        };
      }

      const label = node =>
        node === window ? 'window' : node.id || node.nodeName;
      const log = name => e =>
        Scheduler.log(
          `${name} target=${label(e.target)} related=${label(e.relatedTarget)}`,
        );

      async function renderGapTree(root, refs, fragmentProps) {
        await act(() =>
          root.render(
            <div
              id="grandparent"
              ref={refs.grandparent}
              onMouseLeave={log('grandparent leave')}>
              <div
                id="parent"
                ref={refs.parent}
                onMouseEnter={log('parent enter')}
                onMouseLeave={log('parent leave')}>
                <Fragment
                  onMouseEnter={log('fragment enter')}
                  onMouseLeave={log('fragment leave')}
                  onPointerEnter={log('fragment pointerenter')}
                  onPointerLeave={log('fragment pointerleave')}
                  {...fragmentProps}>
                  <div id="a" ref={refs.a} />
                  <div id="b" ref={refs.b} />
                </Fragment>
                <div id="outside" ref={refs.outside} />
              </div>
            </div>,
          ),
        );
        setRect(refs.a.current, 0, 100);
        setRect(refs.b.current, 120, 220);
        setRect(refs.outside.current, 300, 400);
      }

      // @gate enableFragmentEventHandlers
      it('does not fire when the pointer crosses the gap between children', async () => {
        const refs = createRefs();
        const root = ReactDOMClient.createRoot(container);
        await renderGapTree(root, refs);

        outAt(refs.outside.current, refs.a.current, ON_A);
        assertLog(['fragment enter target=a related=outside']);

        outAt(refs.a.current, refs.parent.current, GAP);
        moveAt(refs.parent.current, [115, 25]);
        outAt(refs.parent.current, refs.b.current, ON_B);
        assertLog([]);
      });

      // @gate enableFragmentEventHandlers
      it('fires leave when the pointer moves onto the parent outside the gaps', async () => {
        const refs = createRefs();
        const root = ReactDOMClient.createRoot(container);
        await renderGapTree(root, refs);

        outAt(refs.outside.current, refs.b.current, ON_B);
        assertLog(['fragment enter target=b related=outside']);
        outAt(refs.b.current, refs.parent.current, PAST_B);
        assertLog(['fragment leave target=b related=parent']);
        outAt(refs.parent.current, refs.a.current, ON_A);
        assertLog(['fragment enter target=a related=parent']);
        outAt(refs.a.current, refs.parent.current, BELOW);
        assertLog(['fragment leave target=a related=parent']);
      });

      // @gate enableFragmentEventHandlers
      it('fires leave and enter when the pointer moves across the edge of a gap', async () => {
        const refs = createRefs();
        const root = ReactDOMClient.createRoot(container);
        await renderGapTree(root, refs);

        outAt(refs.outside.current, refs.a.current, ON_A);
        outAt(refs.a.current, refs.parent.current, GAP);
        assertLog(['fragment enter target=a related=outside']);

        // Out of the gap without leaving the parent node.
        moveAt(refs.parent.current, BELOW);
        assertLog(['fragment leave target=parent related=parent']);
        moveAt(refs.parent.current, [110, 70]);
        assertLog([]);
        // And back in.
        moveAt(refs.parent.current, GAP);
        assertLog(['fragment enter target=parent related=parent']);
        outAt(refs.parent.current, refs.b.current, ON_B);
        assertLog([]);
      });

      // @gate enableFragmentEventHandlers
      it('treats the gap as inside when the pointer comes from outside the fragment', async () => {
        const refs = createRefs();
        const root = ReactDOMClient.createRoot(container);
        await renderGapTree(root, refs);

        outAt(refs.outside.current, refs.parent.current, PAST_B);
        assertLog([]);
        moveAt(refs.parent.current, GAP);
        assertLog(['fragment enter target=parent related=parent']);
        outAt(refs.parent.current, refs.outside.current, ON_OUTSIDE);
        assertLog(['fragment leave target=parent related=outside']);

        outAt(refs.outside.current, refs.parent.current, GAP);
        assertLog(['fragment enter target=parent related=outside']);
        outAt(refs.parent.current, refs.a.current, ON_A);
        assertLog([]);
      });

      // @gate enableFragmentEventHandlers
      it('fires the fragment leave before its parent leave when exiting through a gap', async () => {
        const refs = createRefs();
        const root = ReactDOMClient.createRoot(container);
        await renderGapTree(root, refs);

        outAt(refs.a.current, refs.parent.current, GAP);
        assertLog([]);
        outAt(refs.parent.current, refs.grandparent.current, [110, -10]);
        assertLog([
          'fragment leave target=parent related=grandparent',
          'parent leave target=parent related=grandparent',
        ]);

        outAt(refs.grandparent.current, refs.parent.current, GAP);
        assertLog([
          'parent enter target=parent related=grandparent',
          'fragment enter target=parent related=grandparent',
        ]);
        outAt(refs.parent.current, null, [110, -10]);
        assertLog([
          'fragment leave target=parent related=window',
          'parent leave target=parent related=window',
          'grandparent leave target=parent related=window',
        ]);
      });

      // @gate enableFragmentEventHandlers
      it('tracks each pointer separately', async () => {
        const refs = createRefs();
        const root = ReactDOMClient.createRoot(container);
        await renderGapTree(root, refs);

        dispatchAt(refs.a.current, 'pointerout', GAP, {
          relatedTarget: refs.parent.current,
          pointerId: 1,
        });
        dispatchAt(refs.outside.current, 'pointerout', ON_B, {
          relatedTarget: refs.b.current,
          pointerId: 2,
        });
        assertLog(['fragment pointerenter target=b related=outside']);
        // Pointer 1 moves out of the gap; pointer 2 is unaffected.
        dispatchAt(refs.parent.current, 'pointermove', BELOW, {pointerId: 1});
        assertLog(['fragment pointerleave target=parent related=parent']);
        dispatchAt(refs.b.current, 'pointerout', GAP, {
          relatedTarget: refs.parent.current,
          pointerId: 2,
        });
        assertLog([]);
        // Mouse events are tracked apart from pointer events.
        moveAt(refs.parent.current, GAP);
        assertLog(['fragment enter target=parent related=parent']);
      });

      // @gate enableFragmentEventHandlers
      it('treats the root container as the parent of a top-level fragment', async () => {
        const aRef = React.createRef();
        const bRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);
        await act(() =>
          root.render(
            <Fragment
              onMouseEnter={log('fragment enter')}
              onMouseLeave={log('fragment leave')}>
              <div id="a" ref={aRef} />
              <div id="b" ref={bRef} />
            </Fragment>,
          ),
        );
        setRect(aRef.current, 0, 100);
        setRect(bRef.current, 120, 220);

        dispatchAt(aRef.current, 'mouseover', ON_A, {relatedTarget: null});
        assertLog(['fragment enter target=a related=window']);
        outAt(aRef.current, container, GAP);
        outAt(container, bRef.current, ON_B);
        assertLog([]);
        outAt(bRef.current, container, PAST_B);
        assertLog(['fragment leave target=b related=window']);
      });

      // @gate enableFragmentEventHandlers
      it('stops tracking a fragment once it unmounts or its handlers are removed', async () => {
        const refs = createRefs();
        const root = ReactDOMClient.createRoot(container);
        await renderGapTree(root, refs);
        moveAt(refs.parent.current, GAP);
        assertLog(['fragment enter target=parent related=parent']);

        // Removing the handlers while the pointer is in the gap.
        await renderGapTree(root, refs, {
          onMouseEnter: undefined,
          onMouseLeave: undefined,
          onPointerEnter: undefined,
          onPointerLeave: undefined,
        });
        moveAt(refs.parent.current, BELOW);
        moveAt(refs.parent.current, GAP);
        assertLog([]);

        await renderGapTree(root, refs);
        moveAt(refs.parent.current, GAP);
        assertLog(['fragment enter target=parent related=parent']);

        await act(() =>
          root.render(
            <div id="grandparent" ref={refs.grandparent}>
              <div id="parent" ref={refs.parent} />
            </div>,
          ),
        );
        moveAt(refs.parent.current, BELOW);
        moveAt(refs.parent.current, GAP);
        assertLog([]);
      });

      // @gate enableFragmentEventHandlers
      it('treats nested fragments that share a parent as separate regions', async () => {
        const parentRef = React.createRef();
        const aRef = React.createRef();
        const bRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);
        await act(() =>
          root.render(
            <div id="parent" ref={parentRef}>
              <Fragment
                onMouseEnter={log('outer enter')}
                onMouseLeave={log('outer leave')}>
                <Fragment
                  onMouseEnter={log('inner enter')}
                  onMouseLeave={log('inner leave')}>
                  <div id="a" ref={aRef} />
                </Fragment>
                <div id="b" ref={bRef} />
              </Fragment>
            </div>,
          ),
        );
        setRect(aRef.current, 0, 100);
        setRect(bRef.current, 120, 220);

        dispatchAt(aRef.current, 'mouseover', ON_A, {relatedTarget: null});
        assertLog([
          'outer enter target=a related=window',
          'inner enter target=a related=window',
        ]);
        // The gap is between the outer fragment's children only.
        outAt(aRef.current, parentRef.current, GAP);
        assertLog(['inner leave target=a related=parent']);
        outAt(parentRef.current, bRef.current, ON_B);
        assertLog([]);
        outAt(bRef.current, parentRef.current, PAST_B);
        assertLog(['outer leave target=b related=parent']);

        // Entering both from the outer fragment's gap fires outer first.
        moveAt(parentRef.current, GAP);
        assertLog(['outer enter target=parent related=parent']);
        outAt(parentRef.current, aRef.current, ON_A);
        assertLog(['inner enter target=a related=parent']);
      });

      // @gate enableFragmentEventHandlers
      it('does not count the empty corner between diagonal children', async () => {
        const refs = createRefs();
        const root = ReactDOMClient.createRoot(container);
        await renderGapTree(root, refs);
        // B wraps onto a second row, below and to the right of A.
        refs.b.current.getClientRects = () => [
          {left: 120, right: 220, top: 60, bottom: 110, width: 100, height: 50},
        ];

        outAt(refs.outside.current, refs.a.current, ON_A);
        assertLog(['fragment enter target=a related=outside']);
        // Right of A and above B, with no child on the other side.
        outAt(refs.a.current, refs.parent.current, [170, 25]);
        assertLog(['fragment leave target=a related=parent']);
      });

      // @gate enableFragmentEventHandlers
      it('does not count portaled children as part of the region', async () => {
        const portalContainer = document.createElement('div');
        document.body.appendChild(portalContainer);
        const parentRef = React.createRef();
        const aRef = React.createRef();
        const portalRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);
        await act(() =>
          root.render(
            <div id="parent" ref={parentRef}>
              <Fragment
                onMouseEnter={log('fragment enter')}
                onMouseLeave={log('fragment leave')}>
                <div id="a" ref={aRef} />
                {ReactDOM.createPortal(
                  <div id="portaled" ref={portalRef} />,
                  portalContainer,
                )}
              </Fragment>
            </div>,
          ),
        );
        setRect(aRef.current, 0, 100);
        // The portaled node is laid out to the right of the gap.
        setRect(portalRef.current, 120, 220);

        dispatchAt(aRef.current, 'mouseover', ON_A, {relatedTarget: null});
        assertLog(['fragment enter target=a related=window']);
        outAt(aRef.current, parentRef.current, GAP);
        assertLog(['fragment leave target=a related=parent']);
      });
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
