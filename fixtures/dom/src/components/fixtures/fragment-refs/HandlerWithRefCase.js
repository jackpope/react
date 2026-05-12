import TestCase from '../../TestCase';
import Fixture from '../../Fixture';

const React = window.React;
const {Fragment, useRef, useState} = React;

export default function HandlerWithRefCase() {
  const fragmentRef = useRef(null);
  const [eventLog, setEventLog] = useState([]);

  const log = msg => setEventLog(prev => [...prev, msg]);
  const clear = () => setEventLog([]);

  return (
    <TestCase title="Handlers with Ref">
      <TestCase.Steps>
        <li>Click "Child" — observe both the onClick handler and the ref-based addEventListener fire</li>
        <li>Click "Focus via ref" to use the FragmentInstance.focus() method</li>
        <li>
          Verify that onX props and ref-based addEventListener coexist correctly
        </li>
      </TestCase.Steps>

      <TestCase.ExpectedResult>
        <p>
          A Fragment can have both onX handler props and a ref simultaneously.
          The onX handler participates in synthetic event dispatch (bubble
          phase). The ref provides access to the FragmentInstance for imperative
          methods (focus, addEventListener, etc.). The addEventListener handler
          fires during native DOM bubbling (before synthetic events).
        </p>
      </TestCase.ExpectedResult>

      <Fixture>
        <Fixture.Controls>
          <button onClick={clear}>Clear log</button>
          <button
            onClick={() => {
              if (fragmentRef.current) {
                fragmentRef.current.focus();
                log('Called fragmentRef.current.focus()');
              }
            }}
            style={{marginLeft: '8px'}}>
            Focus via ref
          </button>
          <button
            onClick={() => {
              if (fragmentRef.current) {
                fragmentRef.current.addEventListener('click', () => {
                  log('Ref addEventListener handler fired');
                });
                log('Added click listener via ref');
              }
            }}
            style={{marginLeft: '8px'}}>
            Add listener via ref
          </button>
        </Fixture.Controls>
        <div
          style={{
            padding: '12px',
            border: '2px solid #999',
            borderRadius: '4px',
          }}>
          <Fragment
            ref={fragmentRef}
            onClick={() => log('Fragment onClick prop handler')}>
            <button
              onClick={() => log('Child button onClick')}
              style={{margin: '4px', padding: '8px 16px'}}>
              Child
            </button>
            <input
              type="text"
              placeholder="Focusable input"
              style={{margin: '4px', padding: '6px'}}
            />
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
