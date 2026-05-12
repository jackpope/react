import TestCase from '../../TestCase';
import Fixture from '../../Fixture';

const React = window.React;
const {Fragment, useState} = React;

export default function OnChangeCase() {
  const [eventLog, setEventLog] = useState([]);

  const log = msg => setEventLog(prev => [...prev, msg]);
  const clear = () => setEventLog([]);

  return (
    <TestCase title="onChange Handler">
      <TestCase.Steps>
        <li>Type in "Input A" — observe child and Fragment onChange both fire</li>
        <li>Select a different option in the dropdown — observe the same</li>
        <li>Toggle the checkbox — observe the same</li>
      </TestCase.Steps>

      <TestCase.ExpectedResult>
        <p>
          Fragment onChange fires when any child form element's value changes,
          bubbling just like a wrapper div. The child's own onChange fires first,
          then the Fragment's onChange.
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
            onChange={e =>
              log(`Fragment onChange (target: ${e.target.type || e.target.tagName})`)
            }>
            <div
              style={{
                display: 'flex',
                gap: '12px',
                flexWrap: 'wrap',
                alignItems: 'center',
              }}>
              <input
                type="text"
                placeholder="Input A"
                onChange={e => log(`Input onChange: "${e.target.value}"`)}
                style={{padding: '6px'}}
              />
              <select onChange={e => log(`Select onChange: "${e.target.value}"`)}>
                <option value="one">One</option>
                <option value="two">Two</option>
                <option value="three">Three</option>
              </select>
              <label>
                <input
                  type="checkbox"
                  onChange={e =>
                    log(`Checkbox onChange: ${e.target.checked}`)
                  }
                />{' '}
                Checkbox
              </label>
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
