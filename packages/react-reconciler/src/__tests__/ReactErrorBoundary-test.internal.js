let React;
let ReactDOMClient;
let ReactDOM;
let Scheduler;
let ErrorBoundary;
let act;
let textCache;
let container;

let assertLog;
let waitForPaint;
let waitForAll;
let waitFor;

describe('ReactErrorBoundary', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
    Scheduler = require('scheduler');
    container = document.createElement('div');

    ErrorBoundary = React.ErrorBoundary;

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    waitForPaint = InternalTestUtils.waitForPaint;
    assertLog = InternalTestUtils.assertLog;
    waitFor = InternalTestUtils.waitFor;
  });

  function ChildThatThrows({shouldThrow}) {
    if (shouldThrow) {
      console.log('throwing!');
      throw new Error('Could not render child');
    }

    return <div>Child A</div>;
  }

  it('catches errors and runs onError', async () => {
    class ClassErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = {hasError: false};
      }

      static getDerivedStateFromError(error) {
        return {hasError: true};
      }

      render() {
        if (this.state.hasError) {
          // You can render any custom fallback UI
          return this.props.fallback;
        }

        return this.props.children;
      }
    }
    const handleError = jest.fn();
    function App({shouldThrow}) {
      return (
        <ErrorBoundary fallback={<div>FALLBACK</div>} onError={handleError}>
          <ChildThatThrows shouldThrow={shouldThrow} />
        </ErrorBoundary>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App shouldThrow={false} />);
    });

    expect(container.innerHTML).toEqual('<div>Child A</div>');
    expect(handleError).not.toHaveBeenCalled();

    await act(() => {
      root.render(<App shouldThrow={true} />);
    });

    expect(container.innerHTML).toEqual('<div>FALLBACK</div>');
    expect(handleError).toHaveBeenCalled();
  });
});
