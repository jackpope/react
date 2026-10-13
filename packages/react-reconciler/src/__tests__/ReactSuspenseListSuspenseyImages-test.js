/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

'use strict';

let React;
let ReactNoop;
let Scheduler;
let Suspense;
let SuspenseList;
let startTransition;
let use;
let act;
let assertLog;
let resolveSuspenseyThing;

describe('ReactSuspenseListSuspenseyImages', () => {
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    Suspense = React.Suspense;
    if (gate(flags => flags.enableSuspenseList)) {
      SuspenseList = React.unstable_SuspenseList;
    }
    startTransition = React.startTransition;
    use = React.use;
    resolveSuspenseyThing = ReactNoop.resolveSuspenseyThing;

    const InternalTestUtils = require('internal-test-utils');
    act = InternalTestUtils.act;
    assertLog = InternalTestUtils.assertLog;
  });

  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  function Image({src}) {
    return (
      <suspensey-thing
        src={src}
        onLoadStart={() => Scheduler.log(`Image requested [${src}]`)}
      />
    );
  }

  function Row({id, srcs}) {
    return (
      <Suspense fallback={<Text text={`Loading ${id}`} />}>
        {(srcs || [id]).map(src => (
          <Image key={src} src={src} />
        ))}
      </Suspense>
    );
  }

  function img(src) {
    return <suspensey-thing src={src} />;
  }

  function renderInTransition(root, element) {
    return act(() => {
      startTransition(() => {
        root.render(element);
      });
    });
  }

  // @gate enableSuspenseList && enableSuspenseyImages && enableSuspenseListImages
  it('reveals rows in order as their images load', async () => {
    const root = ReactNoop.createRoot();
    await renderInTransition(
      root,
      <SuspenseList revealOrder="forwards" tail="visible">
        <Row id="A" />
        <Row id="B" />
        <Row id="C" />
      </SuspenseList>,
    );
    // Every row renders its content first, so all images are requested in the
    // first render, before falling back.
    assertLog([
      'Image requested [A]',
      'Loading A',
      'Image requested [B]',
      'Loading B',
      'Image requested [C]',
      'Loading C',
    ]);
    expect(root).toMatchRenderedOutput('Loading ALoading BLoading C');

    await act(() => resolveSuspenseyThing('A'));
    expect(root).toMatchRenderedOutput(
      <>
        {img('A')}
        {'Loading B'}
        {'Loading C'}
      </>,
    );

    await act(() => resolveSuspenseyThing('B'));
    expect(root).toMatchRenderedOutput(
      <>
        {img('A')}
        {img('B')}
        {'Loading C'}
      </>,
    );

    await act(() => resolveSuspenseyThing('C'));
    expect(root).toMatchRenderedOutput(
      <>
        {img('A')}
        {img('B')}
        {img('C')}
      </>,
    );
  });

  // @gate enableSuspenseList && enableSuspenseyImages && enableSuspenseListImages
  it('waits for earlier rows when later images load first', async () => {
    const root = ReactNoop.createRoot();
    await renderInTransition(
      root,
      <SuspenseList revealOrder="forwards" tail="visible">
        <Row id="A" />
        <Row id="B" />
        <Row id="C" />
      </SuspenseList>,
    );
    assertLog([
      'Image requested [A]',
      'Loading A',
      'Image requested [B]',
      'Loading B',
      'Image requested [C]',
      'Loading C',
    ]);

    await act(() => resolveSuspenseyThing('C'));
    expect(root).toMatchRenderedOutput('Loading ALoading BLoading C');

    await act(() => resolveSuspenseyThing('B'));
    expect(root).toMatchRenderedOutput('Loading ALoading BLoading C');

    // Once the first row is ready, everything that's ready after it reveals in
    // the same commit.
    await act(() => resolveSuspenseyThing('A'));
    expect(root).toMatchRenderedOutput(
      <>
        {img('A')}
        {img('B')}
        {img('C')}
      </>,
    );
  });

  // @gate enableSuspenseList && enableSuspenseyImages && enableSuspenseListImages
  it('requests every image in a row and waits for all of them', async () => {
    const root = ReactNoop.createRoot();
    await renderInTransition(
      root,
      <SuspenseList revealOrder="forwards" tail="visible">
        <Row id="1" srcs={['A1', 'A2']} />
        <Row id="2" srcs={['B1']} />
      </SuspenseList>,
    );
    assertLog([
      'Image requested [A1]',
      'Image requested [A2]',
      'Loading 1',
      'Image requested [B1]',
      'Loading 2',
    ]);

    await act(() => resolveSuspenseyThing('A1'));
    expect(root).toMatchRenderedOutput('Loading 1Loading 2');

    await act(() => resolveSuspenseyThing('B1'));
    expect(root).toMatchRenderedOutput('Loading 1Loading 2');

    await act(() => resolveSuspenseyThing('A2'));
    expect(root).toMatchRenderedOutput(
      <>
        {img('A1')}
        {img('A2')}
        {img('B1')}
      </>,
    );
  });

  // @gate enableSuspenseList && enableSuspenseyImages && enableSuspenseListImages
  it('reveals all rows together once every image has loaded', async () => {
    const root = ReactNoop.createRoot();
    await renderInTransition(
      root,
      <SuspenseList revealOrder="together">
        <Row id="A" />
        <Row id="B" />
      </SuspenseList>,
    );
    assertLog([
      'Image requested [A]',
      'Loading A',
      'Image requested [B]',
      'Loading B',
      // Second pass to force every row into its fallback.
      'Loading A',
      'Loading B',
    ]);
    expect(root).toMatchRenderedOutput('Loading ALoading B');

    await act(() => resolveSuspenseyThing('A'));
    expect(root).toMatchRenderedOutput('Loading ALoading B');

    await act(() => resolveSuspenseyThing('B'));
    expect(root).toMatchRenderedOutput(
      <>
        {img('A')}
        {img('B')}
      </>,
    );
  });

  // @gate enableSuspenseList && enableSuspenseyImages && enableSuspenseListImages
  it('reveals rows from the end with revealOrder="backwards"', async () => {
    const root = ReactNoop.createRoot();
    await renderInTransition(
      root,
      <SuspenseList revealOrder="backwards" tail="visible">
        <Row id="C" />
        <Row id="B" />
        <Row id="A" />
      </SuspenseList>,
    );
    assertLog([
      'Image requested [C]',
      'Loading C',
      'Image requested [B]',
      'Loading B',
      'Image requested [A]',
      'Loading A',
    ]);
    expect(root).toMatchRenderedOutput('Loading ALoading BLoading C');

    await act(() => resolveSuspenseyThing('A'));
    expect(root).toMatchRenderedOutput('Loading ALoading BLoading C');

    await act(() => resolveSuspenseyThing('C'));
    expect(root).toMatchRenderedOutput(
      <>
        {'Loading A'}
        {'Loading B'}
        {img('C')}
      </>,
    );

    await act(() => resolveSuspenseyThing('B'));
    expect(root).toMatchRenderedOutput(
      <>
        {img('A')}
        {img('B')}
        {img('C')}
      </>,
    );
  });

  // @gate enableSuspenseList && enableSuspenseyImages && enableSuspenseListImages
  it('only shows one fallback with tail="collapsed"', async () => {
    const root = ReactNoop.createRoot();
    await renderInTransition(
      root,
      <SuspenseList revealOrder="forwards" tail="collapsed">
        <Row id="A" />
        <Row id="B" />
        <Row id="C" />
      </SuspenseList>,
    );
    // Rows after the collapsed fallback aren't rendered at all, so their images
    // aren't requested until the list gets to them.
    assertLog(['Image requested [A]', 'Loading A']);
    expect(root).toMatchRenderedOutput('Loading A');

    await act(() => resolveSuspenseyThing('A'));
    assertLog(['Image requested [B]', 'Loading B']);
    expect(root).toMatchRenderedOutput(
      <>
        {img('A')}
        {'Loading B'}
      </>,
    );

    await act(() => resolveSuspenseyThing('B'));
    assertLog(['Image requested [C]', 'Loading C']);
    expect(root).toMatchRenderedOutput(
      <>
        {img('A')}
        {img('B')}
        {'Loading C'}
      </>,
    );

    await act(() => resolveSuspenseyThing('C'));
    expect(root).toMatchRenderedOutput(
      <>
        {img('A')}
        {img('B')}
        {img('C')}
      </>,
    );
  });

  // @gate enableSuspenseList && enableSuspenseyImages && enableSuspenseListImages
  it('hides rows until they are ready with tail="hidden"', async () => {
    const root = ReactNoop.createRoot();
    await renderInTransition(
      root,
      <SuspenseList revealOrder="forwards" tail="hidden">
        <Row id="A" />
        <Row id="B" />
      </SuspenseList>,
    );
    assertLog(['Image requested [A]', 'Loading A']);
    expect(root).toMatchRenderedOutput(null);

    await act(() => resolveSuspenseyThing('A'));
    assertLog(['Image requested [B]', 'Loading B']);
    expect(root).toMatchRenderedOutput(img('A'));

    await act(() => resolveSuspenseyThing('B'));
    expect(root).toMatchRenderedOutput(
      <>
        {img('A')}
        {img('B')}
      </>,
    );
  });

  // @gate enableSuspenseList && enableSuspenseyImages && enableSuspenseListImages
  it('keeps a revealed row on screen when its image changes', async () => {
    function App({second}) {
      return (
        <SuspenseList revealOrder="forwards" tail="visible">
          <Row id="A" />
          <Row id="B" srcs={[second]} />
        </SuspenseList>
      );
    }
    resolveSuspenseyThing('A');
    resolveSuspenseyThing('B');
    const root = ReactNoop.createRoot();
    await renderInTransition(root, <App second="B" />);
    expect(root).toMatchRenderedOutput(
      <>
        {img('A')}
        {img('B')}
      </>,
    );

    // The row is already showing content, so the transition waits for the new
    // image instead of going back to the fallback.
    await renderInTransition(root, <App second="B2" />);
    assertLog(['Image requested [B2]']);
    expect(root).toMatchRenderedOutput(
      <>
        {img('A')}
        {img('B')}
      </>,
    );

    await act(() => resolveSuspenseyThing('B2'));
    expect(root).toMatchRenderedOutput(
      <>
        {img('A')}
        {img('B2')}
      </>,
    );
  });

  // @gate enableSuspenseList && enableSuspenseyImages && enableSuspenseListImages
  it('waits for the images of a row that is added to a revealed list', async () => {
    function App({rows}) {
      return (
        <SuspenseList revealOrder="forwards" tail="visible">
          {rows.map(id => (
            <Row key={id} id={id} />
          ))}
        </SuspenseList>
      );
    }
    resolveSuspenseyThing('A');
    const root = ReactNoop.createRoot();
    await renderInTransition(root, <App rows={['A']} />);
    expect(root).toMatchRenderedOutput(img('A'));

    await renderInTransition(root, <App rows={['A', 'B', 'C']} />);
    assertLog([
      'Image requested [B]',
      'Loading B',
      'Image requested [C]',
      'Loading C',
    ]);
    expect(root).toMatchRenderedOutput(
      <>
        {img('A')}
        {'Loading B'}
        {'Loading C'}
      </>,
    );

    await act(() => resolveSuspenseyThing('C'));
    expect(root).toMatchRenderedOutput(
      <>
        {img('A')}
        {'Loading B'}
        {'Loading C'}
      </>,
    );

    await act(() => resolveSuspenseyThing('B'));
    expect(root).toMatchRenderedOutput(
      <>
        {img('A')}
        {img('B')}
        {img('C')}
      </>,
    );
  });

  // @gate enableSuspenseList && enableSuspenseyImages && enableSuspenseListImages
  it('lets nested boundaries of a revealed row wait on their own images', async () => {
    const root = ReactNoop.createRoot();
    await renderInTransition(
      root,
      <SuspenseList revealOrder="forwards" tail="visible">
        <Suspense fallback={<Text text="Loading A" />}>
          <Text text="Title A" />
          <Suspense fallback={<Text text="Loading A image" />}>
            <Image src="A" />
          </Suspense>
        </Suspense>
        <Row id="B" />
      </SuspenseList>,
    );
    assertLog([
      'Title A',
      'Image requested [A]',
      'Loading A image',
      'Image requested [B]',
      'Loading B',
    ]);
    // The first row's own boundary can reveal. Like with data, a nested
    // boundary inside a revealed row doesn't hold back the rest of the list,
    // but it still waits for its image instead of committing it unloaded.
    expect(root).toMatchRenderedOutput('Title ALoading A imageLoading B');

    await act(() => resolveSuspenseyThing('B'));
    expect(root).toMatchRenderedOutput(
      <>
        {'Title A'}
        {'Loading A image'}
        {img('B')}
      </>,
    );

    await act(() => resolveSuspenseyThing('A'));
    expect(root).toMatchRenderedOutput(
      <>
        {'Title A'}
        {img('A')}
        {img('B')}
      </>,
    );
  });

  // @gate enableSuspenseList && enableSuspenseyImages && enableSuspenseListImages
  it('does not coordinate rows with revealOrder="independent"', async () => {
    const root = ReactNoop.createRoot();
    await renderInTransition(
      root,
      <SuspenseList revealOrder="independent">
        <Row id="A" />
        <Row id="B" />
      </SuspenseList>,
    );
    assertLog([
      'Image requested [A]',
      'Loading A',
      'Image requested [B]',
      'Loading B',
    ]);
    expect(root).toMatchRenderedOutput('Loading ALoading B');

    // Without a coordinating list, the retry of both boundaries suspends its
    // commit until every image in it has loaded.
    await act(() => resolveSuspenseyThing('B'));
    expect(root).toMatchRenderedOutput('Loading ALoading B');

    await act(() => resolveSuspenseyThing('A'));
    expect(root).toMatchRenderedOutput(
      <>
        {img('A')}
        {img('B')}
      </>,
    );
  });

  // @gate enableSuspenseList && enableSuspenseyImages && enableSuspenseListImages
  it('does not prerender later rows when a row is waiting on data', async () => {
    let resolveData;
    const data = new Promise(resolve => {
      resolveData = resolve;
    });
    function Data() {
      const text = use(data);
      return <Text text={text} />;
    }
    const root = ReactNoop.createRoot();
    await renderInTransition(
      root,
      <SuspenseList revealOrder="forwards" tail="visible">
        <Suspense fallback={<Text text="Loading A" />}>
          <Data />
        </Suspense>
        <Row id="B" />
      </SuspenseList>,
    );
    // The first row is waiting on data, not on images, so later rows keep the
    // existing behavior and aren't rendered yet.
    assertLog(['Loading A', 'Loading B']);
    expect(root).toMatchRenderedOutput('Loading ALoading B');

    await act(() => resolveData('A'));
    assertLog(['A', 'Image requested [B]']);
    expect(root).toMatchRenderedOutput('ALoading B');

    await act(() => resolveSuspenseyThing('B'));
    expect(root).toMatchRenderedOutput(
      <>
        {'A'}
        {img('B')}
      </>,
    );
  });
});
