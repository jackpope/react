import TestCase from '../../TestCase';
import Fixture from '../../Fixture';

const React = window.React;
const {Fragment, useState} = React;

function StopPropagationBoundary({children, onStopped}) {
  return (
    <Fragment
      onClick={e => {
        e.stopPropagation();
        onStopped();
      }}>
      {children}
    </Fragment>
  );
}

export default function StopPropagationCase() {
  const [eventLog, setEventLog] = useState([]);

  const log = msg => setEventLog(prev => [...prev, msg]);
  const clear = () => setEventLog([]);

  return (
    <TestCase title="stopPropagation Boundary">
      <TestCase.Steps>
        <li>Click "Inside boundary" — child handler fires, Fragment stops propagation, parent does NOT fire</li>
        <li>Click "Outside boundary" — only the parent handler fires</li>
      </TestCase.Steps>

      <TestCase.ExpectedResult>
        <p>
          A Fragment with onClick that calls e.stopPropagation() acts as an
          event boundary. Child handlers still fire (they bubble up to the
          Fragment), but the event does not propagate past the Fragment to the
          parent. This is the key composability improvement over
          addEventListener — with native listeners, stopPropagation fires before
          children rather than after.
        </p>
      </TestCase.ExpectedResult>

      <Fixture>
        <Fixture.Controls>
          <button onClick={clear}>Clear log</button>
        </Fixture.Controls>
        <div
          onClick={() => log('Parent div onClick — should NOT fire for boundary clicks')}
          style={{
            padding: '12px',
            border: '2px solid #999',
            borderRadius: '4px',
          }}>
          <span style={{fontSize: '12px', color: '#666'}}>
            Parent div (has onClick)
          </span>
          <div style={{display: 'flex', gap: '12px', marginTop: '8px'}}>
            <StopPropagationBoundary
              onStopped={() => log('Fragment stopPropagation called')}>
              <button
                onClick={() => log('Child onClick (inside boundary)')}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#e8f5e9',
                  border: '2px solid #4caf50',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}>
                Inside boundary
              </button>
            </StopPropagationBoundary>
            <button
              onClick={() => log('Child onClick (outside boundary)')}
              style={{
                padding: '8px 16px',
                backgroundColor: '#fff3e0',
                border: '2px solid #ff9800',
                borderRadius: '4px',
                cursor: 'pointer',
              }}>
              Outside boundary
            </button>
          </div>
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
