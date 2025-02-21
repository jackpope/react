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
let ReactDOMClient;
let act;
let container;

describe('FragmentRefs', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  // @gate enableFragmentRefs
  it('attaches a ref to Fragment', async () => {
    const fragmentRef = React.createRef();
    const root = ReactDOMClient.createRoot(container);

    await act(() =>
      root.render(
        <div id="parent">
          <React.Fragment ref={fragmentRef}>
            <div id="child">Hi</div>
          </React.Fragment>
        </div>,
      ),
    );
    expect(container.innerHTML).toEqual(
      '<div id="parent"><div id="child">Hi</div></div>',
    );

    expect(fragmentRef.current).not.toBe(null);
  });

  // @gate enableFragmentRefs
  it('accepts a ref callback', async () => {
    let fragmentRef;
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(
        <React.Fragment ref={ref => (fragmentRef = ref)}>
          <div id="child">Hi</div>
        </React.Fragment>,
      );
    });

    expect(fragmentRef.current).not.toEqual(null);
  });

  // @gate enableFragmentRefs
  it('is available in effects', async () => {
    function Test() {
      const fragmentRef = React.useRef(null);
      React.useLayoutEffect(() => {
        expect(fragmentRef.current).not.toBe(null);
      });
      React.useEffect(() => {
        expect(fragmentRef.current).not.toBe(null);
      });
      return (
        <React.Fragment ref={fragmentRef}>
          <div />
        </React.Fragment>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<Test />));
  });

  describe('focus()', () => {
    // @gate enableFragmentRefs
    it('focuses the first focusable child', async () => {
      const parentRef = React.createRef();
      const fragmentRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);
      let focusedElement = null;

      function Test() {
        return (
          <div ref={parentRef}>
            <React.Fragment ref={fragmentRef}>
              <div id="child-a" />
              <a id="child-b" href="/">
                A
              </a>
              <div tabIndex={0} id="child-c" />
            </React.Fragment>
          </div>
        );
      }

      await act(() => {
        root.render(<Test />);
      });

      const focusableChildren = parentRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const focusMock = jest.spyOn(HTMLElement.prototype, 'focus');
      focusMock.mockImplementation(function () {
        if (Array.from(focusableChildren).includes(this)) {
          focusedElement = this.id;
        } else {
          return false;
        }
      });
      await act(() => {
        fragmentRef.current.focus();
      });
      expect(focusedElement).toEqual('child-b');
    });

    // @gate enableFragmentRefs
    it('preserves document order when adding and removing children', async () => {
      const fragmentRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);
      let focusedElement = null;

      function Test({showA, showB}) {
        return (
          <React.Fragment ref={fragmentRef}>
            {showA && <a id="child-a" />}
            {showB && <a id="child-b" />}
          </React.Fragment>
        );
      }

      const focusMock = jest.spyOn(HTMLElement.prototype, 'focus');
      focusMock.mockImplementation(function () {
        focusedElement = this.id;
      });

      // Render with A as the first focusable child
      await act(() => {
        root.render(<Test showA={true} showB={false} />);
      });
      await act(() => {
        fragmentRef.current.focus();
      });
      expect(focusedElement).toEqual('child-a');

      // A is still the first focusable child, but B is also tracked
      await act(() => {
        root.render(<Test showA={true} showB={true} />);
      });
      await act(() => {
        fragmentRef.current.focus();
      });
      expect(focusedElement).toEqual('child-a');

      // B is now the first focusable child
      await act(() => {
        root.render(<Test showA={false} showB={true} />);
      });
      await act(() => {
        fragmentRef.current.focus();
      });
      expect(focusedElement).toEqual('child-b');
    });
  });

  describe('event listeners', () => {
    // @gate enableFragmentRefs
    it('adds and removes event listeners from children', async () => {
      const parentRef = React.createRef();
      const fragmentRef = React.createRef();
      const childARef = React.createRef();
      const childBRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      let logs = [];

      function handleFragmentRefClicks() {
        logs.push('fragmentRef');
      }

      function Test() {
        React.useEffect(() => {
          fragmentRef.current.addEventListener(
            'click',
            handleFragmentRefClicks,
          );

          return () => {
            fragmentRef.current.removeEventListener(
              'click',
              handleFragmentRefClicks,
            );
          };
        }, []);
        return (
          <div ref={parentRef}>
            <React.Fragment ref={fragmentRef}>
              <div ref={childARef}>A</div>
              <div ref={childBRef}>B</div>
            </React.Fragment>
          </div>
        );
      }

      await act(() => {
        root.render(<Test />);
      });

      childARef.current.addEventListener('click', () => {
        logs.push('A');
      });

      childBRef.current.addEventListener('click', () => {
        logs.push('B');
      });

      // Clicking on the parent should not trigger any listeners
      parentRef.current.click();
      expect(logs).toEqual([]);

      // Clicking a child triggers its own listeners and the Fragment's
      childARef.current.click();
      expect(logs).toEqual(['fragmentRef', 'A']);

      logs = [];

      childBRef.current.click();
      expect(logs).toEqual(['fragmentRef', 'B']);

      logs = [];

      fragmentRef.current.removeEventListener('click', handleFragmentRefClicks);

      childARef.current.click();
      expect(logs).toEqual(['A']);

      logs = [];

      childBRef.current.click();
      expect(logs).toEqual(['B']);
    });

    // @gate enableFragmentRefs
    it('adds and removes event listeners from children with multiple fragments', async () => {
      const fragmentRef = React.createRef();
      const nestedFragmentRef = React.createRef();
      const nestedFragmentRef2 = React.createRef();
      const childARef = React.createRef();
      const childBRef = React.createRef();
      const childCRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          <div>
            <React.Fragment ref={fragmentRef}>
              <div ref={childARef}>A</div>
              <div>
                <React.Fragment ref={nestedFragmentRef}>
                  <div ref={childBRef}>B</div>
                </React.Fragment>
              </div>
              <React.Fragment ref={nestedFragmentRef2}>
                <div ref={childCRef}>C</div>
              </React.Fragment>
            </React.Fragment>
          </div>,
        );
      });

      let logs = [];

      function handleFragmentRefClicks() {
        logs.push('fragmentRef');
      }

      function handleNestedFragmentRefClicks() {
        logs.push('nestedFragmentRef');
      }

      function handleNestedFragmentRef2Clicks() {
        logs.push('nestedFragmentRef2');
      }

      fragmentRef.current.addEventListener('click', handleFragmentRefClicks);
      nestedFragmentRef.current.addEventListener(
        'click',
        handleNestedFragmentRefClicks,
      );
      nestedFragmentRef2.current.addEventListener(
        'click',
        handleNestedFragmentRef2Clicks,
      );

      childBRef.current.click();
      // Event bubbles to the parent fragment
      expect(logs).toEqual(['nestedFragmentRef', 'fragmentRef']);

      logs = [];

      childARef.current.click();
      expect(logs).toEqual(['fragmentRef']);

      logs = [];
      childCRef.current.click();
      expect(logs).toEqual(['fragmentRef', 'nestedFragmentRef2']);

      logs = [];

      fragmentRef.current.removeEventListener('click', handleFragmentRefClicks);
      nestedFragmentRef.current.removeEventListener(
        'click',
        handleNestedFragmentRefClicks,
      );
      childCRef.current.click();
      expect(logs).toEqual(['nestedFragmentRef2']);
    });

    // @gate enableFragmentRefs
    it('adds an event listener to a newly added child', async () => {
      const fragmentRef = React.createRef();
      const childRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);
      let showChild;

      function Component() {
        const [shouldShowChild, setShouldShowChild] = React.useState(false);
        showChild = () => {
          setShouldShowChild(true);
        };

        return (
          <div>
            <React.Fragment ref={fragmentRef}>
              <div id="a">A</div>
              {shouldShowChild && (
                <div ref={childRef} id="b">
                  B
                </div>
              )}
            </React.Fragment>
          </div>
        );
      }

      await act(() => {
        root.render(<Component />);
      });

      expect(fragmentRef.current).not.toBe(null);
      expect(childRef.current).toBe(null);

      let hasClicked = false;
      fragmentRef.current.addEventListener('click', () => {
        hasClicked = true;
      });

      await act(() => {
        showChild();
      });
      expect(childRef.current).not.toBe(null);

      childRef.current.click();
      expect(hasClicked).toBe(true);
    });

    // @gate enableFragmentRefs
    it('applies event listeners to host children nested within non-host children', async () => {
      const fragmentRef = React.createRef();
      const childRef = React.createRef();
      const nestedChildRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      function Wrapper({children}) {
        return children;
      }

      await act(() => {
        root.render(
          <div>
            <React.Fragment ref={fragmentRef}>
              <div ref={childRef}>Host A</div>
              <Wrapper>
                <Wrapper>
                  <Wrapper>
                    <div ref={nestedChildRef}>Host B</div>
                  </Wrapper>
                </Wrapper>
              </Wrapper>
            </React.Fragment>
          </div>,
        );
      });
      const logs = [];
      fragmentRef.current.addEventListener('click', e => {
        logs.push(e.target.textContent);
      });

      expect(logs).toEqual([]);
      childRef.current.click();
      expect(logs).toEqual(['Host A']);
      nestedChildRef.current.click();
      expect(logs).toEqual(['Host A', 'Host B']);
    });
  });
});
