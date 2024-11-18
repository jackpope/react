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

  it.only('takes a ref for the child host component', async () => {
    const fragmentRef = React.createRef();
    const childRef = React.createRef();
    const root = ReactDOMClient.createRoot(container);

    await act(() =>
      root.render(
        <React.Fragment ref={fragmentRef}>
          <div ref={childRef}>Hi</div>
        </React.Fragment>,
      ),
    );
    expect(container.innerHTML).toEqual('<div>Hi</div>');

    expect(childRef.current).not.toBe(null);
    expect(fragmentRef.current).not.toBe(null);
    expect(fragmentRef.current.tagName).toBe('REACT-VIRTUAL');

    let hasClicked = false;
    fragmentRef.current.addEventListener('click', () => {
      hasClicked = true;
    });

    childRef.current.click();
    expect(hasClicked).toBe(true);
  });
});
