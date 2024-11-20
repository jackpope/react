/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React;
let Scheduler;
let ReactDOMClient;
let act;
let assertLog;
let container;

describe('FragmentRefs', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    Scheduler = require('scheduler');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
    assertLog = require('internal-test-utils').assertLog;
    container = document.createElement('div');
  });

  it('injects the custom element if a ref is provided', async () => {
    const fragmentRef = React.createRef();
    const root = ReactDOMClient.createRoot(container);

    await act(() =>
      root.render(
        <div>
          <React.Fragment ref={fragmentRef}>
            <div>Hi</div>
          </React.Fragment>
        </div>,
      ),
    );
    expect(container.innerHTML).toEqual(
      '<div><react-virtual><div>Hi</div></react-virtual></div>',
    );

    // TODO: Figure out why using a fragment as the root doesn't work
    // await act(() => {
    //   root.render(
    //     <React.Fragment ref={fragmentRef}>
    //       <div>Hi</div>
    //     </React.Fragment>,
    //   );
    // });
    // expect(container.innerHTML).toEqual(
    //   '<react-virtual><div>Hi</div></react-virtual>',
    // );

    expect(fragmentRef.current).not.toBe(null);
    expect(fragmentRef.current.tagName).toBe('REACT-VIRTUAL');
  });

  it('does not inject the custom element if no ref is provided', async () => {
    const root = ReactDOMClient.createRoot(container);

    await act(() =>
      root.render(
        <div>
          <React.Fragment>
            <div>Hi</div>
          </React.Fragment>
        </div>,
      ),
    );
    expect(container.innerHTML).toEqual('<div><div>Hi</div></div>');

    // TODO: Figure out why using a fragment as the root doesn't work
    // await act(() => {
    //   root.render(
    //     <React.Fragment>
    //       <div>Hi</div>
    //     </React.Fragment>,
    //   );
    // });
    // expect(container.innerHTML).toEqual('<div><div>Hi</div></div>');
  });

  it('Attaches a ref to Fragment', async () => {
    const fragmentRef = React.createRef();
    const childRef = React.createRef();
    const root = ReactDOMClient.createRoot(container);

    await act(() =>
      root.render(
        <div>
          <React.Fragment ref={fragmentRef}>
            <div ref={childRef}>Hi</div>
          </React.Fragment>
        </div>,
      ),
    );
    expect(container.innerHTML).toEqual(
      '<div><react-virtual><div>Hi</div></react-virtual></div>',
    );

    expect(childRef.current).not.toBe(null);
    expect(fragmentRef.current).not.toBe(null);
    expect(fragmentRef.current.tagName).toBe('REACT-VIRTUAL');
  });

  it('Adds and removes event listeners to children', async () => {
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
    expect(container.innerHTML).toEqual(
      '<div><react-virtual><div>A</div><div>B</div></react-virtual></div>',
    );

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

    // Clicking a child triggers its own listeners and the Fragment's
    childARef.current.click();
    expect(hasClicked).toBe(true);
    expect(hasClickedA).toBe(true);
    expect(hasClickedB).toBe(false);
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

  it('handles event dispatches', async () => {
    const parentRef = React.createRef();
    const fragmentRef = React.createRef();
    const childRef = React.createRef();
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(
        <div ref={parentRef}>
          <React.Fragment ref={fragmentRef}>
            <div ref={childRef}>Hi</div>
          </React.Fragment>
        </div>,
      );
    });

    let parentClicked = false;
    parentRef.current.addEventListener('click', () => {
      parentClicked = true;
    });

    fragmentRef.current.click();
    expect(parentClicked).toBe(true);
  });

  it('handles getClientRects', async () => {
    const fragmentRef = React.createRef();
    const childARef = React.createRef();
    const childBRef = React.createRef();
    const childCRef = React.createRef();
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(
        // TODO: Figure out why using a fragment as the root doesn't work
        <div>
          <React.Fragment ref={fragmentRef}>
            <div ref={childARef}>A</div>
            <div ref={childBRef}>B</div>
            <div ref={childCRef}>C</div>
          </React.Fragment>
        </div>,
      );
    });

    expect(container.innerHTML).toEqual(
      '<div><react-virtual><div>A</div><div>B</div><div>C</div></react-virtual></div>',
    );

    console.log('count', fragmentRef.current.children.length);

    // Mock rects of children
    const childARect = {
      x: 1,
      y: 1,
      width: 10,
      height: 10,
    };
    childARef.current.getClientRects = () => [childARect];
    const childBRect = {
      x: 2,
      y: 2,
      width: 20,
      height: 20,
    };
    childBRef.current.getClientRects = () => [childBRect];
    const childCRect = {
      x: 3,
      y: 3,
      width: 30,
      height: 30,
    };
    const childCRect2 = {
      x: 4,
      y: 4,
      width: 40,
      height: 40,
    };
    childCRef.current.getClientRects = () => [childCRect, childCRect2];

    const rects = fragmentRef.current.getClientRects();
    expect(rects).toEqual([childARect, childBRect, childCRect, childCRect2]);
  });

  it('forwards getRootNode to parent', async () => {
    const parentRef = React.createRef();
    const fragmentRef = React.createRef();
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(
        <div ref={parentRef}>
          <React.Fragment ref={fragmentRef}>
            <div>Hi</div>
          </React.Fragment>
        </div>,
      );
    });

    const spy = jest.spyOn(parentRef.current, 'getRootNode');
    fragmentRef.current.getRootNode();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(fragmentRef.current.getRootNode()).toBe(
      parentRef.current.getRootNode(),
    );
  });
});
