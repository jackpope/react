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
let ReactDOMClient;
let Scheduler;
let Suspense;
let SuspenseList;
let waitForAll;

let originalComplete;
let originalDecode;
let loadedImages;
let failedImages;
let pendingDecodes;

// A minimal model of how browsers load images: setting src starts a request,
// decode() resolves once it has loaded (or rejects if it failed), and a new
// element for an image that already loaded is `complete` right away unless
// it uses srcset, in which case it only becomes complete asynchronously.
function installImageMocks() {
  loadedImages = new Set();
  failedImages = new Set();
  pendingDecodes = new Map();
  originalComplete = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    'complete',
  );
  originalDecode = HTMLImageElement.prototype.decode;
  Object.defineProperty(HTMLImageElement.prototype, 'complete', {
    configurable: true,
    get() {
      const src = this.getAttribute('src');
      if (failedImages.has(src)) {
        return true;
      }
      return (
        loadedImages.has(src) &&
        (!this.hasAttribute('srcset') || this.__decoded === true)
      );
    },
  });
  HTMLImageElement.prototype.decode = function () {
    const src = this.getAttribute('src');
    const img = this;
    if (loadedImages.has(src)) {
      img.__decoded = true;
      return Promise.resolve();
    }
    if (failedImages.has(src)) {
      return Promise.reject(new Error('Broken image'));
    }
    return new Promise((resolve, reject) => {
      let pending = pendingDecodes.get(src);
      if (pending === undefined) {
        pending = [];
        pendingDecodes.set(src, pending);
      }
      pending.push({
        resolve() {
          img.__decoded = true;
          resolve();
        },
        reject,
      });
    });
  };
}

function uninstallImageMocks() {
  if (originalComplete === undefined) {
    delete HTMLImageElement.prototype.complete;
  } else {
    Object.defineProperty(
      HTMLImageElement.prototype,
      'complete',
      originalComplete,
    );
  }
  if (originalDecode === undefined) {
    delete HTMLImageElement.prototype.decode;
  } else {
    HTMLImageElement.prototype.decode = originalDecode;
  }
}

function loadImage(src) {
  loadedImages.add(src);
  const pending = pendingDecodes.get(src) || [];
  pendingDecodes.delete(src);
  pending.forEach(decode => decode.resolve());
}

function failImage(src) {
  failedImages.add(src);
  const pending = pendingDecodes.get(src) || [];
  pendingDecodes.delete(src);
  pending.forEach(decode => decode.reject(new Error('Broken image')));
}

