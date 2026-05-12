import TestCase from '../../TestCase';
import Fixture from '../../Fixture';

const React = window.React;
const {Fragment, useState} = React;

export default function OnDoubleClickCase() {
  const [eventLog, setEventLog] = useState([]);

  const log = msg => setEventLog(prev => [...prev, msg]);
  const clear = () => setEventLog([]);

  return (
    <TestCase title="onDoubleClick / onContextMenu / onMouseDown / onMouseUp">
      <TestCase.Steps>
        <li>Double-click the child — observe onDoubleClick fires</li>
        <li>Right-click the child — observe onContextMenu fires</li>
        <li>Click and hold — observe onMouseDown, then release for onMouseUp</li>
      </TestCase.Steps>

      <TestCase.ExpectedResult>
        <p>
          All standard mouse event handlers work on Fragments. They participate
          in synthetic event dispatch and bubble from children through the
          Fragment just like a wrapper div.
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
            onDoubleClick={() => log('Fragment onDoubleClick')}
            onContextMenu={e => {
              e.preventDefault();
              log('Fragment onContextMenu');
            }}
            onMouseDown={() => log('Fragment onMouseDown')}
            onMouseUp={() => log('Fragment onMouseUp')}>
            <div
              onDoubleClick={() => log('Child onDoubleClick')}
              onContextMenu={() => log('Child onContextMenu')}
              onMouseDown={() => log('Child onMouseDown')}
              onMouseUp={() => log('Child onMouseUp')}
              style={{
                display: 'inline-block',
                padding: '20px 40px',
                margin: '10px',
                backgroundColor: '#f0f0f0',
                border: '2px solid #607d8b',
                borderRadius: '4px',
                cursor: 'pointer',
                userSelect: 'none',
              }}>
              Interact with me
            </div>
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
