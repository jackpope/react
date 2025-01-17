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
});
