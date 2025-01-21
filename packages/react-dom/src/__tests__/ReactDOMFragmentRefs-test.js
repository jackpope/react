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
  });

  // @gate enableFragmentRefs
  it('Attaches a ref to Fragment', async () => {
    const fragmentRef = React.createRef();
    const childRef = React.createRef();
    const root = ReactDOMClient.createRoot(container);

    await act(() =>
      root.render(
        <div id="parent">
          <React.Fragment ref={fragmentRef}>
            <div ref={childRef} id="child">
              Hi
            </div>
          </React.Fragment>
        </div>,
      ),
    );
    expect(container.innerHTML).toEqual(
      '<div id="parent"><div id="child">Hi</div></div>',
    );

    expect(childRef.current).not.toBe(null);
    expect(fragmentRef.current).not.toBe(null);
  });

  describe('event listeners', () => {
    // @gate enableFragmentRefs
    it('adds and removes event listeners from children', async () => {
      const parentRef = React.createRef();
      const fragmentRef = React.createRef();
      const childARef = React.createRef();
      const childBRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          <div ref={parentRef}>
            <React.Fragment ref={fragmentRef}>
              <div ref={childARef}>A</div>
              <div ref={childBRef}>B</div>
            </React.Fragment>
          </div>,
        );
      });

      let hasClicked = false;
      let hasClickedA = false;
      let hasClickedB = false;

      function handleFragmentRefClicks() {
        hasClicked = true;
      }

      fragmentRef.current.addEventListener('click', handleFragmentRefClicks);

      childARef.current.addEventListener('click', () => {
        hasClickedA = true;
      });

      childBRef.current.addEventListener('click', () => {
        hasClickedB = true;
      });

      // Clicking on the parent should not trigger any listeners
      parentRef.current.click();
      expect(hasClicked).toBe(false);
      expect(hasClickedA).toBe(false);
      expect(hasClickedB).toBe(false);

      hasClicked = false;

      // Clicking a child triggers its own listeners and the Fragment's
      childARef.current.click();
      expect(hasClicked).toBe(true);
      expect(hasClickedA).toBe(true);
      expect(hasClickedB).toBe(false);

      hasClicked = false;

      childBRef.current.click();
      expect(hasClicked).toBe(true);
      expect(hasClickedA).toBe(true);
      expect(hasClickedB).toBe(true);

      // Reset values and remove listeners
      hasClicked = false;
      hasClickedA = false;
      hasClickedB = false;

      fragmentRef.current.removeEventListener('click', handleFragmentRefClicks);

      childARef.current.click();
      expect(hasClicked).toBe(false);
      expect(hasClickedA).toBe(true);
      expect(hasClickedB).toBe(false);

      childBRef.current.click();
      expect(hasClicked).toBe(false);
      expect(hasClickedA).toBe(true);
      expect(hasClickedB).toBe(true);
    });

    // @gate enableFragmentRefs
    it('adds and removes event listeners from children with multiple fragments', async () => {
      const fragmentRef = React.createRef();
      const nestedFragmentRef = React.createRef();
      const childARef = React.createRef();
      const childBRef = React.createRef();
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
            </React.Fragment>
          </div>,
        );
      });

      let hasClicked = false;
      let hasClickedNested = false;

      function handleFragmentRefClicks() {
        hasClicked = true;
      }

      function handleNestedFragmentRefClicks() {
        hasClickedNested = true;
      }

      fragmentRef.current.addEventListener('click', handleFragmentRefClicks);
      nestedFragmentRef.current.addEventListener(
        'click',
        handleNestedFragmentRefClicks,
      );

      childBRef.current.click();
      expect(hasClickedNested).toBe(true);
      expect(hasClicked).toBe(true);

      hasClickedNested = false;
      hasClicked = false;

      childARef.current.click();
      expect(hasClicked).toBe(true);
      expect(hasClickedNested).toBe(false);

      hasClicked = false;

      fragmentRef.current.removeEventListener('click', handleFragmentRefClicks);
      nestedFragmentRef.current.removeEventListener(
        'click',
        handleNestedFragmentRefClicks,
      );
      childBRef.current.click();
      expect(hasClicked).toBe(false);
      expect(hasClickedNested).toBe(false);
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
  });
});
