import type { BookableTimes } from "../../api/types";
import { formatTime } from "../../shared/dates";

interface TimeChoicesProps {
  periods: BookableTimes["periods"];
  selected: string | null;
  disabled: boolean;
  onSelect: (time: string) => void;
}

/** One radio group across all service periods; nothing is preselected. */
export function TimeChoices({ periods, selected, disabled, onSelect }: TimeChoicesProps) {
  return (
    <div className="time-choices">
      {periods.map((period) => (
        <fieldset key={period.name} className="time-period">
          <legend>{period.name}</legend>
          <div className="time-period__list">
            {period.times.map((time) => {
              const isSelected = selected === time;
              return (
                <label
                  key={time}
                  className={isSelected ? "time-choice time-choice--selected" : "time-choice"}
                >
                  <input
                    type="radio"
                    name="time"
                    value={time}
                    checked={isSelected}
                    disabled={disabled}
                    onChange={() => {
                      onSelect(time);
                    }}
                  />
                  <span>
                    {isSelected ? <span aria-hidden="true">✓ </span> : null}
                    {formatTime(time)}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
