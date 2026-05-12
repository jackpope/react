import TestCase from '../../TestCase';
import Fixture from '../../Fixture';

const React = window.React;
const {Fragment, useState} = React;

export default function OnPointerCase() {
  const [eventLog, setEventLog] = useState([]);

  const log = msg => setEventLog(prev => [...prev, msg]);
  const clear = () => setEventLog([]);

  return (
    <TestCase title="onPointerEnter / onPointerLeave / onPointerDown / onPointerUp">
      <TestCase.Steps>
        <li>Move mouse into Child A — observe pointer enter events</li>
        <li>Click and release — observe pointer down/up events</li>
        <li>
          Move between children — Fragment pointer enter/leave should NOT fire
          (same as mouse enter/leave)
        </li>
        <li>Move mouse out — observe pointer leave events</li>
      </TestCase.Steps>

      <TestCase.ExpectedResult>
        <p>
          Fragment pointer event handlers work like their mouse counterparts.
          onPointerEnter/Leave are non-bubbling and use enter/leave semantics
          (moving between children does not trigger the Fragment handler).
          onPointerDown/Up bubble normally through the Fragment.
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
            onPointerEnter={() => log('Fragment onPointerEnter')}
            onPointerLeave={() => log('Fragment onPointerLeave')}
            onPointerDown={() => log('Fragment onPointerDown')}
            onPointerUp={() => log('Fragment onPointerUp')}>
            <div
              onPointerEnter={() => log('Child A onPointerEnter')}
              onPointerLeave={() => log('Child A onPointerLeave')}
              style={{
                display: 'inline-block',
                padding: '20px 40px',
                margin: '10px',
                backgroundColor: '#f0f0f0',
                border: '2px solid #9c27b0',
                borderRadius: '4px',
                cursor: 'pointer',
              }}>
              Child A
            </div>
            <div
              onPointerEnter={() => log('Child B onPointerEnter')}
              onPointerLeave={() => log('Child B onPointerLeave')}
              style={{
                display: 'inline-block',
                padding: '20px 40px',
                margin: '10px',
                backgroundColor: '#f0f0f0',
                border: '2px solid #9c27b0',
                borderRadius: '4px',
                cursor: 'pointer',
              }}>
              Child B
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
        maxHeight: '200px',
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
