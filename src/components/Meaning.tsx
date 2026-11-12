import type { Analysis } from "../domain/models";
export function Meaning({ analysis: a }: { analysis: Analysis }) {
  return (
    <div className="meaning">
      <div className="tags">
        <span>{a.partOfSpeech}</span>
        {a.isPhrasalVerb && a.partOfSpeech !== "phrasal verb" && (
          <span>phrasal verb</span>
        )}
        {a.tense !== "Not applicable" && <span>{a.tense}</span>}
      </div>
      <h3>General meaning</h3>
      <p>{a.meaning}</p>
      <h3>In this context</h3>
      <p>{a.contextMeaning}</p>
      <details>
        <summary>Grammar & examples</summary>
        <p>
          <strong>Base form:</strong> {a.baseForm}
        </p>
        <p>{a.grammarNotes}</p>
        {a.examples.map((example, i) => (
          <blockquote key={i}>{example}</blockquote>
        ))}
      </details>
    </div>
  );
}