describe('ReactDOMSuspenseListImages', () => {
  let container;

  beforeEach(() => {
    jest.resetModules();
    installImageMocks();

    React = require('react');
    ReactDOMClient = require('react-dom/client');
    Scheduler = require('scheduler');
    Suspense = React.Suspense;
    if (gate(flags => flags.enableSuspenseList)) {
      SuspenseList = React.unstable_SuspenseList;
    }

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;

    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    uninstallImageMocks();
  });

  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  function Gallery({images, tail = 'visible', ...imgProps}) {
    return (
      <SuspenseList revealOrder="forwards" tail={tail}>
        {images.map(src => (
          <Suspense key={src} fallback={<Text text={`[${src}]`} />}>
            <img src={src} alt="" {...imgProps} />
          </Suspense>
        ))}
      </SuspenseList>
    );
  }

  // These tests avoid `act` because it flushes pending timers, which would
  // fire the image timeouts right away.
  function renderInTransition(root, element) {
    React.startTransition(() => {
      root.render(element);
    });
  }

  // Retries that still leave a fallback on screen are throttled, which uses a
  // timer.
  async function waitForThrottledRetry() {
    await waitForAll([]);
    jest.advanceTimersByTime(300);
    await waitForAll([]);
  }

  function revealed() {
    return Array.from(container.querySelectorAll('img'))
      .filter(img => img.style.display !== 'none')
      .map(img => img.getAttribute('src'));
  }

  // @gate enableSuspenseList && enableSuspenseyImages && enableSuspenseListImages
  it('reveals a gallery in order as its images load', async () => {
    const root = ReactDOMClient.createRoot(container);
    renderInTransition(root, <Gallery images={['a', 'b', 'c']} />);
    await waitForAll(['[a]', '[b]', '[c]']);
    expect(container.textContent).toBe('[a][b][c]');
    expect(revealed()).toEqual([]);

    loadImage('b');
    await waitForAll([]);
    expect(container.textContent).toBe('[a][b][c]');

    loadImage('a');
    await waitForThrottledRetry();
    expect(revealed()).toEqual(['a', 'b']);
    expect(container.textContent).toBe('[c]');

    loadImage('c');
    await waitForThrottledRetry();
    expect(revealed()).toEqual(['a', 'b', 'c']);
    expect(container.textContent).toBe('');
  });

  // @gate enableSuspenseList && enableSuspenseyImages && enableSuspenseListImages
  it('gives up waiting on an image after a timeout', async () => {
    const root = ReactDOMClient.createRoot(container);
    renderInTransition(root, <Gallery images={['slow', 'b']} />);
    await waitForAll(['[slow]', '[b]']);
    loadImage('b');
    await waitForAll([]);
    expect(container.textContent).toBe('[slow][b]');

    jest.advanceTimersByTime(1000);
    await waitForThrottledRetry();
    expect(revealed()).toEqual(['slow', 'b']);

    // We already waited on this image once so a new gallery that shows it
    // doesn't wait on it again.
    const container2 = document.createElement('div');
    const root2 = ReactDOMClient.createRoot(container2);
    renderInTransition(root2, <Gallery images={['slow']} />);
    await waitForAll([]);
    expect(container2.innerHTML).toBe('<img alt="" src="slow">');
  });

  // @gate enableSuspenseList && enableSuspenseyImages && enableSuspenseListImages
  it('reveals a row when its image fails to load', async () => {
    const root = ReactDOMClient.createRoot(container);
    renderInTransition(root, <Gallery images={['broken', 'b']} />);
    await waitForAll(['[broken]', '[b]']);

    loadImage('b');
    await waitForAll([]);
    expect(container.textContent).toBe('[broken][b]');

    failImage('broken');
    await waitForThrottledRetry();
    expect(revealed()).toEqual(['broken', 'b']);
  });

  // @gate enableSuspenseList && enableSuspenseyImages && enableSuspenseListImages
  it('does not keep waiting on a loaded srcset image', async () => {
    const root = ReactDOMClient.createRoot(container);
    renderInTransition(
      root,
      <Gallery images={['a', 'b']} srcSet="large.jpg 2x" />,
    );
    await waitForAll(['[a]', '[b]']);

    // The retry creates a new <img> that isn't complete synchronously because
    // it uses srcset. It should still reveal instead of falling back again.
    loadImage('a');
    loadImage('b');
    await waitForThrottledRetry();
    expect(revealed()).toEqual(['a', 'b']);
  });

  // @gate enableSuspenseList && enableSuspenseyImages && enableSuspenseListImages
  it('does not wait on images that opt out with loading="lazy"', async () => {
    const root = ReactDOMClient.createRoot(container);
    renderInTransition(
      root,
      <SuspenseList revealOrder="forwards" tail="visible">
        <Suspense fallback={<Text text="[a]" />}>
          <img src="a" alt="" />
        </Suspense>
        <Suspense fallback={<Text text="[lazy]" />}>
          <img src="lazy" alt="" loading="lazy" />
        </Suspense>
      </SuspenseList>,
    );
    await waitForAll(['[a]', '[lazy]']);

    // The lazy image never loads, but it doesn't hold back its row.
    loadImage('a');
    await waitForThrottledRetry();
    expect(revealed()).toEqual(['a', 'lazy']);
  });
});
