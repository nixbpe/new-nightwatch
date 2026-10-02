import { intervalText } from "./labels";

/** The interval sentence with its number in mono and the Thai unit in sans (TYP-04). */
export function IntervalText({ seconds }: { seconds: number }) {
  const text = intervalText(seconds);
  const match = /^(\S+ )(\d+)( .+)$/.exec(text);
  if (match === null) return <span>{text}</span>;
  return (
    <span>
      {match[1]}
      <span className="font-mono">{match[2]}</span>
      {match[3]}
    </span>
  );
}
