let React;
let ReactNoopRenderer;
let Scheduler;
let act;
let useTransition;
let useState;
let useOptimistic;
let textCache;

describe('ReactAsyncActions', () => {
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoopRenderer = require('react-noop-renderer');
    act = require('internal-test-utils').act;
    useTransition = React.useTransition;
    useState = React.useState;
    useOptimistic = React.useOptimistic;

    textCache = new Map();
  });

  function resolveText(text) {
    const record = textCache.get(text);
    if (record === undefined) {
      const newRecord = {
        status: 'resolved',
        value: text,
      };
      textCache.set(text, newRecord);
    } else if (record.status === 'pending') {
      const thenable = record.value;
      record.status = 'resolved';
      record.value = text;
      thenable.pings.forEach(t => t());
    }
  }

  function readText(text) {
    const record = textCache.get(text);
    if (record !== undefined) {
      switch (record.status) {
        case 'pending':
          throw record.value;
        case 'rejected':
          throw record.value;
        case 'resolved':
          return record.value;
      }
    } else {
      const thenable = {
        pings: [],
        then(resolve) {
          if (newRecord.status === 'pending') {
            thenable.pings.push(resolve);
          } else {
            Promise.resolve().then(() => resolve(newRecord.value));
          }
        },
      };

      const newRecord = {
        status: 'pending',
        value: thenable,
      };
      textCache.set(text, newRecord);

      throw thenable;
    }
  }

  function getText(text) {
    const record = textCache.get(text);
    if (record === undefined) {
      const thenable = {
        pings: [],
        then(resolve) {
          if (newRecord.status === 'pending') {
            thenable.pings.push(resolve);
          } else {
            Promise.resolve().then(() => resolve(newRecord.value));
          }
        },
      };
      const newRecord = {
        status: 'pending',
        value: thenable,
      };
      textCache.set(text, newRecord);
      return thenable;
    } else {
      switch (record.status) {
        case 'pending':
          return record.value;
        case 'rejected':
          return Promise.reject(record.value);
        case 'resolved':
          return Promise.resolve(record.value);
      }
    }
  }

  function Text({text}) {
    return text;
  }

  function AsyncText({text}) {
    readText(text);
    return text;
  }

  // @gate enableAsyncActions
  it.only('isPending remains true until async action finishes', async () => {
    let startTransition;
    function App() {
      const [isPending, _start] = useTransition();
      startTransition = _start;
      return <Text text={'Pending: ' + isPending} />;
    }

    const root = ReactNoopRenderer.createRoot();
    await act(() => {
      root.render(<App />);
    });
    expect(root).toMatchRenderedOutput('Pending: false');

    // At the start of an async action, isPending is set to true.
    await act(() => {
      startTransition(async () => {
        await getText('Wait');
      });
    });
    expect(root).toMatchRenderedOutput('Pending: true');

    // Once the action finishes, isPending is set back to false.
    await React.act(() => resolveText('Wait'));
    expect(root).toMatchRenderedOutput('Pending: false');
  });
});
