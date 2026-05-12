import TestCase from '../../TestCase';
import Fixture from '../../Fixture';

const React = window.React;
const {Fragment, useState} = React;

export default function OnSubmitCase() {
  const [eventLog, setEventLog] = useState([]);

  const log = msg => setEventLog(prev => [...prev, msg]);
  const clear = () => setEventLog([]);

  return (
    <TestCase title="onSubmit / onReset / onInput / onSelect">
      <TestCase.Steps>
        <li>Type in the input — observe onInput fires on Fragment</li>
        <li>Select text in the input — observe onSelect fires</li>
        <li>Click Submit — observe onSubmit fires on Fragment</li>
        <li>Click Reset — observe onReset fires on Fragment</li>
      </TestCase.Steps>

      <TestCase.ExpectedResult>
        <p>
          Form events bubble through Fragments. A Fragment wrapping form
          elements can observe submissions, resets, input changes, and selection
          events from any of its children.
        </p>
      </TestCase.ExpectedResult>

      <Fixture>
        <Fixture.Controls>
          <button onClick={clear}>Clear log</button>
        </Fixture.Controls>
        <div
          style={{
            padding: '12px',
            border: '2px solid #999',
            borderRadius: '4px',
          }}>
          <Fragment
            onSubmit={e => {
              e.preventDefault();
              log('Fragment onSubmit');
            }}
            onReset={() => log('Fragment onReset')}
            onInput={e => log(`Fragment onInput: "${e.target.value}"`)}
            onSelect={() => log('Fragment onSelect')}>
            <form
              onSubmit={e => {
                e.preventDefault();
                log('Form onSubmit');
              }}
              onReset={() => log('Form onReset')}
              style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
              <input
                type="text"
                placeholder="Type or select text..."
                onInput={e => log(`Input onInput: "${e.target.value}"`)}
                onSelect={() => log('Input onSelect')}
                style={{padding: '6px'}}
              />
              <button type="submit">Submit</button>
              <button type="reset">Reset</button>
            </form>
          </Fragment>
        </div>

        <EventLog entries={eventLog} />
      </Fixture>
    </TestCase>
  );
}

function EventLog({entries}) {
  if (entries.length === 0) return null;
  return (
    <div
      style={{
        marginTop: '12px',
        padding: '10px',
        backgroundColor: '#f5f5f5',
        border: '1px solid #ddd',
        borderRadius: '4px',
        maxHeight: '150px',
        overflow: 'auto',
        fontFamily: 'monospace',
        fontSize: '13px',
      }}>
      <strong>Event Log:</strong>
      <ul style={{margin: '5px 0', paddingLeft: '20px'}}>
        {entries.map((msg, i) => (
          <li key={i}>{msg}</li>
        ))}
      </ul>
    </div>
  );
}
