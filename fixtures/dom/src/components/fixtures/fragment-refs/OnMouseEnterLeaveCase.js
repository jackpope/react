import TestCase from '../../TestCase';
import Fixture from '../../Fixture';

const React = window.React;
const {Fragment, useState} = React;

export default function OnMouseEnterLeaveCase() {
  const [eventLog, setEventLog] = useState([]);
  const [fragmentHovered, setFragmentHovered] = useState(false);

  const log = msg => setEventLog(prev => [...prev, msg]);
  const clear = () => {
    setEventLog([]);
    setFragmentHovered(false);
  };

  return (
    <TestCase title="onMouseEnter / onMouseLeave Handlers">
      <TestCase.Steps>
        <li>
          Move mouse from outside into Child A — observe Fragment onMouseEnter
          fires and highlight appears
        </li>
        <li>
          Move mouse from Child A to Child B (staying within the Fragment) —
          observe that Fragment onMouseEnter/Leave does NOT fire since both
          children share the same Fragment ancestor
        </li>
        <li>
          Move mouse from Child B to the gap between children (still within the
          parent div but outside Fragment children) — observe Fragment
          onMouseLeave fires
        </li>
        <li>
          Move mouse completely outside the parent — observe both Fragment and
          parent onMouseLeave fire
        </li>
      </TestCase.Steps>

      <TestCase.ExpectedResult>
        <p>
          Fragment onMouseEnter fires when the mouse enters any child of the
          Fragment from outside. It does NOT fire when moving between children
          within the same Fragment (matching wrapper div behavior). Fragment
          onMouseLeave fires when the mouse leaves all Fragment children.
        </p>
        <p>
          The common-ancestor logic handles "moving between Fragment children"
          correctly: the Fragment is the common ancestor, so it sits on neither
          the from-path nor the to-path, and enter/leave handlers don't fire.
        </p>
      </TestCase.ExpectedResult>

      <Fixture>
        <Fixture.Controls>
          <button onClick={clear}>Clear log</button>
          <span style={{marginLeft: '12px', fontFamily: 'monospace'}}>
            Fragment hovered: {fragmentHovered ? 'true' : 'false'}
          </span>
        </Fixture.Controls>
        <div
          onMouseEnter={() => log('Parent div onMouseEnter')}
          onMouseLeave={() => log('Parent div onMouseLeave')}
          style={{
            padding: '20px',
            border: '2px solid #999',
            borderRadius: '4px',
          }}>
          <span style={{fontSize: '12px', color: '#666'}}>Parent div</span>
          <Fragment
            onMouseEnter={() => {
              log('Fragment onMouseEnter');
              setFragmentHovered(true);
            }}
            onMouseLeave={() => {
              log('Fragment onMouseLeave');
              setFragmentHovered(false);
            }}>
            <div
              onMouseEnter={() => log('Child A onMouseEnter')}
              onMouseLeave={() => log('Child A onMouseLeave')}
              style={{
                display: 'inline-block',
                padding: '20px 40px',
                margin: '10px',
                backgroundColor: fragmentHovered ? '#e3f2fd' : '#f0f0f0',
                border: '2px solid #2196F3',
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'background-color 0.15s',
              }}>
              Child A
            </div>
            <div
              onMouseEnter={() => log('Child B onMouseEnter')}
              onMouseLeave={() => log('Child B onMouseLeave')}
              style={{
                display: 'inline-block',
                padding: '20px 40px',
                margin: '10px',
                backgroundColor: fragmentHovered ? '#e3f2fd' : '#f0f0f0',
                border: '2px solid #2196F3',
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'background-color 0.15s',
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
